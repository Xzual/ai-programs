import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PORTABLE_FORMAT = 1;

export function assertInside(root, candidate, label) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`${label} must stay inside ${base}`);
  }
  return resolved;
}

export function assertSafeRelative(value, label) {
  const normalized = String(value).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`${label} is not a safe relative path: ${value}`);
  }
  return normalized;
}

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function listFilesStrict(root) {
  const base = fs.realpathSync(root);
  const files = [];
  const pending = [base];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Portable payload may not contain links: ${absolute}`);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push({ absolute, relative: path.relative(base, absolute).replaceAll('\\', '/') });
    }
  }
  return files.sort((a, b) => a.relative.localeCompare(b.relative, 'en'));
}

export function copyTreeStrict(source, destination, options = {}) {
  const sourceRoot = fs.realpathSync(source);
  fs.mkdirSync(destination, { recursive: true });
  for (const { absolute, relative } of listFilesStrict(sourceRoot)) {
    if (options.exclude?.(relative)) continue;
    const target = assertInside(destination, path.join(destination, assertSafeRelative(relative, 'copy path')), 'copy target');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(absolute, target, fs.constants.COPYFILE_EXCL);
  }
}

export function isExcludedCryptoResource(relative) {
  const normalized = relative.replaceAll('\\', '/');
  return normalized.split('/').some((part) => ['.venv', '__pycache__', '.pytest_cache', '.git'].includes(part))
    || /(?:^|\/)(?:\.env(?:\..*)?|.*\.db(?:-.*)?|.*\.log|.*\.pyc)$/i.test(normalized)
    || /(?:^|\/)test[^/]*\.py$/i.test(normalized);
}

export function assertCryptoResourcesSafe(directory) {
  const files = new Set(listFilesStrict(directory).map(({ relative }) => relative.replaceAll('\\', '/')));
  for (const required of ['run_agent.py', 'requirements.txt', 'config/coin_permissions.json', 'config/demo_asset_modes.json', 'config/observer_config.json']) {
    if (!files.has(required)) throw new Error(`Required Crypto resource is missing: ${required}`);
  }
  if (![...files].some((file) => /^src\/(?!test_).+\.py$/i.test(file))) throw new Error('Crypto source modules are missing.');
  if (![...files].some((file) => /^templates\/.+\.html$/i.test(file))) throw new Error('Crypto templates are missing.');
  const forbidden = [...files].filter(isExcludedCryptoResource);
  if (forbidden.length) throw new Error(`Forbidden Crypto runtime files were staged: ${forbidden.join(', ')}`);
}

export function manifestFor(directory, metadata = {}) {
  return {
    formatVersion: PORTABLE_FORMAT,
    product: 'E.D.I.T.H.',
    platform: 'windows-x64',
    ...metadata,
    files: listFilesStrict(directory).map(({ absolute, relative }) => ({
      path: relative,
      size: fs.statSync(absolute).size,
      sha256: sha256(absolute),
    })),
  };
}

export function findDeveloperPathLeaks(directory) {
  const patterns = [/[A-Za-z]:\\Users\\[^\\\s]+/i, /C:\/Users\/[^/\s]+/i, /\/(?:home|Users)\/[A-Za-z0-9._-]+\//];
  const hits = [];
  for (const { absolute, relative } of listFilesStrict(directory)) {
    if (fs.statSync(absolute).size > 64 * 1024 * 1024) continue;
    const text = fs.readFileSync(absolute).toString('latin1');
    if (patterns.some((pattern) => pattern.test(text))) hits.push(relative);
  }
  return hits;
}

export function validateZipEntries(zip, destinationRoot) {
  const script = String.raw`
Add-Type -AssemblyName System.IO.Compression
$zip = [IO.Path]::GetFullPath($env:EDITH_ZIP)
$root = [IO.Path]::GetFullPath($env:EDITH_ZIP_ROOT)
$prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $rows = @()
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName.Replace('\','/')
    if ([string]::IsNullOrWhiteSpace($name) -or $name.StartsWith('/') -or $name.StartsWith('//') -or $name -match '^[A-Za-z]:' -or $name -match '(^|/)\.\.(/|$)' -or $name -match ':') { throw "Unsafe ZIP entry: $name" }
    $key = $name.TrimEnd('/')
    if ($key -and -not $seen.Add($key)) { throw "Duplicate or case-colliding ZIP entry: $name" }
    $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
    $dosAttrs = ($entry.ExternalAttributes -band 0xFFFF)
    if ($unixType -eq 0xA000 -or ($dosAttrs -band 0x400) -ne 0) { throw "Link or reparse ZIP entry is forbidden: $name" }
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $name.Replace('/', [IO.Path]::DirectorySeparatorChar)))
    if ($target -ne $root -and -not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "ZIP entry escapes destination: $name" }
    $rows += [pscustomobject]@{ name=$name; target=$target }
  }
  @($rows) | ConvertTo-Json -Compress
} finally { $archive.Dispose() }
`;
  const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 20_000,
    env: { ...process.env, EDITH_ZIP: path.resolve(zip), EDITH_ZIP_ROOT: path.resolve(destinationRoot) },
  }).trim();
  const parsed = output ? JSON.parse(output) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}
