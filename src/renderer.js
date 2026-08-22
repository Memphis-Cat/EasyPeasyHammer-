// byanca
const api = window.easyPeasyHammer;
const VMAP = window.EPH_VMAP;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = value => String(value).charAt(0).toUpperCase() + String(value).slice(1);

const S = {
  project: null, doc: null, objects: [], selectedId: null, selectedFaces: new Set([0]), subSelection: null,
  tool: 'select', assetTab: 'materials', bottomTab: 'console', grid: true, gridSize: 64, snap: true, angleSnap: 15,
  space: 'Local', view: 'Perspective', shading: 'Lit', viewport: null, camera: null,
  undo: [], redo: [], dirty: false, logs: [], autosaveTimer: null, lastAutosave: 0,
  assetStatus: null, assetItems: [], assetQuerySeq: 0, clipAxis: 0, clipPlane: 0, clipPositive: true
};

const CORE_MATERIALS = [
  { name: 'ERROR / Missing', path: 'ERROR', kind: 'material', source: 'EasyPeasyHammer' },
  { name: 'Player Clip', path: 'materials/tools/toolsplayerclip.vmat', kind: 'material', source: 'CS2 Tool' },
  { name: 'Grenade Clip', path: 'materials/tools/toolsgrenadeclip.vmat', kind: 'material', source: 'CS2 Tool' },
  { name: 'Block Bullets', path: 'materials/tools/toolsblockbullets_cs.vmat', kind: 'material', source: 'CS2 Tool' },
  { name: 'General Clip', path: 'materials/tools/toolsclip.vmat', kind: 'material', source: 'CS2 Tool' },
  { name: 'Skybox', path: 'materials/tools/toolsskybox.vmat', kind: 'material', source: 'CS2 Tool' }
];
const ENTITIES = [
  { name: 'CT Spawn', className: 'info_player_counterterrorist', kind: 'entity' },
  { name: 'T Spawn', className: 'info_player_terrorist', kind: 'entity' },
  { name: 'Light Omni', className: 'light_omni2', kind: 'entity' },
  { name: 'Light Environment', className: 'light_environment', kind: 'entity' },
  { name: 'Trigger Multiple', className: 'trigger_multiple', kind: 'entity' },
  { name: 'Trigger Hurt', className: 'trigger_hurt', kind: 'entity' },
  { name: 'Info Target', className: 'info_target', kind: 'entity' },
  { name: 'Logic Relay', className: 'logic_relay', kind: 'entity' }
];

function icons() {
  const map = window.EPH_ICONS || {};
  document.querySelectorAll('img[src]').forEach(img => { const raw = img.getAttribute('src'); if (map[raw]) img.src = map[raw]; });
}
function toast(text) { const e = $('toast'); e.textContent = text; e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), 2400); }
function log(message, kind = 'info') { S.logs.push({ time: new Date().toLocaleTimeString(), message, kind }); if (S.logs.length > 300) S.logs.shift(); if (S.bottomTab === 'console') renderBottom(); }
function current() { return S.objects.find(o => o.id === S.selectedId) || null; }
function ensureObject(o) {
  if (!o || ['world', 'folder'].includes(o.type)) return o;
  o.position ??= [0, 0, 0]; o.rotation ??= [0, 0, 0]; o.scale ??= [1, 1, 1]; o.size ??= [64, 64, 64];
  o.collision ??= true; o.blockPlayers ??= o.collision !== false; o.blockGrenades ??= false; o.blockBullets ??= false; o.visible ??= true;
  o.faceMaterials ??= o.faces?.map((_, i) => o.materials?.[VMAP.FACE_NAMES[i]] || 'ERROR') || [];
  o.materials ??= Object.fromEntries(VMAP.FACE_NAMES.map((f, i) => [f, o.faceMaterials[i] || 'ERROR']));
  return o;
}

function extras() {
  const result = {};
  for (const o of S.objects) if (o.dmxId) result[o.id] = {
    name: o.name, size: o.size, collision: o.collision, blockPlayers: o.blockPlayers, blockGrenades: o.blockGrenades,
    blockBullets: o.blockBullets, visible: o.visible, className: o.className, model: o.model
  };
  return result;
}
function applyExtras(data) { if (!data) return; for (const o of S.objects) if (data[o.id]) Object.assign(o, data[o.id]); }
function syncWorking() { if (!S.doc) return; for (const o of S.objects) if (o.dmxId) VMAP.applyObjectToDocument(S.doc, o); }
function workingText() { syncWorking(); return S.doc ? VMAP.stringify(S.doc) : ''; }
function saveText() { syncWorking(); return S.doc ? VMAP.stringify(VMAP.prepareForSave(S.doc, S.objects)) : ''; }
function uiSnapshot() {
  return {
    phase: 3, tool: S.tool, assetTab: S.assetTab, bottomTab: S.bottomTab, selectedId: S.selectedId, selectedFaces: [...S.selectedFaces],
    grid: S.grid, gridSize: S.gridSize, snap: S.snap, angleSnap: S.angleSnap, space: S.space, view: S.view, shading: S.shading,
    cameraState: S.viewport?.getCameraState?.() || S.camera, objectExtras: extras(), vmapText: workingText(), clipAxis: S.clipAxis, clipPlane: S.clipPlane, clipPositive: S.clipPositive
  };
}
function restoreUi(ui) {
  if (!ui) return;
  for (const key of ['tool', 'assetTab', 'bottomTab', 'selectedId', 'grid', 'gridSize', 'snap', 'angleSnap', 'space', 'view', 'shading', 'clipAxis', 'clipPlane', 'clipPositive']) if (ui[key] !== undefined) S[key] = ui[key];
  if (ui.selectedFaces?.length) S.selectedFaces = new Set(ui.selectedFaces.map(Number));
  S.camera = ui.cameraState || null;
}
function updateTitle() {
  if (!S.project) return;
  const star = S.dirty ? ' *' : '';
  $('projectTitle').textContent = `${S.project.name}.vmap${star}`;
  $('mapStatus').textContent = `Map: ${S.project.name}.vmap${star}`;
}
function markDirty(message) { S.dirty = true; updateTitle(); if (message) log(message); clearTimeout(S.autosaveTimer); S.autosaveTimer = setTimeout(() => autosave(), 900); }
async function autosave(show = false) {
  if (!S.project || !S.doc) return;
  const result = await api.autosave({ project: S.project, uiState: uiSnapshot() });
  if (result?.ok) { S.lastAutosave = Date.now(); $('autosaveStatus').textContent = `Autosaved ${new Date(result.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; }
  if (show) toast('Autosaved editor session');
}

function pushHistory() {
  if (!S.doc) return;
  S.undo.push({ text: workingText(), extras: extras(), selectedId: S.selectedId, faces: [...S.selectedFaces] });
  if (S.undo.length > 60) S.undo.shift();
  S.redo = [];
}
function historyState() { return { text: workingText(), extras: extras(), selectedId: S.selectedId, faces: [...S.selectedFaces] }; }
function restoreHistory(item) {
  if (!item) return;
  try {
    S.doc = VMAP.parse(item.text); S.objects = VMAP.extractObjects(S.doc).map(ensureObject); applyExtras(item.extras);
    S.selectedId = S.objects.some(o => o.id === item.selectedId) ? item.selectedId : 'world'; S.selectedFaces = new Set(item.faces || [0]);
    renderAll(); S.viewport?.setObjects(S.objects, S.selectedId); markDirty();
  } catch (error) { log(`History restore failed: ${error.message}`, 'warning'); }
}
function undo() { if (!S.undo.length) return; S.redo.push(historyState()); restoreHistory(S.undo.pop()); }
function redo() { if (!S.redo.length) return; S.undo.push(historyState()); restoreHistory(S.redo.pop()); }

async function home() {
  const data = await api.getStartupState();
  $('editorScreen').classList.add('hidden'); $('startupScreen').classList.remove('hidden');
  const p = data?.lastSession?.project; $('resumePanel').classList.toggle('hidden', !p); $('forgetSessionButton').classList.toggle('hidden', !p);
  if (p) { $('resumeName').textContent = p.name || 'Untitled'; $('resumePath').textContent = p.vmapPath || ''; }
}

async function loadProject(project, ui) {
  S.project = project; restoreUi(ui);
  let source = ui?.vmapText;
  if (!source) {
    const result = await api.loadVmap(project.vmapPath);
    if (!result?.ok) { toast('Could not read VMAP'); log(result?.error || 'Could not read VMAP', 'warning'); return false; }
    source = result.text;
  }
  try { S.doc = VMAP.parse(source); const check = VMAP.validate(S.doc); if (!check.ok) throw Error(check.errors.join(' ')); }
  catch (error) { toast('This VMAP could not be parsed'); log(`VMAP parser: ${error.message}`, 'warning'); return false; }
  S.objects = VMAP.extractObjects(S.doc).map(ensureObject); applyExtras(ui?.objectExtras);
  if (!S.objects.some(o => o.id === S.selectedId)) S.selectedId = S.objects.find(o => o.type !== 'world')?.id || 'world';
  S.undo = []; S.redo = []; S.dirty = Boolean(ui?.vmapText);
  $('startupScreen').classList.add('hidden'); $('editorScreen').classList.remove('hidden');
  renderAll(); connectViewport(); S.viewport?.setObjects(S.objects, S.selectedId); if (S.camera) S.viewport?.setCameraState(S.camera); else S.viewport?.frameAll();
  updateTitle(); await autosave(); await refreshAssetStatus(); queueAssetSearch(); return true;
}
async function openMap() { const result = await api.openVmap(); if (!result) return; const p = result.project || result; if (await loadProject(p, result.uiState || null)) log(`Opened ${p.vmapPath}`, 'success'); }
async function continueMap() { const result = await api.continueLast(); if (result?.project && await loadProject(result.project, result.uiState || null)) log(`Continued ${result.project.name}`, 'success'); }
function openNewModal() { $('newProjectName').value = ''; $('newProjectModal').classList.remove('hidden'); setTimeout(() => $('newProjectName').focus(), 20); }
async function newProject() {
  const name = $('newProjectName').value.trim(); if (!name) return toast('Enter a project name');
  const result = await api.createProject(name); if (!result) return; const p = result.project || result;
  const doc = VMAP.createEmptyDocument(); const write = await api.saveVmap(p.vmapPath, VMAP.stringify(doc), false); if (!write?.ok) return toast('Could not create VMAP file');
  $('newProjectModal').classList.add('hidden'); await loadProject(p, null); S.doc = doc; S.objects = VMAP.extractObjects(doc).map(ensureObject); S.selectedId = 'world'; S.dirty = false;
  renderAll(); S.viewport?.setObjects(S.objects, S.selectedId); updateTitle(); log(`Created ${p.name}`, 'success');
}
async function save(show = true) {
  if (!S.project || !S.doc) return;
  const text = saveText(); const result = await api.saveVmap(S.project.vmapPath, text, true);
  if (!result?.ok) { toast('Save failed'); return log(`Save failed: ${result?.error || 'unknown error'}`, 'warning'); }
  S.dirty = false; updateTitle(); await autosave(); $('autosaveStatus').textContent = `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  log(`Saved ${S.project.vmapPath}`, 'success'); if (result.backupPath) log(`Backup: ${result.backupPath}`); if (show) toast('VMAP saved');
}
async function exitMap() {
  if (!S.project) return; await autosave(); await api.returnHome({ project: S.project, uiState: uiSnapshot() });
  S.viewport?.setObjects([], null); S.project = null; S.doc = null; S.objects = []; S.selectedId = null; await home();
}

function connectViewport() {
  const v = window.EPH3D; if (!v || S.viewport === v) return; S.viewport = v;
  v.onSelect(id => { S.selectedId = id; S.subSelection = null; S.selectedFaces = new Set([0]); renderTree(); renderProperties(); });
  v.onTransformStart(pushHistory);
  v.onChange((o, commit) => { VMAP.applyObjectToDocument(S.doc, o); renderProperties(); if (commit) markDirty(`Changed ${o.name}`); });
  v.onCameraChange(c => S.camera = c);
  v.onSubselect(sub => { S.subSelection = sub; if (sub?.type === 'face' && Number.isInteger(sub.faceIndex)) S.selectedFaces = new Set([sub.faceIndex]); renderProperties(); });
  v.onExtrudeRequest(faceIndex => extrude(faceIndex, 32));
  viewportSettings();
}
function viewportSettings() {
  if (!S.viewport) return;
  S.viewport.setTool(S.tool === 'texture' ? 'face' : S.tool === 'clip' ? 'select' : S.tool);
  S.viewport.setGrid(S.grid, S.gridSize); S.viewport.setSnap(S.snap, S.gridSize, S.angleSnap); S.viewport.setSpace(S.space); S.viewport.setShading(S.shading);
}

function renderAll() { renderAssets(); renderTools(); renderTree(); renderProperties(); renderBottom(); renderViewportControls(); icons(); }

async function refreshAssetStatus() {
  let status = await api.assetStatus();
  if (!status?.available) status = await api.detectCs2();
  S.assetStatus = status;
  renderAssetStatus();
}
function renderAssetStatus() {
  const e = $('assetSourceStatus');
  if (!e) return;
  const dot = document.querySelector('.status-dot');
  if (dot) dot.classList.toggle('online', Boolean(S.assetStatus?.available));
  if (S.assetStatus?.available) { e.textContent = `CS2 • ${Number(S.assetStatus.materialCount || 0).toLocaleString()} mats • ${Number(S.assetStatus.modelCount || 0).toLocaleString()} models`; e.classList.add('online'); }
  else { e.textContent = 'CS2 assets not connected'; e.classList.remove('online'); }
}
async function chooseCs2Folder() {
  const result = await api.chooseCs2Folder();
  if (!result) return;
  S.assetStatus = result; renderAssetStatus();
  if (result.ok || result.available) { toast('CS2 assets loaded'); queueAssetSearch(true); }
  else toast(result.error || 'Could not load CS2 assets');
}
let assetSearchTimer = null;
function queueAssetSearch(immediate = false) { clearTimeout(assetSearchTimer); assetSearchTimer = setTimeout(searchAssets, immediate ? 0 : 180); }
async function searchAssets() {
  const seq = ++S.assetQuerySeq; const query = $('assetSearch')?.value?.trim() || '';
  if (S.assetTab === 'entities') { S.assetItems = ENTITIES.filter(x => `${x.name} ${x.className}`.toLowerCase().includes(query.toLowerCase())); return renderAssets(); }
  if (!S.assetStatus?.available) { S.assetItems = S.assetTab === 'materials' ? CORE_MATERIALS.filter(x => `${x.name} ${x.path}`.toLowerCase().includes(query.toLowerCase())) : []; return renderAssets(); }
  const kind = S.assetTab === 'materials' ? 'material' : 'model';
  const result = await api.searchAssets(kind, query, 300);
  if (seq !== S.assetQuerySeq) return;
  let items = result?.ok ? result.items || [] : [];
  if (S.assetTab === 'materials') {
    const seen = new Set(items.map(x => x.path.toLowerCase()));
    items = [...CORE_MATERIALS.filter(x => !query || `${x.name} ${x.path}`.toLowerCase().includes(query.toLowerCase())).filter(x => !seen.has(x.path.toLowerCase())), ...items];
  }
  if (S.assetTab === 'props') items = items.map(x => ({ ...x, kind: 'prop', className: 'prop_static', model: x.path }));
  S.assetItems = items; renderAssets();
}
function renderAssets() {
  document.querySelectorAll('#assetTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.assetTab));
  const list = S.assetItems || [];
  $('assetGrid').innerHTML = list.map((x, i) => `<button class="asset-card" data-i="${i}" title="${esc(x.path || x.className || x.model || '')}"><div class="asset-thumb" data-thumb="${i}">${S.assetTab === 'materials' ? 'MAT' : S.assetTab === 'entities' ? 'ENT' : S.assetTab === 'props' ? 'PROP' : 'MDL'}</div><div class="asset-name">${esc(x.name)}</div></button>`).join('');
  $('assetCount').textContent = `${list.length}${S.assetStatus?.available && ['materials', 'models', 'props'].includes(S.assetTab) ? ' shown' : ' items'}`;
  $('assetGrid').querySelectorAll('.asset-card').forEach(card => {
    const item = list[Number(card.dataset.i)];
    card.onclick = () => {
      document.querySelectorAll('.asset-card').forEach(x => x.classList.remove('selected')); card.classList.add('selected');
      if (S.assetTab === 'materials' && current()?.type === 'part') applyMaterial(item.path);
    };
    card.ondblclick = () => {
      if (S.assetTab === 'entities') addEntity(item);
      else if (['props', 'models'].includes(S.assetTab)) addProp(item);
    };
  });
  if (S.assetTab === 'materials') loadMaterialThumbs(list.slice(0, 40));
  renderAssetStatus();
}
async function loadMaterialThumbs(items) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]; if (!item?.path || item.path === 'ERROR') continue;
    const result = await api.materialPreview(item.path); const thumb = document.querySelector(`[data-thumb="${i}"]`);
    if (result?.ok && result.url && thumb) { thumb.style.backgroundImage = `url("${result.url}")`; thumb.classList.add('real-thumb'); thumb.textContent = ''; }
  }
}

function renderTools() { document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === S.tool)); }
function childrenOf(id) { return S.objects.filter(o => o.parent === id); }
function renderTree() {
  const root = $('sceneTree'); root.innerHTML = ''; const query = $('sceneSearch').value.trim().toLowerCase();
  function addRow(o, depth) {
    const kids = childrenOf(o.id); if (query && !o.name.toLowerCase().includes(query) && !kids.some(x => x.name.toLowerCase().includes(query))) return;
    const row = document.createElement('div'); row.className = `tree-row${o.id === S.selectedId ? ' selected' : ''}`;
    const icon = o.type === 'world' ? 'hierarchy_world.png' : o.type === 'folder' ? (o.expanded ? 'hierarchy_folder_open.png' : 'hierarchy_folder_closed.png') : 'hierarchy_part.png';
    const chevron = kids.length ? (o.expanded ? 'hierarchy_chevron_down.png' : 'hierarchy_chevron_right.png') : null;
    row.innerHTML = `<span class="tree-indent" style="width:${depth * 14}px"></span>${chevron ? `<img class="tree-chevron" src="../assets/icons/hierarchy/${chevron}">` : '<span class="tree-chevron"></span>'}<img class="tree-icon" src="../assets/icons/hierarchy/${icon}"><span class="tree-name">${esc(o.name)}</span>${o.dmxId ? `<button class="tree-eye" title="Visibility">${o.visible === false ? '○' : '●'}</button>` : ''}`;
    root.appendChild(row); icons();
    row.onclick = event => {
      if (event.target.classList.contains('tree-eye')) { event.stopPropagation(); pushHistory(); o.visible = o.visible === false; VMAP.applyObjectToDocument(S.doc, o); S.viewport?.updateObject(o); markDirty(`Changed visibility on ${o.name}`); renderTree(); return; }
      if (kids.length && event.target.classList.contains('tree-chevron')) o.expanded = !o.expanded;
      else { S.selectedId = o.id; S.selectedFaces = new Set([0]); S.subSelection = null; S.viewport?.select(o.id, false); }
      renderTree(); renderProperties();
    };
    if (o.expanded) kids.forEach(k => addRow(k, depth + 1));
  }
  S.objects.filter(o => o.parent == null).forEach(o => addRow(o, 0));
}

function xyz(label, key, values, step = '.1') { return `<div class="xyz-row"><label>${label}</label>${values.map((v, i) => `<input class="prop-input prop-value" data-key="${key}" data-i="${i}" type="number" step="${step}" value="${Number(v).toFixed(Number.isInteger(Number(v)) ? 0 : 3)}">`).join('')}</div>`; }
function toggle(label, key, value, hint = '') { return `<div class="toggle-row" title="${esc(hint)}"><span>${label}</span><button class="toggle ${value ? 'on' : ''}" data-toggle="${key}"></button></div>`; }
function faceLabel(index, count) { return count === 6 && VMAP.FACE_NAMES[index] ? cap(VMAP.FACE_NAMES[index]) : `Face ${index + 1}`; }
function bindName(o) { $('objectName')?.addEventListener('change', event => { pushHistory(); o.name = event.target.value.trim() || o.name; VMAP.applyObjectToDocument(S.doc, o); renderTree(); markDirty(`Renamed to ${o.name}`); }); }

function renderProperties() {
  const o = ensureObject(current()); const host = $('propertiesContent');
  if (!o) { host.innerHTML = '<div class="collab-state">Nothing selected.</div>'; return; }
  if (['world', 'folder'].includes(o.type)) { host.innerHTML = `<div class="property-name-row"><input id="objectName" class="prop-input" value="${esc(o.name)}"></div><div class="property-section"><div class="property-section-title">${o.type === 'world' ? 'Map World' : 'Group'}</div></div>`; bindName(o); return; }

  const isPart = o.type === 'part'; const isEntity = ['entity', 'prop'].includes(o.type);
  const faceCount = o.faces?.length || 0;
  const entitySection = isEntity ? `<div class="property-section"><div class="property-section-title">Entity</div><div class="field-row"><label>Class</label><input id="classNameField" class="prop-input" value="${esc(o.className || 'info_target')}"></div><div class="field-row"><label>Model</label><input id="modelField" class="prop-input" value="${esc(o.model || '')}"></div></div>` : '';
  const materialSection = isPart ? `<div class="property-section"><div class="property-section-title">Face Materials</div><div class="face-selection">${Array.from({ length: faceCount }, (_, i) => `<button class="face-chip ${S.selectedFaces.has(i) ? 'active' : ''}" data-face="${i}">${faceLabel(i, faceCount)}</button>`).join('')}</div><div class="field-row"><label>Selected</label><div class="material-apply-row"><input id="selectedMaterial" class="prop-input" value="${esc(o.faceMaterials?.[[...S.selectedFaces][0]] || 'ERROR')}"><button id="applyMaterial" class="mini-button">Apply</button></div></div><div class="face-material-list">${Array.from({ length: faceCount }, (_, i) => `<div class="face-row"><label>${faceLabel(i, faceCount)}</label><div class="material-preview ${o.faceMaterials?.[i] === 'ERROR' ? 'error' : ''}" title="${esc(o.faceMaterials?.[i] || 'ERROR')}"></div><span class="face-path">${esc(o.faceMaterials?.[i] || 'ERROR')}</span></div>`).join('')}</div></div>` : '';
  const geometrySection = isPart ? `<div class="property-section"><div class="property-section-title">Geometry</div><div class="geometry-actions"><button id="extrudeFaceButton" class="mini-button wide">Extrude selected face +32</button></div><div class="clip-grid"><label>Clip Axis</label><select id="clipAxis" class="prop-select"><option value="0" ${S.clipAxis === 0 ? 'selected' : ''}>X</option><option value="1" ${S.clipAxis === 1 ? 'selected' : ''}>Y</option><option value="2" ${S.clipAxis === 2 ? 'selected' : ''}>Z</option></select><label>Plane</label><input id="clipPlane" class="prop-input" type="number" value="${S.clipPlane}"><label>Keep</label><select id="clipSide" class="prop-select"><option value="positive" ${S.clipPositive ? 'selected' : ''}>Positive</option><option value="negative" ${!S.clipPositive ? 'selected' : ''}>Negative</option></select><button id="clipApply" class="mini-button wide">Apply Clip</button></div><div class="selection-info">${S.subSelection ? `${cap(S.subSelection.type)} selected` : 'Vertex / Edge / Face tools edit geometry directly in the viewport.'}</div></div>` : '';
  const sizeSection = isPart ? `<div class="property-section"><div class="property-section-title">Size (World Units)</div>${xyz('Size', 'size', o.size, '1')}</div>` : '';

  host.innerHTML = `<div class="property-name-row"><input id="objectName" class="prop-input" value="${esc(o.name)}"><span class="type-badge">${esc(o.type)}</span></div><div class="property-section"><div class="property-section-title">Transform</div>${xyz('Position', 'position', o.position)}${xyz('Rotation', 'rotation', o.rotation)}${xyz('Scale', 'scale', o.scale)}</div>${sizeSection}<div class="property-section"><div class="property-section-title">Collision / Gameplay</div>${toggle('Colliding', 'collision', o.collision, 'Standard physical collision')}${toggle("Players can't pass through", 'blockPlayers', o.blockPlayers, 'Exports player clip when normal collision is off')}${toggle("Grenades can't pass through", 'blockGrenades', o.blockGrenades, 'Exports toolsgrenadeclip volume')}${toggle("Bullets can't pass through", 'blockBullets', o.blockBullets, 'Exports toolsblockbullets_cs volume')}</div>${entitySection}${geometrySection}${materialSection}`;

  bindName(o);
  document.querySelectorAll('.prop-value').forEach(input => input.onchange = () => {
    pushHistory(); const key = input.dataset.key, index = Number(input.dataset.i), value = Number(input.value); if (!Number.isFinite(value)) return;
    if (key === 'size' && isPart) resizePart(o, index, value); else o[key][index] = value;
    VMAP.applyObjectToDocument(S.doc, o); S.viewport?.updateObject(o); markDirty(`Changed ${o.name}`); renderProperties();
  });
  document.querySelectorAll('[data-toggle]').forEach(button => button.onclick = () => { pushHistory(); const key = button.dataset.toggle; o[key] = !o[key]; button.classList.toggle('on', o[key]); VMAP.applyObjectToDocument(S.doc, o); markDirty(`Changed ${key} on ${o.name}`); });
  document.querySelectorAll('[data-face]').forEach(button => button.onclick = event => { const i = Number(button.dataset.face); if (event.ctrlKey) { if (S.selectedFaces.has(i)) S.selectedFaces.delete(i); else S.selectedFaces.add(i); } else S.selectedFaces = new Set([i]); if (!S.selectedFaces.size) S.selectedFaces.add(i); renderProperties(); });
  $('applyMaterial')?.addEventListener('click', () => applyMaterial($('selectedMaterial').value.trim() || 'ERROR'));
  $('selectedMaterial')?.addEventListener('keydown', event => { if (event.key === 'Enter') applyMaterial(event.currentTarget.value.trim() || 'ERROR'); });
  $('classNameField')?.addEventListener('change', event => { pushHistory(); o.className = event.target.value.trim() || 'info_target'; VMAP.applyObjectToDocument(S.doc, o); S.viewport?.updateObject(o); markDirty(`Changed class on ${o.name}`); renderTree(); });
  $('modelField')?.addEventListener('change', event => { pushHistory(); o.model = event.target.value.trim(); VMAP.applyObjectToDocument(S.doc, o); S.viewport?.updateObject(o); markDirty(`Changed model on ${o.name}`); });
  $('extrudeFaceButton')?.addEventListener('click', () => extrude([...S.selectedFaces][0] ?? 0, 32));
  $('clipAxis')?.addEventListener('change', e => S.clipAxis = Number(e.target.value)); $('clipPlane')?.addEventListener('change', e => S.clipPlane = Number(e.target.value) || 0); $('clipSide')?.addEventListener('change', e => S.clipPositive = e.target.value === 'positive'); $('clipApply')?.addEventListener('click', clipSelected);
}

function resizePart(o, axis, target) {
  target = Math.max(0.01, Number(target) || 0.01); const bounds = VMAP.geometryBounds(o.vertices || []); const center = bounds.center; const old = Math.max(0.0001, bounds.size[axis]);
  for (const v of o.vertices || []) v[axis] = center[axis] + (v[axis] - center[axis]) * (target / old);
  o.size = VMAP.geometryBounds(o.vertices).size;
}
function applyMaterial(path) {
  const o = ensureObject(current()); if (!o || o.type !== 'part') return toast('Select a Part first');
  pushHistory(); for (const i of S.selectedFaces) if (i >= 0 && i < o.faces.length) o.faceMaterials[i] = path;
  VMAP.FACE_NAMES.forEach((name, i) => o.materials[name] = o.faceMaterials[i] || o.faceMaterials[0] || 'ERROR'); VMAP.applyObjectToDocument(S.doc, o); S.viewport?.updateObject(o); markDirty(`Applied ${path}`); renderProperties();
}
function extrude(faceIndex, distance) {
  const o = ensureObject(current()); if (!o || o.type !== 'part') return toast('Select a Part first');
  pushHistory(); if (!VMAP.extrudeFace(o, Number(faceIndex), Number(distance))) { S.undo.pop(); return toast('Could not extrude that face'); }
  VMAP.applyObjectToDocument(S.doc, o); S.selectedFaces = new Set([Math.min(Number(faceIndex), o.faces.length - 1)]); S.viewport?.updateObject(o); S.viewport?.setTool(S.tool === 'extrude' ? 'extrude' : S.tool); markDirty(`Extruded ${o.name}`); renderProperties();
}
function clipSelected() {
  const o = ensureObject(current()); if (!o || o.type !== 'part') return toast('Select a Part first');
  pushHistory(); if (!VMAP.clipAxis(o, S.clipAxis, S.clipPlane, S.clipPositive)) { S.undo.pop(); return toast('Clip removed the entire object or failed'); }
  VMAP.applyObjectToDocument(S.doc, o); S.selectedFaces = new Set([0]); S.viewport?.updateObject(o); markDirty(`Clipped ${o.name}`); renderProperties();
}

function renderBottom() {
  document.querySelectorAll('[data-bottom-tab]').forEach(b => b.classList.toggle('active', b.dataset.bottomTab === S.bottomTab));
  const host = $('bottomContent');
  if (S.bottomTab === 'console') host.innerHTML = S.logs.map(x => `<div class="console-line"><span class="console-time">[${esc(x.time)}]</span><span class="console-${esc(x.kind)}">${esc(x.message)}</span></div>`).join('') || '<div class="collab-state">Console ready.</div>';
  else if (S.bottomTab === 'build') host.innerHTML = `<div class="build-card"><strong>VMAP output</strong><div>${S.doc ? 'Editable Source 2 VMAP loaded.' : 'No map loaded.'}</div><div>Collision helper volumes are generated on save.</div><div>Final .vmap_c compilation remains Valve Hammer / ResourceCompiler.</div></div>`;
  else if (S.bottomTab === 'collaborators') host.innerHTML = '<div class="collab-card"><div class="collab-avatar">1</div><div><strong>Single-user mode</strong><div class="collab-state">Multiplayer is Phase 4.</div></div></div>';
  else host.innerHTML = `<div class="project-info"><div><strong>Project:</strong> ${esc(S.project?.name || 'None')}</div><div><strong>VMAP:</strong> ${esc(S.project?.vmapPath || '')}</div><div><strong>Objects:</strong> ${S.objects.filter(o => o.dmxId).length}</div><div><strong>CS2 assets:</strong> ${S.assetStatus?.available ? 'Connected' : 'Not connected'}</div></div>`;
  host.scrollTop = host.scrollHeight;
}

function renderViewportControls() {
  $('viewport').classList.toggle('grid-enabled', S.grid); $('perspectiveButton').childNodes[0].nodeValue = `${S.view} `; $('shadingButton').childNodes[0].nodeValue = `${S.shading} `;
  $('snapButton').classList.toggle('active', S.snap); $('snapButton').textContent = `Snap: ${S.snap ? 'On' : 'Off'}`; $('gridSize').value = String(S.gridSize); $('angleSnap').value = `${S.angleSnap}°`; viewportSettings();
}

function addPart() {
  if (!S.doc) return; pushHistory();
  const o = ensureObject(VMAP.addPart(S.doc, { size: [128, 128, 128], position: [0, 0, 64], collision: true, materials: Object.fromEntries(VMAP.FACE_NAMES.map(f => [f, 'ERROR'])) }));
  o.name = `Part_${String(S.objects.filter(x => x.type === 'part').length + 1).padStart(3, '0')}`; o.blockPlayers = true; S.objects.push(o); S.selectedId = o.id; S.selectedFaces = new Set([0]);
  S.viewport?.setObjects(S.objects, S.selectedId); setTool('move'); markDirty(`Created ${o.name}`); renderTree(); renderProperties();
}
function addEntity(item) {
  if (!S.doc) return; pushHistory(); const o = ensureObject(VMAP.addEntity(S.doc, { className: item.className || 'info_target', name: '', position: [0, 0, 32] }));
  S.objects.push(o); S.selectedId = o.id; S.viewport?.setObjects(S.objects, S.selectedId); setTool('move'); markDirty(`Added ${o.className}`); renderTree(); renderProperties();
}
function addProp(item) {
  if (!S.doc) return; pushHistory(); const model = item.model || item.path || ''; const o = ensureObject(VMAP.addEntity(S.doc, { className: item.className || 'prop_static', model, position: [0, 0, 32], collision: true }));
  o.type = 'prop'; o.model = model; o.size = [64, 64, 64]; S.objects.push(o); S.selectedId = o.id; S.viewport?.setObjects(S.objects, S.selectedId); setTool('move'); markDirty(`Added prop ${model}`); renderTree(); renderProperties();
}
function duplicate() {
  const o = current(); if (!o?.dmxId) return; pushHistory(); const copy = ensureObject(VMAP.duplicateObject(S.doc, o)); if (!copy) return; Object.assign(copy, structuredClone({ blockPlayers: o.blockPlayers, blockGrenades: o.blockGrenades, blockBullets: o.blockBullets, collision: o.collision, size: o.size })); copy.name = `${o.name}_copy`; S.objects.push(copy); S.selectedId = copy.id; S.viewport?.setObjects(S.objects, copy.id); markDirty(`Duplicated ${o.name}`); renderTree(); renderProperties();
}
function removeSelected() {
  const o = current(); if (!o?.dmxId) return; pushHistory(); VMAP.removeObject(S.doc, o); S.objects = S.objects.filter(x => x.id !== o.id); S.selectedId = 'world'; S.viewport?.setObjects(S.objects, S.selectedId); markDirty(`Deleted ${o.name}`); renderTree(); renderProperties();
}

function setTool(tool) {
  if (tool === 'add-part') return addPart();
  S.tool = tool; S.subSelection = null;
  if (tool === 'light') { S.assetTab = 'entities'; $('assetSearch').value = 'light'; queueAssetSearch(true); }
  else if (tool === 'entity') { S.assetTab = 'entities'; $('assetSearch').value = ''; queueAssetSearch(true); }
  else if (tool === 'texture') { S.assetTab = 'materials'; queueAssetSearch(true); }
  renderTools();
  S.viewport?.setTool(tool === 'texture' ? 'face' : tool === 'clip' ? 'select' : tool);
  if (tool === 'extrude') toast('Select a face, then double-click it or use Extrude in Properties');
  else if (tool === 'clip') toast('Set the clip axis/plane in Properties and press Apply Clip');
}
function closeMenus() { document.querySelectorAll('.dropdown-menu').forEach(x => x.classList.add('hidden')); document.querySelectorAll('.menu-button').forEach(x => x.classList.remove('active')); }
function menu(action) {
  closeMenus();
  if (action === 'new-project') openNewModal(); else if (action === 'open-vmap') openMap(); else if (action === 'save') save(); else if (action === 'reveal') api.revealProject(S.project?.projectFolder); else if (action === 'return-home') exitMap();
  else if (action === 'undo') undo(); else if (action === 'redo') redo(); else if (action === 'duplicate') duplicate(); else if (action === 'delete') removeSelected();
  else if (action === 'toggle-grid') { S.grid = !S.grid; renderViewportControls(); } else if (action === 'toggle-left') $('leftPanel').classList.toggle('panel-hidden'); else if (action === 'toggle-right') $('rightPanel').classList.toggle('panel-hidden'); else if (action === 'toggle-bottom') $('bottomPanel').classList.toggle('panel-hidden');
  else if (action === 'reset-layout') document.querySelectorAll('#leftPanel,#rightPanel,#bottomPanel').forEach(x => x.classList.remove('panel-hidden'));
  else if (action === 'build-placeholder') openHammer(); else if (action === 'phase-info') toast('Phase 3: full single-user VMAP editor');
}
async function openHammer() {
  if (S.project) await save(false);
  const result = await api.openWorkshopTools();
  if (result?.ok) { toast('CS2 Workshop Tools launched'); log('Launched CS2 Workshop Tools. Open the saved VMAP in Hammer.', 'success'); }
  else { toast(result?.error || 'Workshop Tools could not be launched'); log(result?.error || 'Workshop Tools could not be launched', 'warning'); }
}

function bind() {
  $('openVmapButton').onclick = openMap; $('createProjectButton').onclick = openNewModal; $('continueButton').onclick = continueMap; $('forgetSessionButton').onclick = async () => { await api.clearLastSession(); home(); };
  $('cancelCreateButton').onclick = () => $('newProjectModal').classList.add('hidden'); $('confirmCreateButton').onclick = newProject; $('newProjectName').onkeydown = e => e.key === 'Enter' && newProject();
  $('toolbarNew').onclick = openNewModal; $('toolbarOpen').onclick = openMap; $('toolbarSave').onclick = save; $('toolbarSaveAll').onclick = save; $('toolbarDuplicate').onclick = duplicate; $('toolbarUndo').onclick = undo; $('toolbarRedo').onclick = redo; $('topAddPart').onclick = addPart;
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('assetTabs').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.assetTab = b.dataset.tab; S.assetItems = []; renderAssets(); queueAssetSearch(true); });
  $('assetSearch').oninput = () => queueAssetSearch(); $('sceneSearch').oninput = renderTree; $('assetSizeSlider').oninput = e => document.documentElement.style.setProperty('--asset-size', `${e.target.value}px`); $('cs2AssetSettings').onclick = chooseCs2Folder;
  document.querySelectorAll('[data-bottom-tab]').forEach(b => b.onclick = () => { S.bottomTab = b.dataset.bottomTab; renderBottom(); });
  document.querySelectorAll('.menu-button').forEach(b => b.onclick = e => { e.stopPropagation(); const m = $(b.dataset.menu), hidden = m.classList.contains('hidden'); closeMenus(); if (!hidden) return; const r = b.getBoundingClientRect(); m.style.left = `${r.left}px`; m.style.top = `${r.bottom + 2}px`; m.classList.remove('hidden'); b.classList.add('active'); });
  document.querySelectorAll('.dropdown-menu [data-action]').forEach(b => b.onclick = () => menu(b.dataset.action)); document.addEventListener('click', e => { if (!e.target.closest('.dropdown-menu') && !e.target.closest('.menu-button')) closeMenus(); });
  $('spaceModeButton').onclick = () => { S.space = S.space === 'Local' ? 'World' : 'Local'; $('spaceModeButton').innerHTML = `${S.space} <span>⌄</span>`; S.viewport?.setSpace(S.space); };
  $('perspectiveButton').onclick = () => { const modes = ['Perspective', 'Top', 'Front', 'Side']; S.view = modes[(modes.indexOf(S.view) + 1) % modes.length]; S.viewport?.setView(S.view); renderViewportControls(); };
  $('shadingButton').onclick = () => { S.shading = S.shading === 'Lit' ? 'Wireframe' : 'Lit'; renderViewportControls(); }; $('gridButton').onclick = () => { S.grid = !S.grid; renderViewportControls(); };
  $('gridSize').onchange = e => { S.gridSize = Number(e.target.value) || 64; renderViewportControls(); }; $('snapButton').onclick = () => { S.snap = !S.snap; renderViewportControls(); }; $('angleSnap').onchange = e => { S.angleSnap = Number(String(e.target.value).replace('°', '')) || 15; renderViewportControls(); };
  $('exportButton').onclick = save; $('hammerButton').onclick = openHammer; document.querySelectorAll('.view-option').forEach(b => b.onclick = () => b.classList.toggle('active'));
  window.addEventListener('keydown', e => {
    const input = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (!input && e.key === 'Delete') removeSelected();
    else if (!input && ['1', '2', '3', '4', '5', '6', '7'].includes(e.key)) setTool({ '1': 'select', '2': 'move', '3': 'rotate', '4': 'scale', '5': 'vertex', '6': 'edge', '7': 'face' }[e.key]);
  });
  window.addEventListener('beforeunload', () => S.project && autosave());
  window.addEventListener('eph3d-ready', e => { S.viewport = e.detail; connectViewport(); if (S.project) { S.viewport.setObjects(S.objects, S.selectedId); S.camera ? S.viewport.setCameraState(S.camera) : S.viewport.frameAll(); } });
}

async function init() {
  icons(); bind(); connectViewport(); await home(); await refreshAssetStatus(); S.assetTab = 'materials'; await searchAssets(); log('Phase 3 single-user editor ready', 'success');
  setInterval(() => { if (S.project && Date.now() - S.lastAutosave > 15000) autosave(); }, 5000);
}
init();
