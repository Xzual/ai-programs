import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  assertCryptoResourcesSafe,
  assertInside,
  isExcludedCryptoResource,
  listFilesStrict,
} from './portable-edith-lib.mjs';

const REQUIRED_FILES = [
  'run_agent.py',
  'requirements.txt',
  'config/coin_permissions.json',
  'config/demo_asset_modes.json',
  'config/observer_config.json',
];

export function isExcludedPackagedCryptoResource(relative) {
  const normalized = relative.replaceAll('\\', '/');
  const allowed = /^(?:run_agent\.py|requirements(?:\.lock)?\.txt)$/i.test(normalized)
    || /^src\/(?!test[^/]*\.py$)[^/]+\.py$/i.test(normalized)
    || /^templates\/[^/]+\.html$/i.test(normalized)
    || /^config\/[^/]+\.json$/i.test(normalized);
  return !allowed || isExcludedCryptoResource(normalized);
}

function copyPackagedResources(source, destination) {
  const sourceRoot = fs.realpathSync(source);
  const visit = (current, relativeDirectory = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Crypto resource source may not contain links: ${relative}`);
      if (entry.isDirectory()) {
        const allowedPrefix = ['src', 'templates', 'config'].includes(relative.toLowerCase());
        if (allowedPrefix) visit(absolute, relative);
        continue;
      }
      if (!entry.isFile() || isExcludedPackagedCryptoResource(relative)) continue;
      const target = assertInside(destination, path.join(destination, relative), 'Crypto resource copy target');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(absolute, target, fs.constants.COPYFILE_EXCL);
    }
  };
  visit(sourceRoot);
}

function assertNoEmbeddedSecrets(directory) {
  for (const { absolute, relative } of listFilesStrict(directory)) {
    const content = fs.readFileSync(absolute, 'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
      throw new Error(`Private key material rejected: ${relative}`);
    }
    if (/^[ \t]*(?:self\.)?_?(?:api_?key|secret|credential|access_?token|private_?key|password)\b\s*(?::[^=\r\n]+)?=\s*[rubf]*["'][^"'\r\n]{8,}["']/im.test(content)) {
      throw new Error(`Embedded secret-like assignment rejected: ${relative}`);
    }
  }
}

export function assertPackagedCryptoResources(directory) {
  assertCryptoResourcesSafe(directory);
  assertNoEmbeddedSecrets(directory);
  const forbidden = listFilesStrict(directory)
    .map(({ relative }) => relative.replaceAll('\\', '/'))
    .filter(isExcludedPackagedCryptoResource);
  if (forbidden.length) {
    throw new Error(`Crypto packaged allowlist violation: ${forbidden.join(', ')}`);
  }
}

function assertSeparatedTrees(source, destination) {
  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  if (
    sourceRoot === destinationRoot
    || sourceRoot.startsWith(`${destinationRoot}${path.sep}`)
    || destinationRoot.startsWith(`${sourceRoot}${path.sep}`)
  ) {
    throw new Error('Crypto resource source and destination trees must not overlap.');
  }
}

export function stageCryptoResources({ source, destination, allowedDestinationRoot }) {
  const sourceRoot = fs.realpathSync(source);
  if (!fs.statSync(sourceRoot).isDirectory()) {
    throw new Error('Crypto resource source must be a directory.');
  }

  const destinationRoot = assertInside(
    allowedDestinationRoot,
    destination,
    'Crypto resource staging destination',
  );
  assertSeparatedTrees(sourceRoot, destinationRoot);

  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationRoot, { recursive: true });
  copyPackagedResources(sourceRoot, destinationRoot);
  assertPackagedCryptoResources(destinationRoot);

  const files = listFilesStrict(destinationRoot).map(({ relative }) => relative.replaceAll('\\', '/'));
  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) throw new Error(`Required Crypto resource was not staged: ${required}`);
  }
  if (!files.some((file) => /^src\/(?!test_).+\.py$/i.test(file))) {
    throw new Error('Crypto source modules were not staged.');
  }
  if (!files.some((file) => /^templates\/.+\.html$/i.test(file))) {
    throw new Error('Crypto templates were not staged.');
  }

  return { source: sourceRoot, destination: destinationRoot, files };
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const root = path.resolve(process.cwd());
  const allowedDestinationRoot = path.join(root, '.edith-build', 'desktop', 'resources');
  const result = stageCryptoResources({
    source: path.join(root, 'crypto'),
    destination: path.join(allowedDestinationRoot, 'crypto'),
    allowedDestinationRoot,
  });
  console.log(JSON.stringify({
    staged: true,
    destination: result.destination,
    fileCount: result.files.length,
  }, null, 2));
}
