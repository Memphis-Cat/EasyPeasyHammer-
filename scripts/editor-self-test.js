// byanca
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const check = (condition, message) => { if (!condition) failures.push(message); };

function versionAtLeast(actual, wanted) {
  const a = String(actual || '0').split('.').map(x => Number.parseInt(x, 10) || 0);
  const b = String(wanted || '0').split('.').map(x => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
}

const pkg = JSON.parse(read('package.json'));
check(versionAtLeast(pkg.dependencies?.ws, '8.21.3'), 'ws must stay at 8.21.3 or newer.');
check(versionAtLeast(pkg.devDependencies?.['electron-builder'], '26.15.3'), 'electron-builder must stay at 26.15.3 or newer.');
check(pkg.build?.asar !== false, 'Packaged builds must not disable ASAR.');

const buildBat = read('Build_EXE.bat');
check(buildBat.includes('SAFE_EB_VERSION=26.15.3'), 'Build_EXE.bat must not reinstall an older vulnerable electron-builder.');
check(!buildBat.includes('electron-builder@26.0.11'), 'Build_EXE.bat still references vulnerable electron-builder 26.0.11.');

const launcher = read('launcher.js');
check(launcher.includes("require('./electron-security')"), 'Electron security guard must load before the editor.');

const collabNetwork = read('collab-network.js');
check(!/128\s*\*\s*1024\s*\*\s*1024/.test(collabNetwork), 'Collaboration payload limit must not return to 128 MB.');
check(collabNetwork.includes('safePayloadLimit'), 'Collaboration WebSocket payloads must be clamped.');

const attachmentService = read('attachment-service.js');
check(attachmentService.includes('canAccessAttachment'), 'Attachment IPC must validate renderer-supplied paths.');

const fidelity = read('src/hammer-fidelity-ui.js');
check(!/setInterval\s*\(\s*synchronizeAll\s*,\s*1000\s*\)/.test(fidelity), 'Texture fidelity must not scan every object every second.');

const largeMap = read('large-map-service.js');
check(largeMap.includes('VALID_TOKEN'), 'Large-map cache tokens must be validated.');
check(largeMap.includes('MAX_PATCH_BYTES'), 'Large-map patch input must be bounded.');
check(largeMap.includes('target.toLowerCase() !== source.toLowerCase()'), 'Large-map saves must stay on the opened VMAP path.');

const startup = read('src/startup-interaction-fix.js');
check(startup.includes('editor-stability-v28.js'), 'Editor V28 stability pass must be loaded.');

const stability = read('src/editor-stability-v28.js');
check(stability.includes('__ephEditorStabilityV28'), 'Editor V28 stability marker is missing.');
check(stability.includes('MAX_PROPERTY_FACES'), 'Large imported mesh property rendering must remain bounded.');
check(stability.includes('installIncrementalViewport'), 'Incremental viewport updates must remain installed.');
check(stability.includes('THUMB_WORKERS'), 'Material preview concurrency must remain bounded.');

const pullBat = read('Pull_Latest.bat');
check(pullBat.includes('npm install --ignore-scripts'), 'Pull_Latest.bat must refresh changed dependencies without running lifecycle scripts.');

if (failures.length) {
  console.error(`Editor self-test failed (${failures.length}):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Editor self-test passed (security, dependency and performance regressions checked).');
}
