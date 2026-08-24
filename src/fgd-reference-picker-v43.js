// byanca
(() => {
  'use strict';
  if (window.__ephFgdReferencePickerV43) return;
  window.__ephFgdReferencePickerV43 = true;

  const VMAP = window.EPH_VMAP;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  let armed = null;
  let wrappedRenderProperties = null;
  let catalog = new Map();

  const lower = value => String(value || '').trim().toLowerCase();
  const objectById = id => state()?.objects?.find(object => object?.id === id) || null;

  function report(message, meta = null) {
    console.info(`[FGD Reference Picker V43] ${message}`, meta || '');
    try { window.easyPeasyHammer?.appLog?.('normal', 'fgd-reference-picker-v43', message, meta)?.catch?.(() => {}); } catch {}
  }

  function ensureStyle() {
    if (document.getElementById('ephFgdReferencePickerV43Style')) return;
    const style = document.createElement('style');
    style.id = 'ephFgdReferencePickerV43Style';
    style.textContent = `
      .eph-fgd-ref-wrap-v43{display:flex;min-width:0;gap:4px;align-items:center}
      .eph-fgd-ref-wrap-v43>.prop-input,.eph-fgd-ref-wrap-v43>.prop-select{flex:1 1 auto;min-width:0}
      .eph-fgd-ref-button-v43{flex:0 0 auto;height:25px;padding:0 7px;border:1px solid #3b4149;border-radius:3px;background:#181b1f;color:#dfe6ef;font:10px Segoe UI,Arial,sans-serif;cursor:pointer}
      .eph-fgd-ref-button-v43:hover,.eph-fgd-ref-button-v43.armed{border-color:#5c9bd5;background:#173047;color:#fff}
      body.eph-reference-picking-v43 #threeViewport,body.eph-reference-picking-v43 #sceneTree{cursor:crosshair!important}
    `;
    document.head.appendChild(style);
  }

  function metadataFor(className) {
    const key = lower(className);
    if (catalog.has(key)) return catalog.get(key);
    const globalItem = Array.isArray(window.ENTITIES || (typeof ENTITIES !== 'undefined' ? ENTITIES : null))
      ? (window.ENTITIES || ENTITIES).find(item => lower(item?.className) === key)
      : null;
    return globalItem || null;
  }

  function pickerKind(property) {
    const type = lower(property?.type).replace(/\s+/g, '_');
    const key = lower(property?.key);

    if (/(?:^|_)(?:target_destination|target_source|entity_reference|entity_handle|entity_name|entityname|target_name)(?:_|$)/.test(type)) return { mode: 'entity', label: 'Pick' };
    // A few Valve FGDs use a plain string for a named target. Only use the key
    // heuristic when it clearly describes an entity target, never a resource.
    if (/(?:^|_)(?:target|parent|owner|destination|source)(?:_|$)/.test(key)
      && !/(material|model|sound|particle|file|path|resource|scene)/.test(key)
      && /^(?:string|target|target_destination|target_source|)$/.test(type)) return { mode: 'entity', label: 'Pick' };

    if (/(?:material|vmat)/.test(type)) return { mode: 'asset', tab: 'materials', label: 'Browse' };
    if (/(?:studio|model|vmdl)/.test(type)) return { mode: 'asset', tab: 'props', label: 'Browse' };
    if (/(?:particle|particlesystem|vpcf)/.test(type)) return { mode: 'asset', tab: 'particles', label: 'Browse' };
    if (/(?:sound|soundevent|vsnd)/.test(type)) return { mode: 'asset', tab: 'sounds', label: 'Browse' };
    return null;
  }

  function cancel(message = '') {
    armed = null;
    document.body.classList.remove('eph-reference-picking-v43');
    if (message) toast?.(message);
    try { renderProperties?.(); } catch {}
  }

  function arm(owner, property, kind) {
    if (!owner?.id || !property?.key || !kind) return;
    armed = { ownerId: owner.id, key: property.key, kind, className: owner.className };
    document.body.classList.toggle('eph-reference-picking-v43', kind.mode === 'entity');

    if (kind.mode === 'entity') {
      toast?.(`Pick an entity for ${property.label || property.key}`);
    } else {
      const s = state();
      if (s) {
        s.assetTab = kind.tab;
        s.assetItems = [];
        try { renderAssets?.(); queueAssetSearch?.(true); } catch {}
      }
      toast?.(`Choose a ${kind.tab === 'props' ? 'model' : kind.tab.slice(0, -1)} in Asset Manager`);
    }
    try { renderProperties?.(); } catch {}
  }

  function uniqueTargetName(target) {
    const s = state();
    if (!target || !s) return '';
    let candidate = String(target.name || target.className || 'target').trim() || 'target';
    const duplicate = () => s.objects.some(object => object?.id !== target.id && ['entity', 'prop'].includes(object?.type) && String(object.name || '') === candidate);
    if (duplicate()) {
      const base = String(target.className || target.name || 'target').replace(/[^A-Za-z0-9_]+/g, '_') || 'target';
      let index = 1;
      do { candidate = `${base}_${String(index++).padStart(2, '0')}`; } while (s.objects.some(object => object?.id !== target.id && String(object.name || '') === candidate));
      target.name = candidate;
    }
    // entityObject() falls back to classname when targetname is blank. Writing
    // the selected object here guarantees the picked reference has a real
    // targetname in Hammer, instead of merely looking named in EasyPeasyHammer.
    if (target.name !== candidate) target.name = candidate;
    if (target.dmxId && s.doc) VMAP?.applyObjectToDocument?.(s.doc, target);
    return candidate;
  }

  function assign(value, sourceLabel = '') {
    const s = state();
    const pick = armed;
    if (!s || !pick) return false;
    const owner = objectById(pick.ownerId);
    if (!owner) { cancel('The property owner no longer exists.'); return false; }

    pushHistory?.();
    owner.entityProperties ||= {};
    owner.entityProperties[pick.key] = String(value ?? '');
    if (owner.dmxId && s.doc) VMAP?.applyObjectToDocument?.(s.doc, owner);
    s.viewport?.updateObject?.(owner);
    markDirty?.(`Changed ${pick.key} on ${owner.name}`);
    report(`Picked ${sourceLabel || value} for ${pick.key}.`, { owner: owner.name || owner.id, value: String(value ?? '') });

    armed = null;
    document.body.classList.remove('eph-reference-picking-v43');
    s.selectedId = owner.id;
    try { renderTree?.(); renderProperties?.(); } catch {}
    toast?.(`${pick.key}: ${value}`);
    return true;
  }

  function canonicalObject(id) {
    if (!id) return null;
    const canonical = window.EPH_SOLID_ENTITY_V30?.canonicalId?.(id) || id;
    let object = objectById(canonical);
    if (object?.ephMeshEntityChild && object.parent) object = objectById(object.parent) || object;
    return object;
  }

  function pickWorldObject(target) {
    if (!armed || armed.kind.mode !== 'entity') return false;
    const object = canonicalObject(target?.id || target);
    if (!object || !['entity', 'prop'].includes(object.type)) {
      toast?.('Pick an entity, prop, particle entity, trigger, buyzone, bombsite, or other Hammer entity.');
      return false;
    }
    const value = uniqueTargetName(object);
    if (!value) return false;
    return assign(value, object.name || object.className);
  }

  function decorate() {
    ensureStyle();
    const owner = current?.();
    if (!owner || !['entity', 'prop'].includes(owner.type)) return;
    const meta = metadataFor(owner.className);
    if (!meta) return;
    const properties = new Map((meta.properties || []).map(property => [String(property.key || '').toLowerCase(), property]));

    document.querySelectorAll('#propertiesContent .eph-fgd-input[data-fgd-key]').forEach(input => {
      const property = properties.get(lower(input.dataset.fgdKey));
      const kind = pickerKind(property);
      if (!kind) return;
      if (input.closest('.eph-fgd-ref-wrap-v43')) return;

      const wrap = document.createElement('div');
      wrap.className = 'eph-fgd-ref-wrap-v43';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'eph-fgd-ref-button-v43';
      button.textContent = kind.label;
      button.title = kind.mode === 'entity' ? 'Click, then pick the referenced entity in the 3D viewport or Scene tree.' : `Choose this resource from the ${kind.tab} Asset Manager tab.`;
      if (armed?.ownerId === owner.id && armed?.key === property.key) button.classList.add('armed');
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        if (armed?.ownerId === owner.id && armed?.key === property.key) cancel('Picker cancelled.');
        else arm(owner, property, kind);
      };
      wrap.appendChild(button);
    });
  }

  function installProperties() {
    if (typeof renderProperties !== 'function') return false;
    if (renderProperties.__ephFgdReferencePickerV43) {
      wrappedRenderProperties = renderProperties;
      queueMicrotask(decorate);
      return true;
    }
    const raw = renderProperties;
    const wrapped = function(...args) {
      const result = raw(...args);
      queueMicrotask(decorate);
      return result;
    };
    for (const key of Object.keys(raw)) if (key.startsWith('__eph')) wrapped[key] = raw[key];
    wrapped.__ephFgdReferencePickerV43 = true;
    wrapped.__ephPrevious = raw;
    renderProperties = wrapped;
    window.renderProperties = wrapped;
    wrappedRenderProperties = wrapped;
    queueMicrotask(decorate);
    return true;
  }

  async function hydrateCatalog() {
    try {
      const result = await window.easyPeasyHammer?.getEntityCatalog?.();
      if (!result?.ok || !Array.isArray(result.entities)) return;
      catalog = new Map(result.entities.map(entity => [lower(entity.className), entity]));
      queueMicrotask(decorate);
    } catch (error) {
      console.warn('[FGD Reference Picker V43] Could not read FGD catalog.', error);
    }
  }

  // Register before Select Click V40 in project-dialog. When a reference picker
  // is armed this capture handler owns the click; otherwise it is completely
  // transparent and the normal selection tool behaves as before.
  window.addEventListener('pointerdown', event => {
    if (!armed || event.button !== 0) return;

    if (armed.kind.mode === 'entity') {
      const row = event.target?.closest?.('#sceneTree .tree-row');
      if (row) {
        const id = row.dataset.objectId;
        if (!id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        pickWorldObject(id);
        return;
      }

      const vp = state()?.viewport || window.EPH3D;
      if (event.target === vp?.renderer?.domElement) {
        const id = window.EPH_SURFACE_MOVE_V39?.selectAt?.(event);
        if (!id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        pickWorldObject(id);
      }
    }
  }, true);

  window.addEventListener('click', event => {
    if (!armed || armed.kind.mode !== 'asset') return;
    const card = event.target?.closest?.('#assetGrid .asset-card[data-i]');
    if (!card) return;
    const item = state()?.assetItems?.[Number(card.dataset.i)];
    const value = item?.path || item?.model || '';
    if (!value) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    assign(value, item.name || value);
  }, true);

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && armed) {
      event.preventDefault();
      cancel('Picker cancelled.');
    }
  }, true);

  function install() {
    installProperties();
    hydrateCatalog();
  }

  install();
  window.addEventListener('eph-fgd-catalog-ready', hydrateCatalog);
  window.addEventListener('eph-runtime-ready', install, { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    if (wrappedRenderProperties && renderProperties !== wrappedRenderProperties) installProperties();
    if (checks >= 32) clearInterval(guard);
  }, 250);

  window.EPH_FGD_REFERENCE_PICKER = { cancel, assign, pickWorldObject, armed: () => armed };
  report('Hammer-style entity-reference and resource-property pickers installed.');
})();
