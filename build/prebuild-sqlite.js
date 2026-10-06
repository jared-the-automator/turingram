// Fetches the better-sqlite3 prebuilt binary for the bundled Electron's ABI
// before packaging. This was a `$(node -p ...)` substitution inline in the
// predist script, which cmd.exe passes through literally, so the Windows
// package step failed with "Invalid Version: $(node".
const { execFileSync } = require('child_process');
const path = require('path');

const electron = require('electron/package.json').version;
execFileSync('npx', ['prebuild-install', '--runtime', 'electron', '--target', electron, '--force'], {
  cwd: path.join(__dirname, '..', 'node_modules', 'better-sqlite3'),
  stdio: 'inherit',
  // npx is npx.cmd on Windows, which only a shell can run.
  shell: process.platform === 'win32',
});
