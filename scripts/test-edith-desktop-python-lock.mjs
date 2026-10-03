import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseExactRequirements, readExactRequirementsLock, verifyPinnedVersions } from './desktop-python-lock.mjs';

const broad = 'alpha>=1.2.3\nbeta~=4.5\n';
let broadRejected = false;
try { parseExactRequirements(broad, 'unpinned fixture'); } catch (error) { broadRejected = String(error).includes('INTERNAL_CONFIGURATION_ERROR UNPINNED_PYTHON_REQUIREMENT'); }
if (!broadRejected) throw new Error('Broad developer requirements must not pass release lock validation.');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edith-python-lock-'));
try {
  const lock = path.join(temp, 'requirements.lock.txt');
  fs.writeFileSync(lock, 'alpha==1.2.3\nbeta==4.5.6\n');
  const pins = readExactRequirementsLock(lock);
  const versions = new Map([['alpha', '1.2.3'], ['beta', '4.5.6']]);
  verifyPinnedVersions(pins, (name) => versions.get(name));
  let mismatchRejected = false;
  try { verifyPinnedVersions(pins, (name) => name === 'alpha' ? '1.2.3' : '0.0.0'); } catch (error) { mismatchRejected = String(error).includes('VETTED_PYTHON_VERSION_MISMATCH'); }
  if (!mismatchRejected) throw new Error('Mismatched vetted runtime must be rejected.');
  console.log(JSON.stringify({ success: true, broadRequirementsRejected: true, exactLockAccepted: true, mismatchRejected: true }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
