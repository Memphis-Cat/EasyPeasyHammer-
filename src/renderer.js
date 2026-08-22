// byanca
const api = window.easyPeasyHammer;

const state = {
  project: null,
  tool: 'select',
  assetTab: 'materials',
  bottomTab: 'console',
  selectedId: 'part-1',
  grid: true,
  snap: true,
  space: 'Local',
  view: 'Perspective',
  shading: 'Lit',
  selectedFaces: new Set(['front']),
  logs: [],
  objects: [
    { id: 'world', name: 'World', type: 'world', parent: null, expanded: true },
    { id: 'arena', name: 'Arena_Center', type: 'folder', parent: 'world', expanded: true },
    { id: 'center-ramp', name: 'Center_Ramp', type: 'part', parent: 'arena' },
    { id: 'center-box', name: 'Center_Box', type: 'part', parent: 'arena' },
    { id: 'mid-crate', name: 'Mid_Crate', type: 'prop', parent: 'arena' },
    { id: 'part-1', name: 'Part_Blockout_01', type: 'part', parent: 'arena', position: [384, -256, 64], rotation: [0, 0, 0], scale: [1, 1, 1], size: [512, 32, 128], collision: true, blockPlayers: true, blockGrenades: true, blockBullets: true, materials: { top: 'ERROR', bottom: 'ERROR', left: 'ERROR', right: 'ERROR', front: 'ERROR', back: 'ERROR' } },
    { id: 'left-cover', name: 'Left_Cover', type: 'folder', parent: 'world', expanded: false },
    { id: 'right-cover', name: 'Right_Cover', type: 'folder', parent: 'world', expanded: false },
    { id: 'ct-spawn', name: 'CT_Spawn', type: 'entity', parent: 'world' },
    { id: 't-spawn', name: 'T_Spawn', type: 'entity', parent: 'world' },
    { id: 'skybox', name: 'Skybox', type: 'folder', parent: 'world', expanded: false },
    { id: 'props', name: 'Props', type: 'folder', parent: 'world', expanded: false }
  ]
};

const assets = {
  materials: ['Concrete Wall', 'Concrete Floor', 'Metal Panel', 'Plaster', 'Wood', 'ERROR Material'],
  models: ['Wooden Crate 01', 'Wooden Crate 02', 'Metal Crate', 'Barrel', 'Ladder', 'Fence'],
  props: ['Wooden Crate', 'Ammo Crate', 'Industrial Barrel', 'Concrete Barrier', 'Pallet', 'Lamp'],
  entities: ['CT Spawn', 'T Spawn', 'Light', 'Trigger', 'Skybox', 'Player Clip']
};

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const cap = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const current = () => state.objects.find((o) => o.id === state.selectedId) || null;

function hydrateIcons() {
  const icons = window.EPH_ICONS || {};
  document.querySelectorAll('img[src]').forEach((img) => {
    const raw = img.getAttribute('src');
    if (icons[raw]) img.src = icons[raw];
  });
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 1800);
}

function log(message, kind = 'info') {
  state.logs.push({ time: new Date().toLocaleTimeString(), message, kind });
  if (state.logs.length > 100) state.logs.shift();
  if (state.bottomTab === 'console') renderBottom();
}

function snapshot() {
  return {
    tool: state.tool,
    assetTab: state.assetTab,
    bottomTab: state.bottomTab,
    selectedId: state.selectedId,
    grid: state.grid,
    snap: state.snap,
    space: state.space,
    view: state.view,
    shading: state.shading,
    objects: state.objects
  };
}

function restore(ui) {
  if (!ui) return;
  for (const key of ['tool', 'assetTab', 'bottomTab', 'selectedId', 'grid', 'snap', 'space', 'view', 'shading']) {
    if (ui[key] !== undefined) state[key] = ui[key];
  }
  if (Array.isArray(ui.objects) && ui.objects.length) state.objects = ui.objects;
}

async function autosave(show = false) {
  if (!state.project) return;
  const result = await api.autosave({ project: state.project, uiState: snapshot() });
  if (result?.ok) $('autosaveStatus').textContent = `Autosaved ${new Date(result.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (show) toast('Autosaved');
}

async function showStartup() {
  const data = await api.getStartupState();
  $('editorScreen').classList.add('hidden');
  $('startupScreen').classList.remove('hidden');
  const last = data?.lastSession?.project;
  $('resumePanel').classList.toggle('hidden', !last);
  $('forgetSessionButton').classList.toggle('hidden', !last);
  if (last) {
    $('resumeName').textContent = last.name || 'Untitled';
    $('resumePath').textContent = last.vmapPath || '';
  }
}

function enterEditor(project, ui) {
  state.project = project;
  restore(ui);
  $('startupScreen').classList.add('hidden');
  $('editorScreen').classList.remove('hidden');
  $('projectTitle').textContent = `${project.name}.vmap`;
  $('mapStatus').textContent = `Map: ${project.name}.vmap`;
  renderAll();
  autosave();
}

async function openVmap() {
  const project = await api.openVmap();
  if (project) {
    enterEditor(project, null);
    log(`Opened ${project.vmapPath}`, 'success');
  }
}

async function continueLast() {
  const result = await api.continueLast();
  if (result?.project) {
    enterEditor(result.project, result.uiState);
    log(`Continued ${result.project.name}`, 'success');
  }
}

function openNewModal() {
  $('newProjectName').value = '';
  $('newProjectModal').classList.remove('hidden');
  setTimeout(() => $('newProjectName').focus(), 20);
}

async function createProject() {
  const name = $('newProjectName').value.trim();
  if (!name) return toast('Enter a project name');
  const project = await api.createProject(name);
  if (!project) return;
  $('newProjectModal').classList.add('hidden');
  enterEditor(project, null);
  log(`Created ${project.name}`, 'success');
}

async function exitMap() {
  if (!state.project) return;
  await autosave();
  await api.returnHome({ project: state.project, uiState: snapshot() });
  state.project = null;
  await showStartup();
}

function renderAll() {
  renderAssets();
  renderTools();
  renderTree();
  renderProperties();
  renderBottom();
  renderViewport();
}

function renderAssets() {
  document.querySelectorAll('#assetTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.assetTab));
  const query = $('assetSearch').value.trim().toLowerCase();
  const list = (assets[state.assetTab] || []).filter((n) => n.toLowerCase().includes(query));
  $('assetGrid').innerHTML = list.map((name) => `<button class="asset-card"><div class="asset-thumb">${state.assetTab.slice(0, -1).toUpperCase()}</div><div class="asset-name">${esc(name)}</div></button>`).join('');
  $('assetCount').textContent = `${list.length} items`;
  $('assetGrid').querySelectorAll('.asset-card').forEach((card, i) => card.addEventListener('click', () => {
    $('assetGrid').querySelectorAll('.asset-card').forEach((x) => x.classList.remove('selected'));
    card.classList.add('selected');
    log(`Selected asset ${list[i]}`);
  }));
}

function renderTools() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === state.tool));
}

function childrenOf(parent) {
  return state.objects.filter((o) => o.parent === parent);
}

function renderTree() {
  const root = $('sceneTree');
  root.innerHTML = '';
  const search = $('sceneSearch').value.trim().toLowerCase();

  function addRow(obj, depth) {
    const kids = childrenOf(obj.id);
    if (search && !obj.name.toLowerCase().includes(search) && !kids.some((k) => k.name.toLowerCase().includes(search))) return;
    const row = document.createElement('div');
    row.className = `tree-row${obj.id === state.selectedId ? ' selected' : ''}`;
    const icon = obj.type === 'world' ? 'hierarchy_world.png' : obj.type === 'folder' ? (obj.expanded ? 'hierarchy_folder_open.png' : 'hierarchy_folder_closed.png') : 'hierarchy_part.png';
    const chev = kids.length ? (obj.expanded ? 'hierarchy_chevron_down.png' : 'hierarchy_chevron_right.png') : null;
    row.innerHTML = `<span class="tree-indent" style="width:${depth * 14}px"></span>${chev ? `<img class="tree-chevron" src="../assets/icons/hierarchy/${chev}">` : '<span class="tree-chevron"></span>'}<img class="tree-icon" src="../assets/icons/hierarchy/${icon}"><span class="tree-name">${esc(obj.name)}</span><span class="tree-meta">◉</span>`;
    root.appendChild(row);
    hydrateIcons();
    row.addEventListener('click', (e) => {
      if (kids.length && e.target.classList.contains('tree-chevron')) obj.expanded = !obj.expanded;
      else state.selectedId = obj.id;
      renderTree();
      renderProperties();
      autosave();
    });
    if (obj.expanded) kids.forEach((kid) => addRow(kid, depth + 1));
  }

  state.objects.filter((o) => o.parent === null).forEach((o) => addRow(o, 0));
}

function editable(obj) {
  if (!obj || ['world', 'folder'].includes(obj.type)) return obj;
  obj.position ??= [0, 0, 0];
  obj.rotation ??= [0, 0, 0];
  obj.scale ??= [1, 1, 1];
  obj.size ??= [64, 64, 64];
  obj.collision ??= true;
  obj.blockPlayers ??= true;
  obj.blockGrenades ??= false;
  obj.blockBullets ??= false;
  obj.materials ??= { top: 'ERROR', bottom: 'ERROR', left: 'ERROR', right: 'ERROR', front: 'ERROR', back: 'ERROR' };
  return obj;
}

function xyz(label, key, values) {
  return `<div class="xyz-row"><label>${label}</label>${values.map((v, i) => `<input class="prop-input prop-value" data-key="${key}" data-i="${i}" type="number" step="0.1" value="${v}">`).join('')}</div>`;
}

function toggle(label, key, value) {
  return `<div class="toggle-row"><span>${label}</span><button class="toggle ${value ? 'on' : ''}" data-toggle="${key}"></button></div>`;
}

function renderProperties() {
  const obj = editable(current());
  if (!obj) return $('propertiesContent').innerHTML = '<div class="collab-state">Nothing selected.</div>';
  if (['world', 'folder'].includes(obj.type)) {
    $('propertiesContent').innerHTML = `<div class="property-name-row"><input id="objectName" class="prop-input" value="${esc(obj.name)}"></div><div class="property-section"><div class="property-section-title">Group</div><div class="collab-state">Hierarchy container</div></div>`;
    bindName(obj);
    return;
  }

  const faces = ['top', 'bottom', 'left', 'right', 'front', 'back'];
  $('propertiesContent').innerHTML = `
    <div class="property-name-row"><input id="objectName" class="prop-input" value="${esc(obj.name)}"><select id="objectType" class="prop-select"><option ${obj.type === 'part' ? 'selected' : ''}>part</option><option ${obj.type === 'prop' ? 'selected' : ''}>prop</option><option ${obj.type === 'entity' ? 'selected' : ''}>entity</option></select></div>
    <div class="property-section"><div class="property-section-title">Transform</div>${xyz('Position', 'position', obj.position)}${xyz('Rotation', 'rotation', obj.rotation)}${xyz('Scale', 'scale', obj.scale)}</div>
    <div class="property-section"><div class="property-section-title">Size (World Units)</div><div class="field-row"><label>Width X</label><input class="prop-input prop-value" data-key="size" data-i="0" type="number" value="${obj.size[0]}"></div><div class="field-row"><label>Depth Y</label><input class="prop-input prop-value" data-key="size" data-i="1" type="number" value="${obj.size[1]}"></div><div class="field-row"><label>Height Z</label><input class="prop-input prop-value" data-key="size" data-i="2" type="number" value="${obj.size[2]}"></div></div>
    <div class="property-section"><div class="property-section-title">Collision / Gameplay</div>${toggle('Colliding', 'collision', obj.collision)}${toggle("Players can't pass through", 'blockPlayers', obj.blockPlayers)}${toggle("Grenades can't pass through", 'blockGrenades', obj.blockGrenades)}${toggle("Bullets can't pass through", 'blockBullets', obj.blockBullets)}</div>
    <div class="property-section"><div class="property-section-title">Face Materials</div><div class="face-selection">${faces.map((f) => `<button class="face-chip ${state.selectedFaces.has(f) ? 'active' : ''}" data-face="${f}">${cap(f)}</button>`).join('')}</div><div class="field-row"><label>Selected</label><div style="display:flex;gap:5px"><input id="selectedMaterial" class="prop-input" style="flex:1" value="ERROR"><button id="applyMaterial" class="mini-button" style="width:58px">Apply</button></div></div>${faces.map((f) => `<div class="face-row"><label>${cap(f)}</label><div class="material-preview" title="${esc(obj.materials[f])}"></div><button class="mini-button" data-face-menu="${f}">...</button></div>`).join('')}</div>`;

  bindName(obj);
  $('objectType').addEventListener('change', (e) => { obj.type = e.target.value; renderTree(); autosave(); });
  document.querySelectorAll('.prop-value').forEach((input) => input.addEventListener('change', () => {
    const value = Number(input.value);
    if (Number.isFinite(value)) obj[input.dataset.key][Number(input.dataset.i)] = value;
    autosave();
  }));
  document.querySelectorAll('[data-toggle]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.toggle;
    obj[key] = !obj[key];
    button.classList.toggle('on', obj[key]);
    autosave();
  }));
  document.querySelectorAll('[data-face]').forEach((button) => button.addEventListener('click', () => {
    const face = button.dataset.face;
    if (state.selectedFaces.has(face)) state.selectedFaces.delete(face); else state.selectedFaces.add(face);
    if (!state.selectedFaces.size) state.selectedFaces.add(face);
    renderProperties();
  }));
  $('applyMaterial').addEventListener('click', () => {
    const mat = $('selectedMaterial').value.trim() || 'ERROR';
    state.selectedFaces.forEach((f) => obj.materials[f] = mat);
    log(`Applied ${mat} to ${[...state.selectedFaces].join(', ')}`, 'success');
    autosave();
  });
  document.querySelectorAll('[data-face-menu]').forEach((button) => button.addEventListener('click', () => {
    state.selectedFaces = new Set([button.dataset.faceMenu]);
    $('selectedMaterial').value = obj.materials[button.dataset.faceMenu] || 'ERROR';
    renderProperties();
  }));
}

function bindName(obj) {
  $('objectName')?.addEventListener('change', (e) => {
    obj.name = e.target.value.trim() || obj.name;
    renderTree();
    autosave();
  });
}

function renderBottom() {
  document.querySelectorAll('[data-bottom-tab]').forEach((b) => b.classList.toggle('active', b.dataset.bottomTab === state.bottomTab));
  const box = $('bottomContent');
  if (state.bottomTab === 'console') box.innerHTML = state.logs.length ? state.logs.map((l) => `<div class="console-line"><span class="console-time">[${esc(l.time)}]</span><span class="console-${l.kind}">${esc(l.message)}</span></div>`).join('') : '<div class="console-line">Interface ready.</div>';
  if (state.bottomTab === 'build') box.innerHTML = '<div class="console-line"><span class="console-warning">Build pipeline is disabled during Phase 2.</span></div>';
  if (state.bottomTab === 'collaborators') box.innerHTML = '<div class="collab-card"><div class="collab-avatar">W</div><div><strong>You</strong><div class="collab-state">Offline editor · Multiplayer arrives in Phase 4</div></div></div>';
  if (state.bottomTab === 'project') box.innerHTML = state.project ? `<div class="console-line">${esc(state.project.projectFolder || '')}</div><div class="console-line">${esc(state.project.vmapPath || '')}</div>` : '';
}

function renderViewport() {
  $('viewport').classList.toggle('grid-enabled', state.grid);
  $('spaceModeButton').innerHTML = `${state.space} <span>⌄</span>`;
  $('perspectiveButton').innerHTML = `${state.view} <span>⌄</span>`;
  $('shadingButton').innerHTML = `${state.shading} <span>⌄</span>`;
  $('snapButton').classList.toggle('active', state.snap);
  $('snapButton').textContent = `Snap: ${state.snap ? 'On' : 'Off'}`;
}

function addPart() {
  const n = state.objects.filter((o) => o.type === 'part' && o.name.startsWith('Part_Blockout_')).length + 1;
  const obj = { id: `part-${Date.now()}`, name: `Part_Blockout_${String(n).padStart(2, '0')}`, type: 'part', parent: 'arena', position: [0, 0, 64], rotation: [0, 0, 0], scale: [1, 1, 1], size: [128, 32, 128], collision: true, blockPlayers: true, blockGrenades: false, blockBullets: false, materials: { top: 'ERROR', bottom: 'ERROR', left: 'ERROR', right: 'ERROR', front: 'ERROR', back: 'ERROR' } };
  state.objects.push(obj);
  state.selectedId = obj.id;
  state.tool = 'select';
  state.objects.find((o) => o.id === 'arena').expanded = true;
  renderTools();
  renderTree();
  renderProperties();
  log(`Created ${obj.name} with ERROR material`, 'success');
  toast('Part added');
  autosave();
}

function duplicateSelected() {
  const obj = current();
  if (!obj || ['world', 'folder'].includes(obj.type)) return toast('Select a part or prop first');
  const copy = JSON.parse(JSON.stringify(obj));
  copy.id = `${obj.type}-${Date.now()}`;
  copy.name += '_copy';
  copy.position ??= [0, 0, 0];
  copy.position[0] += 32;
  state.objects.push(copy);
  state.selectedId = copy.id;
  renderTree(); renderProperties(); autosave();
}

function deleteSelected() {
  const obj = current();
  if (!obj || ['world', 'folder'].includes(obj.type)) return;
  state.objects = state.objects.filter((o) => o.id !== obj.id);
  state.selectedId = 'world';
  renderTree(); renderProperties(); autosave();
}

function closeMenus() {
  document.querySelectorAll('.dropdown-menu').forEach((m) => m.classList.add('hidden'));
  document.querySelectorAll('.menu-button').forEach((b) => b.classList.remove('active'));
}

async function action(name) {
  closeMenus();
  if (name === 'new-project') openNewModal();
  if (name === 'open-vmap') await openVmap();
  if (name === 'save') await autosave(true);
  if (name === 'reveal' && state.project) await api.revealProject(state.project.projectFolder);
  if (name === 'return-home') await exitMap();
  if (name === 'duplicate') duplicateSelected();
  if (name === 'delete') deleteSelected();
  if (name === 'toggle-grid') { state.grid = !state.grid; renderViewport(); autosave(); }
  if (name === 'toggle-left') document.body.classList.toggle('left-hidden');
  if (name === 'toggle-right') document.body.classList.toggle('right-hidden');
  if (name === 'toggle-bottom') document.body.classList.toggle('bottom-hidden');
  if (name === 'reset-layout') document.body.classList.remove('left-hidden', 'right-hidden', 'bottom-hidden');
  if (name === 'undo' || name === 'redo') toast(`${cap(name)} history connects in Phase 3`);
  if (name === 'build-placeholder') toast('Compilation connects to Hammer later');
  if (name === 'phase-info') toast('Phase 2: interface and project flow');
}

function bind() {
  $('openVmapButton').addEventListener('click', openVmap);
  $('createProjectButton').addEventListener('click', openNewModal);
  $('continueButton').addEventListener('click', continueLast);
  $('forgetSessionButton').addEventListener('click', async () => { await api.clearLastSession(); await showStartup(); });
  $('cancelCreateButton').addEventListener('click', () => $('newProjectModal').classList.add('hidden'));
  $('confirmCreateButton').addEventListener('click', createProject);
  $('newProjectName').addEventListener('keydown', (e) => { if (e.key === 'Enter') createProject(); });
  $('toolbarNew').addEventListener('click', openNewModal);
  $('toolbarOpen').addEventListener('click', openVmap);
  $('toolbarSave').addEventListener('click', () => autosave(true));
  $('toolbarSaveAll').addEventListener('click', () => autosave(true));
  $('toolbarDuplicate').addEventListener('click', duplicateSelected);
  $('toolbarUndo').addEventListener('click', () => toast('Undo history connects in Phase 3'));
  $('toolbarRedo').addEventListener('click', () => toast('Redo history connects in Phase 3'));
  $('topAddPart').addEventListener('click', addPart);

  document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tool === 'add-part') return addPart();
    state.tool = b.dataset.tool;
    renderTools();
    autosave();
  }));
  document.querySelectorAll('#assetTabs button').forEach((b) => b.addEventListener('click', () => { state.assetTab = b.dataset.tab; renderAssets(); autosave(); }));
  $('assetSearch').addEventListener('input', renderAssets);
  $('sceneSearch').addEventListener('input', renderTree);
  document.querySelectorAll('[data-bottom-tab]').forEach((b) => b.addEventListener('click', () => { state.bottomTab = b.dataset.bottomTab; renderBottom(); autosave(); }));

  document.querySelectorAll('.menu-button').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $(b.dataset.menu);
    const wasOpen = !menu.classList.contains('hidden');
    closeMenus();
    if (!wasOpen) {
      const r = b.getBoundingClientRect();
      menu.style.left = `${r.left}px`;
      menu.style.top = `${r.bottom + 2}px`;
      menu.classList.remove('hidden');
      b.classList.add('active');
    }
  }));
  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => action(b.dataset.action)));
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.dropdown-menu') && !e.target.closest('.menu-button')) closeMenus(); });

  $('spaceModeButton').addEventListener('click', () => { state.space = state.space === 'Local' ? 'World' : 'Local'; renderViewport(); autosave(); });
  $('perspectiveButton').addEventListener('click', () => { const a = ['Perspective', 'Top', 'Front', 'Right']; state.view = a[(a.indexOf(state.view) + 1) % a.length]; renderViewport(); });
  $('shadingButton').addEventListener('click', () => { const a = ['Lit', 'Unlit', 'Wireframe']; state.shading = a[(a.indexOf(state.shading) + 1) % a.length]; renderViewport(); });
  $('gridButton').addEventListener('click', () => { state.grid = !state.grid; renderViewport(); autosave(); });
  $('snapButton').addEventListener('click', () => { state.snap = !state.snap; renderViewport(); autosave(); });
  $('exportButton').addEventListener('click', () => toast('VMAP export connects in Phase 3'));
  $('hammerButton').addEventListener('click', () => toast('Hammer launch connects in Phase 3'));

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); autosave(true); }
    if (e.key === 'Delete' && document.activeElement?.tagName !== 'INPUT') deleteSelected();
    if (e.key === 'Escape') { closeMenus(); $('newProjectModal').classList.add('hidden'); }
  });
  setInterval(() => { if (state.project && !$('editorScreen').classList.contains('hidden')) autosave(); }, 12000);
}

async function boot() {
  hydrateIcons();
  bind();
  log('EasyPeasyHammer interface initialized', 'success');
  await showStartup();
}

boot();
