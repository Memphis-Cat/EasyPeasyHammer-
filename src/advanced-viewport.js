// byanca
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
globalThis.THREE = THREE;

const FACE_ORDER = ['right', 'left', 'front', 'back', 'top', 'bottom'];
const DEFAULT_PART_MATERIAL = 'materials/dev/dev_measuregeneric01b.vmat';
const playerModelCache = new Map();

function parseLightColor(value) {
  const raw = String(value || '255 244 214').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return new THREE.Color(raw);
  const parts = raw.split(/[ ,]+/).map(Number).filter(Number.isFinite);
  if (parts.length >= 3) return new THREE.Color(parts[0] / 255, parts[1] / 255, parts[2] / 255);
  return new THREE.Color(1, .92, .78);
}

function disposeGridObject(object) {
  if (!object) return;
  object.traverse?.(child => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(material => material?.dispose?.());
    else child.material?.dispose?.();
  });
}

function gridLines(extent, step, predicate) {
  const positions = [];
  const count = Math.floor(extent / step);
  for (let i = -count; i <= count; i++) {
    if (!predicate(i)) continue;
    const p = i * step;
    positions.push(-extent, p, 0, extent, p, 0);
    positions.push(p, -extent, 0, p, extent, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

async function resolvePlayerModel(className) {
  const team = className.includes('counterterrorist') ? 'ct' : 't';
  if (playerModelCache.has(team)) return playerModelCache.get(team);

  const pending = (async () => {
    const searches = team === 'ct'
      ? ['ctm_sas', 'ctm_st6', 'ctm_fbi', 'ctm_gign']
      : ['tm_phoenix', 'tm_leet', 'tm_balkan', 'tm_anarchist'];

    for (const query of searches) {
      try {
        const result = await window.easyPeasyHammer?.searchAssets?.('model', query, 40);
        const items = result?.ok && Array.isArray(result.items) ? result.items : [];
        if (!items.length) continue;
        const preferred = items.find(item => /characters\/models/i.test(item.path || ''))
          || items.find(item => /player/i.test(item.path || ''))
          || items[0];
        if (preferred?.path) return preferred.path;
      } catch {}
    }
    return null;
  })();

  playerModelCache.set(team, pending);
  return pending;
}

function install(viewport) {
  if (!viewport || viewport.__ephAdvancedViewport) return;
  viewport.__ephAdvancedViewport = true;

  const previousGridVisible = viewport.gridHelper?.visible !== false;
  viewport.makeGrid = function() {
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      disposeGridObject(this.gridHelper);
    }

    const step = Math.max(1, Number(this.gridSize) || 64);
    const extent = Math.max(16384, step * 256);
    const majorEvery = 8;
    const group = new THREE.Group();
    group.name = 'HammerGrid';

    const minor = new THREE.LineSegments(
      gridLines(extent, step, index => index !== 0 && Math.abs(index) % majorEvery !== 0),
      new THREE.LineBasicMaterial({ color: 0xa4a7aa, transparent: true, opacity: .42, depthWrite: false })
    );
    const major = new THREE.LineSegments(
      gridLines(extent, step, index => index !== 0 && Math.abs(index) % majorEvery === 0),
      new THREE.LineBasicMaterial({ color: 0xb56f19, transparent: true, opacity: .86, depthWrite: false })
    );

    const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-extent, 0, .04), new THREE.Vector3(extent, 0, .04)
    ]);
    const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -extent, .04), new THREE.Vector3(0, extent, .04)
    ]);
    const xAxis = new THREE.Line(xAxisGeometry, new THREE.LineBasicMaterial({ color: 0x19a8b5, transparent: true, opacity: .95, depthWrite: false }));
    const yAxis = new THREE.Line(yAxisGeometry, new THREE.LineBasicMaterial({ color: 0x118b9a, transparent: true, opacity: .95, depthWrite: false }));

    minor.renderOrder = -300;
    major.renderOrder = -299;
    xAxis.renderOrder = -298;
    yAxis.renderOrder = -298;
    group.add(minor, major, xAxis, yAxis);
    this.gridHelper = group;
    this.scene.add(group);
  };
  viewport.makeGrid();
  viewport.gridHelper.visible = previousGridVisible;
  viewport.scene.background = new THREE.Color(0x0b0c0e);

  const originalLoadMaterialTexture = viewport.loadMaterialTexture.bind(viewport);
  viewport.loadMaterialTexture = async function(resource) {
    const texture = await originalLoadMaterialTexture(resource);
    if (!texture || texture.userData?.ephHammerScale) return texture;

    const image = texture.image;
    const width = Number(image?.naturalWidth || image?.videoWidth || image?.width || 512) || 512;
    const height = Number(image?.naturalHeight || image?.videoHeight || image?.height || 512) || 512;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(512 / width, 512 / height);
    texture.userData.ephHammerScale = true;
    texture.userData.ephSourceSize = [width, height];
    texture.needsUpdate = true;
    return texture;
  };

  viewport.createPartVisual = function(object) {
    const vertices = object.vertices || [];
    const faces = object.faces || [];
    if (!vertices.length || !faces.length) return this.createBoxVisual(object);

    const positions = [];
    const uvs = [];
    const groups = [];
    let cursor = 0;

    const uvFor = (v, normal) => {
      const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
      const worldToUv = 1 / 128;
      if (ax >= ay && ax >= az) return [v[1] * worldToUv, v[2] * worldToUv];
      if (ay >= ax && ay >= az) return [v[0] * worldToUv, v[2] * worldToUv];
      return [v[0] * worldToUv, v[1] * worldToUv];
    };

    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi];
      if (!face || face.length < 3) continue;
      const a = new THREE.Vector3(...(vertices[face[0]] || [0, 0, 0]));
      const b = new THREE.Vector3(...(vertices[face[1]] || [0, 0, 0]));
      const c = new THREE.Vector3(...(vertices[face[2]] || [0, 0, 0]));
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const start = cursor;

      for (let i = 1; i < face.length - 1; i++) {
        for (const index of [face[0], face[i], face[i + 1]]) {
          const v = vertices[index] || [0, 0, 0];
          positions.push(v[0], v[1], v[2]);
          uvs.push(...uvFor(v, normal));
          cursor++;
        }
      }
      if (cursor > start) groups.push({ start, count: cursor - start, materialIndex: fi });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    groups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));

    const materials = faces.map((_, i) => this.createFaceMaterial(object.faceMaterials?.[i] || object.materials?.[FACE_ORDER[i]] || DEFAULT_PART_MATERIAL));
    const mesh = new THREE.Mesh(geometry, materials.length ? materials : [this.createFaceMaterial(DEFAULT_PART_MATERIAL)]);
    mesh.userData.ephVisual = true;
    return mesh;
  };

  const originalCreateEntityMarker = viewport.createEntityMarker.bind(viewport);
  viewport.createEntityMarker = function(object) {
    const className = String(object.className || '');

    if (className === 'info_player_counterterrorist' || className === 'info_player_terrorist') {
      const group = new THREE.Group();
      const ct = className.includes('counterterrorist');
      const placeholder = new THREE.Mesh(
        new THREE.CapsuleGeometry(16, 36, 6, 10),
        new THREE.MeshStandardMaterial({ color: ct ? 0x527da8 : 0x9d7d52, roughness: .72 })
      );
      placeholder.rotation.x = Math.PI / 2;
      placeholder.userData.ephPlayerPlaceholder = true;
      group.add(placeholder);

      resolvePlayerModel(className).then(async modelPath => {
        if (!modelPath) return;
        const data = await this.loadModel(modelPath);
        if (!data || !group.parent) return;
        const model = cloneSkeleton(data.scene);
        model.rotation.x = Math.PI / 2;
        model.scale.setScalar(data.scale);
        model.traverse(child => {
          if (!child.isMesh) return;
          child.castShadow = false;
          child.receiveShadow = false;
        });
        group.remove(placeholder);
        placeholder.geometry?.dispose?.();
        placeholder.material?.dispose?.();
        group.add(model);
        if (this.selectedId === object.id) this.updateSelectionBox();
      });
      return group;
    }

    if (!className.includes('light')) return originalCreateEntityMarker(object);

    const props = object.entityProperties || (object.entityProperties = {});
    const group = new THREE.Group();
    const color = parseLightColor(props.color || props._light || '255 244 214');
    const brightness = Math.max(0, Number(props.brightness ?? props.intensity ?? 300));
    const range = Math.max(16, Number(props.range ?? props.distance ?? 512));

    const marker = new THREE.Mesh(new THREE.SphereGeometry(9, 14, 10), new THREE.MeshBasicMaterial({ color }));
    marker.userData.ephLightMarker = true;
    group.add(marker);

    if (className.includes('environment')) {
      const light = new THREE.DirectionalLight(color, Math.max(.05, brightness / 250));
      light.position.set(0, 0, 64);
      light.target.position.set(0, 100, 0);
      light.castShadow = String(props.castshadows ?? '1') !== '0';
      group.add(light, light.target);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -72)]);
      group.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color })));
    } else {
      const light = new THREE.PointLight(color, Math.max(.05, brightness / 120), range, 2);
      light.castShadow = String(props.castshadows ?? '1') !== '0';
      group.add(light);
      const ring = new THREE.Mesh(new THREE.SphereGeometry(range, 20, 12), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .055, depthWrite: false }));
      ring.userData.ephLightRange = true;
      group.add(ring);
    }
    return group;
  };

  viewport.setOuterRotationRingVisible = function(visible) {
    this.outerRotationRingVisible = Boolean(visible);
    const helper = this.transform?.getHelper?.();
    helper?.traverse?.(node => {
      if (node.name === 'E' || node.name === 'XYZE') {
        node.visible = Boolean(visible);
        if (node.material) node.material.visible = Boolean(visible);
      }
    });
  };

  const oldSetTool = viewport.setTool.bind(viewport);
  viewport.setTool = function(tool) {
    oldSetTool(tool);
    requestAnimationFrame(() => this.setOuterRotationRingVisible(this.outerRotationRingVisible !== false));
  };

  const createMeasuredPart = () => {
    if (!globalThis.S?.doc && typeof S !== 'undefined' && !S.doc) return;
    const state = typeof S !== 'undefined' ? S : globalThis.S;
    if (!state?.doc) return;
    pushHistory();
    const materials = Object.fromEntries(VMAP.FACE_NAMES.map(face => [face, DEFAULT_PART_MATERIAL]));
    const object = ensureObject(VMAP.addPart(state.doc, { size: [128, 128, 128], position: [0, 0, 64], collision: true, materials }));
    object.faceMaterials = object.faces.map(() => DEFAULT_PART_MATERIAL);
    object.materials = materials;
    object.name = `Part_${String(state.objects.filter(item => item.type === 'part').length + 1).padStart(3, '0')}`;
    object.blockPlayers = true;
    state.objects.push(object);
    state.selectedId = object.id;
    state.selectedFaces = new Set([0]);
    viewport.objects = state.objects;
    viewport.updateObject(object);
    viewport.select(object.id, false);
    setTool('move');
    markDirty(`Created ${object.name}`);
    renderTree();
    renderProperties();
  };

  try {
    addPart = createMeasuredPart;
    const topAddPart = document.getElementById('topAddPart');
    if (topAddPart) topAddPart.onclick = createMeasuredPart;
  } catch {}
}

if (window.EPH3D) install(window.EPH3D);
window.addEventListener('eph3d-ready', event => install(event.detail));
