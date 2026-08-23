// byanca
(() => {
  'use strict';

  if (window.__ephFgdCatalogV15) return;
  window.__ephFgdCatalogV15 = true;

  const api = window.easyPeasyHammer;
  if (!api?.getEntityCatalog || !Array.isArray(ENTITIES)) return;

  function mergeCatalog(result) {
    if (!result?.ok || !Array.isArray(result.entities)) return 0;
    const known = new Map(ENTITIES.map(item => [String(item.className || '').toLowerCase(), item]));
    let added = 0;

    for (const entity of result.entities) {
      const className = String(entity?.className || '').trim();
      if (!className) continue;
      const key = className.toLowerCase();
      const existing = known.get(key);
      if (existing) {
        if (!existing.model && entity.model) existing.model = entity.model;
        existing.fgdSource ||= entity.sourceFile || 'CS2 FGD';
        continue;
      }
      const item = {
        name: entity.name || className,
        className,
        kind: 'entity',
        model: entity.model || '',
        source: 'CS2 FGD',
        fgdSource: entity.sourceFile || '',
      };
      ENTITIES.push(item);
      known.set(key, item);
      added++;
    }

    ENTITIES.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.className || '').localeCompare(String(b.className || '')));
    return added;
  }

  if (typeof addEntity === 'function' && !addEntity.__ephFgdModelV15) {
    const rawAddEntity = addEntity;
    addEntity = function(item = {}) {
      const before = S.selectedId;
      const result = rawAddEntity(item);
      const object = current?.();
      if (item?.model && object?.dmxId && object.id !== before && object.className === item.className) {
        object.model = item.model;
        VMAP.applyObjectToDocument(S.doc, object);
        S.viewport?.updateObject?.(object);
        renderProperties?.();
      }
      return result;
    };
    addEntity.__ephFgdModelV15 = true;
    window.addEntity = addEntity;
  }

  (async () => {
    try {
      const result = await api.getEntityCatalog();
      const added = mergeCatalog(result);
      if (added) {
        if (S.assetTab === 'entities') queueAssetSearch?.(true);
        log?.(`Loaded ${added.toLocaleString()} additional CS2 point entities from ${Number(result.fgdFiles || 0).toLocaleString()} FGD files`, 'success');
      } else if (result?.ok) {
        log?.(`CS2 FGD entity catalog ready (${Number(result.entities?.length || 0).toLocaleString()} point entities)`, 'success');
      }
    } catch (error) {
      console.warn('EasyPeasyHammer could not read the installed CS2 FGD catalog', error);
    }
  })();
})();
