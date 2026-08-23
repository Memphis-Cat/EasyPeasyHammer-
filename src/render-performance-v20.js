// byanca
(() => {
  'use strict';

  if (window.__ephRenderPerformanceV20) return;
  window.__ephRenderPerformanceV20 = true;

  const MAX_LOCAL_MODEL_LOADS = 2;
  const modelQueue = [];
  let modelLoads = 0;
  let installed = false;

  function report(message, meta = null) {
    console.info(`[Render Performance] ${message}`, meta || '');
    window.easyPeasyHammer?.appLog?.('normal', 'render-performance', message, meta).catch?.(() => {});
  }

  function runModelTask(task) {
    return new Promise((resolve, reject) => {
      modelQueue.push({ task, resolve, reject });
      pumpModels();
    });
  }

  function pumpModels() {
    while (modelLoads < MAX_LOCAL_MODEL_LOADS && modelQueue.length) {
      const item = modelQueue.shift();
      modelLoads++;
      Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
        modelLoads--;
        pumpModels();
      });
    }
  }

  function install() {
    if (installed) return true;
    const viewport = window.EPH3D || (typeof S !== 'undefined' ? S?.viewport : null);
    if (!viewport?.loadModel) return false;
    const rawLoadModel = viewport.loadModel.bind(viewport);
    const wrappedLoadModel = function(resource) {
      const normalized = String(resource || '').replace(/\\/g, '/');
      if (!/\/worldnodes\//i.test(`/${normalized}`)) return rawLoadModel(resource);
      if (this.modelCache?.has?.(resource)) return rawLoadModel(resource);
      return runModelTask(() => rawLoadModel(resource));
    };
    wrappedLoadModel.__ephQueueV20 = true;
    wrappedLoadModel.__ephPrevious = rawLoadModel;
    viewport.loadModel = wrappedLoadModel;
    installed = true;
    report(`Map-local worldnode model concurrency limited to ${MAX_LOCAL_MODEL_LOADS}.`);
    return true;
  }

  // V20 used to create a material for every face and then rebuild the entire
  // geometry afterwards to merge those materials. V27 now deduplicates before
  // mesh construction, so that expensive second geometry/material pass is gone.
  report('Post-render material rebatching disabled; V27 renders unique materials at source.');
  if (!install()) {
    const started = Date.now();
    const timer = setInterval(() => {
      if (install() || Date.now() - started > 5000) clearInterval(timer);
    }, 250);
  }
  window.addEventListener('eph3d-ready', () => { if (!installed) install(); }, { once: true });
})();
