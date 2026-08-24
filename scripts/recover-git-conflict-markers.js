// byanca
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const markerPattern = /^(?:<<<<<<< .+|=======|>>>>>>> .+)$/m;
const textExtensions = new Set([
  '.js', '.cjs', '.mjs', '.json', '.html', '.css', '.bat', '.cmd', '.ps1',
  '.cs', '.csproj', '.props', '.targets', '.xml', '.md', '.txt', '.yml', '.yaml',
]);

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding || 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function trackedPaths() {
  const output = git(['ls-files', '-z']);
  return output.split('\0').filter(Boolean);
}

function shouldInspect(file) {
  const extension = path.extname(file).toLowerCase();
  return textExtensions.has(extension);
}

function hasMarkers(file) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) return false;
  let stat;
  try { stat = fs.statSync(absolute); } catch { return false; }
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) return false;
  let text;
  try { text = fs.readFileSync(absolute, 'utf8'); } catch { return false; }
  return markerPattern.test(text);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function main() {
  // Scan every tracked text/code file, not only paths Git currently reports as
  // modified. A previous interrupted stash/merge can leave conflict text in a
  // working file after the index itself has already been reset.
  const marked = trackedPaths().filter(file => shouldInspect(file) && hasMarkers(file));
  if (!marked.length) return 0;

  const backupRoot = path.join(root, '.runtime', 'git-conflict-backups', stamp());
  fs.mkdirSync(backupRoot, { recursive: true });

  console.log(`Found ${marked.length} tracked file(s) containing Git conflict markers.`);
  console.log(`Backing them up to: ${path.relative(root, backupRoot)}`);

  for (const file of marked) {
    const source = path.join(root, file);
    const backup = path.join(backupRoot, file);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(source, backup);
    git(['checkout', 'HEAD', '--', file]);
    console.log(`Recovered from HEAD: ${file}`);
  }

  console.log('Conflict-marker recovery complete. Other files were left untouched.');
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`Could not recover Git conflict markers: ${error?.message || error}`);
  process.exitCode = 1;
}
