/**
 * Windows: `cargo-build-sbf` expects platform-tools under the Solana SBF SDK and may try to
 * create symlinks (fails with error 1314 without admin). A directory junction does not require
 * the symlink privilege. Run after extracting platform-tools to LocalAppData (see README).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const home = os.homedir();
const solanaRelease =
  process.env.SOLANA_RELEASE_ROOT ?? path.join(home, 'solana-install', 'solana-release');
const linkPath = path.join(solanaRelease, 'bin', 'sdk', 'sbf', 'dependencies', 'platform-tools');
const targetPath = path.join(home, 'AppData', 'Local', 'solana', 'v1.41', 'platform-tools');

if (process.platform !== 'win32') {
  console.error('This script is only needed on Windows.');
  process.exit(1);
}
if (!fs.existsSync(path.join(targetPath, 'rust', 'bin'))) {
  console.error('Missing platform-tools at:', targetPath);
  console.error('Download platform-tools-windows-x86_64.tar.bz2 from anza-xyz/platform-tools v1.41 and extract there.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(linkPath), { recursive: true });
try {
  fs.rmSync(linkPath, { recursive: true, force: true });
} catch {
  /* ignore */
}
fs.symlinkSync(targetPath, linkPath, 'junction');
console.log('Junction OK:\n ', linkPath, '\n ->\n ', targetPath);
