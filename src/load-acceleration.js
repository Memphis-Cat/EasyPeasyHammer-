// byanca
(() => {
  if (window.__ephLoadAcceleration || typeof loadProject !== 'function') return;
  window.__ephLoadAcceleration = true;

  const originalLoadProject = loadProject;

  async function collectModels(project, ui) {
    if (project?.ephSkipModelWarmup || project?.ephReadOnlySource) return [];
    let source = ui?.vmapText || '';
    if (!source && project?.vmapPath) {
      try {
        const inspection = await api.inspectVmap?.(project.vmapPath);
        // Binary maps need dmxconvert and may expand to hundreds of MB. Model
        // warmup is optional, so never decode/parse them once here and then a
        // second time in the real loader.
        if (inspection?.ok && (inspection.encoding === 'binary' || Number(inspection.size) > 32 * 1024 * 1024)) return [];
        const result = await api.loadVmap(project.vmapPath);
        if (result?.ok) source = result.text || '';
      } catch {}
    }
    if (!source) return [];
    if (source.length > 32 * 1024 * 1024) return [];

    try {
      const doc = VMAP.parse(source);
      const objects = VMAP.extractObjects(doc).map(ensureObject);
      const models = objects.filter(object => object?.type === 'prop' && object.model).map(object => object.model);
      if (objects.some(object => object?.className === 'info_player_counterterrorist')) models.push('agents/models/ctm_sas/ctm_sas.vmdl');
      if (objects.some(object => object?.className === 'info_player_terrorist')) models.push('agents/models/tm_phoenix/tm_phoenix.vmdl');
      return [...new Set(models)];
    } catch {
      return [];
    }
  }

  loadProject = async function(project, ui) {
    const viewport = S.viewport || window.EPH3D;
    if (viewport?.warmModels) {
      const models = await collectModels(project, ui);
      if (models.length) {
        const resumeName = document.getElementById('resumeName');
        const previous = resumeName?.textContent || '';
        if (resumeName) resumeName.textContent = `${previous || project?.name || 'Project'} · loading assets…`;
        try { await viewport.warmModels(models); } catch {}
        if (resumeName) resumeName.textContent = previous || project?.name || 'Project';
      }
    }
    return originalLoadProject(project, ui);
  };

  window.loadProject = loadProject;
})();
