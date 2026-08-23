// byanca
(() => {
  'use strict';

  if (window.__ephMapLocalAssetsV19) return;
  window.__ephMapLocalAssetsV19 = true;

  const api = window.easyPeasyHammer;
  const localCache = new Map();
  const localTextureCache = new Map();
  const unavailable = new Set();

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Map Local Asset] ${message}`, meta || '');
    api?.appLog?.(level, 'map-local-asset', message, meta).catch?.(() => {});
  }

  function projectPath() {
    return String(window.S?.project?.vmapPath || (typeof S !== 'undefined' ? S?.project?.vmapPath : '') || '');
  }

  async function localTexture(viewport, resource) {
    const vmapPath = projectPath();
    const normalized = String(resource || '').replace(/\\/g, '/');
    if (!vmapPath || !normalized || !api?.mapLocalMaterial) return null;
    const cacheKey = `${vmapPath.toLowerCase()}|${normalized.toLowerCase()}`;
    if (!localTextureCache.has(cacheKey)) {
      localTextureCache.set(cacheKey, (async () => {
        let result;
        try { result = await api.mapLocalMaterial(vmapPath, normalized); }
        catch (error) {
          report('error', `Map-local material request failed: ${normalized}`, error?.message || String(error));
          return null;
        }
        if (!result?.ok || !result.url) {
          if (result?.local) report('warning', `Map-local VMAT could not produce a preview texture: ${normalized}`, result?.error || 'unknown error');
          return null;
        }
        return new Promise(resolve => viewport.textureLoader.load(result.url, texture => {
          const THREE = window.EPH_THREE || window.THREE;
          if (THREE) {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          }
          texture.userData ||= {};
          texture.userData.ephMapLocal = true;
          report('normal', `Loaded map-local material texture: ${normalized}`, { source: result.source, texture: result.texture });
          resolve(texture);
        }, undefined, error => {
          report('error', `Browser could not load map-local texture for ${normalized}`, error?.message || String(error));
          resolve(null);
        }));
      })());
    }
    return localTextureCache.get(cacheKey);
  }

  async function materialFor(viewport, THREE, resource) {
    const materialPath = String(resource || 'ERROR');
    let texture = null;
    if (materialPath !== 'ERROR') {
      try { texture = await viewport.loadMaterialTexture(materialPath); }
      catch {}
    }
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.02,
      side: THREE.DoubleSide,
      map: texture || viewport.errorTexture || null,
    });
    material.userData.resource = materialPath;
    if (!texture && materialPath !== 'ERROR') report('warning', `Material for map-local model could not be previewed: ${materialPath}`);
    return material;
  }

  async function buildScene(viewport, result) {
    const THREE = window.EPH_THREE || window.THREE;
    if (!THREE || !result?.meshes?.length) return null;

    const scene = new THREE.Group();
    const axisFix = new THREE.Group();
    // Existing EasyPeasyHammer prop/entity model code rotates imported GLB roots
    // +90° around X. Source-model DMX is already in Hammer coordinates, so this
    // child cancels that GLB-specific correction without changing the common path.
    axisFix.rotation.x = -Math.PI / 2;
    scene.add(axisFix);

    const content = new THREE.Group();
    const translation = Array.isArray(result.translation) ? result.translation.map(Number) : [0, 0, 0];
    content.position.set(Number(translation[0]) || 0, Number(translation[1]) || 0, Number(translation[2]) || 0);
    axisFix.add(content);

    for (const source of result.meshes) {
      if (!Array.isArray(source.positions) || source.positions.length < 9) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
      if (Array.isArray(source.uvs) && source.uvs.length === (source.positions.length / 3) * 2) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(source.uvs, 2));
      }
      if (Array.isArray(source.normals) && source.normals.length === source.positions.length) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.normals, 3));
      } else geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const groups = Array.isArray(source.groups) && source.groups.length ? source.groups : [{ start: 0, count: source.positions.length / 3, material: 'ERROR' }];
      const uniqueResources = [];
      const materialIndex = new Map();
      for (const group of groups) {
        const resource = String(group.material || 'ERROR');
        if (!materialIndex.has(resource)) {
          materialIndex.set(resource, uniqueResources.length);
          uniqueResources.push(resource);
        }
      }
      const materials = await Promise.all(uniqueResources.map(resource => materialFor(viewport, THREE, resource)));
      for (const group of groups) {
        geometry.addGroup(Number(group.start) || 0, Math.max(0, Number(group.count) || 0), materialIndex.get(String(group.material || 'ERROR')) || 0);
      }

      const mesh = new THREE.Mesh(geometry, materials.length ? materials : [await materialFor(viewport, THREE, 'ERROR')]);
      mesh.name = source.name || 'MapLocalMesh';
      mesh.userData.ephMapLocalSource = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      content.add(mesh);
    }

    if (!content.children.length) return null;
    return scene;
  }

  async function localModel(viewport, resource) {
    const vmapPath = projectPath();
    const normalized = String(resource || '').replace(/\\/g, '/');
    if (!vmapPath || !normalized || !api?.mapLocalModel) return null;
    if (!/^(?:maps|models)\//i.test(normalized)) return null;

    const cacheKey = `${vmapPath.toLowerCase()}|${normalized.toLowerCase()}`;
    if (unavailable.has(cacheKey)) return null;
    if (!localCache.has(cacheKey)) {
      localCache.set(cacheKey, (async () => {
        let result;
        try { result = await api.mapLocalModel(vmapPath, normalized); }
        catch (error) {
          report('error', `Map-local model request failed: ${normalized}`, error?.message || String(error));
          return null;
        }
        if (!result?.ok) {
          if (result?.local) report('warning', `Map-local model exists but could not be decoded: ${normalized}`, result?.error || 'unknown error');
          else unavailable.add(cacheKey);
          return null;
        }
        const scene = await buildScene(viewport, result);
        if (!scene) {
          report('warning', `Map-local model produced no renderable geometry: ${normalized}`);
          return null;
        }
        report('normal', `Loaded map-local source model: ${normalized}`, {
          source: result.source,
          sourceFiles: result.sourceFiles,
          draws: result.drawNames,
          meshes: result.meshes.length,
        });
        return { scene, scale: 1, ephMapLocal: true };
      })());
    }
    return localCache.get(cacheKey);
  }

  function install() {
    const viewport = window.EPH3D || (typeof S !== 'undefined' ? S?.viewport : null);
    if (!viewport?.loadModel || !viewport?.loadMaterialTexture) return false;

    if (!viewport.loadMaterialTexture.__ephMapLocalV19) {
      const rawMaterial = viewport.loadMaterialTexture.bind(viewport);
      const materialWrapper = async function(resource) {
        const normal = await rawMaterial(resource);
        if (normal) return normal;
        return localTexture(viewport, resource);
      };
      materialWrapper.__ephMapLocalV19 = true;
      materialWrapper.__ephPreviousLoadMaterial = rawMaterial;
      viewport.loadMaterialTexture = materialWrapper;
      report('normal', 'Map-local material resolver installed.');
    }

    if (!viewport.loadModel.__ephMapLocalV19) {
      const rawModel = viewport.loadModel.bind(viewport);
      const modelWrapper = async function(resource) {
        const local = await localModel(viewport, resource);
        if (local) return local;
        return rawModel(resource);
      };
      modelWrapper.__ephMapLocalV19 = true;
      modelWrapper.__ephPreviousLoadModel = rawModel;
      viewport.loadModel = modelWrapper;
      report('normal', 'Map-local model resolver installed.');
    }

    return Boolean(viewport.loadModel.__ephMapLocalV19 && viewport.loadMaterialTexture.__ephMapLocalV19);
  }

  if (!install()) {
    const timer = setInterval(() => {
      if (install()) clearInterval(timer);
    }, 200);
    setTimeout(() => clearInterval(timer), 15000);
  }
  window.addEventListener('eph3d-ready', install);
})();
