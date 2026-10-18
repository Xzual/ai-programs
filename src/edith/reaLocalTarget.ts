import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, opendir, realpath, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

export interface ReaLocalTargetBinding {
  readonly kind: 'file' | 'directory';
  readonly workspaceRoot: string;
  readonly absolutePath: string;
  readonly sha256: string;
}
export interface ReaLocalTargetOptions {
  readonly stagingRoot: string;
  readonly guard: () => void;
  readonly allowedFileExtensions: readonly string[];
}
declare const targetBrand: unique symbol;
export interface ReaLocalTarget {
  readonly [targetBrand]: true;
  readonly stagedPath: string;
  readonly workDirectory: string;
  readonly kind: 'file' | 'directory';
  readonly sha256: string;
  verify(): Promise<void>;
  dispose(): Promise<{ removed: boolean }>;
}
export class ReaLocalTargetError extends Error { constructor(readonly code: string) { super(code); this.name = 'ReaLocalTargetError'; } }
const TargetError = ReaLocalTargetError;
const fail = (code = 'REA_SELECTION_FORBIDDEN'): never => { throw new TargetError(code); };
const MAX_BYTES = 67108864, MAX_ENTRIES = 2048, MAX_DEPTH = 24;
type Stat = Awaited<ReturnType<typeof lstat>>;
type Entry = { relative: string; kind: 'file' | 'directory'; stat: Stat; sha256?: string };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const jsonHash = (value: unknown) => hash(canonical(value));
const artifactId = (sha256: string) => `art_${jsonHash({ sha256 })}`;
const compare = (left: string, right: string) => {
  const a = Array.from(left, item => item.codePointAt(0)!), b = Array.from(right, item => item.codePointAt(0)!);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
};
const inside = (root: string, target: string) => { const rel = path.relative(root, target); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); };
const same = (a: Stat, b: Stat) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const privacy = /^(?:credentials?(?:[._-].*)?|secrets?(?:[._-].*)?|tokens?(?:[._-].*)?|passwords?(?:[._-].*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|authorized_keys|known_hosts|private(?:[._-].*)?|vault(?:[._-].*)?)$/iu;
function component(value: string): void {
  if (!value || value.length > 128) fail('REA_SELECTION_LIMIT');
  if (value.startsWith('.') || value.normalize('NFC') !== value || /[\x00-\x1f\x7f/\\:<>"|?*]/u.test(value)
    || /[. ]$/u.test(value) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(value)
    || privacy.test(value) || /\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$/iu.test(value)) fail();
}
function logical(value: string): string[] {
  if (!value || value.length > 1024 || value.startsWith('/') || value.includes('\\')) fail();
  const parts = value.split('/'); if (parts.length > MAX_DEPTH) fail('REA_SELECTION_LIMIT');
  parts.forEach(component); return parts;
}
function namesRegistry() {
  const all = new Map<string, 'file' | 'directory'>(), folded = new Map<string, string>();
  return (value: string, kind: 'file' | 'directory') => {
    const parts = logical(value); let prefix = '';
    for (let i = 0; i < parts.length; i++) {
      prefix = prefix ? `${prefix}/${parts[i]!}` : parts[i]!;
      const fold = prefix.toLocaleLowerCase('en-US'), spelling = folded.get(fold);
      if (spelling !== undefined && spelling !== prefix) fail();
      folded.set(fold, prefix);
      if (i < parts.length - 1 && all.get(prefix) === 'file') fail();
    }
    if (all.has(value) || (kind === 'file' && [...all.keys()].some(item => item.startsWith(`${value}/`)))) fail();
    all.set(value, kind);
  };
}
async function watched<T>(action: Promise<T>, guard: () => void): Promise<T> { const value = await action; guard(); return value; }
async function canonicalPath(value: string, guard: () => void) {
  guard(); if (await watched(realpath(value), guard) !== value) fail();
  const stat = await watched(lstat(value), guard); if (stat.isSymbolicLink()) fail(); return stat;
}
async function list(directory: string, guard: () => void, remaining: number): Promise<string[]> {
  guard(); const handle = await opendir(directory); const names: string[] = [];
  try {
    guard(); for (;;) {
      const entry = await watched(handle.read(), guard); if (!entry) break;
      if (names.length >= remaining) fail('REA_SELECTION_LIMIT'); names.push(entry.name);
    }
  } finally { await handle.close(); }
  return names.sort(compare);
}
async function enumerate(root: string, kind: ReaLocalTargetBinding['kind'], guard: () => void): Promise<Entry[]> {
  const rootStat = await canonicalPath(root, guard);
  if (kind === 'file') { if (!rootStat.isFile()) fail(); return [{ relative: '', kind, stat: rootStat }]; }
  if (!rootStat.isDirectory()) fail();
  const entries: Entry[] = [{ relative: '', kind: 'directory', stat: rootStat }];
  const queue = ['']; const register = namesRegistry(); let bytes = 0;
  while (queue.length) {
    const relative = queue.pop()!, absolute = relative ? path.join(root, ...relative.split('/')) : root;
    const parent = entries.find(entry => entry.relative === relative)!;
    const before = await canonicalPath(absolute, guard); if (!same(before, parent.stat)) fail('REA_SELECTION_CHANGED');
    const names = await list(absolute, guard, MAX_ENTRIES - entries.length + 1);
    // Validate the complete listing before inspecting or opening any member bytes.
    for (const name of names) component(name);
    for (const name of names) {
      if (entries.length > MAX_ENTRIES) fail('REA_SELECTION_LIMIT');
      const child = relative ? `${relative}/${name}` : name; logical(child);
      const stat = await canonicalPath(path.join(root, ...child.split('/')), guard);
      if (!stat.isFile() && !stat.isDirectory()) fail();
      const entryKind = stat.isDirectory() ? 'directory' : 'file'; register(child, entryKind);
      if (entryKind === 'file' && name.toLowerCase().endsWith('.asar')) fail('REA_NOT_AVAILABLE');
      if (entryKind === 'file') { bytes += stat.size; if (stat.size > MAX_BYTES || bytes > MAX_BYTES) fail('REA_SELECTION_LIMIT'); }
      entries.push({ relative: child, kind: entryKind, stat }); if (entryKind === 'directory') queue.push(child);
    }
    if (!same(await canonicalPath(absolute, guard), before)) fail('REA_SELECTION_CHANGED');
  }
  return entries.sort((a, b) => compare(a.relative, b.relative));
}
function directoryDigest(entries: readonly Entry[]): string {
  const identities = new Map<string, string>();
  for (const entry of entries) if (entry.kind === 'file') identities.set(entry.relative, artifactId(entry.sha256!));
  for (const dir of entries.filter(entry => entry.kind === 'directory' && entry.relative).sort((a, b) => b.relative.split('/').length - a.relative.split('/').length)) {
    const children = entries.filter(entry => entry.relative && path.posix.dirname(entry.relative) === dir.relative).map(entry => ({
      name: entry.relative.slice(dir.relative.length + 1), artifact_id: identities.get(entry.relative)!, entry_kind: entry.kind,
    })).sort((a, b) => compare(a.name, b.name));
    identities.set(dir.relative, artifactId(jsonHash({ kind: 'directory', children })));
  }
  return jsonHash({ kind: 'directory-root', children: entries.filter(entry => entry.relative).map(entry => ({ logical_path: entry.relative, artifact_id: identities.get(entry.relative)! })).sort((a, b) => compare(a.logical_path, b.logical_path)) });
}
async function digestFile(absolute: string, expected: Stat, guard: () => void, destination?: string): Promise<string> {
  guard(); const source = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let output: FileHandle | undefined;
  try {
    guard(); const initial = await watched(source.stat(), guard);
    if (!initial.isFile() || !same(initial, expected)) fail('REA_SELECTION_CHANGED');
    if (initial.size > MAX_BYTES) fail('REA_SELECTION_LIMIT');
    if (destination) { output = await open(destination, 'wx', 0o600); guard(); }
    const digest = createHash('sha256'), buffer = Buffer.alloc(65536); let bytes = 0;
    for (;;) {
      const read = await watched(source.read(buffer, 0, Math.min(buffer.length, initial.size - bytes + 1), null), guard);
      if (!read.bytesRead) break; bytes += read.bytesRead; if (bytes > initial.size || bytes > MAX_BYTES) fail('REA_SELECTION_CHANGED');
      digest.update(buffer.subarray(0, read.bytesRead));
      if (output) { let offset = 0; while (offset < read.bytesRead) {
        const written = await watched(output.write(buffer, offset, read.bytesRead - offset, null), guard); if (!written.bytesWritten) fail('REA_SNAPSHOT_FAILED'); offset += written.bytesWritten;
      } }
    }
    if (bytes !== initial.size || !same(initial, await watched(source.stat(), guard)) || !same(initial, await canonicalPath(absolute, guard))) fail('REA_SELECTION_CHANGED');
    return digest.digest('hex');
  } finally { try { if (output) await output.close(); } finally { await source.close(); } }
}
const zipExtensions = new Set(['.zip', '.ipa', '.apk', '.msix', '.appx', '.hap', '.hsp', '.app-pack']);
/** A narrow no-extraction ZIP gate. Unsupported metadata is refused, never approximated. */
function preflightZip(data: Buffer): void {
  if (data.length < 22) fail('REA_NOT_AVAILABLE');
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 65557); at--) if (data.readUInt32LE(at) === 0x06054b50 && at + 22 + data.readUInt16LE(at + 20) === data.length) { end = at; break; }
  if (end < 0) fail('REA_NOT_AVAILABLE');
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), start = data.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES || count === 65535 || size === 0xffffffff || start === 0xffffffff || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) || data.readUInt16LE(end + 8) !== count || start + size !== end) fail('REA_NOT_AVAILABLE');
  const register = namesRegistry(), ranges: [number, number][] = []; let at = start, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || data.readUInt32LE(at) !== 0x02014b50) fail('REA_NOT_AVAILABLE');
    const flags = data.readUInt16LE(at + 8), method = data.readUInt16LE(at + 10), compressed = data.readUInt32LE(at + 20), bytes = data.readUInt32LE(at + 24);
    const nameSize = data.readUInt16LE(at + 28), extra = data.readUInt16LE(at + 30), comment = data.readUInt16LE(at + 32), local = data.readUInt32LE(at + 42);
    if ((flags & ~0x800) || ![0, 8].includes(method) || extra || comment || data.readUInt16LE(at + 34) || compressed === 0xffffffff || bytes === 0xffffffff || at + 46 + nameSize > end) fail('REA_NOT_AVAILABLE');
    const nameBytes = data.subarray(at + 46, at + 46 + nameSize);
    if (!(flags & 0x800) && nameBytes.some(byte => byte > 127)) fail('REA_NOT_AVAILABLE');
    const name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(nameBytes), directory = name.endsWith('/');
    register(directory ? name.slice(0, -1) : name, directory ? 'directory' : 'file');
    const mode = data.readUInt32LE(at + 38) >>> 16;
    if ((mode & 0xf000) !== 0 && (mode & 0xf000) !== 0x8000 && (mode & 0xf000) !== 0x4000) fail();
    expanded += bytes; if (expanded > MAX_BYTES || (compressed === 0 && bytes !== 0) || bytes > Math.max(1048576, compressed * 100)) fail('REA_SELECTION_LIMIT');
    if (local + 30 > start || data.readUInt32LE(local) !== 0x04034b50 || data.readUInt16LE(local + 6) !== flags || data.readUInt16LE(local + 8) !== method
      || data.readUInt32LE(local + 14) !== data.readUInt32LE(at + 16) || data.readUInt32LE(local + 18) !== compressed || data.readUInt32LE(local + 22) !== bytes
      || data.readUInt16LE(local + 26) !== nameSize || data.readUInt16LE(local + 28) !== 0) fail('REA_NOT_AVAILABLE');
    const extent = local + 30 + nameSize + compressed;
    if (extent > start || !data.subarray(local + 30, local + 30 + nameSize).equals(nameBytes) || ranges.some(([a, b]) => local < b && extent > a)) fail('REA_NOT_AVAILABLE');
    ranges.push([local, extent]); at += 46 + nameSize;
  }
  if (at !== end) fail('REA_NOT_AVAILABLE');
}
/** Match the published Chromium pickle extents; members are never materialized. */
function preflightAsar(data: Buffer): void {
  // Existing synthetic/non-ASAR bytes are left to the real provider's format validator.
  if (data.length < 4 || data.readUInt32LE(0) !== 4) return;
  if (data.length < 16) fail('REA_NOT_AVAILABLE');
  const headerBytes = data.readUInt32LE(4), payloadBytes = data.readUInt32LE(8), jsonBytes = data.readUInt32LE(12);
  if (headerBytes < 8 || headerBytes > data.length - 8 || headerBytes > 1048576 || payloadBytes !== headerBytes - 4 || jsonBytes > payloadBytes - 4) fail('REA_NOT_AVAILABLE');
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data.subarray(16, 16 + jsonBytes)));
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('REA_NOT_AVAILABLE'); return value as Record<string, unknown>;
  };
  const root = record(parsed); if (!Object.hasOwn(root, 'files')) fail('REA_NOT_AVAILABLE');
  const queue = [{ prefix: '', files: record(root.files) }], register = namesRegistry(), ranges: [number, number][] = [];
  let count = 0, bytes = 0;
  while (queue.length) {
    const item = queue.pop()!;
    for (const [name, raw] of Object.entries(item.files)) {
      if (++count > MAX_ENTRIES) fail('REA_SELECTION_LIMIT'); component(name);
      const relative = item.prefix ? `${item.prefix}/${name}` : name, metadata = record(raw);
      if (Object.hasOwn(metadata, 'link') || metadata.unpacked !== undefined && metadata.unpacked !== false) fail('REA_NOT_AVAILABLE');
      const directory = Object.hasOwn(metadata, 'files'); register(relative, directory ? 'directory' : 'file');
      if (directory) { queue.push({ prefix: relative, files: record(metadata.files) }); continue; }
      if (typeof metadata.size !== 'number' || !Number.isSafeInteger(metadata.size) || metadata.size < 0 || typeof metadata.offset !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/u.test(metadata.offset)) fail('REA_NOT_AVAILABLE');
      const size = metadata.size as number;
      const start = 8 + headerBytes + Number(metadata.offset), end = start + size;
      if (!Number.isSafeInteger(end) || start > data.length || end > data.length || ranges.some(([a, b]) => start < b && end > a)) fail('REA_NOT_AVAILABLE');
      bytes += size; if (bytes > MAX_BYTES) fail('REA_SELECTION_LIMIT'); ranges.push([start, end]);
    }
  }
}
async function archivePreflight(absolute: string, extension: string, guard: () => void): Promise<void> {
  if (!zipExtensions.has(extension) && extension !== '.asar') return;
  guard(); const handle = await open(absolute, 'r');
  try {
    guard(); const stat = await watched(handle.stat(), guard); if (!stat.isFile() || stat.size > MAX_BYTES) fail('REA_SELECTION_LIMIT');
    const data = Buffer.alloc(stat.size); let offset = 0;
    while (offset < data.length) { const read = await watched(handle.read(data, offset, Math.min(65536, data.length - offset), offset), guard); if (!read.bytesRead) fail('REA_SELECTION_CHANGED'); offset += read.bytesRead; }
    if (extension === '.asar') preflightAsar(data); else preflightZip(data); guard();
  } finally { await handle.close(); }
}
/** Cleanup ignores authority revocation, but never follows provider-created links. */
async function removeOwned(root: string, identity: Pick<Stat, 'dev' | 'ino'>): Promise<{ removed: boolean }> {
  try {
    const rootStat = await lstat(root); if (rootStat.dev !== identity.dev || rootStat.ino !== identity.ino || rootStat.isSymbolicLink() || !rootStat.isDirectory() || await realpath(root) !== root) return { removed: false };
    const identities = new Map<string, Pick<Stat, 'dev' | 'ino'>>([[root, identity]]);
    const stable = async (value: string) => {
      const stat = await lstat(value), expected = identities.get(value);
      return expected !== undefined && expected.dev === stat.dev && expected.ino === stat.ino && stat.isDirectory() && !stat.isSymbolicLink() && await realpath(value) === value;
    };
    const directories: string[] = [root], files: string[] = []; let count = 0, outputBytes = 0;
    for (let i = 0; i < directories.length; i++) {
      const dir = directories[i]!; if (!inside(root, dir) || !await stable(root) || !await stable(dir)) return { removed: false };
      const handle = await opendir(dir);
      try { for (;;) {
        const entry = await handle.read(); if (!entry) break;
        if (++count > MAX_ENTRIES + 4) return { removed: false };
        const target = path.join(dir, entry.name), rel = path.relative(root, target);
        if (!inside(root, target) || rel.split(path.sep).length > MAX_DEPTH + 3) return { removed: false };
        const stat = await lstat(target);
        if (rel === 'work' || rel.startsWith(`work${path.sep}`)) {
          const outputRelative = path.relative(path.join(root, 'work'), target), parts = outputRelative.split(path.sep).filter(Boolean);
          if (outputRelative.length > 1024 || parts.length > MAX_DEPTH || parts.some(part => part.length > 128)) return { removed: false };
          if (stat.isFile()) outputBytes += stat.size;
          if (outputBytes > MAX_BYTES || stat.isFile() && stat.size > MAX_BYTES) return { removed: false };
        }
        if (stat.isSymbolicLink() || stat.isFile()) files.push(target);
        else if (stat.isDirectory()) { directories.push(target); identities.set(target, stat); } else return { removed: false };
      } } finally { await handle.close(); }
    }
    for (const file of files) { if (!inside(root, file) || !await stable(root) || !await stable(path.dirname(file))) return { removed: false }; await unlink(file); }
    for (const dir of directories.reverse()) {
      if (!inside(root, dir) || !await stable(root) || !await stable(dir)) return { removed: false };
      await rmdir(dir);
    }
    return { removed: true };
  } catch { return { removed: false }; }
}

async function captureLocalTarget(binding: ReaLocalTargetBinding, options: ReaLocalTargetOptions): Promise<ReaLocalTarget> {
  // All arguments are private backend composition; snapshot mutable arrays/records before awaiting.
  const selected = { ...binding }, stagingRoot = path.resolve(options.stagingRoot), guard = options.guard, extensions = [...options.allowedFileExtensions];
  if (!['file', 'directory'].includes(selected.kind) || !/^[a-f0-9]{64}$/u.test(selected.sha256) || !path.isAbsolute(selected.absolutePath) || !path.isAbsolute(selected.workspaceRoot) || !path.isAbsolute(options.stagingRoot)) fail();
  const workspace = path.resolve(selected.workspaceRoot), original = path.resolve(selected.absolutePath);
  if (!inside(workspace, original)) fail();
  component(path.basename(original));
  guard(); await canonicalPath(workspace, guard);
  const stagingStat = await canonicalPath(stagingRoot, guard);
  if (!stagingStat.isDirectory() || inside(workspace, stagingRoot) || inside(stagingRoot, workspace)) fail('REA_STAGING_FORBIDDEN');
  // Verify every selected ancestor before enumeration, including links contained inside the workspace.
  let ancestor = workspace;
  for (const part of path.relative(workspace, original).split(path.sep).filter(Boolean)) { component(part); ancestor = path.join(ancestor, part); await canonicalPath(ancestor, guard); }
  const extension = path.extname(original).toLowerCase();
  if (selected.kind === 'file' && !extensions.includes(extension)) fail('REA_SELECTION_KIND_NOT_IMPLEMENTED');
  let owned: string | undefined, ownedIdentity: Stat | undefined;
  try {
    const entries = await enumerate(original, selected.kind, guard);
    owned = await mkdtemp(path.join(stagingRoot, 'rea-'));
    // Capture cleanup ownership even if authority was revoked during mkdtemp.
    ownedIdentity = await lstat(owned); guard();
    const inputDirectory = path.join(owned, 'input'), workDirectory = path.join(owned, 'work');
    await watched(mkdir(inputDirectory), guard); await watched(mkdir(workDirectory), guard);
    const stagedPath = path.join(inputDirectory, selected.kind === 'directory' ? 'target' : `target${extension}`);
    if (selected.kind === 'directory') await watched(mkdir(stagedPath), guard);
    for (const entry of entries.filter(item => item.relative && item.kind === 'directory').sort((a, b) => a.relative.split('/').length - b.relative.split('/').length)) await watched(mkdir(path.join(stagedPath, ...entry.relative.split('/'))), guard);
    for (const entry of entries) if (entry.kind === 'file') {
      const source = entry.relative ? path.join(original, ...entry.relative.split('/')) : original, destination = entry.relative ? path.join(stagedPath, ...entry.relative.split('/')) : stagedPath;
      entry.sha256 = await digestFile(source, entry.stat, guard, destination); guard();
      await archivePreflight(destination, path.extname(source).toLowerCase(), guard);
    }
    const observedDigest = selected.kind === 'file' ? entries[0]!.sha256! : directoryDigest(entries);
    if (observedDigest !== selected.sha256) fail('REA_SELECTION_CHANGED');
    const verifyTree = async (root: string, source: boolean) => {
      const current = await enumerate(root, selected.kind, guard);
      if (current.length !== entries.length || current.some((entry, i) => entry.relative !== entries[i]!.relative || entry.kind !== entries[i]!.kind || (source && !same(entry.stat, entries[i]!.stat)))) fail('REA_SELECTION_CHANGED');
      for (const entry of current) if (entry.kind === 'file') entry.sha256 = await digestFile(entry.relative ? path.join(root, ...entry.relative.split('/')) : root, entry.stat, guard);
      if ((selected.kind === 'file' ? current[0]!.sha256 : directoryDigest(current)) !== selected.sha256) fail('REA_SELECTION_CHANGED');
    };
    let disposed = false;
    const verify = async () => {
      try { guard(); if (disposed) fail('REA_SELECTION_REVOKED'); await verifyTree(original, true); await verifyTree(stagedPath, false); guard(); }
      catch (error) { if (error instanceof TargetError) throw error; throw new TargetError('REA_TARGET_REJECTED'); }
    };
    await verify(); guard();
    const ownedRoot = owned, rootIdentity = ownedIdentity;
    return Object.freeze({ stagedPath, workDirectory, kind: selected.kind, sha256: selected.sha256, verify,
      async dispose() { if (disposed) return { removed: true }; const receipt = await removeOwned(ownedRoot, rootIdentity); if (receipt.removed) disposed = true; return receipt; },
    }) as ReaLocalTarget;
  } catch (error) {
    if (owned && (!ownedIdentity || !(await removeOwned(owned, ownedIdentity)).removed)) fail('REA_CLEANUP_UNKNOWN');
    if (error instanceof TargetError) throw error;
    // Do not propagate filesystem paths, arbitrary guard diagnostics or parser messages.
    throw new TargetError('REA_TARGET_REJECTED');
  }
}

export async function materializeReaLocalTarget(binding: ReaLocalTargetBinding, options: ReaLocalTargetOptions): Promise<ReaLocalTarget> {
  try { return await captureLocalTarget(binding, options); }
  catch (error) { if (error instanceof TargetError) throw error; throw new TargetError('REA_TARGET_REJECTED'); }
}
