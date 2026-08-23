// byanca
(() => {
  'use strict';

  const VMAP = window.EPH_VMAP;
  if (!VMAP || VMAP.__ephVmapFinalizeV10) return;
  VMAP.__ephVmapFinalizeV10 = true;

  const TILE_WORLD_UNITS = 16;
  const RESOURCE_RE = /(?:^|[\\/])[^\s"']+\.(?:vmat|vmdl|vpcf|vsnd|vtex|vmap)$/i;
  const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
  const get = (element, key, fallback = null) => field(element, key)?.value ?? fallback;
  const set = (element, key, type, value) => {
    if (!element?.fields) return null;
    let item = field(element, key);
    if (!item) {
      item = { key, type, value };
      element.fields.push(item);
    } else {
      if (type) item.type = type;
      item.value = value;
    }
    return item;
  };
  const elem = (element, key) => get(element, key)?.kind === 'element' ? get(element, key) : null;
  const ary = (element, key) => Array.isArray(get(element, key)) ? get(element, key) : [];
  const stream = (dataArray, name) => ary(dataArray, 'streams').find(item => item?.kind === 'element' && get(item, 'name') === name) || null;
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const numbers = (value, length, fallback = 0) => {
    const source = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/);
    return Array.from({ length }, (_, index) => Number.isFinite(Number(source[index])) ? Number(source[index]) : fallback);
  };
  const vectorString = values => values.map(value => {
    const number = Number(value) || 0;
    return Math.abs(number) < 1e-9 ? '0' : Number.isInteger(number) ? String(number) : String(Number(number.toFixed(8)));
  }).join(' ');
  const dot3 = (a, b) => (Number(a?.[0]) || 0) * (Number(b?.[0]) || 0)
    + (Number(a?.[1]) || 0) * (Number(b?.[1]) || 0)
    + (Number(a?.[2]) || 0) * (Number(b?.[2]) || 0);

  function walk(element, callback) {
    if (!element?.kind) return;
    callback(element);
    for (const item of element.fields || []) {
      if (Array.isArray(item.value)) item.value.forEach(value => value?.kind && walk(value, callback));
      else if (item.value?.kind) walk(item.value, callback);
    }
  }

  function everyElement(doc, callback) {
    for (const top of doc?.elements || []) walk(top, callback);
  }

  function ensureMissing(element, key, type, value) {
    if (!field(element, key)) set(element, key, type, value);
  }

  function completeMeshNode(element) {
    if (element?.className !== 'CMapMesh') return;
    ensureMissing(element, 'lightGroup', 'string', '');
    ensureMissing(element, 'precomputelightprobes', 'bool', '1');
    ensureMissing(element, 'useAsOccluder', 'bool', '0');
    ensureMissing(element, 'cubeMapName', 'string', '');
    ensureMissing(element, 'visexclude', 'bool', '0');
    ensureMissing(element, 'renderwithdynamic', 'bool', '0');
    ensureMissing(element, 'disableHeightDisplacement', 'bool', '0');
    ensureMissing(element, 'fademindist', 'float', '-1');
    ensureMissing(element, 'fademaxdist', 'float', '0');
    ensureMissing(element, 'bakelighting', 'bool', '1');
    ensureMissing(element, 'renderToCubemaps', 'bool', '1');
    ensureMissing(element, 'disableShadows', 'int', '0');
    ensureMissing(element, 'smoothingAngle', 'float', '40');
    ensureMissing(element, 'tintColor', 'color', '255 255 255 255');
    ensureMissing(element, 'renderAmt', 'int', '255');
    ensureMissing(element, 'physicsType', 'string', 'default');
    ensureMissing(element, 'physicsCollisionProperty', 'string', '');
    ensureMissing(element, 'physicsGroup', 'string', '');
    ensureMissing(element, 'physicsInteractsAs', 'string', '');
    ensureMissing(element, 'physicsInteractsWith', 'string', '');
    ensureMissing(element, 'physicsInteractsExclude', 'string', '');
    ensureMissing(element, 'physicsSimplificationOverride', 'bool', '0');
    ensureMissing(element, 'physicsSimplificationError', 'float', '0');
    ensureMissing(element, 'transformLocked', 'bool', '0');
    ensureMissing(element, 'force_hidden', 'bool', '0');
    ensureMissing(element, 'editorOnly', 'bool', '0');
    ensureMissing(element, 'customVisGroup', 'string', '');
  }

  function normalizeSubdivision(meshData) {
    if (!meshData) return { changed: false, unsafe: false };
    const edgeCount = ary(meshData, 'edgeVertexIndices').length;
    let subdivision = elem(meshData, 'subdivisionData');
    if (!subdivision) {
      subdivision = {
        kind: 'element',
        className: 'CDmePolygonMeshSubdivisionData',
        fields: [
          { key: 'id', type: 'elementid', value: globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000000' },
          { key: 'subdivisionLevels', type: 'int_array', value: Array(edgeCount).fill('0') },
          { key: 'streams', type: 'element_array', value: [] }
        ]
      };
      set(meshData, 'subdivisionData', 'CDmePolygonMeshSubdivisionData', subdivision);
      return { changed: true, unsafe: false };
    }

    let levelsField = field(subdivision, 'subdivisionLevels');
    if (!levelsField) levelsField = set(subdivision, 'subdivisionLevels', 'int_array', []);
    if (!Array.isArray(levelsField.value)) levelsField.value = [];
    if (levelsField.value.length === edgeCount) return { changed: false, unsafe: false };

    const hasNonZero = levelsField.value.some(value => num(value) !== 0);
    const hasStreams = ary(subdivision, 'streams').length > 0;
    if (hasNonZero || hasStreams) return { changed: false, unsafe: true };
    levelsField.value = Array(edgeCount).fill('0');
    return { changed: true, unsafe: false };
  }

  function meshLoops(meshData) {
    const starts = ary(meshData, 'faceEdgeIndices').map(value => num(value, -1));
    const next = ary(meshData, 'edgeNextIndices').map(value => num(value, -1));
    const edgeVertex = ary(meshData, 'edgeVertexIndices').map(value => num(value, -1));
    const edgeVertexData = ary(meshData, 'edgeVertexDataIndices').map(value => num(value, -1));
    return starts.map(start => {
      const vertices = [];
      const dataIndices = [];
      const seen = new Set();
      let edge = start;
      while (edge >= 0 && edge < next.length && !seen.has(edge)) {
        seen.add(edge);
        vertices.push(edgeVertex[edge]);
        dataIndices.push(edgeVertexData[edge]);
        edge = next[edge];
        if (edge === start) break;
      }
      return { vertices, dataIndices };
    });
  }

  function setStreamRow(dataArray, name, row, value) {
    const target = stream(dataArray, name);
    const dataField = target && field(target, 'data');
    if (!dataField || !Array.isArray(dataField.value) || row < 0) return false;
    while (dataField.value.length <= row) dataField.value.push('0');
    dataField.value[row] = Array.isArray(value) ? vectorString(value) : String(value);
    const sizeField = field(dataArray, 'size');
    if (sizeField && num(sizeField.value) < dataField.value.length) sizeField.value = String(dataField.value.length);
    return true;
  }

  function isGeneratedPart(object) {
    return object?.type === 'part' && (object.ephProjectionMode === 'tile16' || /^Part_\d+$/i.test(String(object.name || '')));
  }

  function textureScale(width, height, repeatWorldUnits = TILE_WORLD_UNITS) {
    return [
      Math.max(1e-8, Number(repeatWorldUnits) || TILE_WORLD_UNITS) / Math.max(1, Number(width) || 512),
      Math.max(1e-8, Number(repeatWorldUnits) || TILE_WORLD_UNITS) / Math.max(1, Number(height) || 512)
    ];
  }

  function harmonizeGeneratedProjection(doc, object) {
    if (!isGeneratedPart(object) || !object?.dmxId || !object.faces?.length) return false;
    const element = VMAP.findElementByDmxId?.(doc, object.dmxId);
    const meshData = elem(element, 'meshData');
    if (!meshData) return false;
    const loops = meshLoops(meshData);
    const faceData = elem(meshData, 'faceData');
    const faceVertexData = elem(meshData, 'faceVertexData');
    const faceRows = ary(meshData, 'faceDataIndices').map(value => num(value, -1));

    object.ephProjectionMode = 'tile16';
    object.faceUVs ??= [];
    object.faceTextureScale ??= [];
    object.faceTextureAxisU ??= [];
    object.faceTextureAxisV ??= [];
    object.faceTextureSizes ??= [];

    for (let faceIndex = 0; faceIndex < object.faces.length; faceIndex++) {
      const face = object.faces[faceIndex];
      const loop = loops[faceIndex];
      if (!face?.length || !loop) continue;
      const size = numbers(object.faceTextureSizes[faceIndex] || [512, 512], 2, 512);
      const width = Math.max(1, size[0]);
      const height = Math.max(1, size[1]);
      const axes = VMAP.defaultTextureAxes?.(object.vertices, face) || { u: [1, 0, 0, 0], v: [0, -1, 0, 0] };
      const axisU = numbers(object.faceTextureAxisU[faceIndex] || axes.u, 4, 0);
      const axisV = numbers(object.faceTextureAxisV[faceIndex] || axes.v, 4, 0);
      const scale = textureScale(width, height);
      const shiftU = Number(axisU[3]) || 0;
      const shiftV = Number(axisV[3]) || 0;
      const uvs = face.map(vertexIndex => {
        const point = object.vertices?.[vertexIndex] || [0, 0, 0];
        return [
          (dot3(point, axisU) / scale[0] + shiftU) / width,
          (dot3(point, axisV) / scale[1] + shiftV) / height
        ];
      });

      object.faceTextureScale[faceIndex] = scale;
      object.faceTextureAxisU[faceIndex] = axisU;
      object.faceTextureAxisV[faceIndex] = axisV;
      object.faceTextureSizes[faceIndex] = [width, height];
      object.faceUVs[faceIndex] = uvs;

      const faceRow = faceRows[faceIndex] >= 0 ? faceRows[faceIndex] : faceIndex;
      setStreamRow(faceData, 'textureScale:0', faceRow, scale);
      setStreamRow(faceData, 'textureAxisU:0', faceRow, axisU);
      setStreamRow(faceData, 'textureAxisV:0', faceRow, axisV);
      loop.dataIndices.forEach((row, corner) => setStreamRow(faceVertexData, 'texcoord:0', row, uvs[corner] || [0, 0]));
    }
    return true;
  }

  function normalizeResource(value) {
    return String(value || '').trim().replace(/\\/g, '/');
  }

  function syncAssetReferences(doc, objects = []) {
    let prefix = doc?.elements?.find(element => element.className === '$prefix_element$');
    if (!prefix) return;
    let refs = field(prefix, 'map_asset_references');
    if (!refs) refs = set(prefix, 'map_asset_references', 'string_array', []);
    if (!Array.isArray(refs.value)) refs.value = [];
    const assets = new Set(refs.value.map(normalizeResource).filter(Boolean));

    everyElement(doc, element => {
      if (element.className === 'CMapMesh') {
        const meshData = elem(element, 'meshData');
        for (const material of ary(meshData, 'materials')) {
          const value = normalizeResource(material);
          if (value && value !== 'ERROR') assets.add(value);
        }
      }
      if (element.className === 'CMapEntity' || element.className === 'CMapWorld') {
        const props = elem(element, 'entity_properties');
        for (const item of props?.fields || []) {
          if (Array.isArray(item.value) || item.value?.kind) continue;
          const value = normalizeResource(item.value);
          if (RESOURCE_RE.test(value)) assets.add(value);
        }
      }
      for (const item of element.fields || []) {
        if (Array.isArray(item.value) || item.value?.kind) continue;
        const value = normalizeResource(item.value);
        if (RESOURCE_RE.test(value)) assets.add(value);
      }
    });

    for (const object of objects || []) {
      for (const material of object.faceMaterials || []) {
        const value = normalizeResource(material);
        if (value && value !== 'ERROR') assets.add(value);
      }
      const model = normalizeResource(object.model);
      if (model) assets.add(model);
      if (object.blockPlayers && VMAP.TOOL_MATERIALS?.players) assets.add(normalizeResource(VMAP.TOOL_MATERIALS.players));
      if (object.blockGrenades && VMAP.TOOL_MATERIALS?.grenades) assets.add(normalizeResource(VMAP.TOOL_MATERIALS.grenades));
      if (object.blockBullets && VMAP.TOOL_MATERIALS?.bullets) assets.add(normalizeResource(VMAP.TOOL_MATERIALS.bullets));
    }

    refs.value = [...assets].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  function finalizeDocument(doc, objects = []) {
    const unsafe = [];
    everyElement(doc, element => {
      if (element.className !== 'CMapMesh') return;
      completeMeshNode(element);
      const meshData = elem(element, 'meshData');
      const subdivision = normalizeSubdivision(meshData);
      if (subdivision.unsafe) unsafe.push(`CMapMesh ${get(element, 'nodeID', get(element, 'id', '?'))} has mismatched non-zero subdivision data.`);
    });
    for (const object of objects || []) harmonizeGeneratedProjection(doc, object);
    syncAssetReferences(doc, objects);
    if (unsafe.length) throw new Error(`VMAP preservation check failed: ${unsafe.join(' ')}`);
    return doc;
  }

  const previousValidate = VMAP.validate.bind(VMAP);
  VMAP.validate = function(doc) {
    const result = previousValidate(doc);
    const errors = [...(result.errors || [])];
    const warnings = [...(result.warnings || [])];
    everyElement(doc, element => {
      if (element.className !== 'CMapMesh') return;
      const meshData = elem(element, 'meshData');
      if (!meshData) return;
      const edgeCount = ary(meshData, 'edgeVertexIndices').length;
      const subdivision = elem(meshData, 'subdivisionData');
      if (!subdivision) return;
      const levels = ary(subdivision, 'subdivisionLevels');
      if (levels.length !== edgeCount) errors.push(`CMapMesh ${get(element, 'nodeID', '?')}: subdivisionLevels has ${levels.length} rows but half-edge count is ${edgeCount}.`);
    });
    return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  };

  const previousApply = VMAP.applyObjectToDocument.bind(VMAP);
  VMAP.applyObjectToDocument = function(doc, object) {
    const result = previousApply(doc, object);
    if (!result) return result;
    const element = object?.dmxId ? VMAP.findElementByDmxId?.(doc, object.dmxId) : null;
    if (element?.className === 'CMapMesh') {
      completeMeshNode(element);
      const subdivision = normalizeSubdivision(elem(element, 'meshData'));
      if (subdivision.unsafe) {
        object.vmapCompatibilityError = 'This mesh has non-zero Hammer subdivision data whose size no longer matches its half-edge topology.';
        return false;
      }
      harmonizeGeneratedProjection(doc, object);
    }
    return true;
  };

  const previousAddPart = VMAP.addPart.bind(VMAP);
  VMAP.addPart = function(doc, options = {}) {
    const object = previousAddPart(doc, options);
    const element = object?.dmxId ? VMAP.findElementByDmxId?.(doc, object.dmxId) : null;
    if (element?.className === 'CMapMesh') {
      completeMeshNode(element);
      normalizeSubdivision(elem(element, 'meshData'));
    }
    return object;
  };

  const previousDuplicate = VMAP.duplicateObject.bind(VMAP);
  VMAP.duplicateObject = function(doc, object) {
    const copy = previousDuplicate(doc, object);
    const element = copy?.dmxId ? VMAP.findElementByDmxId?.(doc, copy.dmxId) : null;
    if (element?.className === 'CMapMesh') {
      completeMeshNode(element);
      normalizeSubdivision(elem(element, 'meshData'));
    }
    return copy;
  };

  const previousSyncHelpers = VMAP.syncCollisionHelpers.bind(VMAP);
  VMAP.syncCollisionHelpers = function(doc, objects) {
    const result = previousSyncHelpers(doc, objects);
    everyElement(doc, element => {
      if (element.className !== 'CMapMesh') return;
      const meshName = String(get(elem(element, 'meshData'), 'name', ''));
      if (!meshName.startsWith(VMAP.HELPER_PREFIX)) return;
      completeMeshNode(element);
      normalizeSubdivision(elem(element, 'meshData'));
    });
    syncAssetReferences(doc, objects);
    return result;
  };

  const previousPrepare = VMAP.prepareForSave.bind(VMAP);
  VMAP.prepareForSave = function(doc, objects) {
    const output = previousPrepare(doc, objects);
    finalizeDocument(output, objects);
    const validation = VMAP.validate(output);
    if (!validation.ok) throw new Error(`Final VMAP validation failed: ${validation.errors.join(' ')}`);
    return output;
  };

  VMAP.updateAssetReferences = syncAssetReferences;
  VMAP.finalizeDocument = finalizeDocument;
  VMAP.textureScaleForRepeat = textureScale;
  VMAP.validateText = function(text) {
    try {
      const parsed = VMAP.parse(String(text || ''));
      return VMAP.validate(parsed);
    } catch (error) {
      return { ok: false, errors: [error?.message || String(error)], warnings: [] };
    }
  };

  const previousSelfTest = typeof VMAP.selfTest === 'function' ? VMAP.selfTest.bind(VMAP) : null;
  VMAP.selfTest = function() {
    const failures = [];
    const base = previousSelfTest?.();
    if (base && !base.ok) failures.push(...(base.failures || ['base VMAP self-test failed']));
    try {
      const doc = VMAP.createEmptyDocument();
      const object = VMAP.addPart(doc, {
        size: [256, 192, 96],
        material: 'materials/dev/dev_measuregeneric01b.vmat',
        collision: true
      });
      object.name = 'Part_001';
      object.ephProjectionMode = 'tile16';
      object.faceTextureSizes = object.faces.map(() => [512, 512]);
      object.blockGrenades = true;
      const prepared = VMAP.prepareForSave(doc, [object]);
      const check = VMAP.validate(prepared);
      if (!check.ok) failures.push(`finalized: ${check.errors.join(' ')}`);
      everyElement(prepared, element => {
        if (element.className !== 'CMapMesh') return;
        const meshData = elem(element, 'meshData');
        const edgeCount = ary(meshData, 'edgeVertexIndices').length;
        const levels = ary(elem(meshData, 'subdivisionData'), 'subdivisionLevels');
        if (levels.length !== edgeCount) failures.push(`subdivision rows ${levels.length} != half-edge count ${edgeCount}`);
        for (const key of ['lightGroup', 'precomputelightprobes', 'useAsOccluder']) if (!field(element, key)) failures.push(`mesh default ${key} missing`);
      });
      const prefix = prepared.elements.find(element => element.className === '$prefix_element$');
      const refs = ary(prefix, 'map_asset_references');
      if (!refs.includes('materials/dev/dev_measuregeneric01b.vmat')) failures.push('primary material missing from map_asset_references');
      if (VMAP.TOOL_MATERIALS?.grenades && !refs.includes(VMAP.TOOL_MATERIALS.grenades)) failures.push('grenade helper material missing from map_asset_references');
      const scale = textureScale(512, 512);
      if (Math.abs(scale[0] - 0.03125) > 1e-10 || Math.abs(scale[1] - 0.03125) > 1e-10) failures.push('16-HU texture scale math is incorrect for 512px texture');
      const text = VMAP.stringify(prepared);
      const textCheck = VMAP.validateText(text);
      if (!textCheck.ok) failures.push(`serialized: ${textCheck.errors.join(' ')}`);
    } catch (error) {
      failures.push(error?.message || String(error));
    }
    return { ok: failures.length === 0, failures };
  };
})();
