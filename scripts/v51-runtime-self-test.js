// byanca
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const projectDialog = read('src/project-dialog.js');
const assetManager = read('src/asset-manager-v24.js');
const performance = read('src/editor-performance-integrity-v51.js');
const preflight = read('src/performance-preflight-v51.js');

function quotedPasses(blockName) {
  const match = projectDialog.match(new RegExp(`const\\s+${blockName}\\s*=\\s*\\[([\\s\\S]*?)\\n\\];`));
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+\.js)'/g)].map(item => item[1]);
}

const base = quotedPasses('BASE_PASSES');
const late = quotedPasses('LATE_PASSES');
const allPasses = [...base, ...late];
const lateIndex = name => late.indexOf(name);

for (const required of [
  'performance-preflight-v51.js',
  'asset-manager-v24.js',
  'part-numbering-v25.js',
  'prop-fidelity-v37.js',
  'weather-volume-v27.js',
  'weather-audio-v37.js',
  'particle-placement-v25.js',
  'hammer-parity-v45.js',
  'hammer-selection-v46.js',
  'selection-sync-v48.js',
  'editor-interaction-stability-v49.js',
  'editor-interaction-consistency-v50.js',
  'editor-performance-integrity-v51.js',
  'render-frame-watchdog-v36.js',
]) check(late.includes(required), `${required} is missing from deterministic LATE_PASSES.`);

check(lateIndex('performance-preflight-v51.js') >= 0, 'Performance preflight is not loaded.');
for (const guarded of [
  'prop-fidelity-v37.js',
  'solid-entity-runtime-v24.js',
  'entity-model-basis-v41.js',
  'hammer-fgd-visuals-v42.js',
  'hammer-parity-v45.js',
]) {
  check(lateIndex('performance-preflight-v51.js') < lateIndex(guarded), `Performance preflight must load before ${guarded}.`);
}

const assetOrder = [
  'asset-manager-v24.js',
  'part-numbering-v25.js',
  'prop-fidelity-v37.js',
  'weather-volume-v27.js',
  'weather-audio-v37.js',
  'particle-placement-v25.js',
];
for (let i = 1; i < assetOrder.length; i++) {
  check(lateIndex(assetOrder[i - 1]) < lateIndex(assetOrder[i]), `${assetOrder[i]} must load after ${assetOrder[i - 1]}.`);
}

check(lateIndex('editor-interaction-consistency-v50.js') < lateIndex('editor-performance-integrity-v51.js'), 'V51 must load after final V50 interaction consistency.');
check(lateIndex('editor-performance-integrity-v51.js') < lateIndex('render-frame-watchdog-v36.js'), 'Render Frame V36 must verify the renderer after V51 is installed.');

const duplicates = allPasses.filter((name, index) => allPasses.indexOf(name) !== index);
check(duplicates.length === 0, `Deterministic pass list contains duplicates: ${[...new Set(duplicates)].join(', ')}`);

for (const pass of allPasses) {
  if (pass.startsWith('bundled/')) continue;
  check(exists(`src/${pass}`), `Deterministic runtime pass is missing on disk: src/${pass}`);
}

check(!/createElement\s*\(\s*['"]script['"]\s*\)/.test(assetManager), 'Asset Manager must not dynamically inject extension scripts.');
check(!/\bloadExtension\s*\(/.test(assetManager), 'Asset Manager still contains the old extension loader.');

for (const marker of [
  '__ephPerformancePreflightV51',
  'redundantGuards',
  'window.setInterval = guardedSetInterval',
  "window.setInterval === guardedSetInterval",
]) check(preflight.includes(marker), `Performance preflight is missing ${marker}.`);

for (const marker of [
  'PERF_FIXES',
  'STABILITY_FIXES',
  'eph-part-opacity-v51',
  'Invisibility',
  'renderAmt',
  'tintColor',
  'installVmapFastPath',
  'installViewportFastPaths',
  'installSharedPropPreview',
  'installTree',
  'installProperties',
  'installPointerLockGuard',
]) check(performance.includes(marker), `V51 performance/integrity pass is missing ${marker}.`);

const perfBlock = performance.match(/const\s+PERF_FIXES\s*=\s*\[([\s\S]*?)\n\s*\];/);
const stabilityBlock = performance.match(/const\s+STABILITY_FIXES\s*=\s*\[([\s\S]*?)\n\s*\];/);
const countEntries = block => block ? [...block[1].matchAll(/^\s*'[^\n]*',\s*$/gm)].length : 0;
const perfCount = countEntries(perfBlock);
const stabilityCount = countEntries(stabilityBlock);
check(perfCount >= 25, `V51 performance audit dropped below 25 concrete fixes (found ${perfCount}).`);
check(stabilityCount >= 50, `V51 editor consistency audit dropped below 50 concrete fixes (found ${stabilityCount}).`);

if (failures.length) {
  console.error(`V51 runtime self-test failed (${failures.length}):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`V51 runtime self-test passed. ${allPasses.length} deterministic passes checked; ${perfCount} performance + ${stabilityCount} consistency fixes guarded.`);
}
