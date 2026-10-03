import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd());
const require = createRequire(import.meta.url);
const tauriCli = require.resolve('@tauri-apps/cli/tauri.js');
const remaps = [`--remap-path-prefix=${root}=/edith-src`];
if (process.env.USERPROFILE) remaps.push(`--remap-path-prefix=${path.resolve(process.env.USERPROFILE)}=/build-user`);
const existing = process.env.CARGO_ENCODED_RUSTFLAGS?.trim();

execFileSync(process.execPath, [tauriCli, 'build', ...process.argv.slice(2)], {
  cwd: root,
  env: {
    ...process.env,
    CARGO_ENCODED_RUSTFLAGS: [...(existing ? [existing] : []), ...remaps].join('\x1f'),
  },
  stdio: 'inherit',
});
