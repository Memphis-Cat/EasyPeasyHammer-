// byanca
(() => {
  'use strict';
  if (window.__ephFgdEditorModelGuardV18) return;
  window.__ephFgdEditorModelGuardV18 = true;

  const VMAP = window.EPH_VMAP;
  const helperTypes = new Set(['editormodel', 'studio']);

  function removeHelperModelFromDocument(object, helperResource) {
    if (!object?.dmxId || !VMAP?.findElementByDmxId) return;
    const element = VMAP.findElementByDmxId(S.doc, object.dmxId);
    const propertiesField = element?.fields?.find(field => field.key === 'entity_properties');
    const properties = propertiesField?.value?.kind === 'element' ? propertiesField.value : null;
    if (properties?.fields) {
      properties.fields = properties.fields.filter(field => !(field.key === 'model' && String(field.value || '') === String(helperResource || '')));
    }
  }

  function install() {
    if (typeof addEntity !== 'function' || addEntity.__ephEditorModelGuardV18) return false;
    const raw = addEntity;
    addEntity = function(item = {}) {
      const helper = helperTypes.has(String(item?.renderHint?.type || '').toLowerCase()) ? String(item?.model || item?.renderHint?.resource || '') : '';
      const before = S.selectedId;
      const result = raw(item);
      const object = current?.();
      if (helper && object?.id !== before && object?.className === item.className && String(object.model || '') === helper) {
        object.model = '';
        if (object.entityProperties && String(object.entityProperties.model || '') === helper) delete object.entityProperties.model;
        removeHelperModelFromDocument(object, helper);
        S.viewport?.updateObject?.(object);
        renderProperties?.();
        console.info(`[Hammer Entity] Kept editor helper model out of ${object.className} gameplay KeyValues: ${helper}`);
      }
      return result;
    };
    addEntity.__ephEditorModelGuardV18 = true;
    window.addEntity = addEntity;
    return true;
  }

  if (!install()) {
    setTimeout(install, 250);
    setTimeout(install, 750);
    setTimeout(install, 1800);
  }
})();
