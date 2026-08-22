// byanca
import * as THREE from 'three';

const FACE_ORDER = ['right', 'left', 'front', 'back', 'top', 'bottom'];

function parseLightColor(value) {
  const raw = String(value || '255 244 214').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return new THREE.Color(raw);
  const parts = raw.split(/[ ,]+/).map(Number).filter(Number.isFinite);
  if (parts.length >= 3) return new THREE.Color(parts[0] / 255, parts[1] / 255, parts[2] / 255);
  return new THREE.Color(1, .92, .78);
}

function install(viewport) {
  if (!viewport || viewport.__ephAdvancedViewport) return;
  viewport.__ephAdvancedViewport = true;

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
      const scale = 1 / 128;
      if (ax >= ay && ax >= az) return [v[1] * scale, v[2] * scale];
      if (ay >= ax && ay >= az) return [v[0] * scale, v[2] * scale];
      return [v[0] * scale, v[1] * scale];
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

    const materials = faces.map((_, i) => this.createFaceMaterial(object.faceMaterials?.[i] || object.materials?.[FACE_ORDER[i]] || 'ERROR'));
    const mesh = new THREE.Mesh(geometry, materials.length ? materials : [this.createFaceMaterial('ERROR')]);
    mesh.userData.ephVisual = true;
    return mesh;
  };

  const originalCreateEntityMarker = viewport.createEntityMarker.bind(viewport);
  viewport.createEntityMarker = function(object) {
    const className = String(object.className || '');
    if (!className.includes('light')) return originalCreateEntityMarker(object);

    const props = object.entityProperties || (object.entityProperties = {});
    const group = new THREE.Group();
    const color = parseLightColor(props.color || props._light || '255 244 214');
    const brightness = Math.max(0, Number(props.brightness ?? props.intensity ?? 300));
    const range = Math.max(16, Number(props.range ?? props.distance ?? 512));

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(9, 14, 10),
      new THREE.MeshBasicMaterial({ color })
    );
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
      const ring = new THREE.Mesh(
        new THREE.SphereGeometry(range, 20, 12),
        new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .055, depthWrite: false })
      );
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
}

if (window.EPH3D) install(window.EPH3D);
window.addEventListener('eph3d-ready', event => install(event.detail));
