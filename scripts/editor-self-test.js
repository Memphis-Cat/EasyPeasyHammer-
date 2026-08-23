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

function walk(folder, output = []) {
  if (!fs.existsSync(folder)) return output;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.runtime', 'dist', 'Projects', 'bin', 'obj', 'bundled'].includes(entry.name)) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else output.push(full);
  }
  return output;
}

const allProjectFiles = walk(root);
const textExtensions = new Set(['.js', '.css', '.html', '.json', '.bat', '.md', '.cs', '.csproj']);
const allTextFiles = allProjectFiles.filter(file => textExtensions.has(path.extname(file).toLowerCase()));
const rel = file => path.relative(root, file).replace(/\\/g, '/');
const text = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const hazardSweepFiles = allTextFiles.filter(file => rel(file) !== 'scripts/editor-self-test.js');

const pkg = JSON.parse(read('package.json'));
check(versionAtLeast(pkg.dependencies?.ws, '8.21.3'), 'ws must stay at 8.21.3 or newer.');
check(versionAtLeast(pkg.devDependencies?.['electron-builder'], '26.15.3'), 'electron-builder must stay at 26.15.3 or newer.');
check(pkg.build?.asar !== false, 'Packaged builds must not disable ASAR.');

const buildBat = read('Build_EXE.bat');
check(buildBat.includes('SAFE_EB_VERSION=26.15.3'), 'Build_EXE.bat must not reinstall an older vulnerable electron-builder.');
check(!buildBat.includes('electron-builder@26.0.11'), 'Build_EXE.bat still references vulnerable electron-builder 26.0.11.');

const launcher = read('launcher.js');
check(launcher.includes("require('./electron-security')"), 'Electron security guard must load before the editor.');
check(launcher.includes('registerLargeMapBlockServiceV34'), 'The non-poisoning large-map block reader must be registered after the base service.');

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

const blockV34 = read('src/large-map-block-service-v34.js');
check(blockV34.includes('NORMAL_RESPONSE_BYTES = 24 * 1024 * 1024'), 'Normal large-map responses must stay bounded at 24 MB.');
check(blockV34.includes('MAX_SINGLE_BLOCK_BYTES = 128 * 1024 * 1024'), 'Single large-map blocks need a 128 MB hard cap.');
check(blockV34.includes('isolatedOversized'), 'Oversized Anubis blocks must be isolated instead of poisoning their batch.');

const largeStream = read('src/large-map-stream-v21.js');
check(largeStream.includes('INITIAL_CONTAINER_TARGET'), 'Large maps must preload a stable working set before editor handoff.');
check(largeStream.includes('BATCH = 24'), 'Large-map geometry loading should retain the 24-block fast batch.');
check(!largeStream.includes('MAX_RESIDENT'), 'Large maps must not restore the old 320-object resident cap.');
check(!largeStream.includes('unloadInvisible('), 'Camera movement must not evict loaded map geometry.');

const mapLocalModels = read('map-local-model-service-v20.js');
check(mapLocalModels.includes('MAX_SOURCE_CACHE = 48'), 'Map-local shared source cache must remain large enough for Valve maps.');
check(mapLocalModels.includes('MAX_SOURCE_TASKS = 2'), 'Map-local source conversion concurrency must stay bounded.');

const mapLocalAssets = read('src/map-local-assets-v19.js');
check(mapLocalAssets.includes('isShaderOnlyMaterial'), 'Shader-only Source 2 materials must not become false ERROR boxes.');
check(mapLocalAssets.includes('ephPreviewMissing'), 'Non-textured material fallback tracking is missing.');

const bundler = read('bundle-renderer.js');
check(bundler.includes('useSharedViewportThree'), 'All enhancement bundles must use the viewport Three.js runtime.');
check(bundler.includes('EPH_THREE_HELPERS'), 'Shared Three.js addon helpers must be exported by the viewport bundle.');
check(bundler.includes('remainingThreeImports'), 'Bundling must fail when a private Three.js import survives rewriting.');
check(!bundler.includes('options.entryPoints = [source]'), 'Enhancement bundles must not independently bundle Three.js.');

const projectDialog = read('src/project-dialog.js');
check(projectDialog.includes('EPH_RUNTIME_READY'), 'Renderer startup must expose one deterministic readiness promise.');
check(projectDialog.includes('BASE_PASSES') && projectDialog.includes('LATE_PASSES'), 'All runtime passes must be owned by the single project-dialog sequence.');
check(projectDialog.includes("'render-core-integrity-v34.js'"), 'Final render integrity pass must load after renderer enhancements.');

const startupFix = read('src/startup-interaction-fix.js');
check(!startupFix.includes("document.createElement('script')"), 'startup-interaction-fix must never start a second renderer script loader.');
check(!startupFix.includes("loadPass('"), 'startup-interaction-fix still contains competing runtime pass loads.');

const visualClean = read('src/visual-clean-v16.js');
check(!/threeViewport[^\n]*background\s*:\s*#000/i.test(visualClean), 'The WebGL viewport must not be masked by a forced pure-black CSS background.');
check(!/scene\.background\s*=\s*new\s+THREE\.Color\(0x000000\)/.test(visualClean), 'Visual cleanup must not force a pure-black scene.');

const renderCore = read('src/render-core-integrity-v34.js');
for (const marker of ['validCameraState', 'ensureSize', 'ensureScene', 'ensureRoot', 'authoritativeNormalMapRebuild', 'webglcontextlost', 'focusSelected']) {
  check(renderCore.includes(marker), `Render Core V34 is missing ${marker}.`);
}
check(renderCore.includes('clientWidth'), 'Render Core must repair a viewport initially constructed while hidden.');
check(renderCore.includes('Rebuilt missing render root'), 'Missing editor/render roots must be diagnosable.');

const solidEntity = read('src/solid-entity-unified-v30.js');
check(solidEntity.includes("TRIGGER_MATERIAL = 'materials/tools/toolstrigger.vmat'"), 'CS2 trigger volumes must keep the Hammer trigger material.');
check(solidEntity.includes('part.collision !== true'), 'Trigger child meshes must retain default Hammer physics instead of physicsType none.');
check(solidEntity.includes('ephMeshEntityChild'), 'Mesh-entity child Parts must remain owned by their entity.');
check(solidEntity.includes('canonicalId'), '3D selection must canonicalize entity child meshes to their parent entity.');

const stability = read('src/editor-stability-v28.js');
check(stability.includes('__ephEditorStabilityV28'), 'Editor V28 stability marker is missing.');
check(stability.includes('MAX_PROPERTY_FACES'), 'Large imported mesh property rendering must remain bounded.');
check(stability.includes('THUMB_WORKERS'), 'Material preview concurrency must remain bounded.');

// Repository-wide render hazard sweep. This intentionally scans every project
// text/code file except this audit script itself, whose regex definitions would
// otherwise match their own source text rather than a real editor hazard.
const pureBlackCanvasFiles = hazardSweepFiles.filter(file => /#threeViewport[^\n]{0,160}background\s*:\s*#000(?:000)?\b/i.test(text(file)));
check(pureBlackCanvasFiles.length === 0, `Pure-black viewport masking found in: ${pureBlackCanvasFiles.map(rel).join(', ')}`);

const competingLoaderFiles = hazardSweepFiles.filter(file => {
  const name = rel(file);
  if (name === 'src/project-dialog.js') return false;
  const body = text(file);
  return /createElement\(['"]script['"]\)/.test(body) && /(?:bundled\/|vmap-|large-map-|mesh-render-|entity-runtime-|editor-stability-)/.test(body);
});
check(competingLoaderFiles.length === 0, `Competing renderer loaders found in: ${competingLoaderFiles.map(rel).join(', ')}`);

const pullBat = read('Pull_Latest.bat');
check(pullBat.includes('npm install --ignore-scripts'), 'Pull_Latest.bat must refresh changed dependencies without running lifecycle scripts.');

if (failures.length) {
  console.error(`Editor self-test failed (${failures.length}) after scanning ${allTextFiles.length} project text/code files:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Editor self-test passed. Scanned ${allTextFiles.length} project text/code files; renderer startup, canvas, camera, Three.js and large-map block invariants are guarded.`);
}
