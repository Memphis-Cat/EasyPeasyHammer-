// byanca
(() => {
  const api = window.easyPeasyHammer;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'advanced-ui.css';
  document.head.appendChild(style);

  const previewCache = new Map();
  let installedViewport = null;
  let lastProjectKey = '';
  let lastPointer = null;

  const escText = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const projectStorageKey = () => S.project?.vmapPath ? `eph-folders:${S.project.vmapPath}` : null;

  async function checkVersionGate() {
    try {
      const status = await api.checkVersion?.();
      if (!status?.outdated) return;
      const blocker = document.createElement('div');
      blocker.className = 'version-blocker';
      blocker.innerHTML = `<div class="version-blocker-card"><h2>EasyPeasyHammer is outdated</h2><p>This build is <code>${escText(status.localVersion)}</code>, while GitHub has <code>${escText(status.remoteVersion)}</code>.</p><p>Ask the developer for the newest source/build. This version is blocked so projects are not edited with an outdated format.</p></div>`;
      document.body.appendChild(blocker);
    } catch {}
  }

  async function installProfileAndJoinUi() {
    const card = document.querySelector('.startup-card');
    if (!card || document.getElementById('startupProfile')) return;
    const actions = card.querySelector('.startup-actions');

    const profile = document.createElement('div');
    profile.id = 'startupProfile';
    profile.className = 'startup-profile';
    profile.innerHTML = `<div class="startup-mini-label">Username</div><div class="startup-profile-row"><input id="ephUsername" maxlength="32" placeholder="Choose a username"><button id="ephSaveUsername" class="secondary-button">Save</button></div><div class="startup-hint">Saved locally in a hidden profile file for collaboration later.</div>`;
    card.insertBefore(profile, actions);

    const join = document.createElement('div');
    join.className = 'startup-join';
    join.innerHTML = `<div class="startup-mini-label">Join project</div><div class="startup-join-row"><input id="ephInviteCode" maxlength="32" placeholder="Invite code"><button class="secondary-button" type="button" id="ephJoinProject">Join</button></div><div class="startup-hint">Phase 4 interface only — invite networking is not active yet.</div>`;
    card.insertBefore(join, actions);

    const shared = document.createElement('div');
    shared.className = 'startup-shared';
    shared.innerHTML = `<div class="startup-mini-label">Shared projects</div><div class="shared-project-placeholder">Projects you join will stay listed here. Owners will be able to remove collaborators.</div>`;
    card.insertBefore(shared, actions);

    const username = document.getElementById('ephUsername');
    const save = document.getElementById('ephSaveUsername');
    const guarded = ['openVmapButton', 'createProjectButton', 'continueButton'];
    const applyGuard = value => guarded.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !value; });

    try {
      const result = await api.getProfile?.();
      const current = result?.profile?.username || '';
      username.value = current;
      applyGuard(Boolean(current));
    } catch { applyGuard(false); }

    save.onclick = async () => {
      const value = username.value.trim();
      const result = await api.saveProfile?.(value);
      if (result?.ok) {
        username.value = result.profile?.username || value;
        applyGuard(true);
        toast('Username saved');
      } else toast(result?.error || 'Could not save username');
    };
    username.addEventListener('keydown', e => { if (e.key === 'Enter') save.click(); });
    document.getElementById('ephJoinProject').onclick = () => toast('Invite joining will be enabled in Phase 4');
  }

  function addRotateOptions(viewport) {
    if (document.querySelector('.rotate-options')) return;
    const rotate = document.querySelector('.tool-mode[data-tool="rotate"]');
    if (!rotate) return;
    const host = document.createElement('div');
    host.className = 'rotate-options';
    host.innerHTML = `<select id="rotateSnapSelect" title="Rotation snap"><option>15</option><option>30</option><option selected>45</option><option>90</option><option>180</option></select><button id="outerRingButton" type="button" title="Show or hide the outer free-rotation ring">Outer ring</button>`;
    rotate.after(host);
    const snap = host.querySelector('#rotateSnapSelect');
    const ring = host.querySelector('#outerRingButton');
    S.angleSnap = 45;
    viewport.setSnap(S.snap, S.gridSize, S.angleSnap);
    const statusAngle = document.getElementById('angleSnap');
    if (statusAngle && ![...statusAngle.options].some(x => x.value === '90°')) {
      for (const n of [90, 180]) statusAngle.add(new Option(`${n}°`, `${n}°`));
    }
    snap.onchange = () => {
      S.angleSnap = Number(snap.value) || 45;
      viewport.setSnap(S.snap, S.gridSize, S.angleSnap);
      if (statusAngle) statusAngle.value = `${S.angleSnap}°`;
    };
    ring.onclick = () => {
      const visible = viewport.outerRotationRingVisible === false;
      viewport.setOuterRotationRingVisible?.(visible);
      ring.classList.toggle('off', !visible);
      ring.textContent = visible ? 'Outer ring' : 'Ring hidden';
    };
  }

  function rgbToHex(value) {
    const p = String(value || '255 244 214').split(/[ ,]+/).map(Number);
    const h = n => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0');
    return `#${h(p[0])}${h(p[1])}${h(p[2])}`;
  }
  function hexToRgb(value) {
    const v = String(value || '#ffffff').replace('#', '');
    return `${parseInt(v.slice(0,2),16)} ${parseInt(v.slice(2,4),16)} ${parseInt(v.slice(4,6),16)}`;
  }

  function renderLightProperties(object) {
    const host = document.getElementById('propertiesContent');
    if (!host || !object) return;
    object.entityProperties ||= {};
    const p = object.entityProperties;
    const color = rgbToHex(p.color || p._light || '255 244 214');
    const brightness = Number(p.brightness ?? p.intensity ?? 300) || 300;
    const range = Number(p.range ?? p.distance ?? 512) || 512;
    const shadows = String(p.castshadows ?? '1') !== '0';
    const xyzInputs = (key, values) => `<div class="xyz-row"><label>${key}</label>${values.map((v,i)=>`<input class="prop-input eph-light-transform" data-key="${key.toLowerCase()}" data-i="${i}" type="number" step="1" value="${Number(v)||0}">`).join('')}</div>`;
    host.innerHTML = `<div class="light-properties"><div class="property-name-row"><input id="objectName" class="prop-input" value="${escText(object.name)}"><span class="type-badge">LIGHT</span></div><div class="property-section"><div class="property-section-title">Placement</div>${xyzInputs('Position', object.position)}${xyzInputs('Rotation', object.rotation)}</div><div class="property-section"><div class="property-section-title">CS2 Light</div><div class="light-color-row"><label>Color</label><input id="lightColor" type="color" value="${color}"></div><div class="light-field"><label>Brightness</label><input id="lightBrightness" type="number" min="0" step="10" value="${brightness}"></div>${object.className.includes('environment') ? '' : `<div class="light-field"><label>Range</label><input id="lightRange" type="number" min="16" step="16" value="${range}"></div>`}<label class="light-check"><span>Cast shadows</span><input id="lightShadows" type="checkbox" ${shadows ? 'checked' : ''}></label><div class="selection-info">The viewport uses a real Three.js light preview so brightness, color and range affect nearby geometry while editing.</div></div></div>`;
    bindName(object);
    host.querySelectorAll('.eph-light-transform').forEach(input => input.onchange = () => {
      pushHistory();
      const key = input.dataset.key, i = Number(input.dataset.i), value = Number(input.value) || 0;
      object[key][i] = value;
      VMAP.applyObjectToDocument(S.doc, object); S.viewport?.updateObject(object); markDirty(`Changed ${object.name}`);
    });
    const updateLight = () => {
      pushHistory();
      p.color = hexToRgb(document.getElementById('lightColor').value);
      p._light = p.color;
      p.brightness = String(Math.max(0, Number(document.getElementById('lightBrightness').value) || 0));
      const r = document.getElementById('lightRange'); if (r) p.range = String(Math.max(16, Number(r.value) || 16));
      p.castshadows = document.getElementById('lightShadows').checked ? '1' : '0';
      VMAP.applyObjectToDocument(S.doc, object); S.viewport?.updateObject(object); markDirty(`Changed light ${object.name}`);
    };
    ['lightColor','lightBrightness','lightRange','lightShadows'].forEach(id => document.getElementById(id)?.addEventListener('change', updateLight));
  }

  async function hydratePropertyMaterialPreviews() {
    for (const el of document.querySelectorAll('.material-preview:not([data-eph-preview])')) {
      el.dataset.ephPreview = '1';
      const path = el.getAttribute('title');
      if (!path || path === 'ERROR') continue;
      let url = previewCache.get(path);
      if (url === undefined) {
        try { const r = await api.materialPreview(path); url = r?.ok ? r.url : null; } catch { url = null; }
        previewCache.set(path, url);
      }
      if (url && el.isConnected) {
        el.style.backgroundImage = `url("${url}")`;
        el.classList.add('real-property-preview');
      }
    }
  }

  function saveFolders() {
    const key = projectStorageKey(); if (!key) return;
    const folders = S.objects.filter(x => x.type === 'folder').map(x => ({ id:x.id,name:x.name,parent:'world',expanded:x.expanded !== false }));
    const parents = Object.fromEntries(S.objects.filter(x => x.dmxId && x.parent && x.parent !== 'world').map(x => [x.id,x.parent]));
    localStorage.setItem(key, JSON.stringify({ folders, parents }));
  }

  function restoreFolders() {
    const key = projectStorageKey(); if (!key) return;
    let data = null; try { data = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
    S.objects = S.objects.filter(x => x.type !== 'folder');
    for (const folder of data?.folders || []) S.objects.push({ ...folder, type:'folder', sourceClass:'EPH_UI_FOLDER' });
    for (const object of S.objects) if (object.dmxId && data?.parents?.[object.id] && S.objects.some(x => x.id === data.parents[object.id])) object.parent = data.parents[object.id];
    renderTree();
  }

  function installFolders() {
    const tabs = document.querySelector('.right-tabs');
    if (tabs && !document.getElementById('addSceneFolder')) {
      const button = document.createElement('button'); button.id = 'addSceneFolder'; button.className = 'scene-folder-button'; button.title = 'Add editor folder'; button.textContent = '+';
      tabs.appendChild(button);
      button.onclick = () => {
        const id = `ui-folder:${crypto.randomUUID?.() || Date.now()}`;
        const folder = { id, type:'folder', name:`Folder ${S.objects.filter(x=>x.type==='folder').length+1}`, parent:'world', expanded:true, sourceClass:'EPH_UI_FOLDER' };
        S.objects.push(folder); S.selectedId = id; saveFolders(); renderTree(); renderProperties();
      };
    }
  }

  function decorateFolderPicker(object) {
    if (!object || ['world','folder'].includes(object.type) || document.querySelector('.folder-row')) return;
    const host = document.getElementById('propertiesContent'); if (!host) return;
    const row = document.createElement('div'); row.className = 'folder-row';
    const folders = S.objects.filter(x => x.type === 'folder');
    row.innerHTML = `<label>Folder</label><select id="objectFolder"><option value="world">World</option>${folders.map(f=>`<option value="${escText(f.id)}" ${object.parent===f.id?'selected':''}>${escText(f.name)}</option>`).join('')}</select>`;
    host.appendChild(row);
    row.querySelector('select').onchange = e => { object.parent = e.target.value; saveFolders(); renderTree(); };
  }

  function patchProperties() {
    if (renderProperties.__ephAdvanced) return;
    const original = renderProperties;
    renderProperties = function() {
      original();
      const object = ensureObject(current());
      if (object?.type === 'entity' && String(object.className).includes('light')) renderLightProperties(object);
      else decorateFolderPicker(object);
      hydratePropertyMaterialPreviews();
    };
    renderProperties.__ephAdvanced = true;
  }

  function installSelectionSync(viewport) {
    if (viewport.__ephSelectionSync) return;
    viewport.__ephSelectionSync = true;
    const original = viewport.callbacks.select;
    viewport.callbacks.select = id => {
      original?.(id);
      if (S.selectedId !== id) S.selectedId = id || 'world';
      S.selectedFaces = new Set([0]); S.subSelection = null;
      renderTree(); renderProperties();
    };
  }

  function installPropPlacement(viewport) {
    const canvas = viewport.renderer.domElement;
    canvas.addEventListener('pointermove', e => { lastPointer = { x:e.clientX, y:e.clientY }; }, { passive:true });
    addProp = function(item) {
      if (!S.doc) return;
      const model = item?.model || item?.path || ''; if (!model) return toast('That prop has no model path');
      const rect = canvas.getBoundingClientRect();
      const px = lastPointer?.x ?? rect.left + rect.width/2, py = lastPointer?.y ?? rect.top + rect.height/2;
      viewport.pointer.x = ((px-rect.left)/rect.width)*2-1; viewport.pointer.y = -((py-rect.top)/rect.height)*2+1;
      viewport.raycaster.setFromCamera(viewport.pointer, viewport.camera);
      const hits = viewport.raycaster.intersectObjects([...viewport.objectRoots.values()], true).filter(h => !h.object?.userData?.placeholder);
      let point;
      if (hits.length) {
        const hit = hits[0]; point = hit.point.clone();
        if (hit.face) {
          const normal = hit.face.normal.clone().transformDirection(new THREE.Matrix4().extractRotation(hit.object.matrixWorld));
          point.add(normal.multiplyScalar(18));
        }
      } else {
        const dir = viewport.orbit.target.clone().sub(viewport.camera.position).normalize();
        point = viewport.camera.position.clone().add(dir.multiplyScalar(Math.max(128, Math.min(512, viewport.camera.position.distanceTo(viewport.orbit.target)*.3))));
      }
      pushHistory(); viewport.loadModel?.(model);
      const object = ensureObject(VMAP.addEntity(S.doc,{ className:item?.className||'prop_static', model, position:[point.x,point.y,point.z], collision:true }));
      object.type='prop'; object.model=model; object.size=[64,64,64]; S.objects.push(object); S.selectedId=object.id; S.selectedFaces=new Set([0]);
      viewport.objects=S.objects; viewport.updateObject(object); viewport.select(object.id,false); setTool('move'); markDirty(`Added prop ${model}`); renderTree(); renderProperties();
    };
  }

  function installViewport(viewport) {
    if (!viewport || installedViewport === viewport) return;
    installedViewport = viewport;
    addRotateOptions(viewport); installSelectionSync(viewport); installPropPlacement(viewport); patchProperties(); installFolders();
  }

  setInterval(() => {
    if (S.project?.vmapPath && S.project.vmapPath !== lastProjectKey) { lastProjectKey = S.project.vmapPath; setTimeout(restoreFolders, 80); }
    installFolders();
  }, 450);

  checkVersionGate();
  installProfileAndJoinUi();
  if (window.EPH3D) installViewport(window.EPH3D);
  window.addEventListener('eph3d-ready', e => installViewport(e.detail));
})();
