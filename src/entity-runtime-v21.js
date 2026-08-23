// byanca
(() => {
  'use strict';
  if (window.__ephEntityRuntimeV21) return;
  window.__ephEntityRuntimeV21 = true;

  const api = window.easyPeasyHammer;
  const modelResolveCache = new Map();
  const materialResolveCache = new Map();
  const catalog = new Map();
  let catalogPromise = null;

  const lower = value => String(value || '').toLowerCase();
  const clean = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const basename = value => clean(value).split('/').pop() || '';

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Entity Runtime V21] ${message}`, meta || '');
    api?.appLog?.(level, 'entity-runtime-v21', message, meta).catch?.(() => {});
  }

  async function hydrateCatalog() {
    if (catalogPromise) return catalogPromise;
    catalogPromise = (async () => {
      const result = await api?.getEntityCatalog?.();
      if (!result?.ok || !Array.isArray(result.entities)) return null;
      catalog.clear();
      for (const item of result.entities) catalog.set(lower(item.className), item);
      return result;
    })().catch(error => { report('error', 'FGD catalog refresh failed.', error?.message || String(error)); return null; });
    return catalogPromise;
  }

  function scoreModel(path, original, queries) {
    const p = lower(path), wanted = lower(clean(original).replace(/\.mdl$/i, '').replace(/\.vmdl$/i, ''));
    const base = lower(basename(path).replace(/\.vmdl$/i, ''));
    let score = 0;
    if (p.endsWith('.vmdl')) score += 20;
    if (p.replace(/\.vmdl$/i, '') === wanted) score += 1000;
    if (base === lower(basename(wanted))) score += 700;
    for (const query of queries) if (query && p.includes(lower(query))) score += 80;
    if (/\/weapons?\//i.test(path)) score += 15;
    if (/world|dropped|w_/i.test(base)) score += 10;
    return score;
  }

  function modelQueries(resource) {
    const base = basename(resource).replace(/\.(?:mdl|vmdl)$/i, '');
    const cleaned = base
      .replace(/^(?:w_|v_)/i, '')
      .replace(/^(?:rif_|smg_|pist_|shot_|snip_|mach_|eq_)/i, '')
      .replace(/_(?:dropped|world|view|viewmodel)$/i, '');
    const tokens = cleaned.split(/[_\-]+/).filter(token => token.length >= 3);
    return [...new Set([base, cleaned, ...tokens].filter(Boolean))];
  }

  async function resolveLegacyModel(rawLoad, resource) {
    const normalized = clean(resource);
    const cacheKey = lower(normalized);
    if (modelResolveCache.has(cacheKey)) return modelResolveCache.get(cacheKey);
    const promise = (async () => {
      if (!/\.mdl$/i.test(normalized)) return rawLoad(resource);

      const directVmdl = normalized.replace(/\.mdl$/i, '.vmdl');
      let result = await rawLoad(directVmdl);
      if (result?.scene) {
        report('normal', `Resolved legacy Hammer .mdl helper as ${directVmdl}.`, { source: normalized });
        return result;
      }

      const queries = modelQueries(normalized);
      const candidates = new Map();
      for (const query of queries.slice(0, 3)) {
        try {
          const search = await api?.searchAssets?.('model', query, 80);
          for (const item of search?.ok && Array.isArray(search.items) ? search.items : []) {
            const path = clean(item.path || item.model || '');
            if (!path || !/\.vmdl$/i.test(path)) continue;
            candidates.set(lower(path), path);
          }
        } catch {}
      }
      const ranked = [...candidates.values()].sort((a, b) => scoreModel(b, normalized, queries) - scoreModel(a, normalized, queries));
      for (const candidate of ranked.slice(0, 8)) {
        result = await rawLoad(candidate);
        if (result?.scene) {
          report('normal', `Resolved legacy Hammer model ${normalized} → ${candidate}.`);
          return result;
        }
      }
      result = await rawLoad(resource);
      return result || null;
    })();
    modelResolveCache.set(cacheKey, promise);
    return promise;
  }

  function materialCandidates(resource) {
    const normalized = clean(resource);
    const out = [];
    if (/^editor\//i.test(normalized)) out.push(`materials/${normalized}`);
    if (/\.vmat$/i.test(normalized) && !/^materials\//i.test(normalized)) out.push(`materials/${normalized}`);
    out.push(normalized);
    return [...new Set(out)];
  }

  async function resolveEditorMaterial(rawLoad, resource) {
    const normalized = clean(resource);
    const cacheKey = lower(normalized);
    if (materialResolveCache.has(cacheKey)) return materialResolveCache.get(cacheKey);
    const promise = (async () => {
      const candidates = materialCandidates(normalized);
      for (const candidate of candidates) {
        const texture = await rawLoad(candidate);
        if (texture) {
          if (lower(candidate) !== lower(normalized)) report('normal', `Resolved Hammer editor material ${normalized} → ${candidate}.`);
          return texture;
        }
      }
      if (/^(?:editor\/|materials\/editor\/)/i.test(normalized)) {
        const query = basename(normalized).replace(/\.vmat$/i, '');
        try {
          const search = await api?.searchAssets?.('material', query, 40);
          const items = search?.ok && Array.isArray(search.items) ? search.items : [];
          for (const item of items) {
            const candidate = clean(item.path || '');
            if (!candidate || !/\.vmat$/i.test(candidate)) continue;
            const texture = await rawLoad(candidate);
            if (texture) {
              report('normal', `Resolved Hammer editor sprite ${normalized} → ${candidate}.`);
              return texture;
            }
          }
        } catch {}
      }
      return null;
    })();
    materialResolveCache.set(cacheKey, promise);
    return promise;
  }

  function patchPropertyInputs() {
    const s = typeof S !== 'undefined' ? S : window.S;
    const object = s?.objects?.find(item => item.id === s.selectedId);
    if (!object?.className) return;
    const meta = catalog.get(lower(object.className));
    if (!meta?.properties?.length) return;
    const byKey = new Map(meta.properties.filter(item => item?.key).map(item => [String(item.key), item]));
    document.querySelectorAll('.eph-fgd-input[data-fgd-key]').forEach(input => {
      const property = byKey.get(String(input.dataset.fgdKey));
      if (!property || input.tagName !== 'INPUT') return;
      const type = lower(property.type);
      const current = object.entityProperties?.[property.key];
      const intended = current !== undefined && current !== null ? String(current) : String(property.default ?? '');
      const vectorLike = /(?:vector|qangle|color|vecline|axis|origin)/.test(type) || /^\s*-?[\d.]+(?:\s+-?[\d.]+){1,3}\s*$/.test(intended);
      if (vectorLike && input.type === 'number') {
        input.type = 'text';
        input.removeAttribute('step');
        input.value = intended;
        input.placeholder = String(property.default ?? '');
      }
    });
  }

  function install() {
    const vp = window.EPH3D || (typeof S !== 'undefined' ? S?.viewport : null);
    if (!vp?.loadModel || !vp?.loadMaterialTexture) return false;

    if (!vp.loadModel.__ephEntityResolveV21) {
      const raw = vp.loadModel.bind(vp);
      const wrapped = function(resource) { return resolveLegacyModel(raw, resource); };
      wrapped.__ephEntityResolveV21 = true;
      wrapped.__ephPrevious = raw;
      vp.loadModel = wrapped;
      report('normal', 'Legacy Hammer entity model resolver installed.');
    }

    if (!vp.loadMaterialTexture.__ephEntityResolveV21) {
      const raw = vp.loadMaterialTexture.bind(vp);
      const wrapped = function(resource) {
        const value = clean(resource);
        if (/^(?:editor\/|materials\/editor\/)/i.test(value)) return resolveEditorMaterial(raw, value);
        return raw(resource);
      };
      wrapped.__ephEntityResolveV21 = true;
      wrapped.__ephPrevious = raw;
      vp.loadMaterialTexture = wrapped;
      report('normal', 'Hammer editor sprite path resolver installed.');
    }
    return true;
  }

  hydrateCatalog().then(() => {
    const rawRender = typeof renderProperties === 'function' ? renderProperties : null;
    if (rawRender && !rawRender.__ephEntityPropsV21) {
      const wrapped = function(...args) {
        const result = rawRender(...args);
        patchPropertyInputs();
        return result;
      };
      wrapped.__ephEntityPropsV21 = true;
      try { renderProperties = wrapped; } catch {}
      window.renderProperties = wrapped;
    }
    patchPropertyInputs();
  });

  install();
  const timer = setInterval(install, 250);
  setTimeout(() => clearInterval(timer), 20000);
  window.addEventListener('eph3d-ready', install);
  window.addEventListener('eph-fgd-catalog-ready', () => { catalogPromise = null; hydrateCatalog().then(patchPropertyInputs); });
})();
