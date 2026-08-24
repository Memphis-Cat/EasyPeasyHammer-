// byanca
(() => {
  'use strict';
  if (window.__ephScaleThinFixV38) return;
  window.__ephScaleThinFixV38 = true;

  const VMAP = window.EPH_VMAP;
  const STORAGE_STEP = 'eph-scale-step-v21';
  const MIN_SIZE = 0.01;
  let installedViewport = null;

  function state() { return typeof S !== 'undefined' ? S : window.S; }

  function stepValue() {
    const raw = localStorage.getItem(STORAGE_STEP) || 'grid';
    if (raw === 'grid') return Math.max(1, Number(state()?.gridSize) || 64);
    return Math.max(0.01, Number(raw) || 1);
  }

  function axisIndices(axis) {
    const value = String(axis || '').toUpperCase();
    if (value === 'XYZ' || value === 'E') return [0, 1, 2];
    const out = [];
    if (value.includes('X')) out.push(0);
    if (value.includes('Y')) out.push(1);
    if (value.includes('Z')) out.push(2);
    return out.length ? out : [0, 1, 2];
  }

  function amplifyThinAxisScale(viewport) {
    if (!viewport?.transform?.dragging || viewport.tool !== 'scale') return false;
    const object = viewport.getObjectById?.(viewport.selectedId)
      || state()?.objects?.find(item => item?.id === viewport.selectedId);
    if (!object || object.type !== 'part' || !Array.isArray(object.vertices)) return false;
    const root = viewport.objectRoots?.get?.(object.id);
    if (!root) return false;

    const bounds = VMAP?.geometryBounds?.(object.vertices || []);
    const size = bounds?.size || object.size || [64, 64, 64];
    const step = stepValue();
    const axes = axisIndices(viewport.transform?.axis);
    const threshold = Math.max(0.25, step * 0.25);
    const raw = [root.scale.x, root.scale.y, root.scale.z];
    let changed = false;

    for (const axis of axes) {
      const base = Math.max(MIN_SIZE, Math.abs(Number(size[axis])) || MIN_SIZE);
      if (base > threshold) continue;
      const rawFactor = Number(raw[axis]);
      if (!Number.isFinite(rawFactor)) continue;
      const delta = rawFactor - 1;
      if (Math.abs(delta) < 1e-7) continue;

      // TransformControls is multiplicative. On a 0.01u-thick Part, getting
      // back to 64u would otherwise require a 6400x mouse scale. Convert the
      // drag into an additive world-unit gesture while the axis is very thin.
      // Scale V21 still performs the final world-unit snapping and commit.
      const reference = Math.max(1, step);
      const amplified = Math.max(MIN_SIZE / base, 1 + delta * reference / base);
      if (axis === 0) root.scale.x = amplified;
      else if (axis === 1) root.scale.y = amplified;
      else root.scale.z = amplified;
      changed = true;
    }
    return changed;
  }

  function install(viewport = window.EPH3D || state()?.viewport) {
    if (!viewport?.syncSelectedFromRoot || !viewport?.transform) return false;
    if (viewport.syncSelectedFromRoot.__ephScaleThinFixV38) {
      installedViewport = viewport;
      return true;
    }

    const previous = viewport.syncSelectedFromRoot;
    const raw = previous.bind(viewport);
    const wrapped = function(doCommit, ...rest) {
      if (!doCommit) amplifyThinAxisScale(this);
      return raw(doCommit, ...rest);
    };
    for (const key of Object.keys(previous || {})) if (key.startsWith('__eph')) wrapped[key] = previous[key];
    wrapped.__ephScaleThinFixV38 = true;
    wrapped.__ephPrevious = previous;
    viewport.syncSelectedFromRoot = wrapped;
    installedViewport = viewport;
    console.info('[Scale Thin Fix V38] Paper-thin Parts can be widened again with the scale gizmo.');
    return true;
  }

  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    const viewport = window.EPH3D || state()?.viewport;
    if (viewport && (!installedViewport || viewport !== installedViewport || !viewport.syncSelectedFromRoot?.__ephScaleThinFixV38)) install(viewport);
    if (checks >= 48) clearInterval(guard);
  }, 250);
})();
