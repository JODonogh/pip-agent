const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const dist = path.join(root, 'dist');
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'compile']);
fs.mkdirSync(dist, { recursive: true });
run(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  '--yes', '@vscode/vsce', 'package', '--allow-missing-repository', '--skip-license',
  '--no-rewrite-relative-links', '--out', path.join(dist, `agent-pip-${version}.vsix`),
]);
