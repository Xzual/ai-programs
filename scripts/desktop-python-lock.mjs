import fs from 'node:fs';

export function parseExactRequirements(text, label = 'requirements lock') {
  const pins = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)==([^;\s]+)$/);
    if (!match) throw new Error(`INTERNAL_CONFIGURATION_ERROR UNPINNED_PYTHON_REQUIREMENT: ${label} contains ${line}`);
    pins.push({ name: match[1], version: match[2] });
  }
  if (!pins.length) throw new Error(`INTERNAL_CONFIGURATION_ERROR EMPTY_PYTHON_LOCK: ${label}`);
  return pins;
}

export function readExactRequirementsLock(file) {
  if (!fs.existsSync(file)) throw new Error(`INTERNAL_CONFIGURATION_ERROR PYTHON_LOCK_REQUIRED: missing ${file}`);
  return parseExactRequirements(fs.readFileSync(file, 'utf8'), file);
}

export function verifyPinnedVersions(pins, installedVersion) {
  const errors = [];
  for (const pin of pins) {
    const actual = installedVersion(pin.name);
    if (actual !== pin.version) errors.push(`${pin.name} expected ${pin.version}, found ${actual ?? 'missing'}`);
  }
  if (errors.length) throw new Error(`VETTED_PYTHON_VERSION_MISMATCH: ${errors.join('; ')}`);
  return true;
}
