// byanca
(() => {
  'use strict';
  if (window.__ephMeshRenderFastV27) return;
  window.__ephMeshRenderFastV27 = true;

  const FACE_ORDER = ['right', 'left', 'front', 'back', 'top', 'bottom'];
  const DEFAULT_MATERIAL = 'materials/dev/dev_measuregeneric01b.vmat';
  let installedViewport = null;
  let installedFunction = null;

  function getThree() { return window.EPH_THREE || window.THREE || null; }

  function resourceFor(object, faceIndex) {
    return String(object?.faceMaterials?.[faceIndex]
      || object?.materials?.[FACE_ORDER[faceIndex]]
      || object?.faceMaterials?.[0]
      || DEFAULT_MATERIAL);
  }

  function validUvFace(object, faceIndex, face) {
    const values = object?.faceUVs?.[faceIndex];
    return Array.isArray(values) && values.length === face.length && values.every(value => Array.isArray(value) && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1])));
  }

  function fallbackUv(THREE, vertices, face, index) {
    const a = new THREE.Vector3(...(vertices[face[0]] || [0, 0, 0]));
    const b = new THREE.Vector3(...(vertices[face[1]] || [0, 0, 0]));
    const c = new THREE.Vector3(...(vertices[face[2]] || [0, 0, 0]));
    const normal = b.sub(a).cross(c.sub(a)).normalize();
    const vertex = vertices[face[index]] || [0, 0, 0];
    const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
    const scale = 1 / 128;
    if (ax >= ay && ax >= az) return [vertex[1] * scale, vertex[2] * scale];
    if (ay >= ax && ay >= az) return [vertex[0] * scale, vertex[2] * scale];
    return [vertex[0] * scale, vertex[1] * scale];
  }

  function sharedMaterial(viewport, resource) {
    viewport.__ephSharedFaceMaterialsV27 ||= new Map();
    const cache = viewport.__ephSharedFaceMaterialsV27;
    if (cache.has(resource)) return cache.get(resource);
    const material = viewport.createFaceMaterial(resource);
    if (material) {
      material.userData ||= {};
      // Viewport disposal deliberately keeps shared materials alive. This turns
      // thousands of per-face material allocations into one material per VMAT.
      material.userData.sharedMaterial = true;
      material.userData.ephSharedV27 = true;
    }
    cache.set(resource, material);
    return material;
  }

  function makeFastRenderer(viewport, previous) {
    const fast = function(object) {
      const THREE = getThree();
      const vertices = object?.vertices || [];
      const faces = object?.faces || [];
      if (!THREE || !vertices.length || !faces.length) return previous(object);

      const positions = [];
      const uvs = [];
      const groups = [];
      const materialResources = [];
      const materialIndices = new Map();
      let cursor = 0;

      const getMaterialIndex = resource => {
        if (materialIndices.has(resource)) return materialIndices.get(resource);
        const index = materialResources.length;
        materialIndices.set(resource, index);
        materialResources.push(resource);
        return index;
      };

      for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
        const face = faces[faceIndex];
        if (!Array.isArray(face) || face.length < 3) continue;
        const start = cursor;
        const resource = resourceFor(object, faceIndex);
        const materialIndex = getMaterialIndex(resource);
        const hasSourceUvs = validUvFace(object, faceIndex, face);
        const sourceUvs = hasSourceUvs ? object.faceUVs[faceIndex] : null;

        for (let triangle = 1; triangle < face.length - 1; triangle++) {
          const corners = [0, triangle, triangle + 1];
          for (const corner of corners) {
            const vertexIndex = face[corner];
            const vertex = vertices[vertexIndex] || [0, 0, 0];
            positions.push(Number(vertex[0]) || 0, Number(vertex[1]) || 0, Number(vertex[2]) || 0);
            const uv = sourceUvs?.[corner] || fallbackUv(THREE, vertices, face, corner);
            uvs.push(Number(uv?.[0]) || 0, Number(uv?.[1]) || 0);
            cursor++;
          }
        }
        if (cursor > start) groups.push({ start, count: cursor - start, materialIndex });
      }

      if (!positions.length) return previous(object);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);

      const materials = materialResources.map(resource => sharedMaterial(this, resource)).filter(Boolean);
      const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
      mesh.userData.ephVisual = true;
      mesh.userData.ephFastMeshV27 = true;
      mesh.userData.ephSourceUV = Boolean(object.ephSourceFaceUVs);
      object.ephUniqueMaterialCount = materialResources.length;
      return mesh;
    };
    fast.__ephFastMeshV27 = true;
    fast.__ephPrevious = previous;
    return fast;
  }

  function install() {
    const viewport = window.EPH3D || (typeof S !== 'undefined' ? S?.viewport : null);
    if (!viewport?.createPartVisual || !viewport?.createFaceMaterial) return false;
    // Wait until the advanced viewport has installed its final renderer so we
    // replace that implementation once instead of participating in wrapper ping-pong.
    if (!viewport.__ephAdvancedViewport) return false;
    if (viewport === installedViewport && viewport.createPartVisual === installedFunction) return true;
    if (viewport.createPartVisual.__ephFastMeshV27) {
      installedViewport = viewport;
      installedFunction = viewport.createPartVisual;
      return true;
    }
    const previous = viewport.createPartVisual.bind(viewport);
    const fast = makeFastRenderer(viewport, previous);
    viewport.createPartVisual = fast;
    installedViewport = viewport;
    installedFunction = fast;
    console.info('[Mesh Render V27] Unique shared-material renderer installed; imported Source 2 UVs enabled.');
    window.easyPeasyHammer?.appLog?.('normal', 'mesh-render-v27', 'Unique shared-material renderer installed; imported Source 2 UVs enabled.').catch?.(() => {});
    return true;
  }

  install();
  // A few bounded attempts handle project-dialog's asynchronous enhancement
  // loading. There is deliberately no forever/20-second install loop.
  [250, 750, 1500, 3000].forEach(delay => setTimeout(install, delay));
  window.addEventListener('eph3d-ready', install, { once: true });
})();
