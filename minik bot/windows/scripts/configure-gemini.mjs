// Run only with owner authorization to reuse the project's existing Gemini key.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const root = new URL('../../../', import.meta.url);
const require = createRequire(new URL('package.json', root));
const config = require('dotenv').parse(readFileSync(new URL('.env', root)));
const key = process.env.GEMINI_API_KEY || config.GEMINI_API_KEY;
if (!key) throw new Error('No existing GEMINI_API_KEY configured');
const result = spawnSync('cargo', ['run', '--locked', '-p', 'coucou', '--example', 'configure_gemini'], {
  cwd: new URL('../', import.meta.url), env: { ...process.env, GEMINI_API_KEY: key }, stdio: 'inherit', windowsHide: true,
});
process.exit(result.status ?? 1);
