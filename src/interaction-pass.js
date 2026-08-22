// byanca
(() => {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'interaction-pass.css';
  document.head.appendChild(style);

  const isEditable = target => Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"], dialog'));

  function installFastIcons() {
    const hydrate = root => {
      if (!root) return;
      const images = root.matches?.('img[src]') ? [root] : [...(root.querySelectorAll?.('img[src]:not([data-eph-icon-ready])') || [])];
      for (const img of images) {
        if (img.dataset.ephIconReady === '1') continue;
        const raw = img.getAttribute('src');
        const mapped = window.EPH_ICONS?.[raw];
        if (mapped) img.src = mapped;
        img.dataset.ephIconReady = '1';
      }
    };

    icons = function(root = document) { hydrate(root); };
    hydrate(document);

    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) hydrate(node);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function installIncrementalCreation(viewport) {
    const attachNewObject = object => {
      S.objects.push(object);
      S.selectedId = object.id;
      S.selectedFaces = new Set([0]);
      viewport.objects = S.objects;
      viewport.updateObject(object);
      viewport.select(object.id, false);
      setTool('move');
      renderTree();
      renderProperties();
    };

    addProp = function(item) {
      if (!S.doc) return;
      const model = item?.model || item?.path || '';
      if (!model) return toast('That prop has no model path');
      pushHistory();
      viewport.loadModel?.(model);
      const object = ensureObject(VMAP.addEntity(S.doc, {
        className: item?.className || 'prop_static', model, position: [0, 0, 32], collision: true
      }));
      object.type = 'prop';
      object.model = model;
      object.size = [64, 64, 64];
      attachNewObject(object);
      markDirty(`Added prop ${model}`);
    };

    addEntity = function(item) {
      if (!S.doc) return;
      pushHistory();
      const object = ensureObject(VMAP.addEntity(S.doc, {
        className: item?.className || 'info_target', name: '', position: [0, 0, 32]
      }));
      attachNewObject(object);
      markDirty(`Added ${object.className}`);
    };

    addPart = function() {
      if (!S.doc) return;
      pushHistory();
      const object = ensureObject(VMAP.addPart(S.doc, {
        size: [128, 128, 128], position: [0, 0, 64], collision: true,
        materials: Object.fromEntries(VMAP.FACE_NAMES.map(face => [face, 'ERROR']))
      }));
      object.name = `Part_${String(S.objects.filter(x => x.type === 'part').length + 1).padStart(3, '0')}`;
      object.blockPlayers = true;
      attachNewObject(object);
      markDirty(`Created ${object.name}`);
    };
  }

  function installReliablePropClicks(viewport) {
    const grid = document.getElementById('assetGrid');
    if (!grid || grid.dataset.ephPropClickFixed === '1') return;
    grid.dataset.ephPropClickFixed = '1';
    let down = null;

    grid.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !['props', 'models'].includes(S.assetTab)) return;
      const card = event.target.closest('.asset-card');
      if (!card) return;
      down = { card, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      const item = S.assetItems?.[Number(card.dataset.i)];
      const model = item?.model || item?.path;
      if (model) viewport.loadModel?.(model);
    }, true);

    grid.addEventListener('pointerup', event => {
      if (!down || event.pointerId !== down.pointerId || !['props', 'models'].includes(S.assetTab)) { down = null; return; }
      const info = down; down = null;
      const card = event.target.closest('.asset-card');
      if (!card || card !== info.card || Math.hypot(event.clientX - info.x, event.clientY - info.y) > 7) return;
      const item = S.assetItems?.[Number(card.dataset.i)];
      if (!item) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      grid.querySelectorAll('.asset-card').forEach(x => x.classList.toggle('selected', x === card));
      card.classList.add('eph-adding');
      try { addProp(item); } finally { setTimeout(() => card.isConnected && card.classList.remove('eph-adding'), 180); }
    }, true);

    const swallowOldHandlers = event => {
      if (!['props', 'models'].includes(S.assetTab) || !event.target.closest('.asset-card')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    grid.addEventListener('click', swallowOldHandlers, true);
    grid.addEventListener('dblclick', swallowOldHandlers, true);
  }

  function installViewportControls(viewport) {
    const canvas = viewport.renderer.domElement;
    viewport.orbit.enableRotate = false;
    viewport.orbit.enablePan = false;
    viewport.orbit.enableZoom = false;

    const rawSetGrid = viewport.setGrid.bind(viewport);
    viewport.setGrid = function(enabled, size = this.gridSize) {
      const next = Math.max(1, Number(size) || 64);
      if (this.gridHelper && next === this.gridSize) {
        this.gridHelper.visible = Boolean(enabled);
        this.updateSnaps();
        return;
      }
      return rawSetGrid(enabled, next);
    };

    const rawLoadModel = viewport.loadModel.bind(viewport);
    viewport.loadModel = async function(resource) {
      const result = await rawLoadModel(resource);
      if (!result) this.modelCache.delete(resource);
      return result;
    };
    const rawLoadMaterial = viewport.loadMaterialTexture.bind(viewport);
    viewport.loadMaterialTexture = async function(resource) {
      const result = await rawLoadMaterial(resource);
      if (!result) this.materialTextureCache.delete(resource);
      return result;
    };

    const selectionRect = document.createElement('div');
    selectionRect.className = 'eph-selection-rect';
    viewport.container.appendChild(selectionRect);

    let customMode = null;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let moved = false;
    let viewportFocused = false;
    const keys = new Set();
    const extraHelpers = [];
    let boxSelecting = false;

    const clearExtraHelpers = () => {
      for (const helper of extraHelpers.splice(0)) {
        viewport.scene.remove(helper);
        helper.geometry?.dispose?.();
        helper.material?.dispose?.();
      }
    };

    const rawSelect = viewport.select.bind(viewport);
    viewport.select = function(id, notify = true) {
      if (!boxSelecting) {
        clearExtraHelpers();
        this.multiSelectedIds = id ? [id] : [];
      }
      return rawSelect(id, notify);
    };

    const rawSetObjects = viewport.setObjects.bind(viewport);
    viewport.setObjects = function(objects, selectedId = null) {
      clearExtraHelpers();
      this.multiSelectedIds = selectedId ? [selectedId] : [];
      return rawSetObjects(objects, selectedId);
    };

    const setMultiple = ids => {
      clearExtraHelpers();
      viewport.multiSelectedIds = [...ids];
      boxSelecting = true;
      rawSelect(ids[0] || null, true);
      boxSelecting = false;
      const Helper = viewport.selectionBox.constructor;
      for (const id of ids.slice(1)) {
        const root = viewport.objectRoots.get(id);
        if (!root) continue;
        const helper = new Helper(root, 0x8fc0ff);
        helper.material.depthTest = false;
        helper.renderOrder = 999;
        viewport.scene.add(helper);
        extraHelpers.push(helper);
      }
    };

    const pointFromEvent = event => {
      const rect = canvas.getBoundingClientRect();
      viewport.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      viewport.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      viewport.raycaster.setFromCamera(viewport.pointer, viewport.camera);
      return rect;
    };

    const hitSubElement = event => {
      if (!['vertex', 'edge', 'face', 'extrude'].includes(viewport.tool) || !viewport.editGroup.children.length) return false;
      pointFromEvent(event);
      return viewport.raycaster.intersectObjects(viewport.editGroup.children, true).some(hit => hit.object?.userData?.sub);
    };

    const hitObject = event => {
      pointFromEvent(event);
      const hits = viewport.raycaster.intersectObjects([...viewport.objectRoots.values()], true);
      if (!hits.length) return null;
      let root = hits[0].object;
      while (root.parent && root.parent !== viewport.objectGroup) root = root.parent;
      return root.userData?.ephId || null;
    };

    const drawSelectionRect = (x, y) => {
      const left = Math.min(startX, x), top = Math.min(startY, y);
      selectionRect.style.display = 'block';
      selectionRect.style.left = `${left}px`;
      selectionRect.style.top = `${top}px`;
      selectionRect.style.width = `${Math.abs(x - startX)}px`;
      selectionRect.style.height = `${Math.abs(y - startY)}px`;
    };

    const finishBoxSelection = (x, y) => {
      selectionRect.style.display = 'none';
      if (!moved || Math.hypot(x - startX, y - startY) < 5) {
        setMultiple([]);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const left = Math.min(startX, x), right = Math.max(startX, x);
      const top = Math.min(startY, y), bottom = Math.max(startY, y);
      const ids = [];
      for (const [id, root] of viewport.objectRoots) {
        const point = viewport.camera.position.clone();
        root.getWorldPosition(point);
        point.project(viewport.camera);
        if (point.z < -1 || point.z > 1) continue;
        const sx = (point.x * .5 + .5) * rect.width;
        const sy = (-point.y * .5 + .5) * rect.height;
        if (sx >= left && sx <= right && sy >= top && sy <= bottom) ids.push(id);
      }
      setMultiple(ids);
    };

    const cameraChanged = () => viewport.callbacks.camera?.(viewport.getCameraState());

    const endCustomPointer = () => {
      if (pointerId != null && canvas.hasPointerCapture?.(pointerId)) {
        try { canvas.releasePointerCapture(pointerId); } catch {}
      }
      customMode = null;
      pointerId = null;
      selectionRect.style.display = 'none';
      document.body.classList.remove('eph-camera-look', 'eph-camera-pan');
    };

    canvas.addEventListener('pointerdown', event => {
      viewportFocused = true;
      if (viewport.transform.dragging || viewport.transform.axis) return;
      if (event.button === 2 || event.button === 1) {
        event.preventDefault();
        event.stopImmediatePropagation();
        customMode = event.button === 2 ? 'look' : 'pan';
        pointerId = event.pointerId;
        lastX = event.clientX; lastY = event.clientY;
        canvas.setPointerCapture?.(pointerId);
        document.body.classList.add(customMode === 'look' ? 'eph-camera-look' : 'eph-camera-pan');
        return;
      }
      if (event.button !== 0 || hitSubElement(event)) return;
      const hit = hitObject(event);
      if (hit) {
        clearExtraHelpers();
        viewport.multiSelectedIds = [hit];
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      customMode = 'select-box';
      pointerId = event.pointerId;
      const rect = canvas.getBoundingClientRect();
      startX = lastX = event.clientX - rect.left;
      startY = lastY = event.clientY - rect.top;
      moved = false;
      canvas.setPointerCapture?.(pointerId);
    }, true);

    canvas.addEventListener('pointermove', event => {
      if (event.pointerId !== pointerId || !customMode) return;
      const dx = event.clientX - lastX, dy = event.clientY - lastY;
      if (customMode === 'look') {
        event.preventDefault(); event.stopImmediatePropagation();
        const distance = Math.max(1, viewport.camera.position.distanceTo(viewport.orbit.target));
        const up = viewport.camera.up.clone().normalize();
        let dir = viewport.orbit.target.clone().sub(viewport.camera.position).normalize();
        dir.applyAxisAngle(up, -dx * .0032);
        const right = dir.clone().cross(up).normalize();
        const pitched = dir.clone().applyAxisAngle(right, -dy * .0032);
        if (Math.abs(pitched.dot(up)) < .985) dir = pitched;
        viewport.orbit.target.copy(viewport.camera.position).add(dir.multiplyScalar(distance));
        viewport.camera.lookAt(viewport.orbit.target);
        cameraChanged();
      } else if (customMode === 'pan') {
        event.preventDefault(); event.stopImmediatePropagation();
        const distance = Math.max(1, viewport.camera.position.distanceTo(viewport.orbit.target));
        const dir = viewport.orbit.target.clone().sub(viewport.camera.position).normalize();
        const up = viewport.camera.up.clone().normalize();
        let right = dir.clone().cross(up);
        if (right.lengthSq() < .00001) right = viewport.camera.position.clone().set(1, 0, 0);
        right.normalize();
        const screenUp = right.clone().cross(dir).normalize();
        const scale = Math.max(.05, distance * .00135);
        const delta = right.multiplyScalar(-dx * scale).add(screenUp.multiplyScalar(dy * scale));
        viewport.camera.position.add(delta); viewport.orbit.target.add(delta);
        cameraChanged();
      } else if (customMode === 'select-box') {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left, y = event.clientY - rect.top;
        moved ||= Math.hypot(x - startX, y - startY) >= 4;
        if (moved) drawSelectionRect(x, y);
      }
      lastX = event.clientX; lastY = event.clientY;
    }, true);

    canvas.addEventListener('pointerup', event => {
      if (event.pointerId !== pointerId || !customMode) return;
      const mode = customMode;
      if (mode === 'select-box') {
        event.preventDefault(); event.stopImmediatePropagation();
        const rect = canvas.getBoundingClientRect();
        finishBoxSelection(event.clientX - rect.left, event.clientY - rect.top);
      } else {
        event.preventDefault(); event.stopImmediatePropagation();
      }
      endCustomPointer();
    }, true);

    canvas.addEventListener('wheel', event => {
      if (isEditable(event.target)) return;
      event.preventDefault();
      const dir = viewport.orbit.target.clone().sub(viewport.camera.position).normalize();
      const distance = Math.max(1, viewport.camera.position.distanceTo(viewport.orbit.target));
      const amount = -Math.sign(event.deltaY) * Math.max(12, Math.min(900, distance * .12));
      const delta = dir.multiplyScalar(amount);
      viewport.camera.position.add(delta); viewport.orbit.target.add(delta);
      cameraChanged();
    }, { capture: true, passive: false });

    document.addEventListener('pointerdown', event => {
      if (!viewport.container.contains(event.target)) viewportFocused = false;
    }, true);

    window.addEventListener('keydown', event => {
      if (!viewportFocused || isEditable(event.target) || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'q', 'e'].includes(key)) return;
      event.preventDefault();
      keys.add(key);
    }, true);
    window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()), true);
    window.addEventListener('blur', () => { keys.clear(); viewportFocused = false; endCustomPointer(); });

    let lastFrame = performance.now();
    const tick = now => {
      const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      if (viewportFocused && keys.size && !isEditable(document.activeElement)) {
        const up = viewport.camera.up.clone().normalize();
        let forward = viewport.orbit.target.clone().sub(viewport.camera.position).normalize();
        forward.z = 0;
        if (forward.lengthSq() < .00001) forward = viewport.camera.position.clone().set(0, 1, 0);
        forward.normalize();
        const right = forward.clone().cross(up).normalize();
        const delta = viewport.camera.position.clone().set(0, 0, 0);
        if (keys.has('w')) delta.add(forward);
        if (keys.has('s')) delta.sub(forward);
        if (keys.has('d')) delta.add(right);
        if (keys.has('a')) delta.sub(right);
        if (keys.has('e')) delta.add(up);
        if (keys.has('q')) delta.sub(up);
        if (delta.lengthSq() > 0) {
          const multiplier = eventShiftDown ? 4 : eventAltDown ? .25 : 1;
          delta.normalize().multiplyScalar(Math.max(120, viewport.gridSize * 8) * multiplier * dt);
          viewport.camera.position.add(delta); viewport.orbit.target.add(delta);
          cameraChanged();
        }
      }
      for (const helper of extraHelpers) helper.update?.();
      requestAnimationFrame(tick);
    };

    let eventShiftDown = false, eventAltDown = false;
    window.addEventListener('keydown', event => { eventShiftDown = event.shiftKey; eventAltDown = event.altKey; }, true);
    window.addEventListener('keyup', event => { eventShiftDown = event.shiftKey; eventAltDown = event.altKey; }, true);
    requestAnimationFrame(tick);

    const rawRemoveSelected = removeSelected;
    removeSelected = function() {
      const ids = viewport.multiSelectedIds?.filter(id => S.objects.some(o => o.id === id && o.dmxId)) || [];
      if (ids.length <= 1) return rawRemoveSelected();
      pushHistory();
      const targets = S.objects.filter(o => ids.includes(o.id));
      for (const object of targets) VMAP.removeObject(S.doc, object);
      S.objects = S.objects.filter(o => !ids.includes(o.id));
      S.selectedId = 'world';
      viewport.objects = S.objects;
      viewport.setObjects(S.objects, S.selectedId);
      markDirty(`Deleted ${targets.length} objects`);
      renderTree(); renderProperties();
    };
  }

  function install(viewport) {
    if (!viewport || viewport.__ephInteractionPass) return;
    viewport.__ephInteractionPass = true;
    installFastIcons();
    installIncrementalCreation(viewport);
    installReliablePropClicks(viewport);
    installViewportControls(viewport);
  }

  if (window.EPH3D) install(window.EPH3D);
  window.addEventListener('eph3d-ready', event => install(event.detail), { once: true });
})();
