// byanca
(() => {
  'use strict';
  if (window.__ephNegativeBrushV22) return;
  window.__ephNegativeBrushV22 = true;

  const VMAP = window.EPH_VMAP;
  const EPSILON = 1e-5;
  const RAD = Math.PI / 180;
  const MAX_CUTTER_POLYGONS = 12000;
  const MAX_SOURCE_POLYGONS = 100000;
  const MAX_RESULT_POLYGONS = 150000;
  let viewport = null;
  let prepareWrapped = false;
  let extrasWrapped = false;
  let viewportWrapped = false;

  const clone = value => {
    if (value === undefined) return undefined;
    try { return structuredClone(value); }
    catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
  };

  const report = (message, kind = 'info', data = null) => {
    const suffix = data ? ` ${JSON.stringify(data)}` : '';
    try { console[kind === 'error' ? 'error' : kind === 'warning' ? 'warn' : 'info'](`[Negative Brush] ${message}`, data || ''); } catch {}
    try { if (typeof log === 'function') log(`[Negative Brush] ${message}${suffix}`, kind); } catch {}
  };

  class Vertex {
    constructor(pos) { this.pos = pos; }
    clone() { return new Vertex(this.pos.clone()); }
    flip() { return this; }
    interpolate(other, t) { return new Vertex(this.pos.clone().lerp(other.pos, t)); }
  }

  class Plane {
    constructor(normal, w) { this.normal = normal; this.w = w; }
    clone() { return new Plane(this.normal.clone(), this.w); }
    flip() { this.normal.negate(); this.w = -this.w; }
    static fromPoints(a, b, c) {
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      if (normal.lengthSq() < EPSILON * EPSILON) return null;
      normal.normalize();
      return new Plane(normal, normal.dot(a));
    }
    splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
      const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
      let polygonType = 0;
      const types = polygon.vertices.map(vertex => {
        const distance = this.normal.dot(vertex.pos) - this.w;
        const type = distance < -EPSILON ? BACK : distance > EPSILON ? FRONT : COPLANAR;
        polygonType |= type;
        return type;
      });

      if (polygonType === COPLANAR) {
        (this.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
        return;
      }
      if (polygonType === FRONT) { front.push(polygon); return; }
      if (polygonType === BACK) { back.push(polygon); return; }

      const f = [], b = [];
      for (let i = 0; i < polygon.vertices.length; i++) {
        const j = (i + 1) % polygon.vertices.length;
        const ti = types[i], tj = types[j];
        const vi = polygon.vertices[i], vj = polygon.vertices[j];
        if (ti !== BACK) f.push(vi);
        if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
        if ((ti | tj) === SPANNING) {
          const direction = vj.pos.clone().sub(vi.pos);
          const denom = this.normal.dot(direction);
          if (Math.abs(denom) < EPSILON) continue;
          const t = (this.w - this.normal.dot(vi.pos)) / denom;
          const v = vi.interpolate(vj, Math.max(0, Math.min(1, t)));
          f.push(v);
          b.push(v.clone());
        }
      }
      if (f.length >= 3) {
        const poly = new Polygon(f, polygon.shared);
        if (poly.plane) front.push(poly);
      }
      if (b.length >= 3) {
        const poly = new Polygon(b, polygon.shared);
        if (poly.plane) back.push(poly);
      }
    }
  }

  class Polygon {
    constructor(vertices, shared = null) {
      this.vertices = vertices;
      this.shared = shared;
      this.plane = vertices.length >= 3 ? Plane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos) : null;
    }
    clone() { return new Polygon(this.vertices.map(vertex => vertex.clone()), clone(this.shared)); }
    flip() {
      this.vertices.reverse().forEach(vertex => vertex.flip());
      this.plane?.flip();
    }
  }

  class Node {
    constructor(polygons = []) {
      this.plane = null;
      this.front = null;
      this.back = null;
      this.polygons = [];
      if (polygons.length) this.build(polygons);
    }
    clone() {
      const node = new Node();
      node.plane = this.plane?.clone() || null;
      node.front = this.front?.clone() || null;
      node.back = this.back?.clone() || null;
      node.polygons = this.polygons.map(polygon => polygon.clone());
      return node;
    }
    invert() {
      for (const polygon of this.polygons) polygon.flip();
      this.plane?.flip();
      this.front?.invert();
      this.back?.invert();
      [this.front, this.back] = [this.back, this.front];
    }
    clipPolygons(polygons) {
      if (!this.plane) return polygons.slice();
      let front = [], back = [];
      for (const polygon of polygons) this.plane.splitPolygon(polygon, front, back, front, back);
      if (this.front) front = this.front.clipPolygons(front);
      if (this.back) back = this.back.clipPolygons(back); else back = [];
      return front.concat(back);
    }
    clipTo(node) {
      this.polygons = node.clipPolygons(this.polygons);
      this.front?.clipTo(node);
      this.back?.clipTo(node);
    }
    allPolygons() {
      let polygons = this.polygons.slice();
      if (this.front) polygons = polygons.concat(this.front.allPolygons());
      if (this.back) polygons = polygons.concat(this.back.allPolygons());
      return polygons;
    }
    build(polygons) {
      if (!polygons.length) return;
      if (!this.plane) this.plane = polygons.find(polygon => polygon.plane)?.plane?.clone() || null;
      if (!this.plane) return;
      const front = [], back = [];
      for (const polygon of polygons) {
        if (!polygon.plane) continue;
        this.plane.splitPolygon(polygon, this.polygons, this.polygons, front, back);
      }
      if (front.length) { if (!this.front) this.front = new Node(); this.front.build(front); }
      if (back.length) { if (!this.back) this.back = new Node(); this.back.build(back); }
    }
  }

  function subtractPolygons(aPolygons, bPolygons) {
    const a = new Node(aPolygons.map(polygon => polygon.clone()));
    const b = new Node(bPolygons.map(polygon => polygon.clone()));
    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    a.invert();
    return a.allPolygons().filter(polygon => polygon.plane && polygon.vertices.length >= 3);
  }

  function matrixFor(object) {
    const THREE = window.EPH_THREE || window.THREE;
    const position = new THREE.Vector3(...(object.position || [0, 0, 0]).map(Number));
    const rotation = object.rotation || [0, 0, 0];
    let quaternion = window.EPH_COORDINATES?.qAngleToQuaternion?.(rotation) || null;
    if (!quaternion) {
      const pitch = (Number(rotation[0]) || 0) * RAD;
      const yaw = (Number(rotation[1]) || 0) * RAD;
      const roll = (Number(rotation[2]) || 0) * RAD;
      const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
      const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pitch);
      const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll);
      quaternion = qYaw.multiply(qPitch).multiply(qRoll).normalize();
    }
    const scale = new THREE.Vector3(...(object.scale || [1, 1, 1]).map(value => Number.isFinite(Number(value)) ? Number(value) : 1));
    return new THREE.Matrix4().compose(position, quaternion, scale);
  }

  const undirectedEdgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;

  function cleanFaceIndices(face, vertexCount) {
    const output = [];
    for (const raw of Array.isArray(face) ? face : []) {
      const index = Number(raw);
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount) continue;
      if (output.at(-1) !== index) output.push(index);
    }
    if (output.length > 2 && output[0] === output.at(-1)) output.pop();
    return new Set(output).size >= 3 ? output : [];
  }

  // The old implementation oriented every face by asking whether it pointed
  // away from the mesh bounding-box center. That only works for convex meshes.
  // After the first hole, cavity faces legitimately point toward that center;
  // the next carve therefore flipped them inside-out and produced the exact
  // same-winding/non-manifold failure seen in the diagnostics. Instead, solve
  // face orientation from shared edges and then orient each closed component by
  // signed volume. This works for concave meshes and for repeated CSG holes.
  function outwardFaces(object) {
    const vertices = object?.vertices || [];
    const faces = (object?.faces || []).map(face => cleanFaceIndices(face, vertices.length)).filter(face => face.length >= 3);
    if (!faces.length) return [];

    const usage = new Map();
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
      const face = faces[faceIndex];
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i + 1) % face.length];
        const key = undirectedEdgeKey(a, b);
        const list = usage.get(key) || [];
        list.push({ faceIndex, a, b });
        usage.set(key, list);
      }
    }

    const graph = Array.from({ length: faces.length }, () => []);
    for (const list of usage.values()) {
      if (list.length !== 2) continue;
      const a = list[0], b = list[1];
      const xor = a.a === b.a && a.b === b.b ? 1 : 0;
      graph[a.faceIndex].push({ face: b.faceIndex, xor });
      graph[b.faceIndex].push({ face: a.faceIndex, xor });
    }

    const flip = Array(faces.length).fill(null);
    const components = [];
    for (let start = 0; start < faces.length; start++) {
      if (flip[start] !== null) continue;
      flip[start] = 0;
      const component = [];
      const queue = [start];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const current = queue[cursor];
        component.push(current);
        for (const edge of graph[current]) {
          const wanted = flip[current] ^ edge.xor;
          if (flip[edge.face] === null) {
            flip[edge.face] = wanted;
            queue.push(edge.face);
          }
        }
      }
      components.push(component);
    }

    for (let index = 0; index < faces.length; index++) if (flip[index]) faces[index].reverse();

    const signedVolume = component => {
      let volume = 0;
      for (const faceIndex of component) {
        const face = faces[faceIndex];
        const a = vertices[face[0]];
        if (!a) continue;
        for (let i = 1; i < face.length - 1; i++) {
          const b = vertices[face[i]], c = vertices[face[i + 1]];
          if (!b || !c) continue;
          volume += (
            a[0] * (b[1] * c[2] - b[2] * c[1])
            + a[1] * (b[2] * c[0] - b[0] * c[2])
            + a[2] * (b[0] * c[1] - b[1] * c[0])
          ) / 6;
        }
      }
      return volume;
    };

    for (const component of components) {
      if (signedVolume(component) < -EPSILON) {
        for (const faceIndex of component) faces[faceIndex].reverse();
      }
    }
    return faces;
  }

  function objectPolygons(object, forcedMaterial = null) {
    const THREE = window.EPH_THREE || window.THREE;
    const matrix = matrixFor(object);
    const polygons = [];
    const faces = outwardFaces(object);
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
      const face = faces[faceIndex];
      const points = face.map(index => new THREE.Vector3(...(object.vertices?.[index] || [0, 0, 0])));
      if (points.length < 3) continue;
      const material = forcedMaterial || object.faceMaterials?.[faceIndex] || object.faceMaterials?.[0] || 'ERROR';
      for (let index = 1; index < points.length - 1; index++) {
        const vertices = [points[0], points[index], points[index + 1]].map(point => new Vertex(point.clone().applyMatrix4(matrix)));
        const polygon = new Polygon(vertices, { material });
        if (polygon.plane) polygons.push(polygon);
      }
    }
    return polygons;
  }

  function worldBounds(object) {
    const THREE = window.EPH_THREE || window.THREE;
    const matrix = matrixFor(object);
    const box = new THREE.Box3();
    for (const vertex of object.vertices || []) box.expandByPoint(new THREE.Vector3(...vertex).applyMatrix4(matrix));
    return box;
  }

  function canonicalFaceKey(face) {
    const values = [...face];
    if (!values.length) return '';
    const variants = [];
    for (const candidate of [values, [...values].reverse()]) {
      for (let offset = 0; offset < candidate.length; offset++) variants.push(candidate.slice(offset).concat(candidate.slice(0, offset)).join(':'));
    }
    variants.sort();
    return variants[0] || '';
  }

  function applyPolygons(target, polygons) {
    const inverse = matrixFor(target).invert();
    const vertices = [];
    const faces = [];
    const materials = [];
    const indexByKey = new Map();
    const faceKeys = new Set();
    const keyFor = vector => [vector.x, vector.y, vector.z].map(value => Number(value.toFixed(5))).join(',');
    const indexFor = vector => {
      const local = vector.clone().applyMatrix4(inverse);
      const key = keyFor(local);
      if (indexByKey.has(key)) return indexByKey.get(key);
      const index = vertices.length;
      vertices.push([local.x, local.y, local.z]);
      indexByKey.set(key, index);
      return index;
    };

    for (const polygon of polygons) {
      const face = polygon.vertices.map(vertex => indexFor(vertex.pos));
      const clean = cleanFaceIndices(face, vertices.length);
      if (clean.length < 3) continue;
      const faceKey = canonicalFaceKey(clean);
      if (faceKeys.has(faceKey)) continue;
      faceKeys.add(faceKey);
      faces.push(clean);
      materials.push(polygon.shared?.material || target.faceMaterials?.[0] || 'ERROR');
    }
    if (!faces.length) return false;

    target.vertices = vertices;
    target.faces = faces;
    target.faceMaterials = materials;

    // Normalize the fresh BSP surface before the Hammer serializer sees it.
    // The late V36 wrapper remains as a second safety net for T-junctions.
    const repair = window.EPH_MESH_TOPOLOGY?.repairTjunctions?.(target.vertices, target.faces);
    if (repair?.ok && repair.changed) target.faces = repair.faces;

    target.size = VMAP.geometryBounds(vertices).size;
    target.materials ||= {};
    VMAP.FACE_NAMES?.forEach((name, index) => target.materials[name] = materials[index] || materials[0] || 'ERROR');
    delete target.faceUVs;
    delete target.faceTextureScale;
    delete target.faceTextureAxisU;
    delete target.faceTextureAxisV;
    delete target.faceTextureSizes;
    return true;
  }

  function selectedParts() {
    const ids = new Set();
    const add = list => { for (const id of Array.isArray(list) ? list : []) if (id) ids.add(id); };
    try { add(window.EPH_MULTI_SELECTION?.ids?.()); } catch {}
    add(S?.multiSelectedIds);
    add(S?.viewport?.multiSelectedIds);
    if (S?.selectedId) ids.add(S.selectedId);
    return [...ids].map(id => S.objects.find(object => object.id === id)).filter(object => object?.type === 'part');
  }

  function removeObject(object) {
    if (!object) return;
    if (object.dmxId) VMAP.removeObject?.(S.doc, object);
    const index = S.objects.findIndex(item => item.id === object.id);
    if (index >= 0) S.objects.splice(index, 1);
  }

  function carveSelected() {
    const parts = selectedParts();
    const negatives = parts.filter(part => part.ephNegative);
    const normals = parts.filter(part => !part.ephNegative);
    report('Carve requested', 'info', {
      selected: parts.map(part => part.name || part.id),
      negatives: negatives.map(part => part.name || part.id),
      normals: normals.map(part => part.name || part.id),
    });
    if (negatives.length !== 1 || !normals.length) {
      const reason = negatives.length !== 1
        ? `Carve needs exactly 1 Negative Part; ${negatives.length} selected.`
        : 'Carve needs at least 1 normal Part selected with the Negative Part.';
      report(reason, 'warning');
      toast?.(reason);
      return false;
    }

    const negative = negatives[0];
    const cutMaterial = normals[0]?.faceMaterials?.[0] || 'ERROR';
    const cutterPolygons = objectPolygons(negative, cutMaterial);
    if (!cutterPolygons.length) {
      report('Negative Part has no valid closed polygons.', 'warning', { name: negative.name, vertices: negative.vertices?.length, faces: negative.faces?.length });
      toast?.('The Negative Part has no valid closed geometry.');
      return false;
    }
    if (cutterPolygons.length > MAX_CUTTER_POLYGONS) {
      report('Negative Part is too complex for interactive carve.', 'warning', { polygons: cutterPolygons.length });
      toast?.('The Negative Part is too complex to carve safely.');
      return false;
    }

    pushHistory?.();
    let changed = 0;
    const surviving = [];
    const cutterBox = worldBounds(negative);

    try {
      for (const normal of normals) {
        const normalBox = worldBounds(normal);
        const intersects = cutterBox.intersectsBox(normalBox);
        report(`Testing ${normal.name || normal.id}`, 'info', { intersects });
        if (!intersects) { surviving.push(normal.id); continue; }

        const sourcePolygons = objectPolygons(normal);
        if (!sourcePolygons.length) { surviving.push(normal.id); continue; }
        if (sourcePolygons.length > MAX_SOURCE_POLYGONS) throw new Error(`${normal.name || 'Part'} is too complex for interactive CSG.`);

        const result = subtractPolygons(sourcePolygons, cutterPolygons.map(polygon => {
          const copy = polygon.clone();
          copy.shared = { material: normal.faceMaterials?.[0] || 'ERROR' };
          return copy;
        }));
        if (result.length > MAX_RESULT_POLYGONS) throw new Error(`${normal.name || 'Part'} produced too much geometry for an interactive carve.`);
        report(`CSG result for ${normal.name || normal.id}`, 'info', { inputPolygons: sourcePolygons.length, resultPolygons: result.length });

        if (!result.length) {
          removeObject(normal);
          changed++;
          continue;
        }
        if (!applyPolygons(normal, result)) { surviving.push(normal.id); continue; }
        VMAP.applyObjectToDocument?.(S.doc, normal);
        surviving.push(normal.id);
        changed++;
      }

      if (!changed) {
        S.undo?.pop?.();
        report('Carve did not intersect any selected normal Part.', 'warning');
        toast?.('The Negative Part is not touching the selected normal Part.');
        return false;
      }

      removeObject(negative);
      const primary = surviving.find(id => S.objects.some(object => object.id === id)) || normals.find(normal => S.objects.includes(normal))?.id || 'world';
      S.selectedId = primary;
      S.selectedFaces = new Set([0]);
      S.subSelection = null;
      const ids = surviving.filter(id => S.objects.some(object => object.id === id));
      window.EPH_MULTI_SELECTION?.set?.(ids.length ? ids : [primary].filter(id => id !== 'world'), primary, { render: false });
      S.viewport?.setObjects?.(S.objects, primary);
      renderAll?.();
      markDirty?.(`Carved ${negative.name || 'Negative Part'} from ${changed} Part${changed === 1 ? '' : 's'}`);
      report('Carve completed', 'info', { cutter: negative.name || negative.id, changed });
      toast?.(`Carved hole in ${changed} Part${changed === 1 ? '' : 's'}.`);
      return true;
    } catch (error) {
      S.undo?.pop?.();
      report(`CSG failed: ${error?.message || error}`, 'error', { stack: error?.stack || '' });
      toast?.(error?.message || 'Could not carve that geometry.');
      return false;
    }
  }

  function toggleNegative(object) {
    if (!object || object.type !== 'part') return;
    pushHistory?.();
    object.ephNegative = !object.ephNegative;
    applyNegativeVisual(object);
    markDirty?.(`${object.ephNegative ? 'Made' : 'Cleared'} Negative Part ${object.name || ''}`.trim());
    report(`${object.ephNegative ? 'Enabled' : 'Disabled'} Negative Part`, 'info', { name: object.name || object.id });
    injectUi();
    refreshTreeStyles();
  }

  function applyNegativeVisual(object) {
    const vp = viewport || S?.viewport || window.EPH3D;
    const root = vp?.objectRoots?.get?.(object?.id);
    if (!root) return;
    root.traverse?.(child => {
      if (!child.isMesh) return;
      if (object.ephNegative) {
        if (!child.userData.ephNegativeOriginalMaterial) child.userData.ephNegativeOriginalMaterial = child.material;
        if (child.userData.ephNegativeStyled) return;
        const originals = Array.isArray(child.material) ? child.material : [child.material];
        const styled = originals.map(material => {
          const copy = material?.clone?.() || material;
          if (copy?.color?.set) copy.color.set(0xff4b55);
          if (copy) { copy.transparent = true; copy.opacity = 0.40; copy.depthWrite = false; copy.needsUpdate = true; }
          return copy;
        });
        child.material = Array.isArray(child.material) ? styled : styled[0];
        child.userData.ephNegativeStyled = true;
      } else if (child.userData.ephNegativeOriginalMaterial) {
        child.material = child.userData.ephNegativeOriginalMaterial;
        delete child.userData.ephNegativeOriginalMaterial;
        delete child.userData.ephNegativeStyled;
      }
    });
  }

  function refreshNegativeVisuals() {
    viewport = S?.viewport || window.EPH3D || viewport;
    for (const object of S?.objects || []) if (object?.type === 'part') applyNegativeVisual(object);
  }

  function refreshTreeStyles() {
    const rows = document.querySelectorAll('#sceneTree .tree-row[data-object-id]');
    for (const row of rows) {
      const object = S?.objects?.find(item => item.id === row.dataset.objectId);
      row.classList.toggle('eph-negative-part-row', Boolean(object?.ephNegative));
    }
  }

  function injectUi() {
    const object = S?.objects?.find(item => item.id === S.selectedId);
    const host = document.getElementById('propertiesContent');
    if (!host || object?.type !== 'part') return;
    let section = host.querySelector('.eph-negative-brush-section');
    if (!section) {
      section = document.createElement('div');
      section.className = 'property-section eph-negative-brush-section';
      host.appendChild(section);
    }
    const parts = selectedParts();
    const negativeCount = parts.filter(part => part.ephNegative).length;
    const normalCount = parts.length - negativeCount;
    const ready = negativeCount === 1 && normalCount >= 1;
    section.innerHTML = `
      <div class="property-section-title">Boolean / CSG</div>
      <div class="eph-negative-actions">
        <button id="ephNegativeToggle" class="mini-button wide ${object.ephNegative ? 'on' : ''}" type="button">Negative Part: ${object.ephNegative ? 'ON' : 'OFF'}</button>
        <button id="ephNegativeCarve" class="mini-button wide ${ready ? 'eph-csg-ready' : ''}" type="button">Carve Selected</button>
      </div>
      <div class="selection-info">Selected: ${parts.length} Part${parts.length === 1 ? '' : 's'} • ${negativeCount} negative • ${normalCount} normal<br>${ready ? 'Ready — click Carve Selected.' : 'Select exactly one negative Part and one or more normal Parts with Ctrl/Shift.'}</div>`;
    section.querySelector('#ephNegativeToggle').onclick = () => toggleNegative(object);
    section.querySelector('#ephNegativeCarve').onclick = () => window.EPH_NEGATIVE_BRUSH?.carve?.();
  }

  function installExtras() {
    if (extrasWrapped || typeof extras !== 'function' || typeof applyExtras !== 'function') return false;
    const rawExtras = extras;
    const rawApplyExtras = applyExtras;
    extras = function() {
      const result = rawExtras();
      for (const object of S?.objects || []) {
        if (!object?.dmxId) continue;
        result[object.id] ||= {};
        if (object.ephNegative) result[object.id].ephNegative = true;
      }
      return result;
    };
    applyExtras = function(data) {
      const result = rawApplyExtras(data);
      if (data) for (const object of S?.objects || []) if (data[object.id]?.ephNegative !== undefined) object.ephNegative = Boolean(data[object.id].ephNegative);
      return result;
    };
    window.extras = extras;
    window.applyExtras = applyExtras;
    extrasWrapped = true;
    return true;
  }

  function installSaveGuard() {
    if (prepareWrapped || !VMAP?.prepareForSave) return false;
    const rawPrepare = VMAP.prepareForSave.bind(VMAP);
    VMAP.prepareForSave = function(doc, objects) {
      const exported = (objects || []).filter(object => !object?.ephNegative);
      const out = rawPrepare(doc, exported);
      for (const object of objects || []) {
        if (!object?.ephNegative || !object.dmxId) continue;
        VMAP.removeObject?.(out, object);
      }
      return out;
    };
    VMAP.prepareForSave.__ephNegativeV22 = true;
    prepareWrapped = true;
    return true;
  }

  function installViewport() {
    const vp = S?.viewport || window.EPH3D;
    if (!vp?.updateObject) return false;
    viewport = vp;
    if (!viewportWrapped) {
      const rawUpdate = vp.updateObject.bind(vp);
      vp.updateObject = function(object) {
        const result = rawUpdate(object);
        if (object?.type === 'part') queueMicrotask(() => applyNegativeVisual(object));
        return result;
      };
      vp.updateObject.__ephNegativeV22 = true;
      viewportWrapped = true;
    }
    refreshNegativeVisuals();
    return true;
  }

  function ensureStyle() {
    if (document.getElementById('ephNegativeBrushV22Style')) return;
    const style = document.createElement('style');
    style.id = 'ephNegativeBrushV22Style';
    style.textContent = `
      .eph-negative-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .eph-negative-actions button:disabled{opacity:.38;cursor:default}
      .eph-negative-actions #ephNegativeToggle.on{border-color:#b34b52;background:#5a2025;color:#ffd5d7}
      .eph-negative-actions #ephNegativeCarve.eph-csg-ready{border-color:#4f8e62;background:#173822;color:#d8ffe3}
      .tree-row.eph-negative-part-row .tree-name{color:#ff8b91}
      .tree-row.eph-negative-part-row .tree-icon{filter:sepia(1) saturate(5) hue-rotate(315deg)}
    `;
    document.head.appendChild(style);
  }

  function installUiObserver() {
    const host = document.getElementById('propertiesContent');
    if (!host || host.dataset.ephNegativeObserver === '1') return Boolean(host);
    host.dataset.ephNegativeObserver = '1';
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; injectUi(); });
    }).observe(host, { childList: true, subtree: false });
    injectUi();
    return true;
  }

  function install() {
    if (typeof S === 'undefined' || !VMAP) return false;
    ensureStyle();
    installExtras();
    installSaveGuard();
    installViewport();
    installUiObserver();
    injectUi();
    refreshTreeStyles();
    return true;
  }

  window.EPH_NEGATIVE_BRUSH = {
    carve: carveSelected,
    toggle: toggleNegative,
    refresh: () => { refreshNegativeVisuals(); refreshTreeStyles(); injectUi(); },
    selectedParts,
  };

  install();
  const timer = setInterval(() => {
    install();
    refreshNegativeVisuals();
    refreshTreeStyles();
    injectUi();
  }, 300);
  setTimeout(() => clearInterval(timer), 30000);
  window.addEventListener('eph3d-ready', installViewport);
})();
