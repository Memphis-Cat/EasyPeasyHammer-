// byanca
(() => {
  'use strict';
  if (window.__ephHammerMaterialResolverV42) return;
  window.__ephHammerMaterialResolverV42 = true;

  const api = window.easyPeasyHammer;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;
  let installedViewport = null;

  function normalize(value) {
    let resource = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (resource.toLowerCase().endsWith('_c')) resource = resource.slice(0, -2);
    if (resource && !/\.[a-z0-9]+$/i.test(resource)) resource += '.vmat';
    return resource;
  }

  function candidates(value) {
    const resource = normalize(value);
    if (!resource) return [];
    const out = [];
    const add = item => {
      item = normalize(item);
      if (item && !out.some(existing => existing.toLowerCase() === item.toLowerCase())) out.push(item);
    };
    if (resource.toLowerCase().startsWith('materials/')) {
      add(resource);
      add(resource.slice('materials/'.length));
    } else {
      add(`materials/${resource}`);
      add(resource);
    }
    return out;
  }

  function install(viewport = window.EPH3D || state()?.viewport) {
    const T = THREE();
    if (!viewport || !T || !api?.materialPreview) return false;
    installedViewport = viewport;

    if (!viewport.loadMaterialTexture?.__ephHammerMaterialV42) {
      const cache = viewport.materialTextureCache || new Map();
      viewport.materialTextureCache = cache;
      const wrapped = async function(resource) {
        const cacheKey = normalize(resource).toLowerCase();
        if (!cacheKey) return null;
        if (!cache.has(cacheKey)) {
          const pending = (async () => {
            for (const candidate of candidates(resource)) {
              let result = null;
              try { result = await api.materialPreview(candidate); } catch {}
              if (!result?.ok || !result.url) continue;
              const texture = await new Promise(resolve => {
                this.textureLoader.load(result.url, loaded => resolve(loaded), undefined, () => resolve(null));
              });
              if (!texture) continue;
              texture.colorSpace = T.SRGBColorSpace;
              texture.wrapS = texture.wrapT = T.RepeatWrapping;
              texture.userData ||= {};
              texture.userData.ephMaterialResource = result.resource || candidate;
              return texture;
            }
            return null;
          })();
          cache.set(cacheKey, pending);
        }

        const texture = await cache.get(cacheKey);
        // Never make a startup race, temporary AssetHost delay, or transient
        // decode failure permanent. Hammer resources can become available a few
        // moments later, and every material/icon must then be allowed to retry.
        if (!texture) cache.delete(cacheKey);
        return texture;
      };
      wrapped.__ephHammerMaterialV42 = true;
      wrapped.__ephPrevious = viewport.loadMaterialTexture;
      viewport.loadMaterialTexture = wrapped;
    }

    if (!viewport.createFaceMaterial?.__ephHammerMaterialV42) {
      const wrapped = function(resource) {
        const value = String(resource || 'ERROR');
        const isError = value === 'ERROR' || /(?:^|[\\/_.-])(error|missing)(?:[\\/_.-]|$)/i.test(value);
        const material = new T.MeshStandardMaterial({
          color: isError ? 0xffffff : (this.hashColor?.(value) || new T.Color(0x777777)),
          roughness: 0.8,
          metalness: 0.02,
          side: T.DoubleSide,
          map: isError ? this.errorTexture || null : null
        });
        material.userData.resource = value;
        if (!isError) {
          Promise.resolve(this.loadMaterialTexture?.(value)).then(texture => {
            if (!texture || material.userData.disposed) return;
            material.map = texture;
            material.color.set(0xffffff);
            material.needsUpdate = true;
          }).catch(() => {});
        }
        return material;
      };
      wrapped.__ephHammerMaterialV42 = true;
      wrapped.__ephPropFidelityV37 = true;
      wrapped.__ephPrevious = viewport.createFaceMaterial;
      viewport.createFaceMaterial = wrapped;
    }

    return true;
  }

  window.EPH_HAMMER_MATERIALS_V42 = { normalize, candidates, install };
  install();
  window.addEventListener('eph3d-ready', event => install(event.detail));
  window.addEventListener('eph-runtime-ready', () => install(), { once: true });
  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    const viewport = window.EPH3D || state()?.viewport;
    if (viewport && (viewport !== installedViewport || !viewport.loadMaterialTexture?.__ephHammerMaterialV42 || !viewport.createFaceMaterial?.__ephHammerMaterialV42)) install(viewport);
    if (checks >= 100) clearInterval(guard);
  }, 250);
})();
