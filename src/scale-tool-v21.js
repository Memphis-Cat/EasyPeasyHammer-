// byanca
(() => {
  'use strict';
  if (window.__ephScaleToolV21) return;
  window.__ephScaleToolV21 = true;

  const VMAP = window.EPH_VMAP;
  const STORAGE_MODE = 'eph-scale-anchor-v21';
  const STORAGE_STEP = 'eph-scale-step-v21';
  const MIN_SIZE = 0.01;
  let viewport = null;
  let drag = null;
  let pointer = { x: 0, y: 0 };

  function state() { return typeof S !== 'undefined' ? S : window.S; }
  function object() { const s = state(); return s?.objects?.find(item => item.id === s.selectedId) || null; }
  function mode() { return localStorage.getItem(STORAGE_MODE) === 'both' ? 'both' : 'one'; }
  function stepValue() {
    const raw = localStorage.getItem(STORAGE_STEP) || 'grid';
    if (raw === 'grid') return Math.max(1, Number(state()?.gridSize) || 64);
    return Math.max(0.01, Number(raw) || 1);
  }
  function cloneVertices(vertices) { return (vertices || []).map(v => [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]); }
  function bounds(vertices) { return VMAP?.geometryBounds?.(vertices || []) || { center: [0,0,0], size: [64,64,64] }; }
  function log(message, meta = null) {
    console.info(`[Scale V21] ${message}`, meta || '');
    window.easyPeasyHammer?.appLog?.('normal', 'scale-v21', message, meta).catch?.(() => {});
  }

  function ensureStyle() {
    if (document.getElementById('ephScaleV21Style')) return;
    const style = document.createElement('style');
    style.id = 'ephScaleV21Style';
    style.textContent = `
      .eph-scale-v21{display:none;align-items:center;gap:6px;margin-left:2px}
      .eph-scale-v21.show{display:flex}
      .eph-scale-v21 select{height:30px;min-width:92px;background:#0b0c0e;color:#eee;border:1px solid #34383e;border-radius:3px;padding:0 24px 0 8px;font:12px Segoe UI,Arial,sans-serif;outline:none}
      .eph-scale-v21 select:hover{border-color:#555b63}
      .eph-scale-v21 .eph-scale-step{min-width:88px}
    `;
    document.head.appendChild(style);
  }

  function ensureUi() {
    ensureStyle();
    let host = document.getElementById('ephScaleV21');
    if (host) return host;
    const scaleButton = document.querySelector('.tool-mode[data-tool="scale"]');
    if (!scaleButton) return null;
    host = document.createElement('div');
    host.id = 'ephScaleV21';
    host.className = 'eph-scale-v21';
    host.innerHTML = `
      <select id="ephScaleAnchor" title="Choose whether scaling keeps the opposite side fixed or scales around the center">
        <option value="one">One side</option>
        <option value="both">Both sides</option>
      </select>
      <select id="ephScaleStep" class="eph-scale-step" title="World-unit resize step">
        <option value="grid">Step: Grid</option>
        <option value="1">Step: 1u</option><option value="2">Step: 2u</option><option value="4">Step: 4u</option>
        <option value="8">Step: 8u</option><option value="16">Step: 16u</option><option value="32">Step: 32u</option><option value="64">Step: 64u</option>
      </select>`;
    scaleButton.after(host);
    const anchor = host.querySelector('#ephScaleAnchor');
    const step = host.querySelector('#ephScaleStep');
    anchor.value = mode();
    step.value = localStorage.getItem(STORAGE_STEP) || 'grid';
    anchor.onchange = () => localStorage.setItem(STORAGE_MODE, anchor.value);
    step.onchange = () => localStorage.setItem(STORAGE_STEP, step.value);
    return host;
  }

  function showUi(tool) {
    const host = ensureUi();
    host?.classList.toggle('show', tool === 'scale');
  }

  function normalizeLatentScale(vp, obj) {
    if (!obj || obj.type !== 'part' || !Array.isArray(obj.vertices)) return false;
    const scale = Array.isArray(obj.scale) ? obj.scale.map(Number) : [1,1,1];
    if (scale.every(value => Number.isFinite(value) && Math.abs(value - 1) < 1e-6)) return false;
    const base = bounds(obj.vertices);
    const center = base.center;
    obj.vertices = cloneVertices(obj.vertices).map(vertex => vertex.map((value, axis) => center[axis] + (value - center[axis]) * (Number.isFinite(scale[axis]) ? Math.max(MIN_SIZE, scale[axis]) : 1)));
    obj.scale = [1,1,1];
    obj.size = bounds(obj.vertices).size;
    VMAP?.applyObjectToDocument?.(state()?.doc, obj);
    vp?.updateObject?.(obj);
    log(`Baked latent transform scale on ${obj.name || obj.id}.`, { size: obj.size });
    return true;
  }

  function axisIndices(axis) {
    const value = String(axis || '').toUpperCase();
    if (value === 'XYZ' || value === 'E') return [0,1,2];
    const out = [];
    if (value.includes('X')) out.push(0);
    if (value.includes('Y')) out.push(1);
    if (value.includes('Z')) out.push(2);
    return out.length ? out : [0,1,2];
  }

  function projectToScreen(vp, vector) {
    const rect = vp.renderer.domElement.getBoundingClientRect();
    const p = vector.clone().project(vp.camera);
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }

  function draggedSign(vp, root, axisIndex) {
    try {
      const THREE = window.EPH_THREE || window.THREE;
      if (!THREE) return 1;
      const center = root.getWorldPosition(new THREE.Vector3());
      const direction = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)][axisIndex];
      direction.applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const a = projectToScreen(vp, center);
      const b = projectToScreen(vp, center.clone().add(direction.multiplyScalar(128)));
      const dx = b.x - a.x, dy = b.y - a.y;
      const px = pointer.x - a.x, py = pointer.y - a.y;
      return dx * px + dy * py >= 0 ? 1 : -1;
    } catch { return 1; }
  }

  function begin(vp) {
    const obj = object();
    if (!obj || obj.type !== 'part' || vp.tool !== 'scale') return;
    normalizeLatentScale(vp, obj);
    const root = vp.objectRoots?.get(obj.id);
    if (!root) return;
    const THREE = window.EPH_THREE || window.THREE;
    const b = bounds(obj.vertices);
    const axes = axisIndices(vp.transform?.axis);
    drag = {
      id: obj.id,
      vertices: cloneVertices(obj.vertices),
      size: [...b.size],
      center: [...b.center],
      position: [...obj.position],
      rotation: [...obj.rotation],
      rootPosition: root.position.clone(),
      rootQuaternion: root.quaternion.clone(),
      rawStartScale: root.scale.clone(),
      axes,
      signs: Object.fromEntries(axes.map(axis => [axis, draggedSign(vp, root, axis)])),
      lastSize: [...b.size],
      lastFactors: [1,1,1],
      THREE,
    };
    vp.transform?.setSpace?.('local');
    vp.transform?.setScaleSnap?.(null);
  }

  function snappedSize(base, raw, step) {
    const delta = raw - base;
    const target = base + Math.round(delta / step) * step;
    return Math.max(MIN_SIZE, target);
  }

  function liveFields(targetSize, factors) {
    document.querySelectorAll('.prop-value[data-key="size"]').forEach(input => {
      const axis = Number(input.dataset.i); if (Number.isFinite(targetSize[axis])) input.value = String(Number(targetSize[axis].toFixed(3)));
    });
    document.querySelectorAll('.prop-value[data-key="scale"]').forEach(input => {
      const axis = Number(input.dataset.i); if (Number.isFinite(factors[axis])) input.value = String(Number(factors[axis].toFixed(4)));
    });
  }

  function preview(vp) {
    if (!drag) return;
    const obj = object(), root = vp.objectRoots?.get(drag.id);
    if (!obj || obj.id !== drag.id || !root) return;
    const axes = axisIndices(vp.transform?.axis || drag.axes.map(i => 'XYZ'[i]).join(''));
    const step = stepValue();
    const raw = [root.scale.x, root.scale.y, root.scale.z];
    const target = [...drag.size];
    const factors = [1,1,1];
    for (const axis of axes) {
      const rawFactor = Math.max(MIN_SIZE / Math.max(MIN_SIZE, drag.size[axis]), Number(raw[axis]) || 1);
      target[axis] = snappedSize(drag.size[axis], drag.size[axis] * rawFactor, step);
      factors[axis] = target[axis] / Math.max(MIN_SIZE, drag.size[axis]);
    }
    root.scale.set(...factors);
    root.position.copy(drag.rootPosition);
    if (mode() === 'one' && axes.length <= 2) {
      const THREE = drag.THREE;
      for (const axis of axes) {
        const localAxis = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)][axis];
        localAxis.applyQuaternion(drag.rootQuaternion).normalize();
        const shift = (target[axis] - drag.size[axis]) * 0.5 * (drag.signs[axis] || 1);
        root.position.add(localAxis.multiplyScalar(shift));
      }
    }
    drag.lastSize = target;
    drag.lastFactors = factors;
    liveFields(target, factors);
    vp.updateSelectionBox?.();
  }

  function commit(vp) {
    if (!drag) return false;
    const snapshot = drag;
    drag = null;
    const s = state();
    const obj = s?.objects?.find(item => item.id === snapshot.id);
    const root = vp.objectRoots?.get(snapshot.id);
    if (!obj || !root) return false;
    const factors = snapshot.lastFactors || [1,1,1];
    const c = snapshot.center;
    obj.vertices = snapshot.vertices.map(vertex => vertex.map((value, axis) => c[axis] + (value - c[axis]) * factors[axis]));
    obj.position = [root.position.x, root.position.y, root.position.z];
    obj.rotation = [...snapshot.rotation];
    obj.scale = [1,1,1];
    obj.size = bounds(obj.vertices).size;
    root.scale.set(1,1,1);
    root.position.set(...obj.position);
    vp.callbacks?.change?.(obj, true);
    liveFields(obj.size, [1,1,1]);
    requestAnimationFrame(() => {
      if (!vp.getObjectById?.(obj.id)) return;
      vp.updateObject?.(obj);
      vp.select?.(obj.id, false);
      try { renderProperties?.(); } catch {}
    });
    log(`Scaled ${obj.name || obj.id} in world units.`, { size: obj.size.map(v => Number(v.toFixed(3))), step: stepValue(), mode: mode() });
    return true;
  }

  function install() {
    const vp = window.EPH3D || state()?.viewport;
    if (!vp?.transform || !vp.syncSelectedFromRoot) return false;
    viewport = vp;
    ensureUi();
    if (!vp.__ephScaleToolV21) {
      vp.__ephScaleToolV21 = true;
      const rawSync = vp.syncSelectedFromRoot.bind(vp);
      vp.syncSelectedFromRoot = function(doCommit) {
        const obj = this.getObjectById?.(this.selectedId);
        if (this.tool === 'scale' && obj?.type === 'part') {
          if (!drag) begin(this);
          if (doCommit) { commit(this); return; }
          preview(this); return;
        }
        return rawSync(doCommit);
      };

      if (typeof vp.commitObjectTransform === 'function') {
        const rawCommitObjectTransform = vp.commitObjectTransform.bind(vp);
        vp.commitObjectTransform = function() {
          const obj = this.getObjectById?.(this.selectedId);
          if (this.tool === 'scale' && obj?.type === 'part') {
            if (!drag) begin(this);
            commit(this);
            return;
          }
          return rawCommitObjectTransform();
        };
      }

      const rawSetTool = vp.setTool.bind(vp);
      vp.setTool = function(tool) {
        const obj = this.getObjectById?.(this.selectedId);
        if (tool === 'scale' && obj?.type === 'part') normalizeLatentScale(this, obj);
        const result = rawSetTool(tool);
        if (tool === 'scale') { this.transform?.setSpace?.('local'); this.transform?.setScaleSnap?.(null); }
        showUi(tool);
        return result;
      };

      if (typeof vp.updateSnaps === 'function') {
        const rawSnaps = vp.updateSnaps.bind(vp);
        vp.updateSnaps = function() {
          const result = rawSnaps();
          if (this.tool === 'scale') this.transform?.setScaleSnap?.(null);
          return result;
        };
      }

      const canvas = vp.renderer?.domElement;
      canvas?.addEventListener('pointerdown', event => { pointer = { x: event.clientX, y: event.clientY }; }, true);
      vp.transform.addEventListener('dragging-changed', event => {
        if (vp.tool !== 'scale') return;
        if (event.value) begin(vp);
        else if (drag) commit(vp);
      });
      showUi(vp.tool);
      log('World-unit one-side scaling installed.', { defaultMode: mode(), step: localStorage.getItem(STORAGE_STEP) || 'grid' });
    }
    return true;
  }

  install();
  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 250);
  setTimeout(() => clearInterval(timer), 15000);
  window.addEventListener('eph3d-ready', install);
})();
