import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { assertCryptoResourcesSafe, copyTreeStrict, isExcludedCryptoResource } from './portable-edith-lib.mjs';
import { readExactRequirementsLock } from './desktop-python-lock.mjs';

const root = path.resolve(process.cwd());
const buildDir = path.resolve(root, '.edith-build', 'desktop');
const binaryDir = path.resolve(root, 'src-tauri', 'binaries');
const entry = path.join(buildDir, 'server.cjs');
const output = path.join(binaryDir, 'edith-backend-x86_64-pc-windows-msvc.exe');
const resourceDir = path.join(buildDir, 'resources');
const pythonResourceDir = path.join(resourceDir, 'python');
const pythonLock = path.join(root, 'crypto', 'requirements.lock.txt');
const require = createRequire(import.meta.url);
const esbuildBin = require.resolve('esbuild/bin/esbuild');
const pkgBin = path.join(path.dirname(require.resolve('@yao-pkg/pkg/package.json')), 'lib-es5', 'bin.js');

if (!buildDir.startsWith(`${root}${path.sep}`) || !binaryDir.startsWith(`${root}${path.sep}`)) {
  throw new Error('Desktop build paths must stay inside the project root.');
}

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(binaryDir, { recursive: true });
fs.mkdirSync(resourceDir, { recursive: true });
fs.mkdirSync(pythonResourceDir, { recursive: true });

copyTreeStrict(path.join(root, 'crypto'), path.join(resourceDir, 'crypto'), { exclude: isExcludedCryptoResource });
assertCryptoResourcesSafe(path.join(resourceDir, 'crypto'));
readExactRequirementsLock(pythonLock);

const pythonBundleSetting = process.env.EDITH_CRYPTO_PYTHON_BUNDLE_DIR?.trim();
const externalPythonPrerequisite = process.env.EDITH_CRYPTO_EXTERNAL_PYTHON_PREREQUISITE === 'true';
if (pythonBundleSetting) {
  if (!path.isAbsolute(pythonBundleSetting) || pythonBundleSetting.startsWith('\\\\')) throw new Error('EDITH_CRYPTO_PYTHON_BUNDLE_DIR must be a local absolute directory.');
  const pythonBundleDir = fs.realpathSync(pythonBundleSetting);
  const sourcePython = path.join(pythonBundleDir, 'python.exe');
  if (!fs.statSync(pythonBundleDir).isDirectory() || !fs.existsSync(sourcePython) || !fs.statSync(sourcePython).isFile()) throw new Error('The vetted Python bundle must contain python.exe at its root.');
  const requirements = pythonLock;
  const verifyPins = `import importlib.metadata, pathlib, re, sys\nlines=pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()\nerrors=[]\nfor line in lines:\n line=line.strip()\n if not line or line.startswith("#"): continue\n match=re.fullmatch(r"([A-Za-z0-9_.-]+)==([^;\\s]+)",line)\n if not match: errors.append("unpinned: "+line); continue\n name,expected=match.groups()\n try: actual=importlib.metadata.version(name)\n except importlib.metadata.PackageNotFoundError: errors.append(name+" missing"); continue\n if actual!=expected: errors.append(name+" expected "+expected+" found "+actual)\nif errors: raise SystemExit("Pinned runtime verification failed: "+"; ".join(errors))`;
  execFileSync(sourcePython, ['-I', '-c', verifyPins, requirements], { cwd: root, stdio: 'inherit', windowsHide: true });
  execFileSync(sourcePython, ['-I', '-m', 'pip', 'check'], { cwd: root, stdio: 'inherit', windowsHide: true });
  copyTreeStrict(pythonBundleDir, pythonResourceDir);
} else if (externalPythonPrerequisite) {
  fs.writeFileSync(path.join(pythonResourceDir, 'EXTERNAL_RUNTIME_REQUIRED.txt'), 'EDITH_CRYPTO_PYTHON_PATH must identify a vetted absolute Python executable on the target machine.\n', { flag: 'wx' });
} else {
  throw new Error('EXTERNAL_BLOCKER VETTED_PYTHON_REQUIRED: set EDITH_CRYPTO_PYTHON_BUNDLE_DIR to an absolute portable runtime directory.');
}

execFileSync(process.execPath, [esbuildBin, 'server.ts', '--bundle', '--platform=node', '--target=node18', '--format=cjs', '--packages=external', `--outfile=${entry}`], {
  cwd: root,
  stdio: 'inherit',
});

execFileSync(process.execPath, [pkgBin, entry, '--targets', 'node18-win-x64', '--compress', 'GZip', '--output', output], {
  cwd: root,
  stdio: 'inherit',
});

console.log(`[EDITH Desktop] Backend sidecar created: ${output}`);
console.log(`[EDITH Desktop] Crypto resources staged: ${path.join(resourceDir, 'crypto')}`);
