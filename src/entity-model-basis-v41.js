// byanca
(() => {
  'use strict';
  if (window.__ephEntityModelBasisV41) return;
  window.__ephEntityModelBasisV41 = true;

  const api = window.easyPeasyHammer;
  const catalog = new Map();
  let hydratePromise = null;
  let wrappedMarker = null;

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;
  const key = value => String(value || '').trim().toLowerCase();

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Entity Model Basis V41] ${message}`, meta || '');
    try { api?.appLog?.(level, 'entity-model-basis-v41', message, meta)?.catch?.(() => {}); } catch {}
  }

  function modelResource(object) {
    const meta = catalog.get(key(object?.className));
    return String(object?.model || object?.entityProperties?.model || meta?.model || '').trim();
  }

  async function hydrate() {
    if (hydratePromise) return hydratePromise;
    hydratePromise = Promise.resolve(api?.getEntityCatalog?.()).then(result => {
      if (!result?.ok || !Array.isArray(result.entities)) throw new Error(result?.error || 'FGD catalog unavailable');
      catalog.clear();
      for (const entity of result.entities) catalog.set(key(entity?.className), entity);
      return result;
    }).catch(error => {
      report('warning', 'Could not load installed FGD model metadata.', { error: error?.message || String(error) });
      return null;
    });
    return hydratePromise;
  }

  function correctionQuaternion() {
    const T = THREE();
    if (!T) return null;

    // ValveResourceFormat's glTF exporter converts Source 2 Z-up into glTF Y-up
    // as Source X -> glTF Z, Source Y -> glTF X, Source Z -> glTF Y. The exact
    // inverse basis is the same one used by Prop Fidelity V37.
    const desired = new T.Quaternion(0.5, 0.5, 0.5, 0.5).normalize();

    // Entity Fidelity V18 historically applied only +90 degrees around X to
    // editor models. Correct the parent visual so (correction * oldBasis)
    // equals the actual Source2/Hammer basis, without changing entity QAngles.
    const oldBasis = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2);
    return desired.multiply(oldBasis.invert()).normalize();
  }

  function installViewport(viewport = window.EPH3D || state()?.viewport) {
    const T = THREE();
    if (!viewport?.createEntityMarker || !T || !catalog.size) return false;
    if (viewport.createEntityMarker.__ephEntityModelBasisV41) {
      wrappedMarker = viewport.createEntityMarker;
      return true;
    }

    const previous = viewport.createEntityMarker;
    const correction = correctionQuaternion();
    if (!correction) return false;

    const wrapped = function(object) {
      const visual = previous.call(this, object);
      const resource = modelResource(object);
      if (!resource || !visual) return visual;

      // Apply the correction to the returned editor-visual container, not the
      // entity root. Position/rotation written to the VMAP therefore stay pure
      // Source 2 QAngles; only the automatically discovered Hammer helper model
      // gets the Source2<->glTF basis conversion.
      visual.quaternion.premultiply(correction);
      visual.userData ||= {};
      visual.userData.ephSource2EditorModelBasis = true;
      visual.userData.ephEditorModelResource = resource;
      return visual;
    };
    for (const property of Object.keys(previous)) if (property.startsWith('__eph')) wrapped[property] = previous[property];
    wrapped.__ephEntityModelBasisV41 = true;
    wrapped.__ephPrevious = previous;
    viewport.createEntityMarker = wrapped;
    wrappedMarker = wrapped;

    // Rebuild every model-backed entity already in the map. This includes FGD
    // supplied player-spawn/light/etc. editor models and user model overrides.
    queueMicrotask(() => {
      for (const object of state()?.objects || []) {
        if (object?.type !== 'entity' || !modelResource(object)) continue;
        viewport.updateObject?.(object);
      }
      viewport.updateSelectionBox?.();
    });

    report('normal', 'Installed automatic Source 2 basis for all FGD editor models.');
    return true;
  }

  async function install() {
    await hydrate();
    return installViewport();
  }

  install();
  window.addEventListener('eph-fgd-catalog-ready', () => {
    hydratePromise = null;
    install();
  });
  window.addEventListener('eph3d-ready', () => install());
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    const viewport = window.EPH3D || state()?.viewport;
    if (catalog.size && viewport?.createEntityMarker && viewport.createEntityMarker !== wrappedMarker) installViewport(viewport);
    if (checks >= 60) clearInterval(guard);
  }, 250);
})();
