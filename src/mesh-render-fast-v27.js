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

  function dominantAxis(vertices, face) {
    const a = vertices[face[0]] || [0, 0, 0];
    const b = vertices[face[1]] || a;
    const c = vertices[face[2]] || a;
    const abx = (Number(b[0]) || 0) - (Number(a[0]) || 0);
    const aby = (Number(b[1]) || 0) - (Number(a[1]) || 0);
    const abz = (Number(b[2]) || 0) - (Number(a[2]) || 0);
    const acx = (Number(c[0]) || 0) - (Number(a[0]) || 0);
    const acy = (Number(c[1]) || 0) - (Number(a[1]) || 0);
    const acz = (Number(c[2]) || 0) - (Number(a[2]) || 0);
    const nx = Math.abs(aby * acz - abz * acy);
    const ny = Math.abs(abz * acx - abx * acz);
    const nz = Math.abs(abx * acy - aby * acx);
    return nx >= ny && nx >= nz ? 0 : ny >= nx && ny >= nz ? 1 : 2;
  }

  function fallbackUv(vertices, face, corner, axis) {
    const vertex = vertices[face[corner]] || [0, 0, 0];
    const x = Number(vertex[0]) || 0;
    const y = Number(vertex[1]) || 0;
    const z = Number(vertex[2]) || 0;
    const scale = 1 / 128;
    if (axis === 0) return [y * scale, z * scale];
    if (axis === 1) return [x * scale, z * scale];
    return [x * scale, y * scale];
  }

  function sharedMaterial(viewport, resource) {
    viewport.__ephSharedFaceMaterialsV27 ||= new Map();
    const cache = viewport.__ephSharedFaceMaterialsV27;
    if (cache.has(resource)) return cache.get(resource);
    const material = viewport.createFaceMaterial(resource);
    if (material) {
      material.userData ||= {};
      material.userData.sharedMaterial = true;
      material.userData.ephSharedV27 = true;
    }
    cache.set(resource, material);
    return material;
  }

  function installSharedDisposal(viewport) {
    if (viewport.disposeObject?.__ephSharedSafeV27) return;
    const dispose = function(object3d) {
      object3d?.traverse?.(child => {
        if (child.geometry && !child.userData?.sharedGeometry) child.geometry.dispose?.();
        const materials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
        for (const material of materials) {
          if (!material) continue;
          material.userData ||= {};
          // A shared VMAT can be referenced by hundreds of streamed meshes. Do
          // not mark it disposed just because one chunk left the frustum.
          if (material.userData.sharedMaterial || material.userData.ephSharedV27) continue;
          material.userData.disposed = true;
          material.dispose?.();
        }
      });
    };
    dispose.__ephSharedSafeV27 = true;
    viewport.disposeObject = dispose;
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
        const axis = hasSourceUvs ? -1 : dominantAxis(vertices, face);

        for (let triangle = 1; triangle < face.length - 1; triangle++) {
          const corners = [0, triangle, triangle + 1];
          for (const corner of corners) {
            const vertexIndex = face[corner];
            const vertex = vertices[vertexIndex] || [0, 0, 0];
            positions.push(Number(vertex[0]) || 0, Number(vertex[1]) || 0, Number(vertex[2]) || 0);
            const uv = sourceUvs?.[corner] || fallbackUv(vertices, face, corner, axis);
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
    if (!viewport.__ephAdvancedViewport) return false;
    installSharedDisposal(viewport);
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
  [250, 750, 1500, 3000].forEach(delay => setTimeout(install, delay));
  window.addEventListener('eph3d-ready', install, { once: true });
})();
