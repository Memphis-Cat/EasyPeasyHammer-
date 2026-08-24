// byanca
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const markerPattern = /^(?:<<<<<<< .+|=======|>>>>>>> .+)$/m;

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding || 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function changedPaths() {
  const output = git(['status', '--porcelain=v1', '-z']);
  const entries = output.split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    let file = entry.slice(3);
    if (status.includes('R') || status.includes('C')) {
      const target = entries[++index];
      if (target) file = target;
    }
    if (file) paths.push(file);
  }
  return [...new Set(paths)];
}

function isTracked(file) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', file], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasMarkers(file) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return false;
  let text;
  try { text = fs.readFileSync(absolute, 'utf8'); } catch { return false; }
  return markerPattern.test(text);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function main() {
  const marked = changedPaths().filter(file => isTracked(file) && hasMarkers(file));
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

  console.log('Conflict-marker recovery complete. Other local changes were left untouched.');
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`Could not recover Git conflict markers: ${error?.message || error}`);
  process.exitCode = 1;
}
