import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import { reaProjectionDigest } from '../../src/edith/reaIntegrationContract';
import { workspaceManager } from '../../src/edith/workspaceManager';

export type FileRoot = { id: 'workspace' | 'artifacts'; path: string; excluded?: string[] };
export type FileMetadata = { id: string; root: FileRoot['id']; relativePath: string; name: string; size: number; modifiedAt: string; readable: boolean };
export type ExplorerDirectoryMetadata = { id: string; rootId: FileRoot['id']; name: string; relativePath: string };
export type ExplorerDirectoryHandle = { id: string; rootId: FileRoot['id']; rootIdentity: string; absolutePath: string; realRoot: string; identity: string; device: string };
export type ExplorerFileSnapshot = { rootId: FileRoot['id']; absolutePath: string; identity: string; device: string; contentSha256: string; sizeBytes: number };
export interface ReaIndexedTargetSnapshot {
  readonly kind: 'file' | 'directory'; readonly rootId: FileRoot['id'];
  readonly workspaceRoot: string; readonly absolutePath: string;
  readonly sha256: string; readonly identityDigest: string; readonly sizeBytes: number; readonly entries: number;
}
type ReaTargetRow = { relative: string; kind: 'file' | 'directory'; metadata: string; sha256?: string };
const reaCompare = (a: string, b: string): number => {
  const left = Array.from(a, c => c.codePointAt(0)!), right = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
};
function reaMetadata(stat: fs.BigIntStats): string {
  return [stat.dev,stat.ino,stat.mode,stat.nlink,stat.size,stat.birthtimeNs,stat.mtimeNs,stat.ctimeNs].join(':');
}
function reaName(name: string): void {
  if (!name || name.length > 128 || name.startsWith('.') || name.normalize('NFC') !== name
    || /[\x00-\x1f\x7f/\\:<>"|?*]/u.test(name) || /[. ]$/u.test(name)
    || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(name)
    || DENIED.test(name) || PRIVATE_FILE.test(name)
    || /^(?:authorized_keys|known_hosts|private(?:[._-].*)?|vault(?:[._-].*)?)$/iu.test(name)
    || /\.(?:jks|keystore|kdbx)$/iu.test(name)) throw new FileServiceError('FILE_SCOPE_DENIED',403);
}
/** Backend-only live object proof. Never serialized into an Explorer receipt. */
export interface ExplorerFilePin { matches(snapshot: ExplorerFileSnapshot): boolean; close(): void }
function fileIdentity(stat: fs.Stats): string { return createHash('sha256').update(JSON.stringify([stat.dev,stat.ino,stat.birthtimeMs])).digest('hex'); }
export class FileServiceError extends Error { constructor(readonly code: string, readonly status = 400) { super(code); } }
const TEXT = new Set(['.txt','.md','.json','.csv','.tsv','.html','.css','.js','.ts','.tsx','.jsx','.yaml','.yml','.xml','.svg','.tex','.log']);
const DENIED = /^(?:\.git|node_modules|\.edith(?:-build)?|\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.cursor|\.restore-review|local-state|runtime|data|logs|config|backup(?:s|-reference)?|recovery|restore|yedekler|obsidian|vault|secrets?|credentials?|dist|build|coverage|\.next|\.?venv|vendor|\.?cache|__pycache__)$/i;
const PRIVATE_FILE = /(?:^\.env|(?:secret|credential|password|token|private[-_]?key)|\.(?:db|sqlite(?:3)?|pem|key|p12|pfx|bak)(?:[-.].*)?$|^id_(?:rsa|ed25519)|^\.npmrc$)/i;
function inside(root: string, candidate: string): boolean { const rel = path.relative(root,candidate); return rel === '' || (!rel.startsWith('..'+path.sep) && rel !== '..' && !path.isAbsolute(rel)); }

/** Read-only discovery. IDs expire when the service restarts or a root changes. */
export class FileService {
  private readonly reaTargets = new WeakMap<ReaIndexedTargetSnapshot, { root: FileRoot; realRoot: string; rows: ReaTargetRow[] }>();
  private readonly salt = randomBytes(32);
  private readonly index = new Map<string, { root: FileRoot; realRoot: string; relativePath: string }>();
  private readonly directories = new Map<string,{root:FileRoot;realRoot:string;relativePath:string;identity:string}>();
  private readonly preciseSnapshots = new WeakMap<ExplorerFileSnapshot, fs.BigIntStats>();
  private readonly pins = new Set<ExplorerFilePin>();
  private acquiredPins = 0;
  private releasedPins = 0;
  constructor(private readonly roots: () => FileRoot[] = defaultRoots) {}
  explorerPinStatus() { return { active: this.pins.size, acquired: this.acquiredPins, released: this.releasedPins }; }
  sameExplorerFileKey(a: ExplorerFileSnapshot, b: ExplorerFileSnapshot): boolean {
    const left=this.preciseSnapshots.get(a),right=this.preciseSnapshots.get(b);
    return !!left && !!right && left.dev===right.dev && left.ino===right.ino;
  }
  private attestExplorerNtfs(realRoot: string): boolean {
    if(process.platform!=='win32')return false;
    const drive=path.parse(fs.realpathSync(realRoot)).root.toUpperCase();
    const systemRoot=process.env.SystemRoot;
    if(!/^[A-Z]:\\$/.test(drive)||!systemRoot||! /^[A-Z]:\\Windows$/i.test(systemRoot))return false;
    // Fixed read-only script; the strictly validated drive is data in a private child environment.
    const result=spawnSync(path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $drive=[System.IO.DriveInfo]::new($env:EDITH_EXPLORER_DRIVE); if($drive.DriveType -ne [System.IO.DriveType]::Fixed){[Console]::Write('unsupported'); exit 0}; [Console]::Write('Fixed|'+$drive.DriveFormat)"],
      {windowsHide:true,timeout:2000,killSignal:'SIGKILL',maxBuffer:1024,encoding:'utf8',stdio:['ignore','pipe','pipe'],
        env:{SystemRoot:systemRoot,WINDIR:systemRoot,EDITH_EXPLORER_DRIVE:drive}});
    // spawnSync waits for child close, including timeout termination; no helper is retained.
    return !result.error && result.status===0 && result.signal===null && result.stdout.trim()==='Fixed|NTFS';
  }
  pinExplorerEntry(directory: ExplorerDirectoryHandle, name: string, expected: ExplorerFileSnapshot, expiresAt: number): ExplorerFilePin|null {
    if(!this.attestExplorerNtfs(directory.realRoot))return null;
    if(this.pins.size>=256)throw new FileServiceError('EXPLORER_PIN_LIMIT',429);
    if(expiresAt<=Date.now()||expiresAt>Date.now()+120000)throw new FileServiceError('EXPLORER_PIN_EXPIRED',410);
    const current=this.inspectExplorerEntry(directory,name);
    if(!current||current.identity!==expected.identity||current.contentSha256!==expected.contentSha256||!this.sameExplorerFileKey(current,expected))throw new FileServiceError('EXPLORER_SOURCE_CHANGED',409);
    const precise=this.preciseSnapshots.get(current)!;
    const fd=fs.openSync(current.absolutePath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
    let closed=false,timer:ReturnType<typeof setTimeout>|undefined;
    const pin:ExplorerFilePin={
      close:()=>{if(closed)return;closed=true;if(timer)clearTimeout(timer);fs.closeSync(fd);this.pins.delete(pin);this.releasedPins++;},
      matches:(snapshot)=>{
        if(closed)throw new FileServiceError('EXPLORER_PIN_RELEASED',409);
        const actual=this.preciseSnapshots.get(snapshot),opened=fs.fstatSync(fd,{bigint:true});
        if(!actual||snapshot.rootId!==current.rootId||!inside(directory.realRoot,snapshot.absolutePath)||actual.dev!==precise.dev||actual.ino!==precise.ino
          ||opened.dev!==precise.dev||opened.ino!==precise.ino||!opened.isFile()||opened.nlink!==1n||opened.size!==precise.size||opened.mtimeNs!==precise.mtimeNs)return false;
        const buffer=Buffer.alloc(262145),length=fs.readSync(fd,buffer,0,buffer.length,0),after=fs.fstatSync(fd,{bigint:true});
        return length<=262144 && BigInt(length)===precise.size && after.dev===opened.dev && after.ino===opened.ino && after.nlink===1n
          && after.mtimeNs===opened.mtimeNs && after.birthtimeNs===opened.birthtimeNs && after.size===opened.size
          && snapshot.sizeBytes===expected.sizeBytes && snapshot.contentSha256===expected.contentSha256
          && createHash('sha256').update(buffer.subarray(0,length)).digest('hex')===expected.contentSha256;
      }
    };
    try {
      if(!pin.matches(current))throw new FileServiceError('EXPLORER_SOURCE_CHANGED',409);
      const rechecked=this.inspectExplorerEntry(directory,name);
      if(!rechecked||rechecked.identity!==current.identity||!pin.matches(rechecked))throw new FileServiceError('EXPLORER_SOURCE_CHANGED',409);
      this.pins.add(pin);this.acquiredPins++;
      timer=setTimeout(()=>pin.close(),Math.max(1,expiresAt-Date.now()));timer.unref();return pin;
    }catch(error){closed=true;fs.closeSync(fd);throw error;}
  }
  status() { return { state: this.roots().length ? 'available' : 'configuration_required', search: true, read: true, actions: { open: 'adapter_unavailable', send: 'adapter_unavailable', summarize: 'provider_verification_required' }, limits: { entries: 5000, results: 100, depth: 12, readBytes: 262144 } }; }
  search(query = '', limit = 50) {
    if (typeof query !== 'string' || query.length > 160 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new FileServiceError('FILES_QUERY_INVALID');
    let visited = 0, truncated = false;
    const files: FileMetadata[] = [];
    const roots = this.roots();
    if (!roots.length) throw new FileServiceError('FILES_CONFIGURATION_REQUIRED',503);
    const walk = (root: FileRoot, realRoot: string, dir: string, depth: number) => {
      if (depth > 12) { truncated = true; return; }
      let handle: fs.Dir;
      try { handle = fs.opendirSync(dir); } catch { return; }
      try { let entry: fs.Dirent | null;
      while ((entry = handle.readSync())) {
        if (++visited > 5000 || files.length >= limit) { truncated = true; return; }
        const candidate = path.join(dir,entry.name);
        if (entry.isSymbolicLink() || DENIED.test(entry.name) || PRIVATE_FILE.test(entry.name)) continue;
        try {
          this.validate(root,realRoot,candidate);
          const stat = fs.lstatSync(candidate);
          if (stat.isDirectory()) walk(root,realRoot,candidate,depth+1);
          else if (stat.isFile() && stat.nlink === 1) {
            const relativePath = path.relative(realRoot,candidate).split(path.sep).join('/');
            if (!relativePath.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
            const id = createHmac('sha256',this.salt).update(root.id+'\0'+realRoot+'\0'+relativePath).digest('hex');
            if (this.index.size >= 1000 && !this.index.has(id)) this.index.delete(this.index.keys().next().value!);
            this.index.set(id,{root,realRoot,relativePath});
            files.push({id,root:root.id,relativePath,name:entry.name,size:stat.size,modifiedAt:stat.mtime.toISOString(),readable:TEXT.has(path.extname(entry.name).toLowerCase()) && stat.size <= 262144});
          }
        } catch { /* Unreadable, excluded or replaced entries are omitted. */ }
      }
      } finally { handle.closeSync(); }
    };
    for (const root of roots) {
      try { if (fs.lstatSync(root.path).isSymbolicLink()) continue; const real = fs.realpathSync(root.path); walk(root,real,real,0); } catch { /* Missing configured root. */ }
      if (visited > 5000 || files.length >= limit) break;
    }
    return {files,truncated,scannedEntries:Math.min(visited,5000)};
  }
  read(id: string) {
    try { return this.readIndexed(id); }
    catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new FileServiceError('FILE_NOT_FOUND',404);
      throw error;
    }
  }
  /** Backend-only bounded binary/tree snapshot. Indexed locators are not owner grants.
   * Binary bytes are hashed, not text-decoded or secret-scanned. Never serialize this descriptor. */
  async resolveReaTarget(locator: { id: string; kind: 'file' | 'directory' }, guard: () => void): Promise<ReaIndexedTargetSnapshot> {
    guard();
    if (!locator || !/^[a-f0-9]{64}$/.test(locator.id) || !['file','directory'].includes(locator.kind)) throw new FileServiceError('FILE_ID_INVALID');
    const item = locator.kind === 'file' ? this.index.get(locator.id) : this.directories.get(locator.id);
    const active = item && this.roots().find(r => r.id === item.root.id && path.resolve(r.path) === path.resolve(item.root.path));
    if (!item || !active) throw new FileServiceError('FILE_NOT_FOUND',404);
    const root: FileRoot = {id:active.id,path:active.path,...(active.excluded?{excluded:[...active.excluded]}:{})};
    const realRoot = item.realRoot, absolutePath = path.join(realRoot,item.relativePath);
    reaName(path.basename(absolutePath));
    path.relative(realRoot,absolutePath).split(path.sep).filter(Boolean).forEach(reaName);
    this.validate(root,realRoot,absolutePath);
    if (locator.kind === 'directory' && fileIdentity(fs.lstatSync(absolutePath)) !== this.directories.get(locator.id)!.identity) throw new FileServiceError('DIRECTORY_CHANGED',409);
    const inspect = async () => {
      const rows: ReaTargetRow[] = [], folded = new Set<string>(); let sizeBytes = 0;
      const visit = async (relative: string): Promise<void> => {
        guard();
        if (relative && (relative.split('/').length > 24 || relative.length > 1024)) throw new FileServiceError('FILE_REA_LIMIT',413);
        const filePath = relative ? path.join(absolutePath,...relative.split('/')) : absolutePath;
        this.validate(root,realRoot,filePath);
        const stat = await fsp.lstat(filePath,{bigint:true}); guard();
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || stat.isFile() && stat.nlink !== 1n) throw new FileServiceError('FILE_SCOPE_DENIED',403);
        const kind = stat.isFile() ? 'file' : 'directory';
        if (!relative && kind !== locator.kind) throw new FileServiceError('FILE_CHANGED',409);
        if (relative) {
          const fold = relative.toLocaleLowerCase('en-US'); if (folded.has(fold)) throw new FileServiceError('FILE_SCOPE_DENIED',403); folded.add(fold);
          if (rows.length > 2048) throw new FileServiceError('FILE_REA_LIMIT',413);
        }
        rows.push({relative,kind,metadata:reaMetadata(stat)});
        if (kind === 'file') {
          sizeBytes += Number(stat.size); if (stat.size > 67108864n || sizeBytes > 67108864) throw new FileServiceError('FILE_REA_LIMIT',413);
          if (relative.toLowerCase().endsWith('.asar')) throw new FileServiceError('FILE_REA_NESTED_ASAR_UNSUPPORTED',415);
        } else {
          const handle = await fsp.opendir(filePath); const names: string[] = [];
          try { guard(); for await (const entry of handle) { guard(); if (names.length >= 2049) throw new FileServiceError('FILE_REA_LIMIT',413); reaName(entry.name); names.push(entry.name); } }
          finally { await handle.close().catch(e => { if ((e as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED') throw e; }); }
          if(rows.length-1+names.length>2048)throw new FileServiceError('FILE_REA_LIMIT',413);
          for (const name of names.sort(reaCompare)) await visit(relative ? relative+'/'+name : name);
          guard(); this.validate(root,realRoot,filePath);
          if (reaMetadata(await fsp.lstat(filePath,{bigint:true})) !== reaMetadata(stat)) throw new FileServiceError('FILE_CHANGED',409);
        }
      };
      await visit('');
      if (rows.length - 1 > 2048) throw new FileServiceError('FILE_REA_LIMIT',413);
      // Complete listing/metadata validation precedes opening any member bytes.
      for (const row of rows.filter(r => r.kind === 'file')) {
        const filePath = row.relative ? path.join(absolutePath,...row.relative.split('/')) : absolutePath;
        guard(); this.validate(root,realRoot,filePath);
        const handle = await fsp.open(filePath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
        try {
          guard(); const stat = await handle.stat({bigint:true}); guard();
          if (!stat.isFile() || stat.nlink !== 1n || reaMetadata(stat) !== row.metadata) throw new FileServiceError('FILE_CHANGED',409);
          const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let bytes = 0;
          for (;;) { const chunk = await handle.read(buffer,0,buffer.length,null); guard(); if (!chunk.bytesRead) break;
            bytes += chunk.bytesRead; if (bytes > 67108864 || BigInt(bytes) > stat.size) throw new FileServiceError('FILE_REA_LIMIT',413); hash.update(buffer.subarray(0,chunk.bytesRead)); }
          if (BigInt(bytes) !== stat.size || reaMetadata(await handle.stat({bigint:true})) !== row.metadata) throw new FileServiceError('FILE_CHANGED',409);
          guard(); this.validate(root,realRoot,filePath);
          if (reaMetadata(await fsp.lstat(filePath,{bigint:true})) !== row.metadata) throw new FileServiceError('FILE_CHANGED',409);
          row.sha256 = hash.digest('hex');
        } finally { await handle.close(); }
      }
      guard(); return {rows:rows.sort((a,b)=>reaCompare(a.relative,b.relative)),sizeBytes};
    };
    const first = await inspect(), second = await inspect(); guard();
    if (reaProjectionDigest(first) !== reaProjectionDigest(second)) throw new FileServiceError('FILE_CHANGED',409);
    const identities = new Map<string,string>();
    for (const row of first.rows) if (row.kind === 'file') identities.set(row.relative,'art_'+reaProjectionDigest({sha256:row.sha256!}));
    for (const dir of first.rows.filter(r=>r.kind==='directory'&&r.relative).sort((a,b)=>b.relative.split('/').length-a.relative.split('/').length)) {
      const children = first.rows.filter(r=>r.relative&&path.posix.dirname(r.relative)===dir.relative).map(r=>({name:r.relative.slice(dir.relative.length+1),artifact_id:identities.get(r.relative)!,entry_kind:r.kind})).sort((a,b)=>reaCompare(a.name,b.name));
      identities.set(dir.relative,'art_'+reaProjectionDigest({kind:'directory',children}));
    }
    const sha256 = locator.kind === 'file' ? first.rows[0].sha256! : reaProjectionDigest({kind:'directory-root',children:first.rows.filter(r=>r.relative).map(r=>({logical_path:r.relative,artifact_id:identities.get(r.relative)!})).sort((a,b)=>reaCompare(a.logical_path,b.logical_path))});
    const snapshot = Object.freeze({kind:locator.kind,rootId:root.id,workspaceRoot:realRoot,absolutePath,sha256,
      identityDigest:reaProjectionDigest(first.rows),sizeBytes:first.sizeBytes,entries:first.rows.length-1});
    this.reaTargets.set(snapshot,{root,realRoot,rows:first.rows}); this.assertReaTargetCurrent(snapshot); guard(); return snapshot;
  }
  /** Runtime membership and metadata readback; never accepts a copied/JSON descriptor as proof. */
  assertReaTargetCurrent(snapshot: ReaIndexedTargetSnapshot): void {
    const proof = this.reaTargets.get(snapshot); if (!proof) throw new FileServiceError('FILE_REA_SNAPSHOT_REQUIRED',403);
    if (!this.roots().some(r=>r.id===proof.root.id&&path.resolve(r.path)===path.resolve(proof.root.path)
      && reaProjectionDigest(r.excluded??[])===reaProjectionDigest(proof.root.excluded??[]))) throw new FileServiceError('FILE_SCOPE_DENIED',403);
    for (const row of proof.rows) {
      const filePath = row.relative ? path.join(snapshot.absolutePath,...row.relative.split('/')) : snapshot.absolutePath;
      this.validate(proof.root,proof.realRoot,filePath);
      if (reaMetadata(fs.lstatSync(filePath,{bigint:true})) !== row.metadata) throw new FileServiceError('FILE_CHANGED',409);
    }
  }
  /** Bounded metadata discovery; handles below are internal, never public paths. */
  searchDirectories(query='',limit=50) {
    if(typeof query!=='string' || query.length>160 || !Number.isInteger(limit) || limit<1 || limit>100)throw new FileServiceError('FILES_QUERY_INVALID');
    const directories:ExplorerDirectoryMetadata[]=[];let visited=0,truncated=false;
    const add=(root:FileRoot,realRoot:string,candidate:string) => {
      this.validate(root,realRoot,candidate);const stat=fs.lstatSync(candidate);if(!stat.isDirectory())return;
      const relativePath=path.relative(realRoot,candidate).split(path.sep).join('/')||'.';
      if(!relativePath.toLocaleLowerCase().includes(query.toLocaleLowerCase()))return;
      const identity=fileIdentity(stat),id=createHmac('sha256',this.salt).update('directory\0'+root.id+'\0'+realRoot+'\0'+relativePath+'\0'+identity).digest('hex');
      if(this.directories.size>=1000&&!this.directories.has(id))this.directories.delete(this.directories.keys().next().value!);
      this.directories.set(id,{root,realRoot,relativePath,identity});directories.push({id,rootId:root.id,name:path.basename(candidate),relativePath});
    };
    const walk=(root:FileRoot,realRoot:string,dir:string,depth:number) => {
      if(depth>12){truncated=true;return;}let handle:fs.Dir;try{handle=fs.opendirSync(dir);}catch{return;}
      try{let entry:fs.Dirent|null;while((entry=handle.readSync())){
        if(++visited>5000||directories.length>=limit){truncated=true;return;}
        if(!entry.isDirectory()||entry.isSymbolicLink()||DENIED.test(entry.name)||PRIVATE_FILE.test(entry.name))continue;
        const candidate=path.join(dir,entry.name);try{add(root,realRoot,candidate);walk(root,realRoot,candidate,depth+1);}catch{/* Disallowed/unreadable entries are omitted. */}
      }}finally{handle.closeSync();}
    };
    for(const root of this.roots()){try{if(fs.lstatSync(root.path).isSymbolicLink())continue;const realRoot=fs.realpathSync(root.path);add(root,realRoot,realRoot);walk(root,realRoot,realRoot,0);}catch{}if(visited>5000||directories.length>=limit)break;}
    return {directories,truncated,scannedEntries:Math.min(visited,5000)};
  }
  resolveExplorerDirectory(id:string):ExplorerDirectoryHandle {
    if(!/^[a-f0-9]{64}$/.test(id??''))throw new FileServiceError('DIRECTORY_ID_INVALID');
    const item=this.directories.get(id),root=item&&this.roots().find(root=>root.id===item.root.id&&path.resolve(root.path)===path.resolve(item.root.path));
    if(!item||!root)throw new FileServiceError('DIRECTORY_NOT_FOUND',404);
    try {const absolutePath=path.join(item.realRoot,item.relativePath);this.validate(root,item.realRoot,absolutePath);const stat=fs.lstatSync(absolutePath);
      if(!stat.isDirectory()||fileIdentity(stat)!==item.identity)throw new FileServiceError('DIRECTORY_CHANGED',409);
      return {id,rootId:root.id,rootIdentity:fileIdentity(fs.lstatSync(item.realRoot)),absolutePath,realRoot:item.realRoot,identity:item.identity,device:String(stat.dev)};
    }catch(error){if((error as NodeJS.ErrnoException)?.code==='ENOENT')throw new FileServiceError('DIRECTORY_NOT_FOUND',404);throw error;}
  }
  resolveExplorerFile(id:string) {
    this.read(id);const item=this.index.get(id)!;const parent=path.dirname(path.join(item.realRoot,item.relativePath));
    const root=this.roots().find(root=>root.id===item.root.id&&path.resolve(root.path)===path.resolve(item.root.path));if(!root)throw new FileServiceError('FILE_NOT_FOUND',404);
    this.validate(root,item.realRoot,parent);const stat=fs.lstatSync(parent);if(!stat.isDirectory())throw new FileServiceError('FILE_SCOPE_DENIED',403);
    const directory:ExplorerDirectoryHandle={id:'private-source-parent',rootId:root.id,rootIdentity:fileIdentity(fs.lstatSync(item.realRoot)),absolutePath:parent,realRoot:item.realRoot,identity:fileIdentity(stat),device:String(stat.dev)};
    const name=path.basename(item.relativePath);const file=this.inspectExplorerEntry(directory,name);if(!file)throw new FileServiceError('FILE_NOT_FOUND',404);
    return {fileId:id,name,directory,file};
  }
  /** Internal readback of an exact recorded basename. No filesystem mutation. */
  inspectExplorerEntry(directory:ExplorerDirectoryHandle,name:string):ExplorerFileSnapshot|null {
    if(!name || name!==path.basename(name) || name==='.' || name==='..' || name.includes(':') || /[\\/]/.test(name) || DENIED.test(name) || PRIVATE_FILE.test(name))throw new FileServiceError('FILE_SCOPE_DENIED',403);
    const root=this.roots().find(root=>root.id===directory.rootId && fs.realpathSync(root.path)===directory.realRoot);
    if(!root)throw new FileServiceError('FILE_SCOPE_DENIED',403);
    if(fileIdentity(fs.lstatSync(directory.realRoot))!==directory.rootIdentity)throw new FileServiceError('DIRECTORY_ROOT_CHANGED',409);
    this.validate(root,directory.realRoot,directory.absolutePath);const parent=fs.lstatSync(directory.absolutePath);
    if(!parent.isDirectory()||fileIdentity(parent)!==directory.identity)throw new FileServiceError('DIRECTORY_CHANGED',409);
    const absolutePath=path.join(directory.absolutePath,name);
    const validateParent=()=>{this.validate(root,directory.realRoot,directory.absolutePath);if(fileIdentity(fs.lstatSync(directory.absolutePath))!==directory.identity)throw new FileServiceError('DIRECTORY_CHANGED',409);};
    let before:fs.Stats;try{before=fs.lstatSync(absolutePath);}catch(error){if((error as NodeJS.ErrnoException)?.code==='ENOENT'){validateParent();return null;}throw error;}
    this.validate(root,directory.realRoot,absolutePath);
    const preciseBefore=fs.lstatSync(absolutePath,{bigint:true});
    if(!before.isFile()||before.nlink!==1)throw new FileServiceError('FILE_SCOPE_DENIED',403);
    if(!TEXT.has(path.extname(name).toLowerCase()))throw new FileServiceError('FILE_TEXT_UNSUPPORTED',415);
    if(before.size>262144)throw new FileServiceError('FILE_READ_LIMIT',413);
    const fd=fs.openSync(absolutePath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
    try {
      const opened=fs.fstatSync(fd);this.validate(root,directory.realRoot,absolutePath);
      const preciseOpened=fs.fstatSync(fd,{bigint:true});
      if(preciseOpened.dev!==preciseBefore.dev||preciseOpened.ino!==preciseBefore.ino||preciseOpened.birthtimeNs!==preciseBefore.birthtimeNs||preciseOpened.nlink!==1n)throw new FileServiceError('FILE_CHANGED',409);
      if(fileIdentity(opened)!==fileIdentity(before)||opened.size!==before.size||opened.nlink!==1)throw new FileServiceError('FILE_CHANGED',409);
      const buffer=Buffer.alloc(262145),length=fs.readSync(fd,buffer,0,buffer.length,0);if(length>262144)throw new FileServiceError('FILE_READ_LIMIT',413);
      const data=buffer.subarray(0,length);let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw new FileServiceError('FILE_TEXT_UNSUPPORTED',415);}
      if(text.includes('\0'))throw new FileServiceError('FILE_TEXT_UNSUPPORTED',415);
      if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:^|\n)\s*(?:export\s+)?["']?[\w-]*(?:api[_-]?key|token|password|secret|credentials?|authorization|private[_-]?key)[\w-]*["']?\s*[:=]\s*\S+|"[^"\n]*(?:api[_-]?key|token|password|secret|credential|authorization|private[_-]?key)[^"\n]*"\s*:\s*"[^"\s]+"/mi.test(text))throw new FileServiceError('FILE_SECRET_CONTENT_DENIED',403);
      const after=fs.lstatSync(absolutePath);this.validate(root,directory.realRoot,absolutePath);validateParent();
      if(fileIdentity(after)!==fileIdentity(opened)||after.nlink!==1||after.size!==length||after.mtimeMs!==opened.mtimeMs)throw new FileServiceError('FILE_CHANGED',409);
      const preciseAfter=fs.lstatSync(absolutePath,{bigint:true});
      if(preciseAfter.dev!==preciseOpened.dev||preciseAfter.ino!==preciseOpened.ino||preciseAfter.birthtimeNs!==preciseOpened.birthtimeNs||preciseAfter.mtimeNs!==preciseOpened.mtimeNs||preciseAfter.nlink!==1n||preciseAfter.size!==BigInt(length))throw new FileServiceError('FILE_CHANGED',409);
      const snapshot={rootId:root.id,absolutePath,identity:fileIdentity(after),device:String(after.dev),contentSha256:createHash('sha256').update(data).digest('hex'),sizeBytes:length};
      this.preciseSnapshots.set(snapshot,preciseAfter);return snapshot;
    }finally{fs.closeSync(fd);}
  }
  /** Internal bridge descriptor. Never serialize this through public Files API. */
  resolveNativeFile(id: string) {
    const file = this.read(id); // All text/secret/hardlink/encoding/size checks apply.
    const item = this.index.get(id);
    const active = item && this.roots().find(root => root.id === item.root.id && path.resolve(root.path) === path.resolve(item.root.path));
    if (!item || !active) throw new FileServiceError('FILE_NOT_FOUND',404);
    const absolutePath = path.join(item.realRoot,item.relativePath);
    this.validate(active,item.realRoot,absolutePath);
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 262144) throw new FileServiceError('FILE_SCOPE_DENIED',403);
    const current = this.read(id);
    if (current.text !== file.text || current.relativePath !== file.relativePath) throw new FileServiceError('FILE_CHANGED',409);
    return { absolutePath, canonicalPath:fs.realpathSync(absolutePath),contentSha256:createHash('sha256').update(file.text,'utf8').digest('hex') };
  }
  private readIndexed(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id ?? '')) throw new FileServiceError('FILE_ID_INVALID');
    const item = this.index.get(id);
    const active = item && this.roots().find(root => root.id === item.root.id && path.resolve(root.path) === path.resolve(item.root.path));
    if (!item || !active) throw new FileServiceError('FILE_NOT_FOUND',404);
    const candidate = path.join(item.realRoot,item.relativePath);
    this.validate(active,item.realRoot,candidate);
    if (!TEXT.has(path.extname(candidate).toLowerCase())) throw new FileServiceError('FILE_TEXT_UNSUPPORTED',415);
    const before = fs.lstatSync(candidate);
    if (before.nlink !== 1) throw new FileServiceError('FILE_SCOPE_DENIED',403);
    if (!before.isFile() || before.size > 262144) throw new FileServiceError('FILE_READ_LIMIT',413);
    const fd = fs.openSync(candidate,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fs.fstatSync(fd);
      this.validate(active,item.realRoot,candidate);
      if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw new FileServiceError('FILE_CHANGED',409);
      const buffer = Buffer.alloc(262145);
      const bytes = fs.readSync(fd,buffer,0,buffer.length,0);
      if (bytes > 262144) throw new FileServiceError('FILE_READ_LIMIT',413);
      const data = buffer.subarray(0,bytes);
      let text: string;
      try { text = new TextDecoder('utf-8',{fatal:true}).decode(data); } catch { throw new FileServiceError('FILE_TEXT_UNSUPPORTED',415); }
      if (text.includes('\0')) throw new FileServiceError('FILE_TEXT_UNSUPPORTED',415);
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:"[^"\n]*(?:api[_-]?key|token|password|secret|credential|authorization|private[_-]?key)[^"\n]*"\s*:\s*"[^"\s]+"|^\s*[A-Z_]*(?:API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY|CREDENTIAL|AUTHORIZATION)[A-Z_]*\s*=\s*\S+)/mi.test(text)) throw new FileServiceError('FILE_SECRET_CONTENT_DENIED',403);
      if (/(?:^|\n)\s*(?:export\s+)?["']?[\w-]*(?:api[_-]?key|token|password|secret|credentials?|authorization|private[_-]?key)[\w-]*["']?\s*[:=]\s*\S+/mi.test(text)) throw new FileServiceError('FILE_SECRET_CONTENT_DENIED',403);
      return {id,root:item.root.id,relativePath:item.relativePath,encoding:'utf-8',bytes,text,truncated:false};
    } finally { fs.closeSync(fd); }
  }
  private validate(root: FileRoot, realRoot: string, candidate: string) {
    if (fs.lstatSync(root.path).isSymbolicLink() || fs.realpathSync(root.path) !== realRoot || !inside(realRoot,candidate)) throw new FileServiceError('FILE_SCOPE_DENIED',403);
    const parts = path.relative(realRoot,candidate).split(path.sep).filter(Boolean);
    let current = realRoot;
    for (const part of parts) {
      if (DENIED.test(part) || PRIVATE_FILE.test(part)) throw new FileServiceError('FILE_SCOPE_DENIED',403);
      current = path.join(current,part);
      if (fs.lstatSync(current).isSymbolicLink() || !inside(realRoot,fs.realpathSync(current))) throw new FileServiceError('FILE_SCOPE_DENIED',403);
    }
    if (root.excluded?.some(excluded => inside(path.resolve(excluded),candidate))) throw new FileServiceError('FILE_SCOPE_DENIED',403);
  }
}
function defaultRoots(): FileRoot[] {
  const resolved = workspaceManager.getResolvedPaths();
  const artifacts: FileRoot = {id:'artifacts',path:path.resolve(process.cwd(),'artifacts')};
  if (!resolved) return [artifacts];
  return [{id:'workspace',path:resolved.workspaceRoot,excluded:[resolved.dataPath,resolved.logsPath,resolved.backupPath,resolved.chatHistoryPath,resolved.obsidianVaultPath,path.resolve(process.cwd(),'artifacts')].filter(Boolean)},artifacts];
}
export const fileService = new FileService();
