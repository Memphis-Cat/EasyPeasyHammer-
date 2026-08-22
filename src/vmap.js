// byanca
(() => {
  'use strict';

  const HEADER = '<!-- dmx encoding keyvalues2 4 format vmap 40 -->';
  const FACE_NAMES = ['right', 'left', 'front', 'back', 'top', 'bottom'];
  const HELPER_PREFIX = 'EPH_HELPER_';
  const TOOL_MATERIALS = {
    players: 'materials/tools/toolsplayerclip.vmat',
    grenades: 'materials/tools/toolsgrenadeclip.vmat',
    bullets: 'materials/tools/toolsblockbullets_cs.vmat'
  };
  const uid = () => globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16 | 0) & (c === 'x' ? 15 : 3) | (c === 'y' ? 8 : 0)).toString(16));
  const ref64 = () => `0x${Array.from({ length: 16 }, () => Math.random() * 16 | 0).map(x => x.toString(16)).join('')}`;
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const vec = (v, len = 3, d = 0) => {
    if (Array.isArray(v)) return Array.from({ length: len }, (_, i) => num(v[i], d));
    const a = String(v ?? '').trim().split(/\s+/).map(Number);
    return Array.from({ length: len }, (_, i) => Number.isFinite(a[i]) ? a[i] : d);
  };
  const vs = a => a.map(x => { x = Number(x) || 0; return Math.abs(x) < 1e-9 ? '0' : Number.isInteger(x) ? String(x) : String(Number(x.toFixed(6))); }).join(' ');
  const quote = v => `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const clone = value => structuredClone(value);

  function tokens(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { i += 2; while (i < text.length && text[i] !== '\n') i++; continue; }
      if (c === '<' && text.slice(i, i + 4) === '<!--') { const end = text.indexOf('-->', i + 4); i = end < 0 ? text.length : end + 3; continue; }
      if ('{}[],'.includes(c)) { out.push({ t: c, v: c }); i++; continue; }
      if (c === '"') {
        i++;
        let s = '';
        while (i < text.length) {
          const x = text[i++];
          if (x === '"') break;
          if (x === '\\' && i < text.length) {
            const y = text[i++];
            s += y === 'n' ? '\n' : y === 'r' ? '\r' : y === 't' ? '\t' : y;
          } else s += x;
        }
        out.push({ t: 's', v: s });
        continue;
      }
      const start = i;
      while (i < text.length && !/\s/.test(text[i]) && !'{}[],'.includes(text[i])) i++;
      out.push({ t: 's', v: text.slice(start, i) });
    }
    return out;
  }

  function parse(text) {
    const ts = tokens(String(text || ''));
    let p = 0;
    const peek = () => ts[p];
    const take = t => { const x = ts[p++]; if (!x) throw Error('Unexpected end of VMAP'); if (t && x.t !== t) throw Error(`Expected ${t}`); return x; };
    const array = () => {
      take('[');
      const a = [];
      while (peek() && peek().t !== ']') {
        if (peek().t === ',') { take(','); continue; }
        const first = take('s').v;
        a.push(peek()?.t === '{' ? element(first) : first);
      }
      take(']');
      return a;
    };
    const element = className => {
      take('{');
      const fields = [];
      while (peek() && peek().t !== '}') {
        if (peek().t === ',') { take(','); continue; }
        const key = take('s').v;
        const type = take('s').v;
        let value;
        if (peek()?.t === '{') value = element(type);
        else if (peek()?.t === '[') value = array();
        else value = take('s').v;
        fields.push({ key, type, value });
      }
      take('}');
      return { kind: 'element', className, fields };
    };
    const elements = [];
    while (peek()) {
      if (peek().t === ',') { take(','); continue; }
      const className = take('s').v;
      if (peek()?.t !== '{') throw Error(`Expected body after ${className}`);
      elements.push(element(className));
    }
    const header = String(text || '').match(/<!--\s*dmx\s+encoding\s+keyvalues2\s+\d+\s+format\s+vmap\s+\d+\s*-->/i)?.[0] || HEADER;
    return { header, elements };
  }

  function stringify(doc) {
    const lines = [doc?.header || HEADER];
    const body = (e, indent, suffix = '') => {
      lines.push(`${indent}{`);
      for (const f of e.fields || []) {
        if (Array.isArray(f.value)) {
          lines.push(`${indent}\t${quote(f.key)} ${quote(f.type)}`);
          array(f.value, `${indent}\t`);
        } else if (f.value?.kind === 'element') {
          lines.push(`${indent}\t${quote(f.key)} ${quote(f.type)}`);
          body(f.value, `${indent}\t`);
        } else lines.push(`${indent}\t${quote(f.key)} ${quote(f.type)} ${quote(f.value)}`);
      }
      lines.push(`${indent}}${suffix}`);
    };
    const array = (a, indent) => {
      lines.push(`${indent}[`);
      a.forEach((x, i) => {
        const suffix = i < a.length - 1 ? ',' : '';
        if (x?.kind === 'element') {
          lines.push(`${indent}\t${quote(x.className)}`);
          body(x, `${indent}\t`, suffix);
        } else lines.push(`${indent}\t${quote(x)}${suffix}`);
      });
      lines.push(`${indent}]`);
    };
    for (const e of doc?.elements || []) {
      lines.push(quote(e.className));
      body(e, '');
    }
    return `${lines.join('\n')}\n`;
  }

  const field = (e, key) => e?.fields?.find(f => f.key === key) || null;
  const get = (e, key, fallback = null) => field(e, key)?.value ?? fallback;
  const set = (e, key, type, value) => {
    let f = field(e, key);
    if (f) { f.type = type || f.type; f.value = value; }
    else { f = { key, type, value }; e.fields.push(f); }
    return f;
  };
  const elem = (e, key) => { const v = get(e, key); return v?.kind === 'element' ? v : null; };
  const ary = (e, key) => Array.isArray(get(e, key)) ? get(e, key) : [];
  const stream = (dataArray, name) => ary(dataArray, 'streams').find(x => x?.kind === 'element' && get(x, 'name') === name) || null;
  const world = doc => elem(doc?.elements?.find(x => x.className === 'CMapRootElement'), 'world');
  const children = doc => {
    const w = world(doc);
    if (!w) return [];
    let f = field(w, 'children');
    if (!f) { f = { key: 'children', type: 'element_array', value: [] }; w.fields.push(f); }
    if (!Array.isArray(f.value)) f.value = [];
    return f.value;
  };
  function walk(e, fn) {
    if (!e?.kind) return;
    fn(e);
    for (const f of e.fields || []) {
      if (Array.isArray(f.value)) f.value.forEach(x => x?.kind && walk(x, fn));
      else if (f.value?.kind) walk(f.value, fn);
    }
  }
  const maxNode = doc => { let m = 1; for (const top of doc.elements || []) walk(top, e => { const id = Number(get(e, 'nodeID')); if (Number.isInteger(id)) m = Math.max(m, id); }); return m; };

  function meshFaces(md) {
    const starts = ary(md, 'faceEdgeIndices').map(x => num(x, -1));
    const next = ary(md, 'edgeNextIndices').map(x => num(x, -1));
    const edgeVertex = ary(md, 'edgeVertexIndices').map(x => num(x, -1));
    return starts.map(start => {
      const a = [];
      const seen = new Set();
      let edge = start;
      while (edge >= 0 && edge < next.length && !seen.has(edge)) {
        seen.add(edge);
        if (edgeVertex[edge] >= 0) a.push(edgeVertex[edge]);
        edge = next[edge];
        if (edge === start) break;
      }
      return a;
    }).filter(x => x.length >= 3);
  }

  function isHelperMesh(e) {
    if (e?.className !== 'CMapMesh') return false;
    const md = elem(e, 'meshData');
    return String(get(md, 'name', '')).startsWith(HELPER_PREFIX);
  }

  function meshObject(e) {
    if (isHelperMesh(e)) return null;
    const md = elem(e, 'meshData');
    if (!md) return null;
    const vd = elem(md, 'vertexData');
    const ps = stream(vd, 'position:0');
    const vertices = ary(ps, 'data').map(x => vec(x));
    const faces = meshFaces(md);
    const materialList = ary(md, 'materials');
    const fd = elem(md, 'faceData');
    const mi = stream(fd, 'materialindex:0');
    const indices = ary(mi, 'data').map(x => num(x));
    const faceMaterials = faces.map((_, i) => materialList[indices[i] ?? 0] || materialList[0] || 'ERROR');
    const materials = {};
    FACE_NAMES.forEach((name, i) => materials[name] = faceMaterials[i] || faceMaterials[0] || 'ERROR');
    const bounds = geometryBounds(vertices);
    const id = String(get(e, 'id', uid()));
    return editable({
      id: `mesh:${id}`, dmxId: id, type: 'part', name: `Mesh_${get(e, 'nodeID', '')}`, parent: 'world', sourceClass: 'CMapMesh',
      position: vec(get(e, 'origin', '0 0 0')), rotation: vec(get(e, 'angles', '0 0 0')), scale: vec(get(e, 'scales', '1 1 1'), 3, 1),
      size: bounds.size, vertices, faces, faceMaterials, materials, collision: get(e, 'physicsType', 'default') !== 'none', visible: get(e, 'force_hidden', '0') !== '1'
    });
  }

  function entityObject(e) {
    const props = elem(e, 'entity_properties');
    if (!props) return null;
    const className = String(get(props, 'classname', 'info_target'));
    const model = String(get(props, 'model', ''));
    const id = String(get(e, 'id', uid()));
    const entityProperties = Object.fromEntries((props.fields || []).filter(f => !['id', 'classname', 'targetname', 'model'].includes(f.key) && !Array.isArray(f.value) && !f.value?.kind).map(f => [f.key, f.value]));
    return editable({
      id: `entity:${id}`, dmxId: id, type: className.startsWith('prop_') ? 'prop' : 'entity', name: String(get(props, 'targetname', '')) || className,
      parent: 'world', sourceClass: 'CMapEntity', className, model,
      position: vec(get(e, 'origin', '0 0 0')), rotation: vec(get(e, 'angles', '0 0 0')), scale: vec(get(e, 'scales', '1 1 1'), 3, 1),
      visible: get(e, 'force_hidden', '0') !== '1', collision: String(entityProperties.solid ?? '6') !== '0', entityProperties
    });
  }

  function editable(o) {
    o.position ??= [0, 0, 0];
    o.rotation ??= [0, 0, 0];
    o.scale ??= [1, 1, 1];
    o.size ??= [64, 64, 64];
    o.visible ??= true;
    o.collision ??= true;
    o.blockPlayers ??= o.collision !== false;
    o.blockGrenades ??= false;
    o.blockBullets ??= false;
    o.faceMaterials ??= o.faces?.map((_, i) => o.materials?.[FACE_NAMES[i]] || 'ERROR') || [];
    o.materials ??= Object.fromEntries(FACE_NAMES.map((f, i) => [f, o.faceMaterials[i] || 'ERROR']));
    return o;
  }

  function extractObjects(doc) {
    const out = [{ id: 'world', name: 'World', type: 'world', parent: null, expanded: true, sourceClass: 'CMapWorld' }];
    const helperFlags = new Map();
    const visit = list => list.forEach(e => {
      if (!e?.kind) return;
      if (isHelperMesh(e)) {
        const meshName = String(get(elem(e, 'meshData'), 'name', ''));
        const match = meshName.match(/^EPH_HELPER_(players|grenades|bullets)_(.+)$/);
        if (match) {
          const flags = helperFlags.get(match[2]) || {};
          flags[match[1]] = true; helperFlags.set(match[2], flags);
        }
      } else {
        const o = e.className === 'CMapMesh' ? meshObject(e) : e.className === 'CMapEntity' ? entityObject(e) : null;
        if (o) out.push(o);
      }
      const c = ary(e, 'children');
      if (c.length) visit(c);
    });
    visit(children(doc));
    for (const o of out) {
      if (!o.dmxId) continue;
      const flags = helperFlags.get(o.dmxId);
      if (!flags) continue;
      if (flags.players) o.blockPlayers = true;
      if (flags.grenades) o.blockGrenades = true;
      if (flags.bullets) o.blockBullets = true;
    }
    return out;
  }

  function find(doc, id) {
    let hit = null;
    for (const top of doc.elements || []) {
      walk(top, e => { if (!hit && String(get(e, 'id', '')) === String(id)) hit = e; });
      if (hit) break;
    }
    return hit;
  }

  function geometryBounds(vertices) {
    if (!vertices?.length) return { min: [-32, -32, -32], max: [32, 32, 32], center: [0, 0, 0], size: [64, 64, 64] };
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    vertices.forEach(v => v.forEach((x, i) => { min[i] = Math.min(min[i], x); max[i] = Math.max(max[i], x); }));
    return { min, max, center: min.map((x, i) => (x + max[i]) / 2), size: min.map((x, i) => Math.max(0.001, max[i] - x)) };
  }

  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const add = (a, b) => a.map((x, i) => x + b[i]);
  const mul = (a, s) => a.map(x => x * s);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
  function faceNormal(vertices, face) {
    if (!face || face.length < 3) return [0, 0, 1];
    return norm(cross(sub(vertices[face[1]], vertices[face[0]]), sub(vertices[face[2]], vertices[face[0]])));
  }

  function dataStream(name, semantic, type, data, flags = 1) {
    return { kind: 'element', className: 'CDmePolygonMeshDataStream', fields: [
      { key: 'id', type: 'elementid', value: uid() }, { key: 'name', type: 'string', value: name }, { key: 'standardAttributeName', type: 'string', value: semantic },
      { key: 'semanticName', type: 'string', value: semantic }, { key: 'semanticIndex', type: 'int', value: '0' }, { key: 'vertexBufferLocation', type: 'int', value: '0' },
      { key: 'dataStateFlags', type: 'int', value: String(flags) }, { key: 'subdivisionBinding', type: 'element', value: '' }, { key: 'data', type, value: data.map(String) }
    ] };
  }
  function dataArray(size, streams) { return { kind: 'element', className: 'CDmePolygonMeshDataArray', fields: [{ key: 'id', type: 'elementid', value: uid() }, { key: 'size', type: 'int', value: String(size) }, { key: 'streams', type: 'element_array', value: streams }] }; }

  function topology(vertices, faces) {
    const edgeVertex = [], edgeNext = [], edgeFace = [], opposite = [], edgeData = [], faceStart = [], vertexEdge = Array(vertices.length).fill(-1);
    const directed = new Map(), undirected = new Map();
    let undirectedCount = 0;
    faces.forEach((face, fi) => {
      const start = edgeVertex.length;
      faceStart.push(start);
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i + 1) % face.length], ei = edgeVertex.length;
        edgeVertex.push(b); edgeNext.push(start + (i + 1) % face.length); edgeFace.push(fi); opposite.push(-1);
        if (vertexEdge[a] < 0) vertexEdge[a] = ei;
        const reverse = `${b}:${a}`;
        if (directed.has(reverse)) { const oi = directed.get(reverse); opposite[ei] = oi; opposite[oi] = ei; }
        directed.set(`${a}:${b}`, ei);
        const uk = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (!undirected.has(uk)) undirected.set(uk, undirectedCount++);
        edgeData.push(undirected.get(uk));
      }
    });
    return { edgeVertex, edgeNext, edgeFace, opposite, edgeData, faceStart, vertexEdge, undirectedCount };
  }

  function makeMeshData(vertices, faces, faceMaterials, name = 'meshData', oldId = null) {
    const topo = topology(vertices, faces);
    const uniqueMaterials = [];
    const materialIndices = faces.map((_, i) => {
      const mat = faceMaterials[i] || 'ERROR';
      let idx = uniqueMaterials.indexOf(mat);
      if (idx < 0) { idx = uniqueMaterials.length; uniqueMaterials.push(mat); }
      return String(idx);
    });
    const faceVertexCount = faces.reduce((s, f) => s + f.length, 0);
    const normals = [];
    const texcoords = [];
    const tangents = [];
    faces.forEach(face => {
      const normal = faceNormal(vertices, face);
      face.forEach((_, i) => {
        normals.push(vs(normal));
        texcoords.push(`${i === 1 || i === 2 ? 1 : 0} ${i >= 2 ? 1 : 0}`);
        tangents.push('1 0 0 -1');
      });
    });
    return { kind: 'element', className: 'CDmePolygonMesh', fields: [
      { key: 'id', type: 'elementid', value: oldId || uid() }, { key: 'name', type: 'string', value: name },
      { key: 'vertexEdgeIndices', type: 'int_array', value: topo.vertexEdge.map(String) }, { key: 'vertexDataIndices', type: 'int_array', value: vertices.map((_, i) => String(i)) },
      { key: 'edgeVertexIndices', type: 'int_array', value: topo.edgeVertex.map(String) }, { key: 'edgeOppositeIndices', type: 'int_array', value: topo.opposite.map(String) },
      { key: 'edgeNextIndices', type: 'int_array', value: topo.edgeNext.map(String) }, { key: 'edgeFaceIndices', type: 'int_array', value: topo.edgeFace.map(String) },
      { key: 'edgeDataIndices', type: 'int_array', value: topo.edgeData.map(String) }, { key: 'edgeVertexDataIndices', type: 'int_array', value: topo.edgeVertex.map((_, i) => String(i)) },
      { key: 'faceEdgeIndices', type: 'int_array', value: topo.faceStart.map(String) }, { key: 'faceDataIndices', type: 'int_array', value: faces.map((_, i) => String(i)) },
      { key: 'materials', type: 'string_array', value: uniqueMaterials },
      { key: 'vertexData', type: 'CDmePolygonMeshDataArray', value: dataArray(vertices.length, [dataStream('position:0', 'position', 'vector3_array', vertices.map(vs), 3)]) },
      { key: 'faceVertexData', type: 'CDmePolygonMeshDataArray', value: dataArray(faceVertexCount, [dataStream('texcoord:0', 'texcoord', 'vector2_array', texcoords), dataStream('normal:0', 'normal', 'vector3_array', normals), dataStream('tangent:0', 'tangent', 'vector4_array', tangents)]) },
      { key: 'edgeData', type: 'CDmePolygonMeshDataArray', value: dataArray(topo.undirectedCount, [dataStream('flags:0', 'flags', 'int_array', Array(topo.undirectedCount).fill('0'), 3)]) },
      { key: 'faceData', type: 'CDmePolygonMeshDataArray', value: dataArray(faces.length, [
        dataStream('textureScale:0', 'textureScale', 'vector2_array', Array(faces.length).fill('0.25 0.25'), 0),
        dataStream('textureAxisU:0', 'textureAxisU', 'vector4_array', Array(faces.length).fill('1 0 0 0'), 0),
        dataStream('textureAxisV:0', 'textureAxisV', 'vector4_array', Array(faces.length).fill('0 -1 0 0'), 0),
        dataStream('materialindex:0', 'materialindex', 'int_array', materialIndices, 8),
        dataStream('flags:0', 'flags', 'int_array', Array(faces.length).fill('0'), 3),
        dataStream('lightmapScaleBias:0', 'lightmapScaleBias', 'int_array', Array(faces.length).fill('0'))
      ]) },
      { key: 'subdivisionData', type: 'CDmePolygonMeshSubdivisionData', value: { kind: 'element', className: 'CDmePolygonMeshSubdivisionData', fields: [{ key: 'id', type: 'elementid', value: uid() }, { key: 'subdivisionLevels', type: 'int_array', value: Array(faceVertexCount).fill('0') }, { key: 'streams', type: 'element_array', value: [] }] } }
    ] };
  }

  function boxGeometry(size = [128, 128, 128]) {
    const h = size.map(x => Math.max(1, num(x, 128)) / 2);
    const vertices = [[-h[0], -h[1], -h[2]], [h[0], -h[1], -h[2]], [h[0], h[1], -h[2]], [-h[0], h[1], -h[2]], [-h[0], -h[1], h[2]], [h[0], -h[1], h[2]], [h[0], h[1], h[2]], [-h[0], h[1], h[2]]];
    const faces = [[1, 5, 6, 2], [4, 0, 3, 7], [0, 1, 2, 3], [5, 4, 7, 6], [3, 2, 6, 7], [4, 5, 1, 0]];
    return { vertices, faces };
  }

  function plugs() { return { kind: 'element', className: 'DmePlugList', fields: [{ key: 'id', type: 'elementid', value: uid() }, { key: 'names', type: 'string_array', value: [] }, { key: 'dataTypes', type: 'int_array', value: [] }, { key: 'plugTypes', type: 'int_array', value: [] }, { key: 'descriptions', type: 'string_array', value: [] }] }; }

  function makeMesh(options, nodeID) {
    const geometry = options.vertices?.length && options.faces?.length ? { vertices: options.vertices.map(v => vec(v)), faces: options.faces.map(f => [...f]) } : boxGeometry(options.size || [128, 128, 128]);
    const faceMaterials = options.faceMaterials || geometry.faces.map((_, i) => options.materials?.[FACE_NAMES[i]] || options.material || 'ERROR');
    const meshData = makeMeshData(geometry.vertices, geometry.faces, faceMaterials, options.meshName || 'meshData');
    return { kind: 'element', className: 'CMapMesh', fields: [
      { key: 'id', type: 'elementid', value: uid() }, { key: 'nodeID', type: 'int', value: String(nodeID) }, { key: 'referenceID', type: 'uint64', value: ref64() },
      { key: 'children', type: 'element_array', value: [] }, { key: 'variableTargetKeys', type: 'string_array', value: [] }, { key: 'variableNames', type: 'string_array', value: [] },
      { key: 'meshData', type: 'CDmePolygonMesh', value: meshData }, { key: 'origin', type: 'vector3', value: vs(options.position || [0, 0, 64]) },
      { key: 'angles', type: 'qangle', value: vs(options.rotation || [0, 0, 0]) }, { key: 'scales', type: 'vector3', value: vs(options.scale || [1, 1, 1]) },
      { key: 'transformLocked', type: 'bool', value: '0' }, { key: 'force_hidden', type: 'bool', value: options.visible === false ? '1' : '0' },
      { key: 'editorOnly', type: 'bool', value: '0' }, { key: 'randomSeed', type: 'int', value: String(Math.random() * 2147483647 | 0) },
      { key: 'physicsType', type: 'string', value: options.collision === false ? 'none' : 'default' }
    ] };
  }

  function makeEntity(options, nodeID) {
    const properties = [{ key: 'id', type: 'elementid', value: uid() }, { key: 'classname', type: 'string', value: options.className || 'info_target' }, { key: 'targetname', type: 'string', value: options.name || '' }];
    if (options.model) properties.push({ key: 'model', type: 'string', value: options.model });
    for (const [key, value] of Object.entries(options.entityProperties || {})) if (!['id', 'classname', 'targetname', 'model'].includes(key)) properties.push({ key, type: 'string', value: String(value) });
    if (String(options.className || '').startsWith('prop_') && !properties.some(x => x.key === 'solid')) properties.push({ key: 'solid', type: 'string', value: options.collision === false ? '0' : '6' });
    return { kind: 'element', className: 'CMapEntity', fields: [
      { key: 'id', type: 'elementid', value: uid() }, { key: 'nodeID', type: 'int', value: String(nodeID) }, { key: 'referenceID', type: 'uint64', value: ref64() },
      { key: 'children', type: 'element_array', value: [] }, { key: 'variableTargetKeys', type: 'string_array', value: [] }, { key: 'variableNames', type: 'string_array', value: [] },
      { key: 'relayPlugData', type: 'DmePlugList', value: plugs() }, { key: 'connectionsData', type: 'element_array', value: [] },
      { key: 'entity_properties', type: 'EditGameClassProps', value: { kind: 'element', className: 'EditGameClassProps', fields: properties } },
      { key: 'origin', type: 'vector3', value: vs(options.position || [0, 0, 16]) }, { key: 'angles', type: 'qangle', value: vs(options.rotation || [0, 0, 0]) },
      { key: 'scales', type: 'vector3', value: vs(options.scale || [1, 1, 1]) }, { key: 'force_hidden', type: 'bool', value: options.visible === false ? '1' : '0' }, { key: 'editorOnly', type: 'bool', value: '0' }
    ] };
  }

  function applyObjectToDocument(doc, o) {
    if (!o?.dmxId) return false;
    const e = find(doc, o.dmxId);
    if (!e) return false;
    set(e, 'origin', 'vector3', vs(o.position || [0, 0, 0]));
    set(e, 'angles', 'qangle', vs(o.rotation || [0, 0, 0]));
    set(e, 'scales', 'vector3', vs(o.scale || [1, 1, 1]));
    set(e, 'force_hidden', 'bool', o.visible === false ? '1' : '0');
    if (e.className === 'CMapMesh') {
      const old = elem(e, 'meshData');
      const oldName = String(get(old, 'name', 'meshData'));
      const oldId = String(get(old, 'id', uid()));
      const vertices = o.vertices?.length ? o.vertices.map(v => vec(v)) : boxGeometry(o.size).vertices;
      const faces = o.faces?.length ? o.faces.map(f => [...f]) : boxGeometry(o.size).faces;
      const faceMaterials = o.faceMaterials?.length === faces.length ? [...o.faceMaterials] : faces.map((_, i) => o.materials?.[FACE_NAMES[i]] || 'ERROR');
      set(e, 'meshData', 'CDmePolygonMesh', makeMeshData(vertices, faces, faceMaterials, oldName, oldId));
      set(e, 'physicsType', 'string', o.collision === false ? 'none' : 'default');
      o.vertices = vertices; o.faces = faces; o.faceMaterials = faceMaterials; o.size = geometryBounds(vertices).size;
      o.materials ??= {};
      FACE_NAMES.forEach((name, i) => o.materials[name] = faceMaterials[i] || faceMaterials[0] || 'ERROR');
    } else if (e.className === 'CMapEntity') {
      const props = elem(e, 'entity_properties');
      set(props, 'classname', 'string', o.className || 'info_target');
      set(props, 'targetname', 'string', o.name || '');
      if (o.model !== undefined) set(props, 'model', 'string', o.model || '');
      if (String(o.className || '').startsWith('prop_')) { o.entityProperties ??= {}; o.entityProperties.solid = o.collision === false ? '0' : '6'; }
      for (const [key, value] of Object.entries(o.entityProperties || {})) set(props, key, 'string', String(value));
    }
    return true;
  }

  const addPart = (doc, options = {}) => { const e = makeMesh(options, maxNode(doc) + 1); children(doc).push(e); return meshObject(e); };
  const addEntity = (doc, options = {}) => { const e = makeEntity(options, maxNode(doc) + 1); children(doc).push(e); return entityObject(e); };

  function removeObject(doc, o) {
    const remove = list => {
      const i = list.findIndex(x => x?.kind && String(get(x, 'id', '')) === String(o.dmxId));
      if (i >= 0) { list.splice(i, 1); return true; }
      for (const e of list) if (e?.kind && remove(ary(e, 'children'))) return true;
      return false;
    };
    return remove(children(doc));
  }

  function duplicateObject(doc, o) {
    const src = find(doc, o.dmxId);
    if (!src) return null;
    const copy = clone(src);
    let id = maxNode(doc);
    walk(copy, e => {
      const f = field(e, 'id'); if (f?.type === 'elementid') f.value = uid();
      const nf = field(e, 'nodeID'); if (nf) nf.value = String(++id);
      const rf = field(e, 'referenceID'); if (rf) rf.value = ref64();
    });
    const p = vec(get(copy, 'origin', '0 0 0')); p[0] += 32; p[1] += 32; set(copy, 'origin', 'vector3', vs(p));
    children(doc).push(copy);
    return copy.className === 'CMapMesh' ? meshObject(copy) : entityObject(copy);
  }

  function removeHelpersFrom(list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (isHelperMesh(e)) { list.splice(i, 1); continue; }
      if (e?.kind) removeHelpersFrom(ary(e, 'children'));
    }
  }

  function helperFor(o, type, material, nodeID) {
    const mats = Object.fromEntries(FACE_NAMES.map(f => [f, material]));
    return makeMesh({ size: o.size || [64, 64, 64], position: o.position, rotation: o.rotation, scale: o.scale, materials: mats, material, collision: true, meshName: `${HELPER_PREFIX}${type}_${o.dmxId}` }, nodeID);
  }

  function syncCollisionHelpers(doc, objects) {
    const list = children(doc);
    removeHelpersFrom(list);
    let node = maxNode(doc);
    for (const o of objects || []) {
      if (!o?.dmxId || !['part', 'prop'].includes(o.type)) continue;
      if (o.blockPlayers && o.collision === false) list.push(helperFor(o, 'players', TOOL_MATERIALS.players, ++node));
      if (o.blockGrenades) list.push(helperFor(o, 'grenades', TOOL_MATERIALS.grenades, ++node));
      if (o.blockBullets) list.push(helperFor(o, 'bullets', TOOL_MATERIALS.bullets, ++node));
    }
    return doc;
  }

  function prepareForSave(doc, objects) {
    const out = clone(doc);
    for (const o of objects || []) if (o?.dmxId) applyObjectToDocument(out, o);
    syncCollisionHelpers(out, objects);
    return out;
  }

  function extrudeFace(o, faceIndex, distance = 32) {
    if (o?.type !== 'part' || !o.vertices?.length || !o.faces?.[faceIndex]) return false;
    const face = o.faces[faceIndex];
    if (face.length < 3) return false;
    const normal = faceNormal(o.vertices, face);
    const offset = mul(normal, num(distance, 32));
    const map = new Map();
    for (const oldIndex of face) { map.set(oldIndex, o.vertices.length); o.vertices.push(add(o.vertices[oldIndex], offset)); }
    const cap = face.map(i => map.get(i));
    const sideFaces = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length], na = map.get(a), nb = map.get(b);
      sideFaces.push([a, b, nb, na]);
    }
    const selectedMaterial = o.faceMaterials?.[faceIndex] || 'ERROR';
    o.faces.splice(faceIndex, 1, cap, ...sideFaces);
    o.faceMaterials ??= [];
    o.faceMaterials.splice(faceIndex, 1, selectedMaterial, ...sideFaces.map(() => selectedMaterial));
    o.size = geometryBounds(o.vertices).size;
    return true;
  }

  function clipAxis(o, axis = 0, plane = 0, keepPositive = true) {
    if (o?.type !== 'part' || !o.vertices?.length || !o.faces?.length) return false;
    axis = Math.max(0, Math.min(2, Number(axis) || 0));
    plane = num(plane, 0);
    const vertices = o.vertices.map(v => [...v]);
    const resultFaces = [];
    const resultMaterials = [];
    const intersections = [];
    const vertexMap = new Map();
    const key = v => v.map(x => Number(x.toFixed(5))).join(',');
    const addVertex = v => { const k = key(v); if (vertexMap.has(k)) return vertexMap.get(k); const i = vertices.length; vertices.push(v); vertexMap.set(k, i); return i; };
    o.vertices.forEach((v, i) => vertexMap.set(key(v), i));
    const inside = v => keepPositive ? v[axis] >= plane - 1e-6 : v[axis] <= plane + 1e-6;

    o.faces.forEach((face, fi) => {
      const poly = face.map(i => ({ idx: i, v: o.vertices[i] }));
      const clipped = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ai = inside(a.v), bi = inside(b.v);
        if (ai) clipped.push(a.idx);
        if (ai !== bi) {
          const denom = b.v[axis] - a.v[axis];
          if (Math.abs(denom) > 1e-9) {
            const t = (plane - a.v[axis]) / denom;
            const v = a.v.map((x, d) => x + (b.v[d] - x) * t);
            v[axis] = plane;
            const idx = addVertex(v);
            clipped.push(idx);
            intersections.push(idx);
          }
        }
      }
      const clean = clipped.filter((x, i, a) => i === 0 || x !== a[i - 1]);
      if (clean.length >= 3) { resultFaces.push(clean); resultMaterials.push(o.faceMaterials?.[fi] || 'ERROR'); }
    });

    const uniqueIntersections = [...new Set(intersections)];
    if (uniqueIntersections.length >= 3) {
      const center = [0, 0, 0];
      uniqueIntersections.forEach(i => vertices[i].forEach((x, d) => center[d] += x / uniqueIntersections.length));
      const dims = [0, 1, 2].filter(d => d !== axis);
      uniqueIntersections.sort((ia, ib) => {
        const a = vertices[ia], b = vertices[ib];
        return Math.atan2(a[dims[1]] - center[dims[1]], a[dims[0]] - center[dims[0]]) - Math.atan2(b[dims[1]] - center[dims[1]], b[dims[0]] - center[dims[0]]);
      });
      const desired = [0, 0, 0]; desired[axis] = keepPositive ? -1 : 1;
      const candidate = [...uniqueIntersections];
      if (dot(faceNormal(vertices, candidate), desired) < 0) candidate.reverse();
      resultFaces.push(candidate);
      resultMaterials.push('ERROR');
    }
    if (!resultFaces.length) return false;

    const used = [...new Set(resultFaces.flat())].sort((a, b) => a - b);
    const remap = new Map(used.map((old, i) => [old, i]));
    o.vertices = used.map(i => vertices[i]);
    o.faces = resultFaces.map(f => f.map(i => remap.get(i)));
    o.faceMaterials = resultMaterials;
    o.size = geometryBounds(o.vertices).size;
    return true;
  }

  function createEmptyDocument() {
    const worldProps = { kind: 'element', className: 'EditGameClassProps', fields: [{ key: 'id', type: 'elementid', value: uid() }, { key: 'classname', type: 'string', value: 'worldspawn' }, { key: 'targetname', type: 'string', value: '' }, { key: 'skyname', type: 'string', value: 'sky_day01_01' }] };
    const w = { kind: 'element', className: 'CMapWorld', fields: [
      { key: 'id', type: 'elementid', value: uid() }, { key: 'nodeID', type: 'int', value: '1' }, { key: 'referenceID', type: 'uint64', value: '0x0' },
      { key: 'children', type: 'element_array', value: [] }, { key: 'variableTargetKeys', type: 'string_array', value: [] }, { key: 'variableNames', type: 'string_array', value: [] },
      { key: 'relayPlugData', type: 'DmePlugList', value: plugs() }, { key: 'connectionsData', type: 'element_array', value: [] }, { key: 'entity_properties', type: 'EditGameClassProps', value: worldProps },
      { key: 'origin', type: 'vector3', value: '0 0 0' }, { key: 'angles', type: 'qangle', value: '0 0 0' }, { key: 'scales', type: 'vector3', value: '1 1 1' }
    ] };
    const root = { kind: 'element', className: 'CMapRootElement', fields: [
      { key: 'id', type: 'elementid', value: uid() }, { key: 'isprefab', type: 'bool', value: '0' }, { key: 'editorbuild', type: 'int', value: '10533' }, { key: 'editorversion', type: 'int', value: '400' }, { key: 'itemFile', type: 'string', value: '' },
      { key: 'world', type: 'CMapWorld', value: w },
      { key: 'mapVariables', type: 'CMapVariableSet', value: { kind: 'element', className: 'CMapVariableSet', fields: [{ key: 'id', type: 'elementid', value: uid() }, { key: 'variableNames', type: 'string_array', value: [] }, { key: 'variableValues', type: 'string_array', value: [] }] } },
      { key: 'rootSelectionSet', type: 'CMapSelectionSet', value: { kind: 'element', className: 'CMapSelectionSet', fields: [{ key: 'id', type: 'elementid', value: uid() }, { key: 'children', type: 'element_array', value: [] }, { key: 'selectionSetName', type: 'string', value: '' }, { key: 'selectionSetData', type: 'element', value: '' }] } }
    ] };
    return { header: HEADER, elements: [{ kind: 'element', className: '$prefix_element$', fields: [{ key: 'id', type: 'elementid', value: uid() }, { key: 'asset_preview_thumbnail', type: 'binary', value: '' }, { key: 'asset_preview_thumbnail_format', type: 'string', value: 'jpg' }, { key: 'map_asset_references', type: 'string_array', value: [] }] }, root] };
  }

  function validate(doc) {
    const errors = [];
    const root = doc?.elements?.find(e => e.className === 'CMapRootElement');
    if (!root) errors.push('CMapRootElement is missing.');
    if (root && !elem(root, 'world')) errors.push('CMapWorld is missing.');
    return { ok: !errors.length, errors, warnings: [] };
  }

  window.EPH_VMAP = {
    DEFAULT_HEADER: HEADER, FACE_NAMES, HELPER_PREFIX, TOOL_MATERIALS,
    parse, stringify, validate, createEmptyDocument, extractObjects, applyObjectToDocument, prepareForSave, syncCollisionHelpers,
    addPart, addEntity, removeObject, duplicateObject, extrudeFace, clipAxis,
    getWorld: world, getWorldChildren: children, findElementByDmxId: find, parseVector: vec, vectorString: vs, geometryBounds, faceNormal
  };
})();
