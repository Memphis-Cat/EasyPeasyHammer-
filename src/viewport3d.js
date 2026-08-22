// byanca
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const FACE_ORDER = ['right', 'left', 'front', 'back', 'top', 'bottom'];
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

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
    this.renderer.shadowMap.enabled = false;
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

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.objectGroup = new THREE.Group();
    this.objectGroup.name = 'MapObjects';
    this.scene.add(this.objectGroup);
    this.objectMeshes = new Map();
    this.objects = [];
    this.selectedId = null;
    this.tool = 'select';
    this.gridSize = 64;
    this.snap = true;
    this.angleSnap = 15;
    this.shading = 'Lit';
    this.callbacks = { select: null, change: null, camera: null, transformStart: null };
    this.errorTexture = this.makeErrorTexture();

    this.addLights();
    this.makeGrid();

    this.selectionBox = new THREE.BoxHelper(undefined, 0x3d9cff);
    this.selectionBox.visible = false;
    this.selectionBox.material.depthTest = false;
    this.selectionBox.renderOrder = 1000;
    this.scene.add(this.selectionBox);

    this.transform.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;
      if (event.value) this.callbacks.transformStart?.();
      else this.commitTransform();
    });
    this.transform.addEventListener('objectChange', () => {
      this.updateSelectionBox();
      this.syncSelectedFromMesh(false);
    });

    this.orbit.addEventListener('change', () => {
      this.callbacks.camera?.(this.getCameraState());
    });

    this.renderer.domElement.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
    this.renderer.domElement.addEventListener('dblclick', () => this.focusSelected());
    this.renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey) this.focusSelected();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xcbd8ff, 0x3b3540, 1.75));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(-600, -800, 1400);
    this.scene.add(sun);
  }

  makeGrid() {
    if (this.gridHelper) this.scene.remove(this.gridHelper);
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
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const cells = 4;
    const cell = canvas.width / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#24052d' : '#d414b9';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 25px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) ctx.fillText('ERROR', x * cell + cell / 2, y * cell + cell / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    return texture;
  }

  hashColor(text) {
    let hash = 2166136261;
    for (const char of String(text || 'material')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const hue = Math.abs(hash) % 360;
    const color = new THREE.Color();
    color.setHSL(hue / 360, 0.18, 0.42);
    return color;
  }

  createFaceMaterial(resource) {
    const value = String(resource || 'ERROR');
    const isError = value === 'ERROR' || /error|missing/i.test(value);
    const options = {
      color: isError ? 0xffffff : this.hashColor(value),
      roughness: 0.78,
      metalness: 0.04,
      side: THREE.DoubleSide
    };
    if (isError) options.map = this.errorTexture;
    const material = new THREE.MeshStandardMaterial(options);
    material.userData.resource = value;
    return material;
  }

  disposeObject(object3d) {
    object3d.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose?.();
      }
    });
  }

  clearObjects() {
    this.transform.detach();
    for (const child of [...this.objectGroup.children]) {
      this.objectGroup.remove(child);
      this.disposeObject(child);
    }
    this.objectMeshes.clear();
    this.selectionBox.visible = false;
  }

  setObjects(objects, selectedId = null) {
    this.objects = objects || [];
    this.clearObjects();
    for (const object of this.objects) {
      if (['world', 'folder'].includes(object.type) || object.visible === false) continue;
      const mesh = this.createObjectMesh(object);
      if (!mesh) continue;
      mesh.userData.ephId = object.id;
      this.objectGroup.add(mesh);
      this.objectMeshes.set(object.id, mesh);
    }
    this.select(selectedId, false);
  }

  updateObject(object) {
    if (!object || ['world', 'folder'].includes(object.type)) return;
    const previous = this.objectMeshes.get(object.id);
    const wasSelected = this.selectedId === object.id;
    if (previous) {
      if (wasSelected) this.transform.detach();
      this.objectGroup.remove(previous);
      this.disposeObject(previous);
      this.objectMeshes.delete(object.id);
    }
    if (object.visible !== false) {
      const mesh = this.createObjectMesh(object);
      if (mesh) {
        mesh.userData.ephId = object.id;
        this.objectGroup.add(mesh);
        this.objectMeshes.set(object.id, mesh);
      }
    }
    if (wasSelected) this.select(object.id, false);
  }

  createObjectMesh(object) {
    let root;
    if (object.type === 'part') root = object.vertices?.length && object.faces?.length ? this.createMesh(object) : this.createBox(object);
    else if (object.type === 'mesh') root = this.createMesh(object);
    else if (object.type === 'prop') root = this.createPropPlaceholder(object);
    else if (object.type === 'entity') root = this.createEntityMarker(object);
    if (!root) return null;
    this.applyTransform(root, object);
    root.name = object.name || object.id;
    return root;
  }

  createBox(object) {
    const size = object.size || [64, 64, 64];
    const geometry = new THREE.BoxGeometry(Math.max(0.01, size[0]), Math.max(0.01, size[1]), Math.max(0.01, size[2]));
    const materials = FACE_ORDER.map((face, i) => this.createFaceMaterial(object.materials?.[face] || object.faceMaterials?.[i] || 'ERROR'));
    return new THREE.Mesh(geometry, materials);
  }

  createMesh(object) {
    const vertices = object.vertices || [];
    const faces = object.faces || [];
    if (!vertices.length || !faces.length) return this.createBox({ ...object, size: object.size || [64, 64, 64] });

    const positions = [];
    const groups = [];
    let triangleIndex = 0;
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
      const face = faces[faceIndex];
      if (face.length < 3) continue;
      const start = triangleIndex * 3;
      for (let i = 1; i < face.length - 1; i++) {
        for (const index of [face[0], face[i], face[i + 1]]) {
          const v = vertices[index] || [0, 0, 0];
          positions.push(v[0], v[1], v[2]);
        }
        triangleIndex++;
      }
      const count = triangleIndex * 3 - start;
      if (count > 0) groups.push({ start, count, materialIndex: faceIndex });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    const materials = faces.map((_, i) => this.createFaceMaterial(object.materials?.[FACE_ORDER[i]] || object.faceMaterials?.[i] || 'ERROR'));
    return new THREE.Mesh(geometry, materials.length ? materials : [this.createFaceMaterial('ERROR')]);
  }

  createPropPlaceholder(object) {
    const size = object.size || [64, 64, 64];
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const material = new THREE.MeshStandardMaterial({ color: 0x8a744d, roughness: 0.7, metalness: 0.05, transparent: true, opacity: 0.82 });
    const mesh = new THREE.Mesh(geometry, material);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xd6b77c }));
    mesh.add(edges);
    return mesh;
  }

  createEntityMarker(object) {
    const className = String(object.className || 'entity');
    let geometry;
    let color = 0x55a7ff;
    if (className.includes('player_terrorist')) color = 0xe86f52;
    else if (className.includes('player_counterterrorist')) color = 0x58a8ff;
    else if (className.includes('light')) color = 0xffdd76;
    else if (className.includes('trigger')) color = 0xa66aff;

    if (className.includes('player_')) geometry = new THREE.CapsuleGeometry(16, 36, 6, 10);
    else geometry = new THREE.OctahedronGeometry(18, 0);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geometry, material);
    if (className.includes('player_')) mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  applyTransform(mesh, object) {
    const p = object.position || [0, 0, 0];
    const r = object.rotation || [0, 0, 0];
    const s = object.scale || [1, 1, 1];
    mesh.position.set(p[0], p[1], p[2]);
    mesh.rotation.set(r[0] * RAD, r[1] * RAD, r[2] * RAD, 'XYZ');
    mesh.scale.set(s[0], s[1], s[2]);
  }

  getObjectById(id) {
    return this.objects.find((object) => object.id === id) || null;
  }

  select(id, notify = true) {
    this.selectedId = id || null;
    const mesh = id ? this.objectMeshes.get(id) : null;
    if (mesh) {
      if (this.tool === 'move' || this.tool === 'rotate' || this.tool === 'scale') {
        this.transform.attach(mesh);
        this.transform.setMode(this.tool === 'move' ? 'translate' : this.tool);
      } else {
        this.transform.detach();
      }
      this.selectionBox.setFromObject(mesh);
      this.selectionBox.visible = true;
    } else {
      this.transform.detach();
      this.selectionBox.visible = false;
    }
    if (notify) this.callbacks.select?.(this.selectedId);
  }

  setTool(tool) {
    this.tool = tool;
    const mesh = this.selectedId ? this.objectMeshes.get(this.selectedId) : null;
    if (mesh && ['move', 'rotate', 'scale'].includes(tool)) {
      this.transform.attach(mesh);
      this.transform.setMode(tool === 'move' ? 'translate' : tool);
    } else {
      this.transform.detach();
    }
    this.updateSnaps();
  }

  updateSnaps() {
    this.transform.setTranslationSnap(this.snap ? this.gridSize : null);
    this.transform.setRotationSnap(this.snap ? this.angleSnap * RAD : null);
    this.transform.setScaleSnap(this.snap ? 0.1 : null);
  }

  setGrid(enabled, size = this.gridSize) {
    this.gridSize = Math.max(1, Number(size) || 64);
    this.makeGrid();
    this.gridHelper.visible = Boolean(enabled);
    this.updateSnaps();
  }

  setSnap(enabled, gridSize = this.gridSize, angleSnap = this.angleSnap) {
    this.snap = Boolean(enabled);
    this.gridSize = Math.max(1, Number(gridSize) || 64);
    this.angleSnap = Math.max(0.1, Number(angleSnap) || 15);
    this.updateSnaps();
  }

  setSpace(space) {
    this.transform.setSpace(String(space).toLowerCase() === 'world' ? 'world' : 'local');
  }

  setShading(mode) {
    this.shading = mode;
    for (const mesh of this.objectMeshes.values()) {
      mesh.traverse((child) => {
        if (!child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) if ('wireframe' in material) material.wireframe = mode === 'Wireframe';
      });
    }
  }

  setView(view) {
    const distance = Math.max(512, this.camera.position.distanceTo(this.orbit.target));
    const t = this.orbit.target.clone();
    if (view === 'Top') this.camera.position.copy(t).add(new THREE.Vector3(0, 0, distance));
    else if (view === 'Front') this.camera.position.copy(t).add(new THREE.Vector3(0, -distance, 0));
    else if (view === 'Side') this.camera.position.copy(t).add(new THREE.Vector3(distance, 0, 0));
    else this.camera.position.copy(t).add(new THREE.Vector3(distance * 0.7, -distance * 0.9, distance * 0.6));
    this.camera.lookAt(t);
    this.orbit.update();
  }

  focusSelected() {
    const mesh = this.selectedId ? this.objectMeshes.get(this.selectedId) : null;
    if (!mesh) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    const distance = Math.max(96, sphere.radius * 3.1);
    this.orbit.target.copy(center);
    this.camera.position.copy(center).add(direction.multiplyScalar(distance));
    this.orbit.update();
  }

  frameAll() {
    const box = new THREE.Box3();
    let has = false;
    for (const mesh of this.objectMeshes.values()) {
      box.expandByObject(mesh);
      has = true;
    }
    if (!has) return;
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.orbit.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(sphere.radius * 1.5, -sphere.radius * 1.9, sphere.radius * 1.25));
    this.orbit.update();
  }

  handlePointerDown(event) {
    if (event.button !== 0 || this.transform.dragging) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.objectMeshes.values()], true);
    if (!hits.length) return this.select(null);
    let hit = hits[0].object;
    while (hit && !hit.userData.ephId) hit = hit.parent;
    this.select(hit?.userData.ephId || null);
  }

  syncSelectedFromMesh(commit = false) {
    const object = this.getObjectById(this.selectedId);
    const mesh = this.selectedId ? this.objectMeshes.get(this.selectedId) : null;
    if (!object || !mesh) return;
    object.position = [mesh.position.x, mesh.position.y, mesh.position.z];
    object.rotation = [mesh.rotation.x * DEG, mesh.rotation.y * DEG, mesh.rotation.z * DEG];
    object.scale = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
    this.callbacks.change?.(object, commit);
  }

  commitTransform() {
    this.syncSelectedFromMesh(true);
  }

  updateSelectionBox() {
    const mesh = this.selectedId ? this.objectMeshes.get(this.selectedId) : null;
    if (mesh && this.selectionBox.visible) this.selectionBox.setFromObject(mesh);
  }

  onSelect(callback) { this.callbacks.select = callback; }
  onChange(callback) { this.callbacks.change = callback; }
  onTransformStart(callback) { this.callbacks.transformStart = callback; }
  onCameraChange(callback) { this.callbacks.camera = callback; }

  getCameraState() {
    return { position: this.camera.position.toArray(), target: this.orbit.target.toArray() };
  }

  setCameraState(state) {
    if (!state?.position || !state?.target) return;
    this.camera.position.fromArray(state.position);
    this.orbit.target.fromArray(state.target);
    this.orbit.update();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate() {
    this.orbit.update();
    this.updateSelectionBox();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.animate());
  }
}

function init() {
  const container = document.getElementById('threeViewport');
  if (!container) return;
  const viewport = new EditorViewport(container);
  window.EPH3D = viewport;
  window.dispatchEvent(new CustomEvent('eph3d-ready', { detail: viewport }));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
