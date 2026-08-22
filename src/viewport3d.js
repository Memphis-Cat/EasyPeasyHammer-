// byanca
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const FACE_ORDER = ['right', 'left', 'front', 'back', 'top', 'bottom'];
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

class EditorViewport {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x25202f);
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 500000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(700, -900, 650);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0, 64);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.1;
    this.orbit.screenSpacePanning = true;
    this.orbit.zoomToCursor = true;
    this.orbit.minDistance = 2;
    this.orbit.maxDistance = 100000;

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.78);
    this.scene.add(this.transform.getHelper());

    this.objectGroup = new THREE.Group();
    this.objectGroup.name = 'MapObjects';
    this.scene.add(this.objectGroup);
    this.editGroup = new THREE.Group();
    this.editGroup.name = 'SubElementHandles';
    this.scene.add(this.editGroup);
    this.editPivot = new THREE.Object3D();
    this.editPivot.visible = false;
    this.scene.add(this.editPivot);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 7;
    this.pointer = new THREE.Vector2();
    this.objectRoots = new Map();
    this.objects = [];
    this.selectedId = null;
    this.tool = 'select';
    this.gridSize = 64;
    this.snap = true;
    this.angleSnap = 15;
    this.shading = 'Lit';
    this.subSelection = null;
    this.subDrag = null;
    this.callbacks = { select: null, change: null, camera: null, transformStart: null, subselect: null, extrude: null };
    this.errorTexture = this.makeErrorTexture();
    this.materialTextureCache = new Map();
    this.modelCache = new Map();
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();

    this.addLights();
    this.makeGrid();

    this.selectionBox = new THREE.BoxHelper(undefined, 0x3d9cff);
    this.selectionBox.visible = false;
    this.selectionBox.material.depthTest = false;
    this.selectionBox.renderOrder = 1000;
    this.scene.add(this.selectionBox);

    this.transform.addEventListener('dragging-changed', event => {
      this.orbit.enabled = !event.value;
      if (event.value) {
        this.callbacks.transformStart?.();
        if (this.subSelection) this.beginSubDrag();
      } else {
        if (this.subSelection) this.commitSubTransform();
        else this.commitObjectTransform();
      }
    });
    this.transform.addEventListener('objectChange', () => {
      if (this.subSelection) this.updateSubTransform(false);
      else {
        this.updateSelectionBox();
        this.syncSelectedFromRoot(false);
      }
    });
    this.orbit.addEventListener('change', () => this.callbacks.camera?.(this.getCameraState()));

    this.renderer.domElement.addEventListener('pointerdown', event => this.handlePointerDown(event));
    this.renderer.domElement.addEventListener('dblclick', event => this.handleDoubleClick(event));
    this.renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('keydown', event => { if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) this.focusSelected(); });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  onSelect(fn) { this.callbacks.select = fn; }
  onChange(fn) { this.callbacks.change = fn; }
  onCameraChange(fn) { this.callbacks.camera = fn; }
  onTransformStart(fn) { this.callbacks.transformStart = fn; }
  onSubselect(fn) { this.callbacks.subselect = fn; }
  onExtrudeRequest(fn) { this.callbacks.extrude = fn; }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xcbd8ff, 0x3b3540, 1.65));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-600, -800, 1400);
    this.scene.add(sun);
  }

  makeGrid() {
    if (this.gridHelper) { this.scene.remove(this.gridHelper); this.gridHelper.geometry.dispose(); this.gridHelper.material.dispose(); }
    const extent = Math.max(16384, this.gridSize * 512);
    const divisions = Math.max(64, Math.min(1024, Math.round(extent / this.gridSize)));
    this.gridHelper = new THREE.GridHelper(extent, divisions, 0x718096, 0x484657);
    this.gridHelper.rotation.x = Math.PI / 2;
    this.gridHelper.material.transparent = true;
    this.gridHelper.material.opacity = 0.42;
    this.gridHelper.material.depthWrite = false;
    this.gridHelper.renderOrder = -100;
    this.scene.add(this.gridHelper);
  }

  makeErrorTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const cells = 4, cell = 64;
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#24052d' : '#d414b9';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) ctx.fillText('ERROR', x * cell + 32, y * cell + 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  hashColor(text) {
    let hash = 2166136261;
    for (const char of String(text || 'material')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    const color = new THREE.Color();
    color.setHSL((Math.abs(hash) % 360) / 360, 0.18, 0.42);
    return color;
  }

  createFaceMaterial(resource) {
    const value = String(resource || 'ERROR');
    const isError = value === 'ERROR' || /error|missing/i.test(value);
    const material = new THREE.MeshStandardMaterial({ color: isError ? 0xffffff : this.hashColor(value), roughness: 0.8, metalness: 0.02, side: THREE.DoubleSide });
    material.userData.resource = value;
    if (isError) material.map = this.errorTexture;
    else this.loadMaterialTexture(value).then(texture => {
      if (!texture || material.userData.disposed) return;
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    });
    return material;
  }

  async loadMaterialTexture(resource) {
    if (!window.easyPeasyHammer?.materialPreview) return null;
    if (!this.materialTextureCache.has(resource)) {
      this.materialTextureCache.set(resource, (async () => {
        const result = await window.easyPeasyHammer.materialPreview(resource);
        if (!result?.ok || !result.url) return null;
        return new Promise(resolve => this.textureLoader.load(result.url, texture => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          resolve(texture);
        }, undefined, () => resolve(null)));
      })());
    }
    return this.materialTextureCache.get(resource);
  }

  async loadModel(resource) {
    if (!resource || !window.easyPeasyHammer?.modelPreview) return null;
    if (!this.modelCache.has(resource)) {
      this.modelCache.set(resource, (async () => {
        const result = await window.easyPeasyHammer.modelPreview(resource);
        if (!result?.ok || !result.url) return null;
        return new Promise(resolve => this.gltfLoader.load(result.url, gltf => resolve({ scene: gltf.scene, scale: Number(result.scale) || 39.37007874015748 }), undefined, () => resolve(null)));
      })());
    }
    return this.modelCache.get(resource);
  }

  disposeObject(object3d) {
    object3d.traverse(child => {
      if (child.geometry && !child.userData.sharedGeometry) child.geometry.dispose?.();
      const materials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
      for (const material of materials) { material.userData.disposed = true; if (!material.userData.sharedMaterial) material.dispose?.(); }
    });
  }

  clearObjects() {
    this.transform.detach();
    this.clearEditHandles();
    for (const child of [...this.objectGroup.children]) { this.objectGroup.remove(child); this.disposeObject(child); }
    this.objectRoots.clear();
    this.selectionBox.visible = false;
  }

  setObjects(objects, selectedId = null) {
    this.objects = objects || [];
    this.clearObjects();
    for (const object of this.objects) {
      if (['world', 'folder'].includes(object.type) || object.visible === false) continue;
      const root = this.createObjectRoot(object);
      if (!root) continue;
      this.objectGroup.add(root);
      this.objectRoots.set(object.id, root);
    }
    this.select(selectedId, false);
  }

  updateObject(object) {
    if (!object || ['world', 'folder'].includes(object.type)) return;
    const old = this.objectRoots.get(object.id);
    const selected = this.selectedId === object.id;
    if (old) {
      if (selected && !this.subSelection) this.transform.detach();
      this.objectGroup.remove(old);
      this.disposeObject(old);
      this.objectRoots.delete(object.id);
    }
    if (object.visible !== false) {
      const root = this.createObjectRoot(object);
      if (root) { this.objectGroup.add(root); this.objectRoots.set(object.id, root); }
    }
    if (selected) this.select(object.id, false);
  }

  createObjectRoot(object) {
    const root = new THREE.Group();
    root.name = object.name || object.id;
    root.userData.ephId = object.id;
    let visual = null;
    if (object.type === 'part') visual = this.createPartVisual(object);
    else if (object.type === 'prop') visual = this.createPropVisual(object, root);
    else if (object.type === 'entity') visual = this.createEntityMarker(object);
    if (visual) root.add(visual);
    this.applyTransform(root, object);
    return root;
  }

  createPartVisual(object) {
    const vertices = object.vertices || [];
    const faces = object.faces || [];
    if (!vertices.length || !faces.length) return this.createBoxVisual(object);
    const positions = [];
    const groups = [];
    let cursor = 0;
    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi];
      const start = cursor;
      for (let i = 1; i < face.length - 1; i++) {
        for (const idx of [face[0], face[i], face[i + 1]]) {
          const v = vertices[idx] || [0, 0, 0];
          positions.push(v[0], v[1], v[2]); cursor++;
        }
      }
      if (cursor > start) groups.push({ start, count: cursor - start, materialIndex: fi });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    groups.forEach(g => geometry.addGroup(g.start, g.count, g.materialIndex));
    const materials = faces.map((_, i) => this.createFaceMaterial(object.faceMaterials?.[i] || object.materials?.[FACE_ORDER[i]] || 'ERROR'));
    const mesh = new THREE.Mesh(geometry, materials.length ? materials : [this.createFaceMaterial('ERROR')]);
    mesh.userData.ephVisual = true;
    return mesh;
  }

  createBoxVisual(object) {
    const size = object.size || [64, 64, 64];
    const geometry = new THREE.BoxGeometry(Math.max(0.01, size[0]), Math.max(0.01, size[1]), Math.max(0.01, size[2]));
    const materials = FACE_ORDER.map((face, i) => this.createFaceMaterial(object.faceMaterials?.[i] || object.materials?.[face] || 'ERROR'));
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.userData.ephVisual = true;
    return mesh;
  }

  createPropVisual(object, root) {
    const group = new THREE.Group();
    group.userData.ephVisual = true;
    const size = object.size || [64, 64, 64];
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const material = new THREE.MeshStandardMaterial({ color: 0x8a744d, roughness: 0.7, transparent: true, opacity: 0.62 });
    const placeholder = new THREE.Mesh(geometry, material);
    placeholder.userData.placeholder = true;
    group.add(placeholder);
    if (object.model) this.loadModel(object.model).then(data => {
      if (!data || !root.parent) return;
      const model = cloneSkeleton(data.scene);
      model.rotation.x = Math.PI / 2;
      model.scale.setScalar(data.scale);
      model.traverse(child => { if (child.isMesh) { child.geometry = child.geometry?.clone?.() || child.geometry; if (Array.isArray(child.material)) child.material = child.material.map(m => m.clone()); else if (child.material?.clone) child.material = child.material.clone(); child.castShadow = false; child.receiveShadow = false; } });
      group.remove(placeholder);
      this.disposeObject(placeholder);
      group.add(model);
      if (this.selectedId === object.id) this.updateSelectionBox();
    });
    return group;
  }

  createEntityMarker(object) {
    const className = String(object.className || 'entity');
    let geometry, color = 0x55a7ff;
    if (className.includes('player_terrorist')) color = 0xe86f52;
    else if (className.includes('player_counterterrorist')) color = 0x58a8ff;
    else if (className.includes('light')) color = 0xffdd76;
    else if (className.includes('trigger')) color = 0xa66aff;
    if (className.includes('player_')) geometry = new THREE.CapsuleGeometry(16, 36, 6, 10); else geometry = new THREE.OctahedronGeometry(18, 0);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.5, transparent: true, opacity: 0.9 }));
    if (className.includes('player_')) mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  applyTransform(root, object) {
    const p = object.position || [0, 0, 0], r = object.rotation || [0, 0, 0], s = object.scale || [1, 1, 1];
    root.position.set(p[0], p[1], p[2]);
    root.rotation.set(r[0] * RAD, r[1] * RAD, r[2] * RAD, 'XYZ');
    root.scale.set(s[0], s[1], s[2]);
  }

  getObjectById(id) { return this.objects.find(o => o.id === id) || null; }

  select(id, notify = true) {
    this.selectedId = id || null;
    this.subSelection = null;
    this.clearEditHandles();
    const root = id ? this.objectRoots.get(id) : null;
    if (root) {
      this.selectionBox.setFromObject(root); this.selectionBox.visible = true;
      if (['move', 'rotate', 'scale'].includes(this.tool)) this.attachObjectTransform(root); else this.transform.detach();
      if (['vertex', 'edge', 'face', 'extrude'].includes(this.tool)) this.buildEditHandles();
    } else { this.transform.detach(); this.selectionBox.visible = false; }
    if (notify) this.callbacks.select?.(this.selectedId);
  }

  attachObjectTransform(root) {
    this.transform.attach(root);
    this.transform.setMode(this.tool === 'move' ? 'translate' : this.tool);
    this.transform.setSpace(String(this.space || 'Local').toLowerCase() === 'world' ? 'world' : 'local');
  }

  setTool(tool) {
    this.tool = tool;
    this.subSelection = null;
    this.clearEditHandles();
    const root = this.selectedId ? this.objectRoots.get(this.selectedId) : null;
    if (root && ['move', 'rotate', 'scale'].includes(tool)) this.attachObjectTransform(root); else this.transform.detach();
    if (root && ['vertex', 'edge', 'face', 'extrude'].includes(tool)) this.buildEditHandles();
    this.updateSnaps();
  }

  clearEditHandles() {
    if (this.transform.object === this.editPivot) this.transform.detach();
    for (const child of [...this.editGroup.children]) { this.editGroup.remove(child); this.disposeObject(child); }
    this.editPivot.visible = false;
    this.subSelection = null;
  }

  buildEditHandles() {
    for (const child of [...this.editGroup.children]) { this.editGroup.remove(child); this.disposeObject(child); }
    const object = this.getObjectById(this.selectedId);
    const root = this.objectRoots.get(this.selectedId);
    if (!object || object.type !== 'part' || !root || !object.vertices?.length) return;
    root.updateMatrixWorld(true);

    if (this.tool === 'vertex') {
      const radius = Math.max(2, this.gridSize * 0.08);
      object.vertices.forEach((v, index) => {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), new THREE.MeshBasicMaterial({ color: 0x58a8ff, depthTest: false }));
        mesh.position.copy(root.localToWorld(new THREE.Vector3(...v)));
        mesh.userData.sub = { type: 'vertex', indices: [index], index };
        mesh.renderOrder = 2000;
        this.editGroup.add(mesh);
      });
    } else if (this.tool === 'edge') {
      const seen = new Set();
      object.faces.forEach(face => {
        for (let i = 0; i < face.length; i++) {
          const a = face[i], b = face[(i + 1) % face.length];
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (seen.has(key)) continue; seen.add(key);
          const ga = root.localToWorld(new THREE.Vector3(...object.vertices[a]));
          const gb = root.localToWorld(new THREE.Vector3(...object.vertices[b]));
          const geo = new THREE.BufferGeometry().setFromPoints([ga, gb]);
          const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7fc3ff, depthTest: false }));
          line.userData.sub = { type: 'edge', indices: [a, b], key };
          line.renderOrder = 2000;
          this.editGroup.add(line);
        }
      });
    } else {
      object.faces.forEach((face, faceIndex) => {
        const positions = [];
        for (let i = 1; i < face.length - 1; i++) for (const idx of [face[0], face[i], face[i + 1]]) {
          const p = root.localToWorld(new THREE.Vector3(...object.vertices[idx])); positions.push(p.x, p.y, p.z);
        }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.MeshBasicMaterial({ color: 0x4fa5ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthTest: false });
        const mesh = new THREE.Mesh(geo, mat); mesh.userData.sub = { type: 'face', indices: [...new Set(face)], faceIndex }; mesh.renderOrder = 1900;
        this.editGroup.add(mesh);
      });
    }
  }

  selectSub(handle) {
    const sub = handle?.userData?.sub;
    if (!sub) return;
    this.subSelection = { ...sub };
    const object = this.getObjectById(this.selectedId), root = this.objectRoots.get(this.selectedId);
    if (!object || !root) return;
    const center = new THREE.Vector3();
    sub.indices.forEach(i => center.add(root.localToWorld(new THREE.Vector3(...object.vertices[i]))));
    center.multiplyScalar(1 / sub.indices.length);
    this.editPivot.position.copy(center);
    this.editPivot.rotation.set(0, 0, 0); this.editPivot.scale.set(1, 1, 1); this.editPivot.visible = true;
    this.transform.attach(this.editPivot); this.transform.setMode('translate'); this.transform.setSpace('world'); this.updateSnaps();
    this.callbacks.subselect?.(this.subSelection);
  }

  beginSubDrag() {
    const object = this.getObjectById(this.selectedId), root = this.objectRoots.get(this.selectedId);
    if (!object || !root || !this.subSelection) return;
    this.subDrag = { pivot: this.editPivot.position.clone(), vertices: object.vertices.map(v => [...v]), indices: [...this.subSelection.indices] };
  }

  updateSubTransform(commit) {
    const object = this.getObjectById(this.selectedId), root = this.objectRoots.get(this.selectedId);
    if (!object || !root || !this.subSelection || !this.subDrag) return;
    root.updateMatrixWorld(true);
    const startLocal = root.worldToLocal(this.subDrag.pivot.clone());
    const nowLocal = root.worldToLocal(this.editPivot.position.clone());
    const delta = nowLocal.sub(startLocal);
    for (const index of this.subDrag.indices) {
      const base = this.subDrag.vertices[index];
      object.vertices[index] = [base[0] + delta.x, base[1] + delta.y, base[2] + delta.z];
    }
    this.refreshSelectedPartVisual();
    this.callbacks.change?.(object, commit);
  }

  commitSubTransform() {
    this.updateSubTransform(true);
    this.subDrag = null;
    const selected = this.subSelection ? { ...this.subSelection } : null;
    this.buildEditHandles();
    const closest = [...this.editGroup.children].find(x => {
      const s = x.userData.sub;
      return s && selected && s.type === selected.type && (s.index === selected.index || s.faceIndex === selected.faceIndex || s.key === selected.key);
    });
    if (closest) this.selectSub(closest);
  }

  refreshSelectedPartVisual() {
    const object = this.getObjectById(this.selectedId), root = this.objectRoots.get(this.selectedId);
    if (!object || !root || object.type !== 'part') return;
    const old = root.children.find(x => x.userData.ephVisual);
    const visual = this.createPartVisual(object);
    if (old) { root.remove(old); this.disposeObject(old); }
    root.add(visual);
    this.updateSelectionBox();
  }

  updateSnaps() {
    this.transform.setTranslationSnap(this.snap ? this.gridSize : null);
    this.transform.setRotationSnap(this.snap ? this.angleSnap * RAD : null);
    this.transform.setScaleSnap(this.snap ? 0.1 : null);
  }

  setGrid(enabled, size = this.gridSize) { this.gridSize = Math.max(1, Number(size) || 64); this.makeGrid(); this.gridHelper.visible = Boolean(enabled); this.updateSnaps(); }
  setSnap(enabled, gridSize = this.gridSize, angleSnap = this.angleSnap) { this.snap = Boolean(enabled); this.gridSize = Math.max(1, Number(gridSize) || 64); this.angleSnap = Math.max(0.1, Number(angleSnap) || 15); this.updateSnaps(); }
  setSpace(space) { this.space = space; if (this.transform.object !== this.editPivot) this.transform.setSpace(String(space).toLowerCase() === 'world' ? 'world' : 'local'); }

  setShading(mode) {
    this.shading = mode;
    for (const root of this.objectRoots.values()) root.traverse(child => {
      if (!child.isMesh) return;
      for (const mat of Array.isArray(child.material) ? child.material : [child.material]) if (mat) { mat.wireframe = mode === 'Wireframe'; mat.needsUpdate = true; }
    });
  }

  setView(mode) {
    const target = this.orbit.target.clone();
    const distance = Math.max(500, this.camera.position.distanceTo(target));
    if (mode === 'Top') this.camera.position.copy(target).add(new THREE.Vector3(0, 0, distance));
    else if (mode === 'Front') this.camera.position.copy(target).add(new THREE.Vector3(0, -distance, 0));
    else if (mode === 'Side') this.camera.position.copy(target).add(new THREE.Vector3(distance, 0, 0));
    else this.camera.position.copy(target).add(new THREE.Vector3(distance * 0.65, -distance * 0.75, distance * 0.55));
    this.camera.lookAt(target); this.orbit.update();
  }

  handlePointerDown(event) {
    if (event.button !== 0 || this.transform.dragging || this.transform.axis) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (['vertex', 'edge', 'face', 'extrude'].includes(this.tool) && this.editGroup.children.length) {
      const hits = this.raycaster.intersectObjects(this.editGroup.children, true);
      const handle = hits.map(h => h.object).find(x => x.userData.sub);
      if (handle) { event.stopPropagation(); this.selectSub(handle); return; }
    }

    const hits = this.raycaster.intersectObjects([...this.objectRoots.values()], true);
    if (!hits.length) { this.select(null); return; }
    let root = hits[0].object;
    while (root.parent && root.parent !== this.objectGroup) root = root.parent;
    if (root.userData.ephId) this.select(root.userData.ephId);
  }

  handleDoubleClick(event) {
    if (this.tool === 'extrude' && this.subSelection?.type === 'face') { this.callbacks.extrude?.(this.subSelection.faceIndex); return; }
    this.focusSelected();
  }

  syncSelectedFromRoot(commit) {
    const object = this.getObjectById(this.selectedId), root = this.objectRoots.get(this.selectedId);
    if (!object || !root) return;
    object.position = [root.position.x, root.position.y, root.position.z];
    object.rotation = [root.rotation.x * DEG, root.rotation.y * DEG, root.rotation.z * DEG];
    object.scale = [root.scale.x, root.scale.y, root.scale.z];
    this.callbacks.change?.(object, commit);
  }

  commitObjectTransform() { this.syncSelectedFromRoot(true); this.updateSelectionBox(); }
  updateSelectionBox() { const root = this.selectedId ? this.objectRoots.get(this.selectedId) : null; if (root) { this.selectionBox.setFromObject(root); this.selectionBox.visible = true; } }

  focusSelected() {
    const root = this.selectedId ? this.objectRoots.get(this.selectedId) : null;
    if (!root) return this.frameAll();
    const box = new THREE.Box3().setFromObject(root); if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), radius = Math.max(size.length(), 64);
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center); this.camera.position.copy(center).add(dir.multiplyScalar(radius * 1.8)); this.orbit.update();
  }

  frameAll() {
    const box = new THREE.Box3().setFromObject(this.objectGroup);
    if (box.isEmpty()) { this.orbit.target.set(0, 0, 64); this.camera.position.set(700, -900, 650); this.orbit.update(); return; }
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), radius = Math.max(size.length(), 128);
    this.orbit.target.copy(center); this.camera.position.copy(center).add(new THREE.Vector3(radius * 0.75, -radius, radius * 0.65)); this.camera.lookAt(center); this.orbit.update();
  }

  getCameraState() { return { position: this.camera.position.toArray(), target: this.orbit.target.toArray(), fov: this.camera.fov }; }
  setCameraState(state) {
    if (!state) return;
    if (Array.isArray(state.position)) this.camera.position.fromArray(state.position);
    if (Array.isArray(state.target)) this.orbit.target.fromArray(state.target);
    if (Number.isFinite(Number(state.fov))) { this.camera.fov = Number(state.fov); this.camera.updateProjectionMatrix(); }
    this.orbit.update();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }

  animate() { requestAnimationFrame(() => this.animate()); this.orbit.update(); this.renderer.render(this.scene, this.camera); }
}

const container = document.getElementById('threeViewport');
if (container) {
  const viewport = new EditorViewport(container);
  window.EPH3D = viewport;
  window.dispatchEvent(new CustomEvent('eph3d-ready', { detail: viewport }));
}
