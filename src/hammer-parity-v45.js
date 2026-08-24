// byanca
(() => {
  'use strict';
  if (window.__ephHammerParityV45) return;
  window.__ephHammerParityV45 = true;

  const VMAP = window.EPH_VMAP;
  const api = window.easyPeasyHammer;
  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const THREE = () => window.EPH_THREE || window.THREE;

  let wrappedMarker = null;
  let wrappedMaterialLoader = null;
  let wrappedApply = null;
  let wrappedExtract = null;
  let wrappedPrepare = null;
  let rebuiltAfterAssets = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const key = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim().toLowerCase();

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Hammer Parity V45] ${message}`, meta || '');
    try { api?.appLog?.(level, 'hammer-parity-v45', message, meta)?.catch?.(() => {}); } catch {}
  }

  // ---------------------------------------------------------------------------
  // Material / icon loading parity
  // ---------------------------------------------------------------------------
  // The Hammer FGD renderer can ask for icons before the AssetHost has finished
  // loading CS2. V42 cached that first null result forever. Retry failures and
  // evict only failed cache entries so every FGD icon/material gets another
  // chance once the mounted game content is ready.
  function installMaterialRetry(viewport = window.EPH3D || state()?.viewport) {
    if (!viewport?.loadMaterialTexture || !THREE()) return false;
    if (viewport.loadMaterialTexture.__ephHammerParityV45) {
      wrappedMaterialLoader = viewport.loadMaterialTexture;
      return true;
    }

    const previous = viewport.loadMaterialTexture;
    const normalize = value => window.EPH_HAMMER_MATERIALS_V42?.normalize?.(value) || String(value || '');
    const wrapped = async function(resource) {
      const normalized = normalize(resource);
      const cacheKey = key(normalized);
      const clearFailure = () => {
        try { this.materialTextureCache?.delete?.(cacheKey); } catch {}
      };

      let texture = null;
      try { texture = await previous.call(this, resource); } catch {}
      if (texture) return texture;

      clearFailure();
      for (const delay of [120, 350, 900, 1800]) {
        await sleep(delay);
        clearFailure();
        try { texture = await previous.call(this, resource); } catch { texture = null; }
        if (texture) return texture;
      }
      clearFailure();
      return null;
    };
    wrapped.__ephHammerParityV45 = true;
    wrapped.__ephPrevious = previous;
    viewport.loadMaterialTexture = wrapped;
    wrappedMaterialLoader = wrapped;
    return true;
  }

  function rebuildEntityVisualsWhenAssetsReady() {
    if (rebuiltAfterAssets || !state()?.assetStatus?.available) return false;
    const viewport = window.EPH3D || state()?.viewport;
    if (!viewport?.updateObject) return false;
    rebuiltAfterAssets = true;
    for (const object of state()?.objects || []) {
      if (object?.type === 'entity') viewport.updateObject(object);
    }
    viewport.updateSelectionBox?.();
    report('normal', 'Rebuilt all FGD entity helpers after CS2 assets became available.');
    return true;
  }

  // ---------------------------------------------------------------------------
  // FGD studio/editormodel orientation parity
  // ---------------------------------------------------------------------------
  // Hammer's FGD studio helpers use the model facing convention opposite to the
  // raw VRF glTF helper orientation. Apply one Source-space 180 degree yaw to
  // every FGD model helper, not to named entities. Actual VMAP QAngles remain
  // untouched; only the editor helper visual is corrected.
  function correctModelFacing(visual) {
    if (!visual?.traverse) return visual;
    visual.traverse(node => {
      if (!node?.userData?.ephModelResource || node.userData.ephHammerFacingV45) return;
      node.rotation.z += Math.PI;
      node.userData.ephHammerFacingV45 = true;
    });
    return visual;
  }

  function installEntityFacing(viewport = window.EPH3D || state()?.viewport) {
    if (!viewport?.createEntityMarker) return false;
    if (viewport.createEntityMarker.__ephHammerParityV45) {
      wrappedMarker = viewport.createEntityMarker;
      return true;
    }
    const previous = viewport.createEntityMarker;
    const wrapped = function(object) {
      return correctModelFacing(previous.call(this, object));
    };
    for (const property of Object.keys(previous)) if (property.startsWith('__eph')) wrapped[property] = previous[property];
    wrapped.__ephHammerParityV45 = true;
    wrapped.__ephPrevious = previous;
    viewport.createEntityMarker = wrapped;
    wrappedMarker = wrapped;

    queueMicrotask(() => {
      for (const object of state()?.objects || []) if (object?.type === 'entity') viewport.updateObject?.(object);
      viewport.updateSelectionBox?.();
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Hammer-valid open decal mesh topology
  // ---------------------------------------------------------------------------
  // Hammer stores open CMapMesh boundaries with explicit outside half-edges.
  // Our generic mesh builder omitted those because closed solids do not need
  // them. That is harmless for boxes but wrong for one-face decals. Rebuild the
  // half-edge arrays exactly for every EPH decal so Hammer sees a proper open
  // polygon rather than a malformed/open solid.
  const field = (element, name) => element?.fields?.find(item => item?.key === name) || null;
  const element = (owner, name) => {
    const value = field(owner, name)?.value;
    return value?.kind === 'element' ? value : null;
  };
  const array = (owner, name) => {
    const value = field(owner, name)?.value;
    return Array.isArray(value) ? value : [];
  };
  function setField(owner, name, type, value) {
    if (!owner?.fields) return;
    let item = field(owner, name);
    if (!item) {
      item = { key: name, type, value };
      owner.fields.push(item);
    } else {
      item.type = type || item.type;
      item.value = value;
    }
  }

  function decalMarker(meshElement) {
    if (meshElement?.className !== 'CMapMesh') return false;
    const name = String(field(element(meshElement, 'meshData'), 'name')?.value || '');
    return /^EPH_DECAL_/i.test(name);
  }

  function isDecalObject(object, meshElement = null) {
    return object?.type === 'decal'
      || /^Decal[_\s-]*\d+/i.test(String(object?.name || ''))
      || decalMarker(meshElement);
  }

  function duplicateFaceVertexStreams(faceVertexData, face) {
    if (!faceVertexData?.fields || !Array.isArray(face) || face.length < 3) return;
    const n = face.length;
    setField(faceVertexData, 'size', 'int', String(n * 2));
    const streams = array(faceVertexData, 'streams');
    for (const stream of streams) {
      const dataField = field(stream, 'data');
      if (!Array.isArray(dataField?.value)) continue;
      const original = dataField.value.slice(0, n);
      if (!original.length) continue;
      const expanded = [];
      for (let i = 0; i < n; i++) {
        const value = original[i] ?? original[0];
        expanded.push(String(value), String(value));
      }
      dataField.value = expanded;
    }
  }

  function patchDecalMesh(meshElement, object = null) {
    if (meshElement?.className !== 'CMapMesh' || !isDecalObject(object, meshElement)) return false;
    const meshData = element(meshElement, 'meshData');
    if (!meshData) return false;

    const faces = Array.isArray(object?.faces) && object.faces.length
      ? object.faces
      : (() => {
          const starts = array(meshData, 'faceEdgeIndices').map(Number);
          const next = array(meshData, 'edgeNextIndices').map(Number);
          const edgeVertex = array(meshData, 'edgeVertexIndices').map(Number);
          return starts.map(start => {
            const result = [];
            const seen = new Set();
            let edge = start;
            while (edge >= 0 && edge < next.length && !seen.has(edge)) {
              seen.add(edge);
              result.push(edgeVertex[edge]);
              edge = next[edge];
              if (edge === start) break;
            }
            return result;
          }).filter(face => face.length >= 3);
        })();
    if (faces.length !== 1 || faces[0].length < 3) return false;

    const face = [...faces[0]];
    const n = face.length;
    const edgeVertex = [];
    const edgeOpposite = [];
    const edgeNext = [];
    const edgeFace = [];
    const edgeData = [];
    const edgeVertexData = [];
    const vertexEdge = Array(Math.max(...face) + 1).fill('-1');

    for (let i = 0; i < n; i++) {
      const faceEdge = i * 2;
      const boundaryEdge = faceEdge + 1;
      const a = face[i];
      const b = face[(i + 1) % n];

      edgeVertex[faceEdge] = String(b);
      edgeVertex[boundaryEdge] = String(a);
      edgeOpposite[faceEdge] = String(boundaryEdge);
      edgeOpposite[boundaryEdge] = String(faceEdge);
      edgeNext[faceEdge] = String(((i + 1) % n) * 2);
      edgeNext[boundaryEdge] = String(((i - 1 + n) % n) * 2 + 1);
      edgeFace[faceEdge] = '0';
      edgeFace[boundaryEdge] = '-1';
      edgeData[faceEdge] = edgeData[boundaryEdge] = String(i);
      edgeVertexData[faceEdge] = String(faceEdge);
      edgeVertexData[boundaryEdge] = String(boundaryEdge);
      if (vertexEdge[a] === '-1') vertexEdge[a] = String(faceEdge);
    }

    setField(meshData, 'vertexEdgeIndices', 'int_array', vertexEdge);
    setField(meshData, 'edgeVertexIndices', 'int_array', edgeVertex);
    setField(meshData, 'edgeOppositeIndices', 'int_array', edgeOpposite);
    setField(meshData, 'edgeNextIndices', 'int_array', edgeNext);
    setField(meshData, 'edgeFaceIndices', 'int_array', edgeFace);
    setField(meshData, 'edgeDataIndices', 'int_array', edgeData);
    setField(meshData, 'edgeVertexDataIndices', 'int_array', edgeVertexData);
    setField(meshData, 'faceEdgeIndices', 'int_array', ['0']);

    const edgeDataArray = element(meshData, 'edgeData');
    if (edgeDataArray) {
      setField(edgeDataArray, 'size', 'int', String(n));
      for (const stream of array(edgeDataArray, 'streams')) {
        const data = field(stream, 'data');
        if (data && Array.isArray(data.value)) data.value = Array(n).fill('0');
      }
    }
    duplicateFaceVertexStreams(element(meshData, 'faceVertexData'), face);

    setField(meshElement, 'physicsType', 'string', 'none');
    setField(meshElement, 'disableShadows', 'int', '1');
    setField(meshElement, 'bakelighting', 'bool', '0');
    setField(meshElement, 'renderwithdynamic', 'bool', '1');
    return true;
  }

  function patchAllDecals(doc, objects = state()?.objects || []) {
    if (!doc) return doc;
    const byDmx = new Map((objects || []).filter(object => object?.dmxId).map(object => [String(object.dmxId), object]));
    const visit = owner => {
      if (!owner?.kind) return;
      if (owner.className === 'CMapMesh' && decalMarker(owner)) {
        const id = String(field(owner, 'id')?.value || '');
        patchDecalMesh(owner, byDmx.get(id) || null);
      }
      for (const item of owner.fields || []) {
        if (Array.isArray(item.value)) item.value.forEach(child => child?.kind && visit(child));
        else if (item.value?.kind) visit(item.value);
      }
    };
    for (const top of doc.elements || []) visit(top);
    return doc;
  }

  function installDecals() {
    if (!VMAP) return false;

    if (VMAP.applyObjectToDocument && !VMAP.applyObjectToDocument.__ephHammerParityV45) {
      const previous = VMAP.applyObjectToDocument;
      const wrapped = function(doc, object, ...rest) {
        const result = previous.call(this, doc, object, ...rest);
        if (object?.dmxId && isDecalObject(object)) {
          const mesh = VMAP.findElementByDmxId?.(doc, object.dmxId);
          patchDecalMesh(mesh, object);
        }
        return result;
      };
      wrapped.__ephHammerParityV45 = true;
      wrapped.__ephPrevious = previous;
      VMAP.applyObjectToDocument = wrapped;
      wrappedApply = wrapped;
    }

    if (VMAP.extractObjects && !VMAP.extractObjects.__ephHammerParityV45) {
      const previous = VMAP.extractObjects;
      const wrapped = function(doc, ...rest) {
        const objects = previous.call(this, doc, ...rest);
        for (const object of objects || []) {
          if (!object?.dmxId) continue;
          const mesh = VMAP.findElementByDmxId?.(doc, object.dmxId);
          if (!decalMarker(mesh)) continue;
          object.type = 'decal';
          object.collision = false;
          object.blockPlayers = false;
          object.blockGrenades = false;
          object.blockBullets = false;
          if (!/^Decal_/i.test(String(object.name || ''))) object.name = `Decal_${String(object.dmxId).slice(0, 6)}`;
        }
        return objects;
      };
      wrapped.__ephHammerParityV45 = true;
      wrapped.__ephPrevious = previous;
      VMAP.extractObjects = wrapped;
      wrappedExtract = wrapped;
    }

    if (VMAP.prepareForSave && !VMAP.prepareForSave.__ephHammerParityV45) {
      const previous = VMAP.prepareForSave;
      const wrapped = function(doc, objects, ...rest) {
        return patchAllDecals(previous.call(this, doc, objects, ...rest), objects);
      };
      wrapped.__ephHammerParityV45 = true;
      wrapped.__ephPrevious = previous;
      VMAP.prepareForSave = wrapped;
      wrappedPrepare = wrapped;
    }
    return true;
  }

  function install() {
    const viewport = window.EPH3D || state()?.viewport;
    installMaterialRetry(viewport);
    installEntityFacing(viewport);
    installDecals();
    rebuildEntityVisualsWhenAssetsReady();
  }

  install();
  window.addEventListener('eph3d-ready', install);
  window.addEventListener('eph-fgd-catalog-ready', install);
  window.addEventListener('eph-runtime-ready', install, { once: true });

  let checks = 0;
  const guard = setInterval(() => {
    checks++;
    const viewport = window.EPH3D || state()?.viewport;
    if (viewport?.loadMaterialTexture && viewport.loadMaterialTexture !== wrappedMaterialLoader) installMaterialRetry(viewport);
    if (viewport?.createEntityMarker && viewport.createEntityMarker !== wrappedMarker) installEntityFacing(viewport);
    if (VMAP?.applyObjectToDocument && VMAP.applyObjectToDocument !== wrappedApply) installDecals();
    rebuildEntityVisualsWhenAssetsReady();
    if (checks >= 80) clearInterval(guard);
  }, 250);

  window.EPH_HAMMER_PARITY_V45 = {
    install,
    patchAllDecals,
    correctModelFacing,
  };

  report('normal', 'Automatic Hammer parity fixes installed for FGD models, icon/material retries, and open decal topology.');
})();
