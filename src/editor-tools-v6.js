// byanca
import * as THREE from 'three';

const SPECIAL_MESH_TYPES = new Set(['terrain', 'decal']);
const MESH_TYPES = new Set(['part', 'terrain', 'decal']);
const DEFAULT_MATERIAL = 'materials/dev/dev_measuregeneric01b.vmat';
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

const escText = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fieldValue = (element, key, fallback = null) => element?.fields?.find(field => field.key === key)?.value ?? fallback;
const meshNameFor = object => {
  if (!object?.dmxId) return '';
  const element = VMAP.findElementByDmxId?.(S.doc, object.dmxId);
  const meshData = fieldValue(element, 'meshData');
  return String(fieldValue(meshData, 'name', ''));
};

function classifySpecialMeshes(objects, doc = S.doc) {
  for (const object of objects || []) {
    if (object?.sourceClass !== 'CMapMesh' || !object.dmxId) continue;
    const element = VMAP.findElementByDmxId?.(doc, object.dmxId);
    const meshData = fieldValue(element, 'meshData');
    const name = String(fieldValue(meshData, 'name', ''));
    if (name.startsWith('EPH_DECAL_')) {
      object.type = 'decal';
      object.collision = false;
      object.blockPlayers = false;
      object.blockGrenades = false;
      object.blockBullets = false;
      if (!/^Decal_/i.test(object.name || '')) object.name = `Decal_${String(object.dmxId).slice(0, 6)}`;
    } else if (name.startsWith('EPH_TERRAIN_')) {
      object.type = 'terrain';
      object.collision = object.collision !== false;
      object.blockPlayers = object.collision !== false;
      if (!/^Terrain_/i.test(object.name || '')) object.name = `Terrain_${String(object.dmxId).slice(0, 6)}`;
    }
  }
  return objects;
}

function installVmapTypes() {
  if (VMAP.__ephSpecialMeshTypes) return;
  VMAP.__ephSpecialMeshTypes = true;

  const rawExtract = VMAP.extractObjects.bind(VMAP);
  VMAP.extractObjects = function(doc) {
    return classifySpecialMeshes(rawExtract(doc), doc);
  };

  const rawApply = VMAP.applyObjectToDocument.bind(VMAP);
  VMAP.applyObjectToDocument = function(doc, object) {
    if (!SPECIAL_MESH_TYPES.has(object?.type)) return rawApply(doc, object);
    const type = object.type;
    object.type = 'part';
    try { return rawApply(doc, object); }
    finally { object.type = type; }
  };

  const rawPrepare = VMAP.prepareForSave.bind(VMAP);
  VMAP.prepareForSave = function(doc, objects) {
    const changed = [];
    for (const object of objects || []) {
      if (!SPECIAL_MESH_TYPES.has(object?.type)) continue;
      changed.push([object, object.type]);
      object.type = 'part';
    }
    try { return rawPrepare(doc, objects); }
    finally { for (const [object, type] of changed) object.type = type; }
  };
}

function makePlane(width = 128, height = 128) {
  const w = Math.max(.1, Number(width) || 128) / 2;
  const h = Math.max(.1, Number(height) || 128) / 2;
  return {
    vertices: [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, h, 0]],
    faces: [[0, 1, 2, 3]],
  };
}

function makeTerrain(width = 1024, depth = 1024, subdivisions = 16, heightSampler = null) {
  const n = Math.max(2, Math.min(64, Math.round(Number(subdivisions) || 16)));
  const w = Math.max(1, Number(width) || 1024);
  const d = Math.max(1, Number(depth) || 1024);
  const vertices = [];
  const faces = [];

  for (let y = 0; y <= n; y++) {
    const v = y / n;
    for (let x = 0; x <= n; x++) {
      const u = x / n;
      const z = Number(heightSampler?.(u, v)) || 0;
      vertices.push([(u - .5) * w, (v - .5) * d, z]);
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x;
      const b = a + 1;
      const c = a + n + 2;
      const dIndex = a + n + 1;
      faces.push([a, b, c, dIndex]);
    }
  }
  return { vertices, faces, subdivisions: n };
}

function inferTerrainSubdivisions(object) {
  const side = Math.round(Math.sqrt(object?.vertices?.length || 0));
  return side >= 3 && side * side === object.vertices.length ? side - 1 : null;
}

function terrainHeightSampler(object) {
  const n = inferTerrainSubdivisions(object);
  if (!n) return null;
  const heights = object.vertices.map(vertex => Number(vertex[2]) || 0);
  return (u, v) => {
    const x = Math.max(0, Math.min(n, u * n));
    const y = Math.max(0, Math.min(n, v * n));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(n, x0 + 1), y1 = Math.min(n, y0 + 1);
    const tx = x - x0, ty = y - y0;
    const sample = (sx, sy) => heights[sy * (n + 1) + sx] || 0;
    const a = sample(x0, y0) * (1 - tx) + sample(x1, y0) * tx;
    const b = sample(x0, y1) * (1 - tx) + sample(x1, y1) * tx;
    return a * (1 - ty) + b * ty;
  };
}

function createMeshRoot(viewport, object, visual) {
  const root = new THREE.Group();
  root.name = object.name || object.id;
  root.userData.ephId = object.id;
  if (visual) root.add(visual);
  viewport.applyTransform(root, object);
  return root;
}

function decalVisual(viewport, object) {
  const positions = [];
  const uvs = [];
  const face = object.faces?.[0] || [0, 1, 2, 3];
  const vertices = object.vertices || makePlane().vertices;
  const bounds = VMAP.geometryBounds(vertices);
  const width = Math.max(.0001, bounds.size[0]);
  const height = Math.max(.0001, bounds.size[1]);
  for (let i = 1; i < face.length - 1; i++) {
    for (const index of [face[0], face[i], face[i + 1]]) {
      const point = vertices[index] || [0, 0, 0];
      positions.push(point[0], point[1], point[2]);
      uvs.push((point[0] - bounds.min[0]) / width, (point[1] - bounds.min[1]) / height);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  material.userData.resource = object.faceMaterials?.[0] || DEFAULT_MATERIAL;
  viewport.loadMaterialTexture(material.userData.resource).then(texture => {
    if (!texture || material.userData.disposed) return;
    material.map = texture;
    material.needsUpdate = true;
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.ephVisual = true;
  mesh.userData.ephDecal = true;
  return mesh;
}

function terrainVisual(viewport, object) {
  const positions = [];
  const uvs = [];
  for (const face of object.faces || []) {
    if (!face || face.length < 3) continue;
    for (let i = 1; i < face.length - 1; i++) {
      for (const index of [face[0], face[i], face[i + 1]]) {
        const point = object.vertices?.[index] || [0, 0, 0];
        positions.push(point[0], point[1], point[2]);
        uvs.push(point[0] / 128, point[1] / 128);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const material = viewport.createFaceMaterial(object.faceMaterials?.[0] || DEFAULT_MATERIAL);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.ephVisual = true;
  mesh.userData.ephTerrain = true;
  return mesh;
}

function installViewportSpecialMeshes(viewport) {
  if (!viewport || viewport.__ephEditorToolsV6) return;
  viewport.__ephEditorToolsV6 = true;

  const rawCreateRoot = viewport.createObjectRoot.bind(viewport);
  viewport.createObjectRoot = function(object) {
    if (object?.type === 'decal') return createMeshRoot(this, object, decalVisual(this, object));
    if (object?.type === 'terrain') return createMeshRoot(this, object, terrainVisual(this, object));
    return rawCreateRoot(object);
  };

  const rawBuildHandles = viewport.buildEditHandles.bind(viewport);
  viewport.buildEditHandles = function() {
    const object = this.getObjectById(this.selectedId);
    if (object?.type !== 'terrain') return rawBuildHandles();
    const type = object.type;
    object.type = 'part';
    try { return rawBuildHandles(); }
    finally { object.type = type; }
  };

  const rawRefreshSelected = viewport.refreshSelectedPartVisual.bind(viewport);
  viewport.refreshSelectedPartVisual = function() {
    const object = this.getObjectById(this.selectedId);
    if (!SPECIAL_MESH_TYPES.has(object?.type)) return rawRefreshSelected();
    this.updateObject(object);
  };

  const storedMoveSnap = Math.max(.1, Number(localStorage.getItem('eph-move-snap')) || 1);
  viewport.moveSnap = storedMoveSnap;
  const rawUpdateSnaps = viewport.updateSnaps.bind(viewport);
  viewport.updateSnaps = function() {
    rawUpdateSnaps();
    this.transform.setTranslationSnap(this.snap ? Math.max(.1, Number(this.moveSnap) || 1) : null);
  };
  viewport.updateSnaps();

  viewport.scaleResizeMode = localStorage.getItem('eph-scale-mode') === 'one' ? 'one' : 'both';
  viewport.scaleResizeSide = localStorage.getItem('eph-scale-side') === '-' ? -1 : 1;
  let scaleDrag = null;

  viewport.transform.addEventListener('dragging-changed', event => {
    if (!event.value) { scaleDrag = null; return; }
    if (viewport.tool !== 'scale' || viewport.scaleResizeMode !== 'one') return;
    const object = viewport.getObjectById(viewport.selectedId);
    const root = viewport.objectRoots.get(viewport.selectedId);
    if (!object || !root) return;
    const bounds = object.vertices?.length ? VMAP.geometryBounds(object.vertices) : { size: object.size || [64, 64, 64] };
    scaleDrag = {
      position: root.position.clone(),
      scale: root.scale.clone(),
      quaternion: root.quaternion.clone(),
      size: new THREE.Vector3(...(bounds.size || object.size || [64, 64, 64])),
    };
  });

  viewport.transform.addEventListener('objectChange', () => {
    if (!scaleDrag || viewport.tool !== 'scale' || viewport.scaleResizeMode !== 'one') return;
    const root = viewport.objectRoots.get(viewport.selectedId);
    if (!root) return;
    const axis = String(viewport.transform.axis || 'XYZ');
    const delta = new THREE.Vector3();
    const side = viewport.scaleResizeSide < 0 ? -1 : 1;
    if (axis.includes('X')) delta.x = side * scaleDrag.size.x * (root.scale.x - scaleDrag.scale.x) * .5;
    if (axis.includes('Y')) delta.y = side * scaleDrag.size.y * (root.scale.y - scaleDrag.scale.y) * .5;
    if (axis.includes('Z')) delta.z = side * scaleDrag.size.z * (root.scale.z - scaleDrag.scale.z) * .5;
    delta.applyQuaternion(scaleDrag.quaternion);
    root.position.copy(scaleDrag.position).add(delta);
    viewport.syncSelectedFromRoot(false);
    viewport.updateSelectionBox();
  });
}

function addObjectToEditor(object, message) {
  S.objects.push(object);
  S.selectedId = object.id;
  S.selectedFaces = new Set([0]);
  S.viewport.objects = S.objects;
  S.viewport.updateObject(object);
  S.viewport.select(object.id, false);
  setTool('move');
  markDirty(message);
  renderTree();
  renderProperties();
}

function rotationForNormal(normal) {
  const direction = normal.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return [euler.x * DEG, euler.y * DEG, euler.z * DEG];
}

function createDecal(position, normal) {
  if (!S.doc) return;
  pushHistory();
  const geometry = makePlane(128, 128);
  const object = ensureObject(VMAP.addPart(S.doc, {
    ...geometry,
    position: position.toArray(),
    rotation: rotationForNormal(normal),
    scale: [1, 1, 1],
    faceMaterials: [DEFAULT_MATERIAL],
    material: DEFAULT_MATERIAL,
    collision: false,
    meshName: `EPH_DECAL_${Date.now()}`,
  }));
  object.type = 'decal';
  object.name = `Decal_${String(S.objects.filter(item => item.type === 'decal').length + 1).padStart(3, '0')}`;
  object.collision = false;
  object.blockPlayers = false;
  object.blockGrenades = false;
  object.blockBullets = false;
  object.faceMaterials = [DEFAULT_MATERIAL];
  object.materials = Object.fromEntries(VMAP.FACE_NAMES.map(name => [name, DEFAULT_MATERIAL]));
  addObjectToEditor(object, `Created ${object.name}`);
}

function createTerrain(position) {
  if (!S.doc) return;
  pushHistory();
  const geometry = makeTerrain(1024, 1024, 16);
  const faceMaterials = geometry.faces.map(() => DEFAULT_MATERIAL);
  const object = ensureObject(VMAP.addPart(S.doc, {
    vertices: geometry.vertices,
    faces: geometry.faces,
    faceMaterials,
    position: position.toArray(),
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    collision: true,
    meshName: `EPH_TERRAIN_${Date.now()}`,
  }));
  object.type = 'terrain';
  object.name = `Terrain_${String(S.objects.filter(item => item.type === 'terrain').length + 1).padStart(3, '0')}`;
  object.collision = true;
  object.blockPlayers = true;
  object.faceMaterials = faceMaterials;
  object.materials = Object.fromEntries(VMAP.FACE_NAMES.map(name => [name, DEFAULT_MATERIAL]));
  addObjectToEditor(object, `Created ${object.name}`);
}

let placementMode = null;

function viewportPlacementHit(event) {
  const viewport = S.viewport;
  if (!viewport) return null;
  const canvas = viewport.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  viewport.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  viewport.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  viewport.raycaster.setFromCamera(viewport.pointer, viewport.camera);
  const hits = viewport.raycaster.intersectObjects([...viewport.objectRoots.values()], true);
  if (hits.length) {
    const hit = hits[0];
    const normal = hit.face?.normal?.clone?.().transformDirection(hit.object.matrixWorld).normalize() || new THREE.Vector3(0, 0, 1);
    return { point: hit.point.clone(), normal };
  }
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const point = new THREE.Vector3();
  if (viewport.raycaster.ray.intersectPlane(plane, point)) return { point, normal: new THREE.Vector3(0, 0, 1) };
  return { point: viewport.orbit.target.clone(), normal: viewport.camera.position.clone().sub(viewport.orbit.target).normalize() };
}

function installPlacement() {
  const canvas = S.viewport?.renderer?.domElement;
  if (!canvas || canvas.dataset.ephSpecialPlacement === '1') return;
  canvas.dataset.ephSpecialPlacement = '1';
  canvas.addEventListener('pointerdown', event => {
    if (!placementMode || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const hit = viewportPlacementHit(event);
    const mode = placementMode;
    placementMode = null;
    document.body.classList.remove('eph-place-special');
    if (!hit) return;
    if (mode === 'decal') createDecal(hit.point.clone().add(hit.normal.clone().multiplyScalar(.25)), hit.normal);
    else if (mode === 'terrain') createTerrain(hit.point);
  }, true);
}

const terrainSettings = {
  mode: localStorage.getItem('eph-terrain-mode') || 'push',
  radius: Math.max(1, Number(localStorage.getItem('eph-terrain-radius')) || 192),
  strength: Math.max(.1, Number(localStorage.getItem('eph-terrain-strength')) || 8),
  direction: localStorage.getItem('eph-terrain-direction') || 'z',
};

function saveTerrainSettings() {
  localStorage.setItem('eph-terrain-mode', terrainSettings.mode);
  localStorage.setItem('eph-terrain-radius', String(terrainSettings.radius));
  localStorage.setItem('eph-terrain-strength', String(terrainSettings.strength));
  localStorage.setItem('eph-terrain-direction', terrainSettings.direction);
}

function terrainNeighbors(index, n) {
  const stride = n + 1;
  const x = index % stride;
  const y = Math.floor(index / stride);
  const out = [];
  if (x > 0) out.push(index - 1);
  if (x < n) out.push(index + 1);
  if (y > 0) out.push(index - stride);
  if (y < n) out.push(index + stride);
  return out;
}

function sculptTerrain(object, center, reverse = false, flattenHeight = center.z) {
  const n = inferTerrainSubdivisions(object);
  if (!n) return false;
  const radius = Math.max(1, terrainSettings.radius);
  const strength = Math.max(.1, terrainSettings.strength);
  const source = object.vertices.map(vertex => [...vertex]);
  const sign = reverse ? -1 : 1;
  const affected = [];

  for (let index = 0; index < object.vertices.length; index++) {
    const vertex = object.vertices[index];
    const dx = vertex[0] - center.x;
    const dy = vertex[1] - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance > radius) continue;
    const t = 1 - distance / radius;
    const falloff = .5 - .5 * Math.cos(Math.PI * t);
    affected.push([index, falloff, dx, dy]);
  }

  for (const [index, falloff, dx, dy] of affected) {
    const vertex = object.vertices[index];
    if (terrainSettings.mode === 'smooth') {
      const neighbors = terrainNeighbors(index, n);
      if (!neighbors.length) continue;
      const average = neighbors.reduce((sum, neighbor) => sum + source[neighbor][2], 0) / neighbors.length;
      const blend = Math.min(.48, strength * .012) * falloff;
      vertex[2] = source[index][2] + (average - source[index][2]) * blend;
    } else if (terrainSettings.mode === 'flatten') {
      const blend = Math.min(.55, strength * .014) * falloff;
      vertex[2] += (flattenHeight - vertex[2]) * blend;
    } else if (terrainSettings.mode === 'pinch') {
      const amount = Math.min(.18, strength * .003) * falloff * sign;
      vertex[0] = center.x + dx * (1 - amount);
      vertex[1] = center.y + dy * (1 - amount);
    } else if (terrainSettings.mode === 'directional') {
      const amount = strength * .12 * falloff * sign;
      if (terrainSettings.direction === 'x') vertex[0] += amount;
      else if (terrainSettings.direction === 'y') vertex[1] += amount;
      else vertex[2] += amount;
    } else {
      const shape = terrainSettings.mode === 'inflate' ? falloff * falloff : terrainSettings.mode === 'clay' ? Math.min(1, falloff * 1.45) : falloff;
      vertex[2] += strength * .12 * shape * sign;
    }
  }
  object.size = VMAP.geometryBounds(object.vertices).size;
  return affected.length > 0;
}

function rebuildTerrain(object, subdivisions) {
  const sampler = terrainHeightSampler(object);
  if (!sampler) return false;
  const bounds = VMAP.geometryBounds(object.vertices);
  const geometry = makeTerrain(bounds.size[0], bounds.size[1], subdivisions, sampler);
  object.vertices = geometry.vertices;
  object.faces = geometry.faces;
  const material = object.faceMaterials?.[0] || DEFAULT_MATERIAL;
  object.faceMaterials = geometry.faces.map(() => material);
  object.size = VMAP.geometryBounds(object.vertices).size;
  return true;
}

function resizeMeshXY(object, width, depth) {
  const bounds = VMAP.geometryBounds(object.vertices || []);
  const sx = Math.max(.001, Number(width) || bounds.size[0]) / Math.max(.001, bounds.size[0]);
  const sy = Math.max(.001, Number(depth) || bounds.size[1]) / Math.max(.001, bounds.size[1]);
  for (const vertex of object.vertices || []) {
    vertex[0] = bounds.center[0] + (vertex[0] - bounds.center[0]) * sx;
    vertex[1] = bounds.center[1] + (vertex[1] - bounds.center[1]) * sy;
  }
  object.size = VMAP.geometryBounds(object.vertices).size;
}

function renderTransformRows(object) {
  const row = (label, key, values, step = '.1') => `<div class="xyz-row"><label>${label}</label>${values.map((value, index) => `<input class="prop-input eph-special-transform" data-key="${key}" data-i="${index}" type="number" step="${step}" value="${Number(value).toFixed(Number.isInteger(Number(value)) ? 0 : 3)}">`).join('')}</div>`;
  return `${row('Position', 'position', object.position)}${row('Rotation', 'rotation', object.rotation)}${row('Scale', 'scale', object.scale)}`;
}

function bindSpecialCommon(object) {
  document.getElementById('objectName')?.addEventListener('change', event => {
    pushHistory();
    object.name = event.target.value.trim() || object.name;
    VMAP.applyObjectToDocument(S.doc, object);
    renderTree();
    markDirty(`Renamed to ${object.name}`);
  });
  document.querySelectorAll('.eph-special-transform').forEach(input => input.onchange = () => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    pushHistory();
    object[input.dataset.key][Number(input.dataset.i)] = value;
    VMAP.applyObjectToDocument(S.doc, object);
    S.viewport.updateObject(object);
    markDirty(`Changed ${object.name}`);
    renderProperties();
  });
}

function renderDecalProperties(object) {
  const host = document.getElementById('propertiesContent');
  const bounds = VMAP.geometryBounds(object.vertices || []);
  host.innerHTML = `<div class="property-name-row"><input id="objectName" class="prop-input" value="${escText(object.name)}"><span class="type-badge">DECAL</span></div>
    <div class="property-section"><div class="property-section-title">Transform</div>${renderTransformRows(object)}</div>
    <div class="property-section"><div class="property-section-title">Decal Size</div><div class="eph-pair"><label>Width</label><input id="ephDecalWidth" class="prop-input" type="number" min="0.1" step="1" value="${Number(bounds.size[0]).toFixed(2)}"><label>Height</label><input id="ephDecalHeight" class="prop-input" type="number" min="0.1" step="1" value="${Number(bounds.size[1]).toFixed(2)}"></div></div>
    <div class="property-section"><div class="property-section-title">Material</div><div class="material-apply-row"><input id="ephDecalMaterial" class="prop-input" value="${escText(object.faceMaterials?.[0] || DEFAULT_MATERIAL)}"><button id="ephApplyDecalMaterial" class="mini-button">Apply</button></div><div class="selection-info">A decal is a single non-solid face. Transparent VMATs keep their alpha; there is no box behind it.</div></div>`;
  bindSpecialCommon(object);
  const resize = () => {
    pushHistory();
    resizeMeshXY(object, Number(document.getElementById('ephDecalWidth').value), Number(document.getElementById('ephDecalHeight').value));
    VMAP.applyObjectToDocument(S.doc, object);
    S.viewport.updateObject(object);
    markDirty(`Resized ${object.name}`);
    renderProperties();
  };
  document.getElementById('ephDecalWidth').onchange = resize;
  document.getElementById('ephDecalHeight').onchange = resize;
  document.getElementById('ephApplyDecalMaterial').onclick = () => applyMaterial(document.getElementById('ephDecalMaterial').value.trim() || DEFAULT_MATERIAL);
  document.getElementById('ephDecalMaterial').onkeydown = event => { if (event.key === 'Enter') applyMaterial(event.currentTarget.value.trim() || DEFAULT_MATERIAL); };
}

function renderTerrainProperties(object) {
  const host = document.getElementById('propertiesContent');
  const bounds = VMAP.geometryBounds(object.vertices || []);
  const subdivisions = inferTerrainSubdivisions(object) || 16;
  host.innerHTML = `<div class="property-name-row"><input id="objectName" class="prop-input" value="${escText(object.name)}"><span class="type-badge">TERRAIN</span></div>
    <div class="property-section"><div class="property-section-title">Transform</div>${renderTransformRows(object)}</div>
    <div class="property-section"><div class="property-section-title">Terrain Size</div><div class="eph-pair"><label>Width</label><input id="ephTerrainWidth" class="prop-input" type="number" min="1" step="16" value="${Number(bounds.size[0]).toFixed(1)}"><label>Depth</label><input id="ephTerrainDepth" class="prop-input" type="number" min="1" step="16" value="${Number(bounds.size[1]).toFixed(1)}"></div></div>
    <div class="property-section"><div class="property-section-title">Terrain Mesh</div><div class="eph-field"><label>Subdivisions</label><select id="ephTerrainSubdivisions" class="prop-select">${[4,8,12,16,24,32,48,64].map(value => `<option value="${value}" ${value === subdivisions ? 'selected' : ''}>${value} × ${value}</option>`).join('')}</select></div><button id="ephRebuildTerrain" class="mini-button wide">Rebuild subdivisions</button></div>
    <div class="property-section"><div class="property-section-title">Material</div><div class="material-apply-row"><input id="ephTerrainMaterial" class="prop-input" value="${escText(object.faceMaterials?.[0] || DEFAULT_MATERIAL)}"><button id="ephApplyTerrainMaterial" class="mini-button">Apply</button></div></div>
    <div class="property-section"><div class="property-section-title">Displacement / Sculpt</div><div class="eph-field"><label>Brush</label><select id="ephTerrainMode" class="prop-select"><option value="push">Push / Pull</option><option value="inflate">Inflate</option><option value="clay">Clay</option><option value="smooth">Smooth</option><option value="flatten">Flatten</option><option value="pinch">Pinch</option><option value="directional">Directional</option></select></div><div class="eph-pair"><label>Radius</label><input id="ephTerrainRadius" class="prop-input" type="number" min="1" step="1" value="${terrainSettings.radius}"><label>Strength</label><input id="ephTerrainStrength" class="prop-input" type="number" min="0.1" step="0.1" value="${terrainSettings.strength}"></div><div class="eph-field" id="ephDirectionRow"><label>Direction</label><select id="ephTerrainDirection" class="prop-select"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></div><button id="ephStartSculpt" class="mini-button wide">Sculpt terrain</button><div class="selection-info">Hold left mouse to sculpt. Hold Shift to reverse Push, Inflate, Clay, Pinch, or Directional. Smooth and Flatten use Radius + Strength.</div></div>
    <div class="property-section"><div class="property-section-title">Collision</div><label class="eph-check"><input id="ephTerrainCollision" type="checkbox" ${object.collision !== false ? 'checked' : ''}> Colliding / blocks players</label></div>`;
  bindSpecialCommon(object);
  document.getElementById('ephTerrainMode').value = terrainSettings.mode;
  document.getElementById('ephTerrainDirection').value = terrainSettings.direction;
  const refreshDirection = () => document.getElementById('ephDirectionRow').classList.toggle('hidden', document.getElementById('ephTerrainMode').value !== 'directional');
  refreshDirection();
  document.getElementById('ephTerrainMode').onchange = event => { terrainSettings.mode = event.target.value; saveTerrainSettings(); refreshDirection(); };
  document.getElementById('ephTerrainRadius').onchange = event => { terrainSettings.radius = Math.max(1, Number(event.target.value) || 1); saveTerrainSettings(); };
  document.getElementById('ephTerrainStrength').onchange = event => { terrainSettings.strength = Math.max(.1, Number(event.target.value) || .1); saveTerrainSettings(); };
  document.getElementById('ephTerrainDirection').onchange = event => { terrainSettings.direction = event.target.value; saveTerrainSettings(); };
  document.getElementById('ephStartSculpt').onclick = () => { setTool('terrain-sculpt'); toast('Terrain sculpt active — drag on the terrain'); };
  document.getElementById('ephRebuildTerrain').onclick = () => {
    pushHistory();
    if (!rebuildTerrain(object, Number(document.getElementById('ephTerrainSubdivisions').value))) { S.undo.pop(); return toast('This terrain can no longer be automatically resubdivided.'); }
    VMAP.applyObjectToDocument(S.doc, object);
    S.viewport.updateObject(object);
    markDirty(`Rebuilt subdivisions on ${object.name}`);
    renderProperties();
  };
  const resize = () => {
    pushHistory();
    resizeMeshXY(object, Number(document.getElementById('ephTerrainWidth').value), Number(document.getElementById('ephTerrainDepth').value));
    VMAP.applyObjectToDocument(S.doc, object);
    S.viewport.updateObject(object);
    markDirty(`Resized ${object.name}`);
    renderProperties();
  };
  document.getElementById('ephTerrainWidth').onchange = resize;
  document.getElementById('ephTerrainDepth').onchange = resize;
  document.getElementById('ephApplyTerrainMaterial').onclick = () => applyMaterial(document.getElementById('ephTerrainMaterial').value.trim() || DEFAULT_MATERIAL);
  document.getElementById('ephTerrainMaterial').onkeydown = event => { if (event.key === 'Enter') applyMaterial(event.currentTarget.value.trim() || DEFAULT_MATERIAL); };
  document.getElementById('ephTerrainCollision').onchange = event => {
    pushHistory();
    object.collision = event.target.checked;
    object.blockPlayers = object.collision;
    VMAP.applyObjectToDocument(S.doc, object);
    markDirty(`Changed collision on ${object.name}`);
  };
}

function installPropertyAndMaterialSupport() {
  if (window.__ephEditorToolsProps) return;
  window.__ephEditorToolsProps = true;

  const rawRenderProperties = renderProperties;
  renderProperties = function() {
    const object = ensureObject(current());
    if (object?.type === 'decal') return renderDecalProperties(object);
    if (object?.type === 'terrain') return renderTerrainProperties(object);
    return rawRenderProperties();
  };

  const rawApplyMaterial = applyMaterial;
  applyMaterial = function(path) {
    const object = ensureObject(current());
    if (!SPECIAL_MESH_TYPES.has(object?.type)) return rawApplyMaterial(path);
    pushHistory();
    if (object.type === 'terrain') object.faceMaterials = (object.faces || []).map(() => path);
    else object.faceMaterials = [path];
    object.materials ||= {};
    VMAP.FACE_NAMES.forEach(name => object.materials[name] = path);
    VMAP.applyObjectToDocument(S.doc, object);
    S.viewport?.updateObject(object);
    markDirty(`Applied ${path}`);
    renderProperties();
  };

  const grid = document.getElementById('assetGrid');
  grid?.addEventListener('click', event => {
    if (S.assetTab !== 'materials' || !SPECIAL_MESH_TYPES.has(current()?.type)) return;
    const card = event.target.closest('.asset-card');
    if (!card) return;
    const item = S.assetItems?.[Number(card.dataset.i)];
    if (item?.path) applyMaterial(item.path);
  });
}

function installToolbar() {
  if (document.getElementById('ephMoveSnap')) return;
  const move = document.querySelector('.tool-mode[data-tool="move"]');
  const scale = document.querySelector('.tool-mode[data-tool="scale"]');
  const addPartButton = document.getElementById('topAddPart');
  const toolRail = document.getElementById('toolRail');

  if (move) {
    const host = document.createElement('div');
    host.className = 'eph-transform-option';
    host.innerHTML = `<label>Move</label><input id="ephMoveSnap" type="number" min="0.1" step="0.1" value="${S.viewport?.moveSnap || 1}" title="Translation snap in world units">u`;
    move.after(host);
    host.querySelector('#ephMoveSnap').onchange = event => {
      const value = Math.max(.1, Number(event.target.value) || .1);
      event.target.value = String(value);
      S.viewport.moveSnap = value;
      localStorage.setItem('eph-move-snap', String(value));
      S.viewport.updateSnaps();
    };
  }

  if (scale) {
    const host = document.createElement('div');
    host.className = 'eph-transform-option eph-scale-option';
    host.innerHTML = `<select id="ephScaleMode" title="Scale around the center or resize only one side"><option value="both">Both sides</option><option value="one">One side</option></select><button id="ephScaleSide" type="button" title="Which side moves in one-side mode">+</button>`;
    scale.after(host);
    const mode = host.querySelector('#ephScaleMode');
    const side = host.querySelector('#ephScaleSide');
    mode.value = S.viewport.scaleResizeMode || 'both';
    const syncSide = () => {
      side.classList.toggle('hidden', mode.value !== 'one');
      side.textContent = S.viewport.scaleResizeSide < 0 ? '− side' : '+ side';
    };
    mode.onchange = () => {
      S.viewport.scaleResizeMode = mode.value;
      localStorage.setItem('eph-scale-mode', mode.value);
      syncSide();
    };
    side.onclick = () => {
      S.viewport.scaleResizeSide = S.viewport.scaleResizeSide < 0 ? 1 : -1;
      localStorage.setItem('eph-scale-side', S.viewport.scaleResizeSide < 0 ? '-' : '+');
      syncSide();
    };
    syncSide();
  }

  if (addPartButton) {
    const decal = document.createElement('button');
    decal.className = 'tool-mode';
    decal.id = 'topAddDecal';
    decal.innerHTML = `<img src="../assets/icons/tools/tool_texture.png" alt=""><span>Add Decal</span>`;
    decal.onclick = () => { placementMode = 'decal'; document.body.classList.add('eph-place-special'); toast('Click a surface to place the decal'); };
    addPartButton.after(decal);

    const terrain = document.createElement('button');
    terrain.className = 'tool-mode';
    terrain.id = 'topAddTerrain';
    terrain.innerHTML = `<img src="../assets/icons/tools/tool_face.png" alt=""><span>Add Terrain</span>`;
    terrain.onclick = () => { placementMode = 'terrain'; document.body.classList.add('eph-place-special'); toast('Click where the terrain should be created'); };
    decal.after(terrain);
    icons?.(terrain.parentElement);
  }

  if (toolRail) {
    const decal = document.createElement('button');
    decal.id = 'ephRailDecal';
    decal.innerHTML = `<img src="../assets/icons/tools/tool_texture.png" alt=""><span>Decal</span>`;
    decal.onclick = () => { placementMode = 'decal'; document.body.classList.add('eph-place-special'); toast('Click a surface to place the decal'); };
    toolRail.appendChild(decal);

    const terrain = document.createElement('button');
    terrain.id = 'ephRailTerrain';
    terrain.innerHTML = `<img src="../assets/icons/tools/tool_face.png" alt=""><span>Terrain</span>`;
    terrain.onclick = () => { placementMode = 'terrain'; document.body.classList.add('eph-place-special'); toast('Click where the terrain should be created'); };
    toolRail.appendChild(terrain);
    icons?.(toolRail);
  }
}

function installTerrainSculpt() {
  const viewport = S.viewport;
  const canvas = viewport?.renderer?.domElement;
  if (!viewport || !canvas || canvas.dataset.ephTerrainSculpt === '1') return;
  canvas.dataset.ephTerrainSculpt = '1';

  const brush = new THREE.Mesh(
    new THREE.RingGeometry(.96, 1, 72),
    new THREE.MeshBasicMaterial({ color: 0x9c6cff, transparent: true, opacity: .8, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
  );
  brush.visible = false;
  brush.renderOrder = 2600;
  viewport.scene.add(brush);

  let sculpting = false;
  let sculptObject = null;
  let flattenHeight = 0;

  const hitTerrain = event => {
    const object = current();
    if (object?.type !== 'terrain') return null;
    const root = viewport.objectRoots.get(object.id);
    if (!root) return null;
    const rect = canvas.getBoundingClientRect();
    viewport.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    viewport.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    viewport.raycaster.setFromCamera(viewport.pointer, viewport.camera);
    const hit = viewport.raycaster.intersectObject(root, true)[0];
    if (!hit) return null;
    root.updateMatrixWorld(true);
    const local = root.worldToLocal(hit.point.clone());
    const quaternion = new THREE.Quaternion();
    root.getWorldQuaternion(quaternion);
    return { object, root, hit, local, quaternion };
  };

  const showBrush = info => {
    if (!info) { brush.visible = false; return; }
    brush.visible = true;
    brush.position.copy(info.hit.point).add(new THREE.Vector3(0, 0, .15));
    brush.quaternion.copy(info.quaternion);
    brush.scale.setScalar(terrainSettings.radius);
  };

  canvas.addEventListener('pointermove', event => {
    if (S.tool !== 'terrain-sculpt') { brush.visible = false; return; }
    const info = hitTerrain(event);
    showBrush(info);
    if (!sculpting || !info || info.object !== sculptObject) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!sculptTerrain(info.object, info.local, event.shiftKey, flattenHeight)) return;
    viewport.updateObject(info.object);
    viewport.callbacks.change?.(info.object, false);
  }, true);

  canvas.addEventListener('pointerdown', event => {
    if (S.tool !== 'terrain-sculpt' || event.button !== 0) return;
    const info = hitTerrain(event);
    if (!info) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pushHistory();
    sculpting = true;
    sculptObject = info.object;
    flattenHeight = info.local.z;
    sculptTerrain(info.object, info.local, event.shiftKey, flattenHeight);
    viewport.updateObject(info.object);
    viewport.callbacks.change?.(info.object, false);
  }, true);

  window.addEventListener('pointerup', event => {
    if (!sculpting || event.button !== 0) return;
    const object = sculptObject;
    sculpting = false;
    sculptObject = null;
    if (object) viewport.callbacks.change?.(object, true);
  }, true);

  const rawSetTool = setTool;
  setTool = function(tool) {
    const result = rawSetTool(tool);
    brush.visible = tool === 'terrain-sculpt' && current()?.type === 'terrain' ? brush.visible : false;
    return result;
  };
}

function installLegacyMeshActions() {
  const rawExtrude = extrude;
  extrude = function(faceIndex, distance) {
    const object = current();
    if (object?.type !== 'terrain') return rawExtrude(faceIndex, distance);
    const type = object.type;
    object.type = 'part';
    try { return rawExtrude(faceIndex, distance); }
    finally { object.type = type; }
  };
}

function install() {
  if (!window.EPH3D || window.__ephEditorToolsV6Installed) return;
  window.__ephEditorToolsV6Installed = true;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'editor-tools-v6.css';
  document.head.appendChild(style);
  installVmapTypes();
  classifySpecialMeshes(S.objects || [], S.doc);
  installViewportSpecialMeshes(window.EPH3D);
  installPropertyAndMaterialSupport();
  installToolbar();
  installPlacement();
  installTerrainSculpt();
  installLegacyMeshActions();
  if (S.project) {
    renderTree();
    renderProperties();
    S.viewport.setObjects(S.objects, S.selectedId);
  }
}

if (window.EPH3D) install();
window.addEventListener('eph3d-ready', install, { once: true });
