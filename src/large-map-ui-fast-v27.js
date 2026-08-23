// byanca
(() => {
  'use strict';
  if (window.__ephLargeMapUiFastV27) return;
  window.__ephLargeMapUiFastV27 = true;

  let installed = false;
  let lastMap = '';
  let lastQuery = '';
  let lastCount = -1;
  let lastExpansion = '';

  const large = () => Boolean(window.EPH_LARGE_STREAM?.active?.() && (S?.objects?.length || 0) > 1200);
  const mapKey = () => String(S?.project?.vmapPath || S?.project?.id || '');
  const queryKey = () => String(document.getElementById('sceneSearch')?.value || '').trim().toLowerCase();
  const expansionKey = () => (S?.objects || [])
    .filter(object => ['world', 'folder'].includes(object?.type))
    .map(object => `${object.id}:${object.expanded ? 1 : 0}`)
    .join('|');

  function updateRows() {
    const tree = document.getElementById('sceneTree');
    if (!tree) return false;
    const rows = [...tree.querySelectorAll('.tree-row[data-object-id]')];
    if (!rows.length) return false;
    let found = S.selectedId === 'world';
    for (const row of rows) {
      const id = row.dataset.objectId;
      const selected = id === S.selectedId;
      row.classList.toggle('selected', selected);
      if (selected) {
        found = true;
        const object = S.objects.find(item => item.id === id);
        if (object) {
          const name = row.querySelector('.tree-name');
          if (name && name.textContent !== String(object.name || '')) name.textContent = String(object.name || '');
          const eye = row.querySelector('.tree-eye');
          if (eye) eye.textContent = object.visible === false ? '○' : '●';
        }
      }
    }
    return found;
  }

  function install() {
    if (installed || typeof renderTree !== 'function') return installed;
    const raw = renderTree;
    const wrapped = function(...args) {
      if (!large()) return raw(...args);
      const map = mapKey();
      const query = queryKey();
      const count = S.objects.length;
      const expansion = expansionKey();
      const tree = document.getElementById('sceneTree');
      const mustRebuild = map !== lastMap
        || query !== lastQuery
        || count !== lastCount
        || expansion !== lastExpansion
        || !tree?.querySelector('.tree-row[data-object-id]')
        || !updateRows();
      if (mustRebuild) {
        const result = raw(...args);
        lastMap = map;
        lastQuery = query;
        lastCount = count;
        lastExpansion = expansion;
        queueMicrotask(() => window.EPH_MULTI_SELECTION?.refresh?.());
        return result;
      }
      return undefined;
    };
    wrapped.__ephLargeMapUiFastV27 = true;
    wrapped.__ephPrevious = raw;
    renderTree = wrapped;
    window.renderTree = wrapped;
    installed = true;
    console.info('[Large Map UI V27] Scene tree selection updates no longer rebuild thousands of DOM rows.');
    return true;
  }

  // Install after multi-select has created row object ids. Its late wrapper can
  // safely sit outside this one; it will only annotate the rows we kept.
  setTimeout(install, 3200);
})();
