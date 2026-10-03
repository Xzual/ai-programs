// Opt-in smoke test. Never prints or persists the project's existing API key.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const root = new URL('../../../', import.meta.url);
const require = createRequire(new URL('package.json', root));
const { parse } = require('dotenv');
const config = parse(readFileSync(new URL('.env', root)));
const key = process.env.GEMINI_API_KEY || config.GEMINI_API_KEY;
if (!key) throw new Error('No existing GEMINI_API_KEY configured');
const run = spawnSync('cargo', ['test', '--locked', '-p', 'coucou', '--lib', 'live_gemini_conversation', '--', '--ignored', '--test-threads=1'], {
  cwd: new URL('../', import.meta.url), env: { ...process.env, GEMINI_API_KEY: key }, stdio: 'inherit',
});
process.exit(run.status ?? 1);
