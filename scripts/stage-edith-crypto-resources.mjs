import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  assertCryptoResourcesSafe,
  assertInside,
  copyTreeStrict,
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
  copyTreeStrict(sourceRoot, destinationRoot, { exclude: isExcludedCryptoResource });
  assertCryptoResourcesSafe(destinationRoot);

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
