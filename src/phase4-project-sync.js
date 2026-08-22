// byanca
(() => {
  const api = window.easyPeasyHammer;
  if (!api || window.__ephPhase4ProjectSync) return;
  window.__ephPhase4ProjectSync = true;

  function applySharedFolders(ui) {
    if (!ui || (!Array.isArray(ui.ephFolders) && !ui.ephParents)) return;
    S.objects = S.objects.filter(object => object.type !== 'folder');
    for (const folder of ui.ephFolders || []) {
      S.objects.push({
        id: folder.id,
        type: 'folder',
        name: folder.name || 'Folder',
        parent: folder.parent || 'world',
        expanded: folder.expanded !== false,
        sourceClass: 'EPH_UI_FOLDER'
      });
    }
    for (const object of S.objects) {
      if (!object.dmxId) continue;
      const parent = ui.ephParents?.[object.id];
      object.parent = parent && S.objects.some(item => item.id === parent) ? parent : (object.parent || 'world');
    }
    renderTree();
    renderProperties();
    S.viewport?.setObjects(S.objects, S.selectedId);
  }

  if (typeof loadProject === 'function' && !loadProject.__ephSharedFolders) {
    const originalLoadProject = loadProject;
    loadProject = async function(project, ui) {
      const result = await originalLoadProject(project, ui);
      if (result) applySharedFolders(ui);
      return result;
    };
    loadProject.__ephSharedFolders = true;
    window.loadProject = loadProject;
  }

  let uiSyncTimer = null;
  function sendUiOnlyChange() {
    clearTimeout(uiSyncTimer);
    uiSyncTimer = setTimeout(async () => {
      const collab = window.EPH_COLLAB;
      const state = collab?.state?.();
      if (!state?.connected || !S.project || !S.doc) return;
      try { await api.collabSendSnapshot(collab.makeSnapshot()); } catch {}
    }, 80);
  }

  document.addEventListener('click', event => {
    if (event.target?.id === 'addSceneFolder') setTimeout(sendUiOnlyChange, 0);
  });
  document.addEventListener('change', event => {
    if (event.target?.id === 'objectFolder') sendUiOnlyChange();
  });

  window.EPH_APPLY_SHARED_FOLDERS = applySharedFolders;
})();
