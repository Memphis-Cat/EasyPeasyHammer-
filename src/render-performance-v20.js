// byanca
(() => {
  'use strict';

  if (window.__ephRenderPerformanceV20) return;
  window.__ephRenderPerformanceV20 = true;

  const MAX_LOCAL_MODEL_LOADS = 2;
  const modelQueue = [];
  let modelLoads = 0;

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

  function materialResource(material) {
    return String(material?.userData?.resource || material?.name || 'ERROR');
  }

  function batchVisual(visual, object) {
    if (!visual?.isMesh || !visual.geometry || visual.geometry.index) return visual;
    const oldGeometry = visual.geometry;
    const oldMaterials = Array.isArray(visual.material) ? visual.material : [visual.material];
    const oldGroups = Array.isArray(oldGeometry.groups) ? oldGeometry.groups : [];
    if (oldMaterials.length < 2 || oldGroups.length < 2) return visual;

    const attributes = Object.entries(oldGeometry.attributes || {});
    if (!attributes.length || !oldGeometry.getAttribute?.('position')) return visual;

    const buckets = new Map();
    for (const group of oldGroups) {
      const material = oldMaterials[group.materialIndex] || oldMaterials[0];
      const resource = materialResource(material);
      let bucket = buckets.get(resource);
      if (!bucket) {
        bucket = { resource, material, groups: [], values: new Map() };
        for (const [name] of attributes) bucket.values.set(name, []);
        buckets.set(resource, bucket);
      }
      bucket.groups.push(group);
    }
    if (buckets.size >= oldMaterials.length) return visual;

    for (const bucket of buckets.values()) {
      for (const group of bucket.groups) {
        const start = Math.max(0, Number(group.start) || 0);
        const end = start + Math.max(0, Number(group.count) || 0);
        for (const [name, attribute] of attributes) {
          const values = bucket.values.get(name);
          const itemSize = attribute.itemSize;
          for (let index = start; index < end; index++) {
            const base = index * itemSize;
            for (let component = 0; component < itemSize; component++) values.push(attribute.array[base + component]);
          }
        }
      }
    }

    const Geometry = oldGeometry.constructor;
    const geometry = new Geometry();
    let cursor = 0;
    const uniqueMaterials = [];
    const representative = new Set();

    for (const bucket of buckets.values()) {
      const positionValues = bucket.values.get('position') || [];
      const vertexCount = positionValues.length / (oldGeometry.getAttribute('position')?.itemSize || 3);
      if (!vertexCount) continue;
      const materialIndex = uniqueMaterials.length;
      uniqueMaterials.push(bucket.material);
      representative.add(bucket.material);
      for (const [name, attribute] of attributes) {
        const Attribute = attribute.constructor;
        const ArrayType = attribute.array.constructor;
        const existing = geometry.getAttribute(name);
        const values = bucket.values.get(name) || [];
        const typed = new ArrayType(values);
        if (!existing) geometry.setAttribute(name, new Attribute(typed, attribute.itemSize, attribute.normalized));
        else {
          // This branch is not used because each final attribute is assembled below.
        }
      }
      geometry.addGroup(cursor, vertexCount, materialIndex);
      cursor += vertexCount;
    }

    // The loop above created each attribute from only the first bucket. Rebuild
    // the attributes once from all buckets in final draw order.
    for (const [name, attribute] of attributes) {
      const combined = [];
      for (const bucket of buckets.values()) combined.push(...(bucket.values.get(name) || []));
      const Attribute = attribute.constructor;
      const ArrayType = attribute.array.constructor;
      geometry.setAttribute(name, new Attribute(new ArrayType(combined), attribute.itemSize, attribute.normalized));
    }

    geometry.computeBoundingBox?.();
    geometry.computeBoundingSphere?.();
    visual.geometry = geometry;
    visual.material = uniqueMaterials.length === 1 ? uniqueMaterials[0] : uniqueMaterials;

    for (const material of oldMaterials) {
      if (!material || representative.has(material)) continue;
      material.userData ||= {};
      material.userData.disposed = true;
      material.dispose?.();
    }
    oldGeometry.dispose?.();

    object.ephRenderBatched = true;
    object.ephOriginalMaterialSlots = oldMaterials.length;
    object.ephBatchedMaterialSlots = uniqueMaterials.length;
    return visual;
  }

  function install() {
    const viewport = window.EPH3D || (typeof S !== 'undefined' ? S?.viewport : null);
    if (!viewport) return false;

    if (typeof viewport.createPartVisual === 'function' && !viewport.createPartVisual.__ephBatchV20) {
      const rawCreatePartVisual = viewport.createPartVisual.bind(viewport);
      const wrappedCreatePartVisual = function(object) {
        const visual = rawCreatePartVisual(object);
        if (!object?.ephLargeStreamed || !Array.isArray(object.faces) || object.faces.length < 24) return visual;
        try { return batchVisual(visual, object); }
        catch (error) {
          console.warn('[Render Performance] Could not batch streamed mesh.', error);
          return visual;
        }
      };
      wrappedCreatePartVisual.__ephBatchV20 = true;
      wrappedCreatePartVisual.__ephPrevious = rawCreatePartVisual;
      viewport.createPartVisual = wrappedCreatePartVisual;
      report('Streamed CMapMesh material batching installed.');
    }

    if (typeof viewport.loadModel === 'function' && !viewport.loadModel.__ephQueueV20) {
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
      report(`Map-local worldnode model concurrency limited to ${MAX_LOCAL_MODEL_LOADS}.`);
    }

    return Boolean(viewport.createPartVisual?.__ephBatchV20 && viewport.loadModel?.__ephQueueV20);
  }

  install();
  const timer = setInterval(() => {
    if (install()) clearInterval(timer);
  }, 250);
  setTimeout(() => clearInterval(timer), 20000);
  window.addEventListener('eph3d-ready', install);
})();
