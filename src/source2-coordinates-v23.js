// byanca
(() => {
  'use strict';
  if (window.__ephSource2CoordinatesV23) return;
  window.__ephSource2CoordinatesV23 = true;

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const CONVENTION = 'source2-qangle-yzx-v23';
  let viewportInstalled = null;

  const THREE_NOW = () => window.EPH_THREE || window.THREE;
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const normalizeDegree = value => {
    let angle = finite(value, 0);
    angle = ((angle + 180) % 360 + 360) % 360 - 180;
    if (Math.abs(angle) < 1e-7) angle = 0;
    return Number(angle.toFixed(6));
  };
  const chainHas = (fn, marker) => {
    const seen = new Set();
    let current = fn;
    for (let i = 0; current && typeof current === 'function' && i < 32 && !seen.has(current); i++) {
      if (current[marker]) return true;
      seen.add(current);
      current = current.__ephPrevious;
    }
    return false;
  };

  // Source 2 QAngle is Pitch/Yaw/Roll, rotating around Y/Z/X respectively.
  // Build Rz(yaw) * Ry(pitch) * Rx(roll), matching Source/Hammer semantics.
  function qAngleToQuaternion(angles) {
    const THREE = THREE_NOW();
    if (!THREE) return null;
    const pitch = finite(angles?.[0]) * RAD;
    const yaw = finite(angles?.[1]) * RAD;
    const roll = finite(angles?.[2]) * RAD;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pitch);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll);
    return qYaw.multiply(qPitch).multiply(qRoll).normalize();
  }

  function quaternionToQAngle(quaternion) {
    const THREE = THREE_NOW();
    if (!THREE || !quaternion) return [0, 0, 0];
    const euler = new THREE.Euler().setFromQuaternion(quaternion.clone().normalize(), 'ZYX');
    return [
      normalizeDegree(euler.y * DEG),
      normalizeDegree(euler.z * DEG),
      normalizeDegree(euler.x * DEG),
    ];
  }

  function legacyEulerToQAngle(angles) {
    const THREE = THREE_NOW();
    if (!THREE) return Array.isArray(angles) ? [...angles] : [0, 0, 0];
    const euler = new THREE.Euler(
      finite(angles?.[0]) * RAD,
      finite(angles?.[1]) * RAD,
      finite(angles?.[2]) * RAD,
      'XYZ'
    );
    return quaternionToQAngle(new THREE.Quaternion().setFromEuler(euler));
  }

  function qAngleToLegacyEuler(angles) {
    const THREE = THREE_NOW();
    const quaternion = qAngleToQuaternion(angles);
    if (!THREE || !quaternion) return Array.isArray(angles) ? [...angles] : [0, 0, 0];
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    return [normalizeDegree(euler.x * DEG), normalizeDegree(euler.y * DEG), normalizeDegree(euler.z * DEG)];
  }

  window.EPH_COORDINATES = {
    convention: CONVENTION,
    qAngleToQuaternion,
    quaternionToQAngle,
    legacyEulerToQAngle,
    qAngleToLegacyEuler,
  };

  function installViewport(viewport) {
    if (!viewport || viewportInstalled === viewport) return Boolean(viewport);
    if (!viewport.objectRoots || typeof viewport.syncSelectedFromRoot !== 'function') return false;
    viewportInstalled = viewport;

    viewport.applyTransform = function(root, object) {
      const position = object?.position || [0, 0, 0];
      const scale = object?.scale || [1, 1, 1];
      root.position.set(finite(position[0]), finite(position[1]), finite(position[2]));
      const quaternion = qAngleToQuaternion(object?.rotation || [0, 0, 0]);
      if (quaternion) root.quaternion.copy(quaternion);
      else root.rotation.set(0, 0, 0);
      root.scale.set(finite(scale[0], 1), finite(scale[1], 1), finite(scale[2], 1));
    };
    viewport.applyTransform.__ephSource2QAngleV23 = true;

    viewport.syncSelectedFromRoot = function(commit) {
      const object = this.getObjectById?.(this.selectedId);
      const root = this.objectRoots?.get?.(this.selectedId);
      if (!object || !root) return;
      object.position = [root.position.x, root.position.y, root.position.z];
      object.rotation = quaternionToQAngle(root.quaternion);
      object.scale = [root.scale.x, root.scale.y, root.scale.z];
      this.callbacks?.change?.(object, commit);
    };
    viewport.syncSelectedFromRoot.__ephSource2QAngleV23 = true;

    for (const object of viewport.objects || []) {
      const root = viewport.objectRoots?.get?.(object.id);
      if (root) viewport.applyTransform(root, object);
    }
    viewport.updateSelectionBox?.();
    console.info('[Coordinates V23] Source 2 Pitch/Yaw/Roll (Y/Z/X) conversion installed.');
    return true;
  }

  function isLegacyEphProject(project) {
    return Boolean(project && project.type === 'new-project' && project.rotationConvention !== CONVENTION);
  }

  function migrateLegacyProject(project) {
    if (!project || !isLegacyEphProject(project) || !window.EPH_VMAP || typeof S === 'undefined' || !S.doc) return false;
    let changed = 0;
    for (const object of S.objects || []) {
      if (!object?.dmxId || !Array.isArray(object.rotation)) continue;
      const old = object.rotation.map(value => finite(value));
      if (old.every(value => Math.abs(value) < 1e-7)) continue;
      object.rotation = legacyEulerToQAngle(old);
      window.EPH_VMAP.applyObjectToDocument?.(S.doc, object);
      changed++;
    }
    project.rotationConvention = CONVENTION;
    S.project = project;
    S.viewport?.setObjects?.(S.objects, S.selectedId);
    try { renderProperties?.(); renderTree?.(); } catch {}
    if (changed) {
      markDirty?.(`Migrated ${changed} legacy rotation${changed === 1 ? '' : 's'} to Source 2 QAngle`);
      console.info(`[Coordinates V23] Migrated ${changed} legacy EPH rotations for Hammer compatibility.`);
    } else autosave?.();
    return true;
  }

  function installLoadProjectMigration() {
    if (typeof loadProject !== 'function') return false;
    if (chainHas(loadProject, '__ephSource2CoordinateMigrationV23')) return true;
    const raw = loadProject;
    const wrapped = async function(project, ui) {
      const result = await raw(project, ui);
      if (result && project) migrateLegacyProject(project);
      return result;
    };
    wrapped.__ephSource2CoordinateMigrationV23 = true;
    wrapped.__ephPrevious = raw;
    loadProject = wrapped;
    window.loadProject = wrapped;
    return true;
  }

  // Decal placement computes a Three.js surface quaternion in the older tool
  // pass. Convert only those generated decal rotations before they enter VMAP.
  function installDecalCreationBridge() {
    const VMAP = window.EPH_VMAP;
    if (!VMAP?.addPart || chainHas(VMAP.addPart, '__ephSource2DecalV23')) return Boolean(VMAP?.addPart);
    const previous = VMAP.addPart;
    const raw = previous.bind(VMAP);
    const wrapped = function(doc, options = {}) {
      if (/^EPH_DECAL_/i.test(String(options?.meshName || '')) && Array.isArray(options.rotation)) {
        options = { ...options, rotation: legacyEulerToQAngle(options.rotation) };
      }
      return raw(doc, options);
    };
    wrapped.__ephSource2DecalV23 = true;
    wrapped.__ephPrevious = previous;
    VMAP.addPart = wrapped;
    return true;
  }

  function install() {
    installDecalCreationBridge();
    installLoadProjectMigration();
    return installViewport(window.EPH3D || (typeof S !== 'undefined' ? S.viewport : null));
  }

  install();
  window.addEventListener('eph3d-ready', event => installViewport(event.detail));
  const timer = setInterval(() => {
    installDecalCreationBridge();
    installLoadProjectMigration();
    if (!viewportInstalled) installViewport(window.EPH3D || (typeof S !== 'undefined' ? S.viewport : null));
  }, 250);
  setTimeout(() => clearInterval(timer), 30000);
})();
