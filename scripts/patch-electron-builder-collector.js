// byanca
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'node_modules', 'app-builder-lib', 'out', 'util', 'appFileCopier.js');

function fail(message) {
  console.error(`[electron-builder collector patch] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(target)) {
  fail(`Missing ${path.relative(root, target)}. Run npm install first.`);
}

let source = fs.readFileSync(target, 'utf8');

// electron-builder 26 normally asks npm/yarn/pnpm for a dependency tree before
// using its filesystem traversal fallback. On Windows that package-manager call
// is executed through a shell. A shell/profile that prints anything (Fastfetch,
// banners, prompts, warnings, etc.) contaminates the JSON stream and produces:
//   No JSON content found in output
// Traversal does not spawn the user's shell, so make it the first collector.
// 26.x releases have used both `packager` and `platformPackager` as the local
// variable name, so accept either while still refusing to alter an unknown shape.
const packageManagerCall = '(?:platformPackager|packager)\\.getPackageManager\\(\\)';
const alreadyPatched = new RegExp(
  `const\\s+pmApproaches\\s*=\\s*\\[\\s*[^\\]]*PM\\.TRAVERSAL\\s*,\\s*await\\s+${packageManagerCall}\\s*\\]`,
  'm'
);
const originalOrder = new RegExp(
  `(const\\s+pmApproaches\\s*=\\s*)\\[\\s*await\\s+((?:platformPackager|packager)\\.getPackageManager\\(\\))\\s*,\\s*([^\\]\\r\\n]*PM\\.TRAVERSAL)\\s*\\]`,
  'm'
);

if (!alreadyPatched.test(source)) {
  const match = source.match(originalOrder);
  if (!match) {
    const nearby = source.match(/.{0,120}pmApproaches.{0,260}/s)?.[0] || 'pmApproaches was not found';
    fail(`Could not recognize electron-builder's collector order. Refusing to patch an unknown layout.\n${nearby}`);
  }
  source = source.replace(originalOrder, '$1[$3, await $2]');
  fs.writeFileSync(target, source, 'utf8');
}

const verified = fs.readFileSync(target, 'utf8');
if (!alreadyPatched.test(verified)) {
  fail('Traversal-first collector verification failed after patching.');
}

console.log('electron-builder collector patched: filesystem traversal runs before package-manager JSON collection.');
