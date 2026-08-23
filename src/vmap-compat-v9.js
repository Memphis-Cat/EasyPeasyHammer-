// byanca
(() => {
  'use strict';

  const VMAP = window.EPH_VMAP;
  if (!VMAP || VMAP.__ephHammerVmapCompatV9) return;
  VMAP.__ephHammerVmapCompatV9 = true;

  const DEFAULT_SCALE = 0.125;
  const DEFAULT_PROJECTED_TEXTURE_SIZE = 1024;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STANDARD_MESH_FIELDS = new Set([
    'id', 'name', 'vertexEdgeIndices', 'vertexDataIndices', 'edgeVertexIndices', 'edgeOppositeIndices',
    'edgeNextIndices', 'edgeFaceIndices', 'edgeDataIndices', 'edgeVertexDataIndices', 'faceEdgeIndices',
    'faceDataIndices', 'materials', 'vertexData', 'faceVertexData', 'edgeData', 'faceData', 'subdivisionData'
  ]);
  const STANDARD_VERTEX_STREAMS = new Set(['position:0']);
  const STANDARD_FACE_VERTEX_STREAMS = new Set(['texcoord:0', 'normal:0', 'tangent:0']);
  const STANDARD_EDGE_STREAMS = new Set(['flags:0']);
  const STANDARD_FACE_STREAMS = new Set([
    'textureScale:0', 'textureAxisU:0', 'textureAxisV:0', 'materialindex:0', 'flags:0', 'lightmapScaleBias:0'
  ]);

  const clone = value => structuredClone(value);
  const uid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16 | 0) & (c === 'x' ? 15 : 3) | (c === 'y' ? 8 : 0)).toString(16));
  const ref64 = () => `0x${Array.from({ length: 16 }, () => Math.random() * 16 | 0).map(x => x.toString(16)).join('')}`;
  const randomSeed = () => String(Math.floor(Math.random() * 2147483647));
  const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const vec = (value, length = 3, fallback = 0) => {
    const values = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/);
    return Array.from({ length }, (_, index) => num(values[index], fallback));
  };
  const vectorString = values => values.map(value => {
    const number = Number(value) || 0;
    return Math.abs(number) < 1e-9 ? '0' : Number.isInteger(number) ? String(number) : String(Number(number.toFixed(6)));
  }).join(' ');
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
  const elem = (element, key) => {
    const value = get(element, key);
    return value?.kind === 'element' ? value : null;
  };
  const ary = (element, key) => Array.isArray(get(element, key)) ? get(element, key) : [];
  const stream = (dataArray, name) => ary(dataArray, 'streams').find(item => item?.kind === 'element' && get(item, 'name') === name) || null;

  function walkInline(element, callback) {
    if (!element?.kind) return;
    callback(element);
    for (const item of element.fields || []) {
      if (Array.isArray(item.value)) item.value.forEach(value => value?.kind && walkInline(value, callback));
      else if (item.value?.kind) walkInline(item.value, callback);
    }
  }

  function elementIndex(doc) {
    const index = new Map();
    for (const top of doc?.elements || []) {
      walkInline(top, element => {
        const id = String(get(element, 'id', ''));
        if (id) index.set(id, element);
      });
    }
    return index;
  }

  function resolveElement(doc, value, index = null) {
    if (value?.kind === 'element') return value;
    if (typeof value !== 'string' || !value) return null;
    return (index || elementIndex(doc)).get(value) || null;
  }

  function rootElement(doc) {
    return doc?.elements?.find(element => element.className === 'CMapRootElement') || null;
  }

  function getWorld(doc) {
    const root = rootElement(doc);
    return root ? resolveElement(doc, get(root, 'world')) : null;
  }

  function getChildren(doc, owner = null) {
    const parent = owner || getWorld(doc);
    if (!parent) return [];
    let childrenField = field(parent, 'children');
    if (!childrenField) {
      childrenField = { key: 'children', type: 'element_array', value: [] };
      parent.fields.push(childrenField);
    }
    if (!Array.isArray(childrenField.value)) childrenField.value = [];
    return childrenField.value;
  }

  function maxNode(doc) {
    let maximum = 1;
    for (const top of doc?.elements || []) {
      walkInline(top, element => {
        const value = Number(get(element, 'nodeID'));
        if (Number.isInteger(value)) maximum = Math.max(maximum, value);
      });
    }
    return maximum;
  }

  function geometryBounds(vertices) {
    if (!vertices?.length) return { min: [-32, -32, -32], max: [32, 32, 32], center: [0, 0, 0], size: [64, 64, 64] };
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const vertex of vertices) {
      for (let axis = 0; axis < 3; axis++) {
        const value = num(vertex?.[axis]);
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
    return {
      min,
      max,
      center: min.map((value, axis) => (value + max[axis]) / 2),
      size: min.map((value, axis) => Math.max(0.001, max[axis] - value))
    };
  }

  const subtract = (a, b) => a.map((value, index) => value - b[index]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const normalize = vector => {
    const length = Math.hypot(...vector) || 1;
    return vector.map(value => value / length);
  };

  function faceNormal(vertices, face) {
    if (!face || face.length < 3) return [0, 0, 1];
    for (let index = 1; index + 1 < face.length; index++) {
      const normal = cross(subtract(vertices[face[index]], vertices[face[0]]), subtract(vertices[face[index + 1]], vertices[face[0]]));
      if (Math.hypot(...normal) > 1e-8) return normalize(normal);
    }
    return [0, 0, 1];
  }

  const FACE_NORMALS = [[0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]];
  const FACE_RIGHT = [[1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 1, 0]];
  const FACE_DOWN = [[0, -1, 0], [0, -1, 0], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1]];

  function defaultAxes(vertices, face) {
    const normal = faceNormal(vertices, face);
    let orientation = 0;
    let best = -Infinity;
    for (let index = 0; index < FACE_NORMALS.length; index++) {
      const score = dot(normal, FACE_NORMALS[index]);
      if (score >= best) {
        best = score;
        orientation = index;
      }
    }
    return { u: [...FACE_RIGHT[orientation], 0], v: [...FACE_DOWN[orientation], 0] };
  }

  function meshFaces(meshData) {
    const starts = ary(meshData, 'faceEdgeIndices').map(value => num(value, -1));
    const next = ary(meshData, 'edgeNextIndices').map(value => num(value, -1));
    const edgeVertex = ary(meshData, 'edgeVertexIndices').map(value => num(value, -1));
    return starts.map(start => {
      const result = [];
      const visited = new Set();
      let edge = start;
      while (edge >= 0 && edge < next.length && !visited.has(edge)) {
        visited.add(edge);
        if (edgeVertex[edge] >= 0) result.push(edgeVertex[edge]);
        edge = next[edge];
        if (edge === start) break;
      }
      return result;
    });
  }

  function streamHasNonZero(dataArray, name) {
    return ary(stream(dataArray, name), 'data').some(value => String(value).trim().split(/\s+/).some(part => Math.abs(Number(part) || 0) > 1e-9));
  }

  function meshHasAdvancedData(meshData) {
    if (!meshData) return false;
    const arrays = [
      [elem(meshData, 'vertexData'), STANDARD_VERTEX_STREAMS],
      [elem(meshData, 'faceVertexData'), STANDARD_FACE_VERTEX_STREAMS],
      [elem(meshData, 'edgeData'), STANDARD_EDGE_STREAMS],
      [elem(meshData, 'faceData'), STANDARD_FACE_STREAMS]
    ];
    for (const [dataArray, allowed] of arrays) {
      for (const item of ary(dataArray, 'streams')) {
        if (!allowed.has(String(get(item, 'name', '')))) return true;
      }
    }
    const subdivision = elem(meshData, 'subdivisionData');
    if (ary(subdivision, 'streams').length) return true;
    if (ary(subdivision, 'subdivisionLevels').some(value => num(value) !== 0)) return true;
    if (streamHasNonZero(elem(meshData, 'edgeData'), 'flags:0')) return true;
    if (streamHasNonZero(elem(meshData, 'faceData'), 'flags:0')) return true;
    if (streamHasNonZero(elem(meshData, 'faceData'), 'lightmapScaleBias:0')) return true;
    return false;
  }

  function editable(object) {
    object.position ??= [0, 0, 0];
    object.rotation ??= [0, 0, 0];
    object.scale ??= [1, 1, 1];
    object.size ??= [64, 64, 64];
    object.visible ??= true;
    object.collision ??= true;
    object.blockPlayers ??= object.collision !== false;
    object.blockGrenades ??= false;
    object.blockBullets ??= false;
    object.faceMaterials ??= object.faces?.map((_, index) => object.materials?.[VMAP.FACE_NAMES[index]] || 'ERROR') || [];
    object.materials ??= Object.fromEntries(VMAP.FACE_NAMES.map((name, index) => [name, object.faceMaterials[index] || 'ERROR']));
    return object;
  }

  function meshObject(element) {
    const meshData = elem(element, 'meshData');
    if (!meshData) return null;
    const name = String(get(meshData, 'name', ''));
    if (name.startsWith(VMAP.HELPER_PREFIX)) return null;
    const vertexData = elem(meshData, 'vertexData');
    const positionRows = ary(stream(vertexData, 'position:0'), 'data').map(value => vec(value));
    const vertexDataIndices = ary(meshData, 'vertexDataIndices').map(value => num(value, -1));
    const vertexCount = ary(meshData, 'vertexEdgeIndices').length || vertexDataIndices.length || positionRows.length;
    const vertices = Array.from({ length: vertexCount }, (_, index) => {
      const row = vertexDataIndices[index] >= 0 ? vertexDataIndices[index] : index;
      return positionRows[row] ? [...positionRows[row]] : [0, 0, 0];
    });
    const faces = meshFaces(meshData);
    const materialsList = ary(meshData, 'materials');
    const faceData = elem(meshData, 'faceData');
    const materialRows = ary(stream(faceData, 'materialindex:0'), 'data').map(value => num(value, -1));
    const faceDataIndices = ary(meshData, 'faceDataIndices').map(value => num(value, -1));
    const faceMaterials = faces.map((_, faceIndex) => {
      const row = faceDataIndices[faceIndex] >= 0 ? faceDataIndices[faceIndex] : faceIndex;
      const materialIndex = materialRows[row] ?? 0;
      return materialsList[materialIndex] || materialsList[0] || 'ERROR';
    });
    const materials = {};
    VMAP.FACE_NAMES.forEach((faceName, index) => materials[faceName] = faceMaterials[index] || faceMaterials[0] || 'ERROR');
    const id = String(get(element, 'id', uid()));
    return editable({
      id: `mesh:${id}`,
      dmxId: id,
      type: 'part',
      name: `Mesh_${get(element, 'nodeID', '')}`,
      parent: 'world',
      sourceClass: 'CMapMesh',
      position: vec(get(element, 'origin', '0 0 0')),
      rotation: vec(get(element, 'angles', '0 0 0')),
      scale: vec(get(element, 'scales', '1 1 1'), 3, 1),
      size: geometryBounds(vertices).size,
      vertices,
      faces,
      faceMaterials,
      materials,
      collision: String(get(element, 'physicsType', 'default')).toLowerCase() !== 'none',
      visible: get(element, 'force_hidden', '0') !== '1',
      sourceHasAdvancedMeshData: meshHasAdvancedData(meshData)
    });
  }

  function entityObject(element) {
    const properties = elem(element, 'entity_properties');
    if (!properties) return null;
    const className = String(get(properties, 'classname', 'info_target'));
    const model = String(get(properties, 'model', ''));
    const id = String(get(element, 'id', uid()));
    const entityProperties = Object.fromEntries((properties.fields || [])
      .filter(item => !['id', 'classname', 'targetname', 'model'].includes(item.key) && !Array.isArray(item.value) && !item.value?.kind)
      .map(item => [item.key, item.value]));
    return editable({
      id: `entity:${id}`,
      dmxId: id,
      type: className.startsWith('prop_') ? 'prop' : 'entity',
      name: String(get(properties, 'targetname', '')) || className,
      parent: 'world',
      sourceClass: 'CMapEntity',
      className,
      model,
      position: vec(get(element, 'origin', '0 0 0')),
      rotation: vec(get(element, 'angles', '0 0 0')),
      scale: vec(get(element, 'scales', '1 1 1'), 3, 1),
      visible: get(element, 'force_hidden', '0') !== '1',
      collision: String(entityProperties.solid ?? '6') !== '0',
      entityProperties
    });
  }

  function extractObjects(doc) {
    const output = [{ id: 'world', name: 'World', type: 'world', parent: null, expanded: true, sourceClass: 'CMapWorld' }];
    const helperFlags = new Map();
    const index = elementIndex(doc);
    const visited = new Set();
    const visit = (list, parentElement = getWorld(doc), depth = 0) => {
      for (const raw of list || []) {
        const element = resolveElement(doc, raw, index);
        if (!element) continue;
        const id = String(get(element, 'id', ''));
        if (id && visited.has(id)) continue;
        if (id) visited.add(id);
        const meshData = element.className === 'CMapMesh' ? elem(element, 'meshData') : null;
        const meshName = String(get(meshData, 'name', ''));
        if (meshName.startsWith(VMAP.HELPER_PREFIX)) {
          const match = meshName.match(/^EPH_HELPER_(players|grenades|bullets)_(.+)$/);
          if (match) {
            const flags = helperFlags.get(match[2]) || {};
            flags[match[1]] = true;
            helperFlags.set(match[2], flags);
          }
        } else {
          const object = element.className === 'CMapMesh' ? meshObject(element) : element.className === 'CMapEntity' ? entityObject(element) : null;
          if (object) {
            object.sourceParentDmxId = String(get(parentElement, 'id', '')) || null;
            object.sourceDepth = depth;
            output.push(object);
          }
        }
        const nested = ary(element, 'children');
        if (nested.length) visit(nested, element, depth + 1);
      }
    };
    visit(getChildren(doc));
    for (const object of output) {
      if (!object.dmxId) continue;
      const flags = helperFlags.get(object.dmxId);
      if (!flags) continue;
      if (flags.players) object.blockPlayers = true;
      if (flags.grenades) object.blockGrenades = true;
      if (flags.bullets) object.blockBullets = true;
    }
    return output;
  }

  function dataStream(name, semantic, type, data, flags = 1) {
    return {
      kind: 'element',
      className: 'CDmePolygonMeshDataStream',
      fields: [
        { key: 'id', type: 'elementid', value: uid() },
        { key: 'name', type: 'string', value: name },
        { key: 'standardAttributeName', type: 'string', value: semantic },
        { key: 'semanticName', type: 'string', value: semantic },
        { key: 'semanticIndex', type: 'int', value: String(Number(name.match(/:(\d+)$/)?.[1] || 0)) },
        { key: 'vertexBufferLocation', type: 'int', value: '0' },
        { key: 'dataStateFlags', type: 'int', value: String(flags) },
        { key: 'subdivisionBinding', type: 'element', value: '' },
        { key: 'data', type, value: data.map(String) }
      ]
    };
  }

  function dataArray(size, streams) {
    return {
      kind: 'element',
      className: 'CDmePolygonMeshDataArray',
      fields: [
        { key: 'id', type: 'elementid', value: uid() },
        { key: 'size', type: 'int', value: String(size) },
        { key: 'streams', type: 'element_array', value: streams }
      ]
    };
  }

  function buildTopology(vertices, faces) {
    const pairByKey = new Map();
    const directed = new Map();
    const edgeVertex = [];
    const opposite = [];
    const edgeData = [];
    const edgeFace = [];
    const edgeNext = [];
    const edgeVertexData = [];
    const vertexEdge = Array(vertices.length).fill(-1);
    const faceStart = [];
    const errors = [];

    const ensurePair = (a, b) => {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = `${low}:${high}`;
      if (pairByKey.has(key)) return pairByKey.get(key);
      const base = edgeVertex.length;
      const dataIndex = pairByKey.size;
      const pair = { base, low, high, dataIndex };
      pairByKey.set(key, pair);
      edgeVertex.push(high, low);
      opposite.push(base + 1, base);
      edgeData.push(dataIndex, dataIndex);
      edgeFace.push(-1, -1);
      edgeNext.push(-1, -1);
      edgeVertexData.push(base, base + 1);
      directed.set(`${low}:${high}`, base);
      directed.set(`${high}:${low}`, base + 1);
      if (vertexEdge[low] < 0) vertexEdge[low] = base;
      if (vertexEdge[high] < 0) vertexEdge[high] = base + 1;
      return pair;
    };

    faces.forEach((face, faceIndex) => {
      if (!Array.isArray(face) || face.length < 3) {
        errors.push(`Face ${faceIndex} has fewer than 3 vertices.`);
        faceStart.push(-1);
        return;
      }
      const loop = [];
      for (let corner = 0; corner < face.length; corner++) {
        const destination = Number(face[corner]);
        const origin = Number(face[(corner + face.length - 1) % face.length]);
        if (!Number.isInteger(origin) || !Number.isInteger(destination) || origin < 0 || destination < 0 || origin >= vertices.length || destination >= vertices.length || origin === destination) {
          errors.push(`Face ${faceIndex} contains invalid edge ${origin}->${destination}.`);
          continue;
        }
        ensurePair(origin, destination);
        const edge = directed.get(`${origin}:${destination}`);
        if (edgeFace[edge] !== -1) errors.push(`Edge ${origin}->${destination} is used by more than one face with the same winding.`);
        else edgeFace[edge] = faceIndex;
        loop.push(edge);
      }
      if (loop.length < 3) {
        faceStart.push(-1);
        return;
      }
      faceStart.push(loop[0]);
      loop.forEach((edge, index) => edgeNext[edge] = loop[(index + 1) % loop.length]);
    });

    const boundaryByOrigin = new Map();
    const boundary = [];
    for (let edge = 0; edge < edgeVertex.length; edge++) {
      if (edgeFace[edge] !== -1) continue;
      boundary.push(edge);
      const origin = edgeVertex[opposite[edge]];
      const list = boundaryByOrigin.get(origin) || [];
      list.push(edge);
      boundaryByOrigin.set(origin, list);
    }
    for (const edge of boundary) {
      const destination = edgeVertex[edge];
      const candidates = boundaryByOrigin.get(destination) || [];
      if (candidates.length === 1) edgeNext[edge] = candidates[0];
      else if (!candidates.length) errors.push(`Boundary edge ${edge} does not close into a boundary loop.`);
      else {
        edgeNext[edge] = candidates[0];
        errors.push(`Boundary at vertex ${destination} is non-manifold.`);
      }
    }

    return { vertexEdge, edgeVertex, opposite, edgeData, edgeFace, edgeNext, edgeVertexData, faceStart, edgeDataSize: pairByKey.size, errors };
  }

  function faceUv(vertices, face, axes) {
    return face.map(vertexIndex => {
      const position = vertices[vertexIndex] || [0, 0, 0];
      return [
        (dot(position, axes.u) / DEFAULT_SCALE + (Number(axes.u[3]) || 0)) / DEFAULT_PROJECTED_TEXTURE_SIZE,
        (dot(position, axes.v) / DEFAULT_SCALE + (Number(axes.v[3]) || 0)) / DEFAULT_PROJECTED_TEXTURE_SIZE
      ];
    });
  }

  function faceTangent(vertices, face, axes) {
    const normal = faceNormal(vertices, face);
    let tangent = normalize(axes.u.slice(0, 3));
    const projection = dot(tangent, normal);
    tangent = normalize(tangent.map((value, index) => value - normal[index] * projection));
    const v = normalize(axes.v.slice(0, 3));
    const handedness = dot(cross(tangent, v), normal) < 0 ? -1 : 1;
    return [...tangent, handedness];
  }

  function makeMeshData(vertices, faces, faceMaterials, name = 'meshData', oldId = null) {
    const topology = buildTopology(vertices, faces);
    if (topology.errors.length) throw Error(`Cannot create Hammer mesh: ${topology.errors.join(' ')}`);
    const materials = [];
    const materialIndices = faces.map((_, faceIndex) => {
      const material = faceMaterials[faceIndex] || 'ERROR';
      let index = materials.indexOf(material);
      if (index < 0) {
        index = materials.length;
        materials.push(material);
      }
      return String(index);
    });
    const halfEdgeCount = topology.edgeVertex.length;
    const texcoords = Array(halfEdgeCount).fill('0 0');
    const normals = Array(halfEdgeCount).fill('0 0 0');
    const tangents = Array(halfEdgeCount).fill('0 0 0 0');
    const scales = [];
    const axesU = [];
    const axesV = [];

    faces.forEach((face, faceIndex) => {
      const axes = defaultAxes(vertices, face);
      const uv = faceUv(vertices, face, axes);
      const normal = faceNormal(vertices, face);
      const tangent = faceTangent(vertices, face, axes);
      scales.push(`${DEFAULT_SCALE} ${DEFAULT_SCALE}`);
      axesU.push(vectorString(axes.u));
      axesV.push(vectorString(axes.v));
      let edge = topology.faceStart[faceIndex];
      for (let corner = 0; corner < face.length && edge >= 0; corner++) {
        const dataIndex = topology.edgeVertexData[edge];
        texcoords[dataIndex] = vectorString(uv[corner] || [0, 0]);
        normals[dataIndex] = vectorString(normal);
        tangents[dataIndex] = vectorString(tangent);
        edge = topology.edgeNext[edge];
      }
    });

    return {
      kind: 'element',
      className: 'CDmePolygonMesh',
      fields: [
        { key: 'id', type: 'elementid', value: oldId || uid() },
        { key: 'name', type: 'string', value: name },
        { key: 'vertexEdgeIndices', type: 'int_array', value: topology.vertexEdge.map(String) },
        { key: 'vertexDataIndices', type: 'int_array', value: vertices.map((_, index) => String(index)) },
        { key: 'edgeVertexIndices', type: 'int_array', value: topology.edgeVertex.map(String) },
        { key: 'edgeOppositeIndices', type: 'int_array', value: topology.opposite.map(String) },
        { key: 'edgeNextIndices', type: 'int_array', value: topology.edgeNext.map(String) },
        { key: 'edgeFaceIndices', type: 'int_array', value: topology.edgeFace.map(String) },
        { key: 'edgeDataIndices', type: 'int_array', value: topology.edgeData.map(String) },
        { key: 'edgeVertexDataIndices', type: 'int_array', value: topology.edgeVertexData.map(String) },
        { key: 'faceEdgeIndices', type: 'int_array', value: topology.faceStart.map(String) },
        { key: 'faceDataIndices', type: 'int_array', value: faces.map((_, index) => String(index)) },
        { key: 'materials', type: 'string_array', value: materials },
        { key: 'vertexData', type: 'CDmePolygonMeshDataArray', value: dataArray(vertices.length, [dataStream('position:0', 'position', 'vector3_array', vertices.map(vectorString), 3)]) },
        { key: 'faceVertexData', type: 'CDmePolygonMeshDataArray', value: dataArray(halfEdgeCount, [
          dataStream('texcoord:0', 'texcoord', 'vector2_array', texcoords, 1),
          dataStream('normal:0', 'normal', 'vector3_array', normals, 1),
          dataStream('tangent:0', 'tangent', 'vector4_array', tangents, 1)
        ]) },
        { key: 'edgeData', type: 'CDmePolygonMeshDataArray', value: dataArray(topology.edgeDataSize, [dataStream('flags:0', 'flags', 'int_array', Array(topology.edgeDataSize).fill('0'), 3)]) },
        { key: 'faceData', type: 'CDmePolygonMeshDataArray', value: dataArray(faces.length, [
          dataStream('textureScale:0', 'textureScale', 'vector2_array', scales, 0),
          dataStream('textureAxisU:0', 'textureAxisU', 'vector4_array', axesU, 0),
          dataStream('textureAxisV:0', 'textureAxisV', 'vector4_array', axesV, 0),
          dataStream('materialindex:0', 'materialindex', 'int_array', materialIndices, 8),
          dataStream('flags:0', 'flags', 'int_array', Array(faces.length).fill('0'), 3),
          dataStream('lightmapScaleBias:0', 'lightmapScaleBias', 'int_array', Array(faces.length).fill('0'), 1)
        ]) },
        { key: 'subdivisionData', type: 'CDmePolygonMeshSubdivisionData', value: {
          kind: 'element',
          className: 'CDmePolygonMeshSubdivisionData',
          fields: [
            { key: 'id', type: 'elementid', value: uid() },
            { key: 'subdivisionLevels', type: 'int_array', value: Array(8).fill('0') },
            { key: 'streams', type: 'element_array', value: [] }
          ]
        } }
      ]
    };
  }

  function ensureMeshNodeDefaults(element) {
    const defaults = [
      ['customVisGroup', 'string', ''], ['randomSeed', 'int', randomSeed()], ['disableShadows', 'int', '0'],
      ['bakelighting', 'bool', '1'], ['cubeMapName', 'string', ''], ['emissiveLightingEnabled', 'bool', '1'],
      ['emissiveLightingBoost', 'float', '1'], ['lightingDummy', 'bool', '0'], ['visexclude', 'bool', '0'],
      ['disablemerging', 'bool', '0'], ['renderwithdynamic', 'bool', '0'], ['renderToCubemaps', 'bool', '1'],
      ['keep_vertices', 'bool', '0'], ['fademindist', 'float', '-1'], ['fademaxdist', 'float', '0'],
      ['disableHeightDisplacement', 'bool', '0'], ['smoothingAngle', 'float', '40'], ['tintColor', 'color', '255 255 255 255'],
      ['renderAmt', 'int', '255'], ['physicsCollisionProperty', 'string', ''], ['physicsGroup', 'string', ''],
      ['physicsInteractsAs', 'string', ''], ['physicsInteractsWith', 'string', ''], ['physicsInteractsExclude', 'string', ''],
      ['physicsSimplificationOverride', 'bool', '0'], ['physicsSimplificationError', 'float', '0']
    ];
    for (const [key, type, value] of defaults) if (!field(element, key)) set(element, key, type, value);
    if (!field(element, 'transformLocked')) set(element, 'transformLocked', 'bool', '0');
    if (!field(element, 'editorOnly')) set(element, 'editorOnly', 'bool', '0');
  }

  function ensureEntityNodeDefaults(element) {
    if (!field(element, 'hitNormal')) set(element, 'hitNormal', 'vector3', '0 0 1');
    if (!field(element, 'isProceduralEntity')) set(element, 'isProceduralEntity', 'bool', '0');
    if (!field(element, 'transformLocked')) set(element, 'transformLocked', 'bool', '0');
    if (!field(element, 'editorOnly')) set(element, 'editorOnly', 'bool', '0');
    if (!field(element, 'customVisGroup')) set(element, 'customVisGroup', 'string', '');
    if (!field(element, 'randomSeed')) set(element, 'randomSeed', 'int', randomSeed());
  }

  function sameTopology(meshData, vertices, faces) {
    const currentFaces = meshFaces(meshData);
    const vertexCount = ary(meshData, 'vertexEdgeIndices').length || ary(meshData, 'vertexDataIndices').length;
    if (vertexCount !== vertices.length || currentFaces.length !== faces.length) return false;
    return currentFaces.every((face, index) => face.length === faces[index].length && face.every((vertex, corner) => vertex === faces[index][corner]));
  }

  function ensureStream(dataArray, name, semantic, type, flags, size, fill) {
    if (!dataArray) return null;
    let result = stream(dataArray, name);
    if (!result) {
      result = dataStream(name, semantic, type, Array(size).fill(fill), flags);
      const streams = field(dataArray, 'streams');
      if (!streams) set(dataArray, 'streams', 'element_array', [result]);
      else {
        if (!Array.isArray(streams.value)) streams.value = [];
        streams.value.push(result);
      }
    }
    const data = field(result, 'data');
    if (!data) set(result, 'data', type, Array(size).fill(fill));
    else {
      if (!Array.isArray(data.value)) data.value = [];
      while (data.value.length < size) data.value.push(fill);
    }
    return result;
  }

  function updatePositions(meshData, vertices) {
    const vertexData = elem(meshData, 'vertexData');
    if (!vertexData) return false;
    const indices = ary(meshData, 'vertexDataIndices').map(value => num(value, -1));
    const size = Math.max(num(get(vertexData, 'size', 0)), vertices.length, ...indices.map(index => index + 1));
    set(vertexData, 'size', 'int', String(size));
    const position = ensureStream(vertexData, 'position:0', 'position', 'vector3_array', 3, size, '0 0 0');
    if (!position) return false;
    const data = field(position, 'data').value;
    vertices.forEach((vertex, index) => {
      const row = indices[index] >= 0 ? indices[index] : index;
      while (data.length <= row) data.push('0 0 0');
      data[row] = vectorString(vertex);
    });
    return true;
  }

  function updateMaterials(meshData, faces, faceMaterials) {
    let materialsField = field(meshData, 'materials');
    if (!materialsField) materialsField = set(meshData, 'materials', 'string_array', []);
    if (!Array.isArray(materialsField.value)) materialsField.value = [];
    const materials = materialsField.value;
    const faceData = elem(meshData, 'faceData');
    if (!faceData) return false;
    const indices = ary(meshData, 'faceDataIndices').map(value => num(value, -1));
    const size = Math.max(num(get(faceData, 'size', 0)), faces.length, ...indices.map(index => index + 1));
    set(faceData, 'size', 'int', String(size));
    const materialIndex = ensureStream(faceData, 'materialindex:0', 'materialindex', 'int_array', 8, size, '0');
    if (!materialIndex) return false;
    const data = field(materialIndex, 'data').value;
    faces.forEach((_, faceIndex) => {
      const material = faceMaterials[faceIndex] || 'ERROR';
      let index = materials.indexOf(material);
      if (index < 0) {
        index = materials.length;
        materials.push(material);
      }
      const row = indices[faceIndex] >= 0 ? indices[faceIndex] : faceIndex;
      while (data.length <= row) data.push('0');
      data[row] = String(index);
    });
    return true;
  }

  function preserveUnknownMeshFields(oldMeshData, newMeshData) {
    if (!oldMeshData) return;
    for (const item of oldMeshData.fields || []) {
      if (STANDARD_MESH_FIELDS.has(item.key)) continue;
      if (!field(newMeshData, item.key)) newMeshData.fields.push(clone(item));
    }
  }

  const rawApply = VMAP.applyObjectToDocument.bind(VMAP);
  VMAP.applyObjectToDocument = function(doc, object) {
    if (!object?.dmxId) return false;
    const element = VMAP.findElementByDmxId(doc, object.dmxId);
    if (!element) return false;
    if (element.className !== 'CMapMesh') return rawApply(doc, object);

    set(element, 'origin', 'vector3', vectorString(object.position || [0, 0, 0]));
    set(element, 'angles', 'qangle', vectorString(object.rotation || [0, 0, 0]));
    set(element, 'scales', 'vector3', vectorString(object.scale || [1, 1, 1]));
    set(element, 'force_hidden', 'bool', object.visible === false ? '1' : '0');
    set(element, 'physicsType', 'string', object.collision === false ? 'none' : 'default');
    ensureMeshNodeDefaults(element);

    const oldMeshData = elem(element, 'meshData');
    const vertices = object.vertices?.length ? object.vertices.map(vertex => vec(vertex)) : [];
    const faces = object.faces?.length ? object.faces.map(face => [...face]) : [];
    if (!vertices.length || !faces.length) return false;
    const faceMaterials = object.faceMaterials?.length === faces.length ? [...object.faceMaterials] : faces.map((_, index) => object.materials?.[VMAP.FACE_NAMES[index]] || 'ERROR');

    if (oldMeshData && sameTopology(oldMeshData, vertices, faces)) {
      if (!updatePositions(oldMeshData, vertices) || !updateMaterials(oldMeshData, faces, faceMaterials)) return false;
    } else {
      if (oldMeshData && meshHasAdvancedData(oldMeshData)) {
        object.vmapCompatibilityError = 'This imported mesh contains Hammer corner/subdivision data. Topology-changing edits are blocked so EasyPeasyHammer cannot destroy that data.';
        return false;
      }
      const name = String(get(oldMeshData, 'name', 'meshData'));
      const id = String(get(oldMeshData, 'id', uid()));
      const rebuilt = makeMeshData(vertices, faces, faceMaterials, name, id);
      preserveUnknownMeshFields(oldMeshData, rebuilt);
      set(element, 'meshData', 'CDmePolygonMesh', rebuilt);
    }

    object.vertices = vertices;
    object.faces = faces;
    object.faceMaterials = faceMaterials;
    object.size = geometryBounds(vertices).size;
    object.materials ??= {};
    VMAP.FACE_NAMES.forEach((name, index) => object.materials[name] = faceMaterials[index] || faceMaterials[0] || 'ERROR');
    delete object.vmapCompatibilityError;
    return true;
  };

  const rawAddPart = VMAP.addPart.bind(VMAP);
  VMAP.addPart = function(doc, options = {}) {
    const object = rawAddPart(doc, options);
    if (!object?.dmxId) return object;
    const element = VMAP.findElementByDmxId(doc, object.dmxId);
    if (!element) return object;
    ensureMeshNodeDefaults(element);
    const oldMeshData = elem(element, 'meshData');
    const name = String(get(oldMeshData, 'name', options.meshName || 'meshData'));
    const id = String(get(oldMeshData, 'id', uid()));
    const vertices = object.vertices.map(vertex => vec(vertex));
    const faces = object.faces.map(face => [...face]);
    const faceMaterials = object.faceMaterials?.length === faces.length ? [...object.faceMaterials] : faces.map(() => options.material || 'ERROR');
    set(element, 'meshData', 'CDmePolygonMesh', makeMeshData(vertices, faces, faceMaterials, name, id));
    return meshObject(element);
  };

  const rawAddEntity = VMAP.addEntity.bind(VMAP);
  VMAP.addEntity = function(doc, options = {}) {
    const object = rawAddEntity(doc, options);
    const element = object?.dmxId ? VMAP.findElementByDmxId(doc, object.dmxId) : null;
    if (element) ensureEntityNodeDefaults(element);
    return element ? entityObject(element) : object;
  };

  const rawDuplicate = VMAP.duplicateObject.bind(VMAP);
  VMAP.duplicateObject = function(doc, object) {
    const copy = rawDuplicate(doc, object);
    const element = copy?.dmxId ? VMAP.findElementByDmxId(doc, copy.dmxId) : null;
    if (!element) return copy;
    if (element.className === 'CMapMesh') ensureMeshNodeDefaults(element);
    if (element.className === 'CMapEntity') ensureEntityNodeDefaults(element);
    return element.className === 'CMapMesh' ? meshObject(element) : element.className === 'CMapEntity' ? entityObject(element) : copy;
  };

  function removeReferences(doc, targetId) {
    for (const top of doc?.elements || []) {
      walkInline(top, element => {
        for (const item of element.fields || []) {
          if (item.type === 'element_array' && Array.isArray(item.value)) {
            item.value = item.value.filter(value => typeof value === 'string' ? value !== targetId : String(get(value, 'id', '')) !== targetId);
          } else if (typeof item.value === 'string' && item.value === targetId && (item.type === 'element' || /^C[A-Z]/.test(item.type))) {
            item.value = '';
          }
        }
      });
    }
  }

  VMAP.removeObject = function(doc, object) {
    if (!object?.dmxId) return false;
    const targetId = String(object.dmxId);
    let removed = false;
    const removeFromChildren = list => {
      for (let index = list.length - 1; index >= 0; index--) {
        const value = list[index];
        if (typeof value === 'string' && value === targetId) {
          list.splice(index, 1);
          removed = true;
          continue;
        }
        if (!value?.kind) continue;
        if (String(get(value, 'id', '')) === targetId) {
          list.splice(index, 1);
          removed = true;
          continue;
        }
        removeFromChildren(ary(value, 'children'));
      }
    };
    removeFromChildren(getChildren(doc));
    removeReferences(doc, targetId);
    const before = doc.elements.length;
    doc.elements = doc.elements.filter(element => String(get(element, 'id', '')) !== targetId);
    return removed || before !== doc.elements.length;
  };

  function enrichEmptyDocument(doc) {
    doc.header = '<!-- dmx encoding keyvalues2 4 format vmap 40 -->';
    const root = rootElement(doc);
    const world = getWorld(doc);
    if (!root || !world) return doc;
    const addRoot = (key, type, value) => { if (!field(root, key)) set(root, key, type, value); };
    addRoot('showgrid', 'bool', '1');
    addRoot('snaprotationangle', 'int', '15');
    addRoot('gridspacing', 'float', '64');
    addRoot('show3dgrid', 'bool', '1');
    addRoot('defaultcamera', 'CStoredCamera', { kind: 'element', className: 'CStoredCamera', fields: [
      { key: 'id', type: 'elementid', value: uid() }, { key: 'position', type: 'vector3', value: '0 -1000 1000' }, { key: 'lookat', type: 'vector3', value: '0 0 0' }
    ] });
    addRoot('3dcameras', 'CStoredCameras', { kind: 'element', className: 'CStoredCameras', fields: [
      { key: 'id', type: 'elementid', value: uid() }, { key: 'activecamera', type: 'int', value: '-1' }, { key: 'cameras', type: 'element_array', value: [] }
    ] });
    addRoot('visbility', 'CVisibilityMgr', { kind: 'element', className: 'CVisibilityMgr', fields: [
      { key: 'id', type: 'elementid', value: uid() }, { key: 'nodeID', type: 'int', value: '0' }, { key: 'referenceID', type: 'uint64', value: '0x0' },
      { key: 'children', type: 'element_array', value: [] }, { key: 'variableTargetKeys', type: 'string_array', value: [] }, { key: 'variableNames', type: 'string_array', value: [] },
      { key: 'nodes', type: 'element_array', value: [] }, { key: 'hiddenFlags', type: 'int_array', value: [] },
      { key: 'origin', type: 'vector3', value: '0 0 0' }, { key: 'angles', type: 'qangle', value: '0 0 0' }, { key: 'scales', type: 'vector3', value: '1 1 1' },
      { key: 'transformLocked', type: 'bool', value: '0' }, { key: 'force_hidden', type: 'bool', value: '0' }, { key: 'editorOnly', type: 'bool', value: '0' },
      { key: 'customVisGroup', type: 'string', value: '' }, { key: 'randomSeed', type: 'int', value: randomSeed() }
    ] });
    addRoot('m_ReferencedMeshSnapshots', 'element_array', []);
    addRoot('m_bIsCordoning', 'bool', '0');
    addRoot('m_bCordonsVisible', 'bool', '0');
    addRoot('nodeInstanceData', 'element_array', []);

    const mapVariables = resolveElement(doc, get(root, 'mapVariables'));
    if (mapVariables) {
      if (!field(mapVariables, 'variableTypeNames')) set(mapVariables, 'variableTypeNames', 'string_array', []);
      if (!field(mapVariables, 'variableTypeParameters')) set(mapVariables, 'variableTypeParameters', 'string_array', []);
      if (!field(mapVariables, 'm_ChoiceGroups')) set(mapVariables, 'm_ChoiceGroups', 'element_array', []);
    }
    const worldDefaults = [
      ['nextDecalID', 'int', '0'], ['fixupEntityNames', 'bool', '1'], ['mapUsageType', 'string', 'standard'],
      ['transformLocked', 'bool', '0'], ['force_hidden', 'bool', '0'], ['editorOnly', 'bool', '0'], ['customVisGroup', 'string', ''], ['randomSeed', 'int', randomSeed()]
    ];
    for (const [key, type, value] of worldDefaults) if (!field(world, key)) set(world, key, type, value);
    return doc;
  }

  const rawCreateEmpty = VMAP.createEmptyDocument.bind(VMAP);
  VMAP.createEmptyDocument = () => enrichEmptyDocument(rawCreateEmpty());

  function updateAssetReferences(doc, objects) {
    let prefix = doc?.elements?.find(element => element.className === '$prefix_element$');
    if (!prefix) {
      prefix = { kind: 'element', className: '$prefix_element$', fields: [
        { key: 'id', type: 'elementid', value: uid() }, { key: 'asset_preview_thumbnail', type: 'binary', value: '' },
        { key: 'asset_preview_thumbnail_format', type: 'string', value: 'jpg' }, { key: 'map_asset_references', type: 'string_array', value: [] }
      ] };
      doc.elements.unshift(prefix);
    }
    let references = field(prefix, 'map_asset_references');
    if (!references) references = set(prefix, 'map_asset_references', 'string_array', []);
    if (!Array.isArray(references.value)) references.value = [];
    const assets = new Set(references.value.map(value => String(value).replace(/\\/g, '/')).filter(Boolean));
    for (const object of objects || []) {
      for (const material of object.faceMaterials || []) if (material && material !== 'ERROR') assets.add(String(material).replace(/\\/g, '/'));
      if (object.model) assets.add(String(object.model).replace(/\\/g, '/'));
      for (const raw of Object.values(object.entityProperties || {})) {
        const value = String(raw || '').replace(/\\/g, '/');
        if (/\.(?:vmat|vmdl|vpcf|vsnd|vtex|vmap)$/i.test(value)) assets.add(value);
      }
    }
    references.value = [...assets].sort((a, b) => a.localeCompare(b));
  }

  function validateDataArray(dataArray, label, errors, warnings) {
    if (!dataArray) {
      errors.push(`${label} is missing.`);
      return;
    }
    const size = num(get(dataArray, 'size', -1), -1);
    if (!Number.isInteger(size) || size < 0) {
      errors.push(`${label}.size is invalid.`);
      return;
    }
    for (const item of ary(dataArray, 'streams')) {
      const name = String(get(item, 'name', 'unnamed'));
      const data = ary(item, 'data');
      if (data.length < size) errors.push(`${label}/${name} has ${data.length} rows but size is ${size}.`);
      else if (data.length > size) warnings.push(`${label}/${name} has ${data.length} rows while size is ${size}.`);
    }
  }

  function validateMesh(meshData, label, errors, warnings) {
    if (!meshData) {
      errors.push(`${label}: meshData is missing.`);
      return;
    }
    const vertexEdges = ary(meshData, 'vertexEdgeIndices').map(value => num(value, -1));
    const vertexDataIndices = ary(meshData, 'vertexDataIndices').map(value => num(value, -1));
    const edgeVertex = ary(meshData, 'edgeVertexIndices').map(value => num(value, -1));
    const opposite = ary(meshData, 'edgeOppositeIndices').map(value => num(value, -1));
    const next = ary(meshData, 'edgeNextIndices').map(value => num(value, -1));
    const edgeFace = ary(meshData, 'edgeFaceIndices').map(value => num(value, -1));
    const edgeDataIndices = ary(meshData, 'edgeDataIndices').map(value => num(value, -1));
    const edgeVertexDataIndices = ary(meshData, 'edgeVertexDataIndices').map(value => num(value, -1));
    const faceEdges = ary(meshData, 'faceEdgeIndices').map(value => num(value, -1));
    const faceDataIndices = ary(meshData, 'faceDataIndices').map(value => num(value, -1));
    const edgeCount = edgeVertex.length;
    const vertexCount = vertexEdges.length || vertexDataIndices.length;

    if (vertexEdges.length !== vertexDataIndices.length) errors.push(`${label}: vertex index arrays have different lengths.`);
    for (const [name, values] of [['edgeOppositeIndices', opposite], ['edgeNextIndices', next], ['edgeFaceIndices', edgeFace], ['edgeDataIndices', edgeDataIndices], ['edgeVertexDataIndices', edgeVertexDataIndices]]) {
      if (values.length !== edgeCount) errors.push(`${label}: ${name} length does not match edgeVertexIndices.`);
    }
    if (edgeCount % 2 !== 0) errors.push(`${label}: half-edge count ${edgeCount} is not even.`);
    if (faceEdges.length !== faceDataIndices.length) errors.push(`${label}: face index arrays have different lengths.`);

    for (let edge = 0; edge < edgeCount; edge++) {
      const twin = opposite[edge];
      if (edgeVertex[edge] < 0 || edgeVertex[edge] >= vertexCount) errors.push(`${label}: edge ${edge} references an invalid vertex.`);
      if (twin < 0 || twin >= edgeCount || twin === edge) {
        errors.push(`${label}: edge ${edge} has an invalid opposite edge.`);
        continue;
      }
      if (opposite[twin] !== edge) errors.push(`${label}: edge ${edge} opposite relation is not symmetric.`);
      if (edgeDataIndices[twin] !== edgeDataIndices[edge]) errors.push(`${label}: edge ${edge} and its twin do not share edge data.`);
      if (next[edge] < 0 || next[edge] >= edgeCount) errors.push(`${label}: edge ${edge} has an invalid next edge.`);
      if (edgeFace[edge] < -1 || edgeFace[edge] >= faceEdges.length) errors.push(`${label}: edge ${edge} references an invalid face.`);
    }

    faceEdges.forEach((start, faceIndex) => {
      if (start < 0 || start >= edgeCount) {
        errors.push(`${label}: face ${faceIndex} has an invalid starting edge.`);
        return;
      }
      const visited = new Set();
      let edge = start;
      while (edge >= 0 && edge < edgeCount && !visited.has(edge)) {
        visited.add(edge);
        if (edgeFace[edge] !== faceIndex) errors.push(`${label}: face ${faceIndex} contains an edge assigned to another face.`);
        edge = next[edge];
        if (edge === start) break;
      }
      if (edge !== start) errors.push(`${label}: face ${faceIndex} edge loop does not close.`);
      if (visited.size < 3) errors.push(`${label}: face ${faceIndex} has fewer than 3 edges.`);
    });

    const vertexData = elem(meshData, 'vertexData');
    const faceVertexData = elem(meshData, 'faceVertexData');
    const edgeData = elem(meshData, 'edgeData');
    const faceData = elem(meshData, 'faceData');
    validateDataArray(vertexData, `${label}/vertexData`, errors, warnings);
    validateDataArray(faceVertexData, `${label}/faceVertexData`, errors, warnings);
    validateDataArray(edgeData, `${label}/edgeData`, errors, warnings);
    validateDataArray(faceData, `${label}/faceData`, errors, warnings);
    const vertexDataSize = num(get(vertexData, 'size', 0));
    const faceVertexDataSize = num(get(faceVertexData, 'size', 0));
    const edgeDataSize = num(get(edgeData, 'size', 0));
    const faceDataSize = num(get(faceData, 'size', 0));
    vertexDataIndices.forEach(row => { if (row < 0 || row >= vertexDataSize) errors.push(`${label}: vertexDataIndices contains an out-of-range row.`); });
    edgeVertexDataIndices.forEach(row => { if (row < 0 || row >= faceVertexDataSize) errors.push(`${label}: edgeVertexDataIndices contains an out-of-range row.`); });
    edgeDataIndices.forEach(row => { if (row < 0 || row >= edgeDataSize) errors.push(`${label}: edgeDataIndices contains an out-of-range row.`); });
    faceDataIndices.forEach(row => { if (row < 0 || row >= faceDataSize) errors.push(`${label}: faceDataIndices contains an out-of-range row.`); });
    if (faceVertexDataSize < edgeCount) errors.push(`${label}: faceVertexData is smaller than the half-edge table.`);

    const positions = ary(stream(vertexData, 'position:0'), 'data');
    if (vertexCount && !positions.length) errors.push(`${label}: position:0 stream is missing.`);
    const materials = ary(meshData, 'materials');
    const materialRows = ary(stream(faceData, 'materialindex:0'), 'data').map(value => num(value, -1));
    faceDataIndices.forEach((row, faceIndex) => {
      const materialIndex = materialRows[row];
      if (materialIndex === undefined || materialIndex < 0 || materialIndex >= materials.length) errors.push(`${label}: face ${faceIndex} has an invalid material index.`);
    });
    if (!elem(meshData, 'subdivisionData')) warnings.push(`${label}: subdivisionData is missing; Hammer may add it on save.`);
  }

  VMAP.validate = function(doc) {
    const errors = [];
    const warnings = [];
    if (!doc || !Array.isArray(doc.elements)) return { ok: false, errors: ['VMAP element list is missing.'], warnings };
    if (!/dmx\s+encoding\s+keyvalues2\s+\d+\s+format\s+vmap\s+\d+/i.test(String(doc.header || ''))) errors.push('VMAP DMX header is missing or invalid.');
    const root = rootElement(doc);
    if (!root) errors.push('CMapRootElement is missing.');
    const ids = new Map();
    for (const top of doc.elements) {
      walkInline(top, element => {
        const id = String(get(element, 'id', ''));
        if (!id) return warnings.push(`${element.className || 'Element'} has no elementid.`);
        if (!UUID_RE.test(id)) warnings.push(`${element.className || 'Element'} has a non-standard elementid ${id}.`);
        if (ids.has(id) && ids.get(id) !== element) errors.push(`Duplicate elementid ${id}.`);
        else ids.set(id, element);
      });
    }
    for (const top of doc.elements) {
      walkInline(top, element => {
        for (const item of element.fields || []) {
          if (item.type === 'element_array' && Array.isArray(item.value)) {
            for (const value of item.value) if (typeof value === 'string' && value && UUID_RE.test(value) && !ids.has(value)) errors.push(`${element.className}.${item.key} references missing element ${value}.`);
          } else if (typeof item.value === 'string' && item.value && UUID_RE.test(item.value) && (item.type === 'element' || /^C[A-Z]/.test(item.type)) && !ids.has(item.value)) {
            errors.push(`${element.className}.${item.key} references missing element ${item.value}.`);
          }
        }
      });
    }
    const world = getWorld(doc);
    if (root && !world) errors.push('CMapWorld is missing or cannot be resolved.');
    for (const [id, element] of ids) if (element.className === 'CMapMesh') validateMesh(elem(element, 'meshData'), `CMapMesh ${get(element, 'nodeID', id)}`, errors, warnings);
    return { ok: !errors.length, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  };

  VMAP.extractObjects = extractObjects;
  VMAP.getWorld = getWorld;
  VMAP.getWorldChildren = getChildren;
  VMAP.resolveElement = resolveElement;
  VMAP.defaultTextureAxes = defaultAxes;
  VMAP.meshHasAdvancedData = meshHasAdvancedData;
  VMAP.HAMMER_DEFAULT_TEXTURE_SCALE = DEFAULT_SCALE;
  VMAP.updateAssetReferences = updateAssetReferences;

  const rawPrepare = VMAP.prepareForSave.bind(VMAP);
  VMAP.prepareForSave = function(doc, objects) {
    const output = clone(doc);
    for (const object of objects || []) {
      if (!object?.dmxId) continue;
      if (!VMAP.applyObjectToDocument(output, object)) throw Error(object.vmapCompatibilityError || `Could not safely reproduce ${object.name || object.id} in VMAP.`);
    }
    VMAP.syncCollisionHelpers(output, objects);
    updateAssetReferences(output, objects);
    const validation = VMAP.validate(output);
    if (!validation.ok) throw Error(`VMAP compatibility validation failed: ${validation.errors.join(' ')}`);
    return output;
  };
  VMAP.prepareForSave.__ephCompatPrevious = rawPrepare;

  const rawExtrude = VMAP.extrudeFace.bind(VMAP);
  VMAP.extrudeFace = function(object, faceIndex, distance) {
    if (object?.sourceHasAdvancedMeshData) {
      object.vmapCompatibilityError = 'Extrude is disabled on this imported mesh because it contains Hammer-specific corner/subdivision data that must be preserved.';
      return false;
    }
    return rawExtrude(object, faceIndex, distance);
  };

  const rawClip = VMAP.clipAxis.bind(VMAP);
  VMAP.clipAxis = function(object, axis, plane, keepPositive) {
    if (object?.sourceHasAdvancedMeshData) {
      object.vmapCompatibilityError = 'Clip is disabled on this imported mesh because it contains Hammer-specific corner/subdivision data that must be preserved.';
      return false;
    }
    return rawClip(object, axis, plane, keepPositive);
  };

  VMAP.selfTest = function() {
    const failures = [];
    try {
      const doc = VMAP.createEmptyDocument();
      let validation = VMAP.validate(doc);
      if (!validation.ok) failures.push(`empty: ${validation.errors.join(' ')}`);
      const plane = VMAP.addPart(doc, {
        vertices: [[-64, -64, 0], [64, -64, 0], [64, 64, 0], [-64, 64, 0]],
        faces: [[0, 1, 2, 3]],
        faceMaterials: ['materials/dev/dev_measuregeneric01b.vmat'],
        collision: false,
        meshName: 'EPH_SELFTEST_PLANE'
      });
      const element = VMAP.findElementByDmxId(doc, plane.dmxId);
      const meshData = elem(element, 'meshData');
      if (ary(meshData, 'edgeVertexIndices').length !== 8) failures.push('open quad did not create 8 Hammer half-edges');
      if (ary(meshData, 'edgeFaceIndices').filter(value => num(value) === -1).length !== 4) failures.push('open quad did not create 4 boundary twins');
      VMAP.addPart(doc, { size: [128, 128, 128], material: 'materials/dev/dev_measuregeneric01b.vmat' });
      validation = VMAP.validate(doc);
      if (!validation.ok) failures.push(`geometry: ${validation.errors.join(' ')}`);
      const roundTrip = VMAP.parse(VMAP.stringify(doc));
      validation = VMAP.validate(roundTrip);
      if (!validation.ok) failures.push(`roundtrip: ${validation.errors.join(' ')}`);
    } catch (error) {
      failures.push(error?.message || String(error));
    }
    return { ok: !failures.length, failures };
  };
})();
