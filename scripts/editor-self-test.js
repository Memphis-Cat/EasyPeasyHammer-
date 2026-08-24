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
check(projectDialog.includes("'viewport-layout-integrity-v35.js'"), 'Zero-height viewport recovery must load in the deterministic runtime sequence.');
check(projectDialog.indexOf("'viewport-layout-integrity-v35.js'") < projectDialog.indexOf("'render-core-integrity-v34.js'"), 'Viewport layout recovery must load before the final render integrity guard.');
check(projectDialog.includes("'render-core-integrity-v34.js'"), 'Final render integrity pass must load after renderer enhancements.');
check(projectDialog.includes("'render-frame-watchdog-v36.js'"), 'Actual WebGL frame verification must load in the deterministic runtime sequence.');
check(projectDialog.indexOf("'render-core-integrity-v34.js'") < projectDialog.indexOf("'render-frame-watchdog-v36.js'"), 'Render Frame V36 must load after Render Core V34.');
check(projectDialog.includes("'mesh-topology-repair-v36.js'"), 'Hammer T-junction topology repair must load with Negative Brush.');
check(projectDialog.indexOf("'negative-brush-safety-v22.js'") < projectDialog.indexOf("'mesh-topology-repair-v36.js'"), 'Topology repair must be installed after the atomic Negative Brush guard.');

const startupFix = read('src/startup-interaction-fix.js');
check(!startupFix.includes("document.createElement('script')"), 'startup-interaction-fix must never start a second renderer script loader.');
check(!startupFix.includes("loadPass('"), 'startup-interaction-fix still contains competing runtime pass loads.');

const visualClean = read('src/visual-clean-v16.js');
check(!/threeViewport[^\n]*background\s*:\s*#000/i.test(visualClean), 'The WebGL viewport must not be masked by a forced pure-black CSS background.');
check(!/scene\.background\s*=\s*new\s+THREE\.Color\(0x000000\)/.test(visualClean), 'Visual cleanup must not force a pure-black scene.');

const uiFixes = read('src/ui-fixes.css');
check(uiFixes.includes('#editorScreen.editor-screen'), 'The UI stylesheet must own an explicit editor height contract.');
check(uiFixes.includes('grid-template-rows: auto minmax(0, 1fr) 36px'), 'The editor middle row must have a zero intrinsic minimum so it cannot collapse after hidden startup.');
check(uiFixes.includes('#editorScreen .workspace-column') && uiFixes.includes('height: 100% !important'), 'The workspace must inherit a concrete editor height.');

const viewportLayout = read('src/viewport-layout-integrity-v35.js');
for (const marker of ['forceVerticalContract', 'chainState', 'drawingBuffer', 'Recovered a zero-size editor viewport', 'Viewport layout is still zero-sized after forced recovery']) {
  check(viewportLayout.includes(marker), `Viewport Layout V35 is missing ${marker}.`);
}
check(viewportLayout.includes("grid-template-rows: auto minmax(0, 1fr) 36px"), 'Viewport Layout V35 must enforce the non-collapsing editor grid.');
check(viewportLayout.includes("window.addEventListener('resize'"), 'Viewport Layout V35 must recover after window resizing.');

const renderCore = read('src/render-core-integrity-v34.js');
for (const marker of ['validCameraState', 'ensureSize', 'ensureScene', 'ensureRoot', 'authoritativeNormalMapRebuild', 'webglcontextlost', 'focusSelected']) {
  check(renderCore.includes(marker), `Render Core V34 is missing ${marker}.`);
}
check(renderCore.includes('clientWidth'), 'Render Core must repair a viewport initially constructed while hidden.');
check(renderCore.includes('Rebuilt missing render root'), 'Missing editor/render roots must be diagnosable.');

const renderFrame = read('src/render-frame-watchdog-v36.js');
for (const marker of ['stabilizeRenderer', 'forceFrame', 'renderer.info', 'setScissorTest', 'setViewport', 'stalled-render-loop', 'Actual WebGL frame verified after project load']) {
  check(renderFrame.includes(marker), `Render Frame V36 is missing ${marker}.`);
}
check(renderFrame.includes("canvas.style.setProperty('opacity', '1', 'important')"), 'Render Frame V36 must recover a hidden/transparent WebGL canvas.');
check(renderFrame.includes('renderableRoots(viewport) > 0') && renderFrame.includes('viewport.frameAll?.()'), 'Render Frame V36 must recover a valid-but-empty camera frustum after load.');

const topologyRepair = read('src/mesh-topology-repair-v36.js');
for (const marker of ['repairTjunctions', 'topologySummary', 'pointOnSegment', 'nonManifoldBoundaryVertices', 'T-junction conformance', '__ephMeshTopologyRepairV36']) {
  check(topologyRepair.includes(marker), `Mesh Topology V36 is missing ${marker}.`);
}
check(topologyRepair.includes('throw error'), 'Mesh Topology V36 must preserve Hammer validation failures it cannot safely repair.');
check(!topologyRepair.includes('VMAP.validate ='), 'Mesh Topology V36 must never weaken or replace VMAP validation.');

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
  return /createElement\(['"]script['"]\)/.test(body) && /(?:bundled\/|vmap-|large-map-|mesh-render-|entity-runtime-|editor-stability-|render-core-|render-frame-)/.test(body);
});
check(competingLoaderFiles.length === 0, `Competing renderer loaders found in: ${competingLoaderFiles.map(rel).join(', ')}`);

const hiddenCanvasFiles = hazardSweepFiles.filter(file => {
  const name = rel(file);
  if (name === 'src/viewport-layout-integrity-v35.js' || name === 'src/render-frame-watchdog-v36.js') return false;
  const body = text(file);
  return /(?:threeViewport|renderer\.domElement|\bcanvas\b)[^\n]{0,180}(?:opacity\s*[:=]\s*0\b|visibility\s*[:=]\s*hidden\b|display\s*[:=]\s*none\b)/i.test(body);
});
check(hiddenCanvasFiles.length === 0, `WebGL canvas hiding found in: ${hiddenCanvasFiles.map(rel).join(', ')}`);

const renderLoopSabotageFiles = hazardSweepFiles.filter(file => {
  const name = rel(file);
  if (name === 'src/viewport3d.js' || name === 'src/render-frame-watchdog-v36.js') return false;
  const body = text(file);
  return /renderer\.setAnimationLoop\s*\(\s*null\s*\)|renderer\.render\s*=|cancelAnimationFrame\s*\(/.test(body);
});
check(renderLoopSabotageFiles.length === 0, `Render-loop override/sabotage found in: ${renderLoopSabotageFiles.map(rel).join(', ')}`);

const sceneHideFiles = hazardSweepFiles.filter(file => /(?:scene|objectGroup)\.visible\s*=\s*false/.test(text(file)));
check(sceneHideFiles.length === 0, `Scene/object-root hiding found in: ${sceneHideFiles.map(rel).join(', ')}`);

const pullBat = read('Pull_Latest.bat');
check(pullBat.includes('npm install --ignore-scripts'), 'Pull_Latest.bat must refresh changed dependencies without running lifecycle scripts.');

if (failures.length) {
  console.error(`Editor self-test failed (${failures.length}) after scanning ${allTextFiles.length} project text/code files:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Editor self-test passed. Scanned ${allTextFiles.length} project text/code files; renderer startup, canvas, camera, actual frame progress, Three.js, carve topology and large-map block invariants are guarded.`);
}
