// byanca
(() => {
  'use strict';
  if (window.__ephVmapImportFidelityV27) return;
  window.__ephVmapImportFidelityV27 = true;

  const VMAP = window.EPH_VMAP;
  if (!VMAP?.extractObjects || !VMAP?.findElementByDmxId) return;

  const FACE_NAMES = VMAP.FACE_NAMES || ['right', 'left', 'front', 'back', 'top', 'bottom'];
  const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
  const get = (element, key, fallback = null) => field(element, key)?.value ?? fallback;
  const elementValue = (element, key) => {
    const value = get(element, key);
    return value?.kind === 'element' ? value : null;
  };
  const arrayValue = (element, key) => {
    const value = get(element, key);
    return Array.isArray(value) ? value : [];
  };
  const stream = (dataArray, name) => arrayValue(dataArray, 'streams').find(item => item?.kind === 'element' && String(get(item, 'name', '')) === name) || null;
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const vector = (value, length, fallback = 0) => {
    const source = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/);
    return Array.from({ length }, (_, index) => Number.isFinite(Number(source[index])) ? Number(source[index]) : fallback);
  };

  function meshFaceLoops(meshData) {
    const starts = arrayValue(meshData, 'faceEdgeIndices').map(value => number(value, -1));
    const next = arrayValue(meshData, 'edgeNextIndices').map(value => number(value, -1));
    const edgeVertex = arrayValue(meshData, 'edgeVertexIndices').map(value => number(value, -1));
    const edgeVertexData = arrayValue(meshData, 'edgeVertexDataIndices').map(value => number(value, -1));
    const loops = [];
    for (const start of starts) {
      const vertices = [];
      const dataRows = [];
      const seen = new Set();
      let edge = start;
      while (edge >= 0 && edge < next.length && !seen.has(edge)) {
        seen.add(edge);
        if (edgeVertex[edge] >= 0) {
          vertices.push(edgeVertex[edge]);
          dataRows.push(edgeVertexData[edge]);
        }
        edge = next[edge];
        if (edge === start) break;
      }
      loops.push({ vertices, dataRows });
    }
    return loops;
  }

  function enrichPart(doc, object) {
    if (!object?.dmxId || object.type !== 'part') return;
    const element = VMAP.findElementByDmxId(doc, object.dmxId);
    if (element?.className !== 'CMapMesh') return;
    const meshData = elementValue(element, 'meshData');
    if (!meshData) return;

    const loops = meshFaceLoops(meshData);
    if (!loops.length) return;

    // Source 2 faces address faceData through faceDataIndices. Imported maps do
    // not guarantee that face i == faceData row i.
    const faceRows = arrayValue(meshData, 'faceDataIndices').map(value => number(value, -1));
    const materialList = arrayValue(meshData, 'materials').map(String);
    const faceData = elementValue(meshData, 'faceData');
    const materialIndices = arrayValue(stream(faceData, 'materialindex:0'), 'data').map(value => number(value, 0));
    const textureScaleRows = arrayValue(stream(faceData, 'textureScale:0'), 'data');
    const textureAxisURows = arrayValue(stream(faceData, 'textureAxisU:0'), 'data');
    const textureAxisVRows = arrayValue(stream(faceData, 'textureAxisV:0'), 'data');

    const correctedMaterials = [];
    const textureScales = [];
    const textureAxesU = [];
    const textureAxesV = [];
    for (let faceIndex = 0; faceIndex < loops.length; faceIndex++) {
      const row = faceRows[faceIndex] >= 0 ? faceRows[faceIndex] : faceIndex;
      const materialIndex = materialIndices[row];
      correctedMaterials[faceIndex] = materialList[materialIndex] || materialList[0] || object.faceMaterials?.[faceIndex] || 'ERROR';
      if (textureScaleRows[row] !== undefined) textureScales[faceIndex] = vector(textureScaleRows[row], 2, 0.25);
      if (textureAxisURows[row] !== undefined) textureAxesU[faceIndex] = vector(textureAxisURows[row], 4, 0);
      if (textureAxisVRows[row] !== undefined) textureAxesV[faceIndex] = vector(textureAxisVRows[row], 4, 0);
    }
    if (correctedMaterials.length) {
      object.faceMaterials = correctedMaterials;
      object.materials ||= {};
      FACE_NAMES.forEach((name, index) => {
        object.materials[name] = correctedMaterials[index] || correctedMaterials[0] || 'ERROR';
      });
    }
    if (textureScales.some(Boolean)) object.faceTextureScale = textureScales;
    if (textureAxesU.some(Boolean)) object.faceTextureAxisU = textureAxesU;
    if (textureAxesV.some(Boolean)) object.faceTextureAxisV = textureAxesV;

    // Preserve Hammer's real face-corner UV stream. The old renderer threw this
    // away and generated a planar 1/128 projection, which is visibly wrong on
    // decompiled Valve maps such as Anubis.
    const faceVertexData = elementValue(meshData, 'faceVertexData');
    const texcoords = arrayValue(stream(faceVertexData, 'texcoord:0'), 'data');
    if (texcoords.length) {
      const faceUVs = loops.map(loop => loop.dataRows.map(row => row >= 0 && texcoords[row] !== undefined ? vector(texcoords[row], 2, 0) : null));
      if (faceUVs.some(face => face.length >= 3 && face.every(Boolean))) {
        object.faceUVs = faceUVs;
        object.ephSourceFaceUVs = true;
      }
    }
    object.ephSourceFaceData = true;
  }

  const rawExtract = VMAP.extractObjects.bind(VMAP);
  const wrappedExtract = function(doc, ...args) {
    const objects = rawExtract(doc, ...args);
    for (const object of objects || []) {
      try { enrichPart(doc, object); }
      catch (error) { console.warn('[Import Fidelity V27] Could not enrich imported CMapMesh.', object?.dmxId, error); }
    }
    return objects;
  };
  wrappedExtract.__ephImportFidelityV27 = true;
  wrappedExtract.__ephPrevious = rawExtract;
  VMAP.extractObjects = wrappedExtract;

  window.EPH_IMPORT_FIDELITY_V27 = { enrichPart };
  console.info('[Import Fidelity V27] Source 2 faceDataIndices, materials and texcoord:0 UVs are preserved.');
})();
