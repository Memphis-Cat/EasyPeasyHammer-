// byanca
(() => {
  const VMAP = window.EPH_VMAP;
  if (!VMAP || VMAP.__ephSpecialDuplicateV6) return;
  VMAP.__ephSpecialDuplicateV6 = true;

  const original = VMAP.duplicateObject.bind(VMAP);
  VMAP.duplicateObject = function(doc, object) {
    const copy = original(doc, object);
    if (!copy || !['decal', 'terrain'].includes(object?.type)) return copy;
    copy.type = object.type;
    if (copy.type === 'decal') {
      copy.collision = false;
      copy.blockPlayers = false;
      copy.blockGrenades = false;
      copy.blockBullets = false;
    } else {
      copy.collision = object.collision !== false;
      copy.blockPlayers = object.blockPlayers !== false;
    }
    return copy;
  };
})();
