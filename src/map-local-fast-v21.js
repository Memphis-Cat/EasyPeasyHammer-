// byanca
(() => {
  'use strict';
  if (window.__ephMapLocalFastV21) return;
  window.__ephMapLocalFastV21 = true;

  const api = window.easyPeasyHammer;
  const cache = new Map();
  const unavailable = new Set();
  let installed = false;

  function projectPath() {
    return String((typeof S !== 'undefined' ? S?.project?.vmapPath : '') || window.S?.project?.vmapPath || '');
  }
  function clean(value) { return String(value || '').replace(/\\/g, '/').replace(/^\/+/, ''); }
  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Map Material V21] ${message}`, meta || '');
    api?.appLog?.(level, 'map-material-v21', message, meta).catch?.(() => {});
  }

  async function localTexture(vp, resource) {
    const vmap = projectPath(), normalized = clean(resource);
    if (!vmap || !normalized || !api?.mapLocalMaterial) return null;
    const key = `${vmap.toLowerCase()}|${normalized.toLowerCase()}`;
    if (unavailable.has(key)) return null;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        let result;
        try { result = await api.mapLocalMaterial(vmap, normalized); }
        catch (error) { report('error', `Local material lookup failed: ${normalized}`, error?.message || String(error)); return null; }
        if (!result?.ok || !result.url) {
          if (!result?.local) unavailable.add(key);
          return null;
        }
        return new Promise(resolve => vp.textureLoader.load(result.url, texture => {
          const THREE = window.EPH_THREE || window.THREE;
          if (THREE) {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          }
          texture.userData ||= {};
          texture.userData.ephMapLocal = true;
          texture.userData.ephSourceResource = normalized;
          report('normal', `Loaded map-local texture before ERROR fallback: ${normalized}`, { source: result.source, texture: result.texture });
          resolve(texture);
        }, undefined, () => resolve(null)));
      })());
    }
    return cache.get(key);
  }

  function install() {
    if (installed) return true;
    const vp = window.EPH3D || (typeof S !== 'undefined' ? S?.viewport : null);
    if (!vp?.loadMaterialTexture || !vp.textureLoader) return false;
    const raw = vp.loadMaterialTexture.bind(vp);
    const wrapped = async function(resource) {
      const normalized = clean(resource);
      let texture = null;
      if (/^maps\//i.test(normalized)) texture = await localTexture(vp, normalized);
      if (!texture) texture = await raw(resource);
      if (!texture && normalized && normalized !== 'ERROR' && !/^maps\//i.test(normalized)) texture = await localTexture(vp, normalized);
      if (texture && vp.materialTextureCache?.set) vp.materialTextureCache.set(resource, Promise.resolve(texture));
      return texture || null;
    };
    wrapped.__ephMapLocalFastV21 = true;
    wrapped.__ephPrevious = raw;
    vp.loadMaterialTexture = wrapped;
    installed = true;
    report('normal', 'Map-local-first material resolver installed once.');
    return true;
  }

  if (!install()) {
    const started = Date.now();
    const timer = setInterval(() => {
      if (install() || Date.now() - started > 5000) clearInterval(timer);
    }, 250);
  }
  window.addEventListener('eph3d-ready', () => { if (!installed) install(); }, { once: true });
})();
