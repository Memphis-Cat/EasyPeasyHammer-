// byanca
(() => {
  'use strict';
  if (window.__ephNegativeBrushV22) return;
  window.__ephNegativeBrushV22 = true;

  const VMAP = window.EPH_VMAP;
  const EPSILON = 1e-5;
  const RAD = Math.PI / 180;
  let viewport = null;
  let prepareWrapped = false;
  let extrasWrapped = false;
  let viewportWrapped = false;

  const clone = value => {
    if (value === undefined) return undefined;
    try { return structuredClone(value); }
    catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
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
        const t = this.normal.dot(vertex.pos) - this.w;
        const type = t < -EPSILON ? BACK : t > EPSILON ? FRONT : COPLANAR;
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
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (Number(rotation[0]) || 0) * RAD,
      (Number(rotation[1]) || 0) * RAD,
      (Number(rotation[2]) || 0) * RAD,
      'XYZ'
    ));
    const scale = new THREE.Vector3(...(object.scale || [1, 1, 1]).map(value => Number.isFinite(Number(value)) ? Number(value) : 1));
    return new THREE.Matrix4().compose(position, quaternion, scale);
  }

  function orientedFace(object, face) {
    const THREE = window.EPH_THREE || window.THREE;
    const points = face.map(index => new THREE.Vector3(...(object.vertices?.[index] || [0, 0, 0])));
    if (points.length < 3) return points;
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    if (normal.lengthSq() < EPSILON * EPSILON) return points;
    const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
    const bounds = VMAP.geometryBounds?.(object.vertices || []);
    const objectCenter = new THREE.Vector3(...(bounds?.center || [0, 0, 0]));
    if (normal.dot(center.clone().sub(objectCenter)) < 0) points.reverse();
    return points;
  }

  function objectPolygons(object, forcedMaterial = null) {
    const matrix = matrixFor(object);
    const polygons = [];
    for (let faceIndex = 0; faceIndex < (object.faces?.length || 0); faceIndex++) {
      const points = orientedFace(object, object.faces[faceIndex] || []);
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

  function applyPolygons(target, polygons) {
    const THREE = window.EPH_THREE || window.THREE;
    const inverse = matrixFor(target).invert();
    const vertices = [];
    const faces = [];
    const materials = [];
    const indexByKey = new Map();
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
      const clean = face.filter((value, index) => index === 0 || value !== face[index - 1]);
      if (clean.length >= 3 && clean[0] === clean.at(-1)) clean.pop();
      if (new Set(clean).size < 3) continue;
      faces.push(clean);
      materials.push(polygon.shared?.material || target.faceMaterials?.[0] || 'ERROR');
    }
    if (!faces.length) return false;

    target.vertices = vertices;
    target.faces = faces;
    target.faceMaterials = materials;
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
    const ids = window.EPH_MULTI_SELECTION?.ids?.() || S?.multiSelectedIds || S?.viewport?.multiSelectedIds || [S?.selectedId];
    return [...new Set(ids || [])].map(id => S.objects.find(object => object.id === id)).filter(object => object?.type === 'part');
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
    if (negatives.length !== 1 || !normals.length) {
      toast?.('Select one Negative Part and at least one normal Part.');
      return false;
    }
    const negative = negatives[0];
    const cutMaterial = normals[0]?.faceMaterials?.[0] || 'ERROR';
    const cutterPolygons = objectPolygons(negative, cutMaterial);
    if (!cutterPolygons.length) return toast?.('The Negative Part has no valid closed geometry.'), false;
    if (cutterPolygons.length > 5000) return toast?.('The Negative Part is too complex to carve safely.'), false;

    pushHistory?.();
    let changed = 0;
    const surviving = [];
    const cutterBox = worldBounds(negative);

    try {
      for (const normal of normals) {
        if (!cutterBox.intersectsBox(worldBounds(normal))) { surviving.push(normal.id); continue; }
        const sourcePolygons = objectPolygons(normal);
        if (!sourcePolygons.length) { surviving.push(normal.id); continue; }
        if (sourcePolygons.length > 12000) throw new Error(`${normal.name || 'Part'} is too complex for interactive CSG.`);
        const result = subtractPolygons(sourcePolygons, cutterPolygons.map(polygon => {
          const copy = polygon.clone();
          copy.shared = { material: normal.faceMaterials?.[0] || 'ERROR' };
          return copy;
        }));

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
      toast?.(`Carved hole in ${changed} Part${changed === 1 ? '' : 's'}.`);
      return true;
    } catch (error) {
      S.undo?.pop?.();
      console.error('[Negative Brush V22] CSG failed', error);
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
          if (copy) { copy.transparent = true; copy.opacity = 0.34; copy.depthWrite = false; copy.needsUpdate = true; }
          return copy;
        });
        child.material = Array.isArray(child.material) ? styled : styled[0];
        child.userData.ephNegativeStyled = true;
      } else if (child.userData.ephNegativeOriginalMaterial) {
        const styled = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of styled) if (material !== child.userData.ephNegativeOriginalMaterial) material?.dispose?.();
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
    section.innerHTML = `
      <div class="property-section-title">Boolean / CSG</div>
      <div class="eph-negative-actions">
        <button id="ephNegativeToggle" class="mini-button wide" type="button">Negative Part: ${object.ephNegative ? 'ON' : 'OFF'}</button>
        <button id="ephNegativeCarve" class="mini-button wide" type="button" ${negativeCount === 1 && normalCount >= 1 ? '' : 'disabled'}>Carve Selected</button>
      </div>
      <div class="selection-info">Select one negative Part and one or more normal Parts. Carving removes the negative Part and subtracts its touching volume.</div>`;
    section.querySelector('#ephNegativeToggle').onclick = () => toggleNegative(object);
    section.querySelector('#ephNegativeCarve').onclick = carveSelected;
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
  };

  install();
  const timer = setInterval(() => {
    install();
    refreshNegativeVisuals();
    refreshTreeStyles();
  }, 450);
  setTimeout(() => clearInterval(timer), 30000);
  window.addEventListener('eph3d-ready', installViewport);
})();
