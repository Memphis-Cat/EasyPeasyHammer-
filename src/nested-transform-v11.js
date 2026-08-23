// byanca
import * as THREE from 'three';

const VMAP = window.EPH_VMAP;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const EPSILON = 1e-5;

const field = (element, key) => element?.fields?.find(item => item.key === key) || null;
const get = (element, key, fallback = null) => field(element, key)?.value ?? fallback;
const ary = (element, key) => Array.isArray(get(element, key)) ? get(element, key) : [];
const numbers = (value, length, fallback = 0) => {
  const source = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/);
  return Array.from({ length }, (_, index) => Number.isFinite(Number(source[index])) ? Number(source[index]) : fallback);
};
const clone3 = (value, fallback = 0) => numbers(value, 3, fallback);

function localMatrixFromValues(position, rotation, scale) {
  const p = clone3(position, 0);
  const r = clone3(rotation, 0);
  const s = clone3(scale, 1);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * RAD, r[1] * RAD, r[2] * RAD, 'XYZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(...p), quaternion, new THREE.Vector3(...s));
}

function localMatrixFromElement(element) {
  return localMatrixFromValues(
    get(element, 'origin', '0 0 0'),
    get(element, 'angles', '0 0 0'),
    get(element, 'scales', '1 1 1')
  );
}

function decomposeMatrix(matrix) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: [position.x, position.y, position.z],
    rotation: [euler.x * DEG, euler.y * DEG, euler.z * DEG],
    scale: [scale.x, scale.y, scale.z]
  };
}

function matrixDifference(a, b) {
  let maximum = 0;
  for (let index = 0; index < 16; index++) maximum = Math.max(maximum, Math.abs(a.elements[index] - b.elements[index]));
  return maximum;
}

function same3(a, b, epsilon = 1e-4) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return [0, 1, 2].every(index => Math.abs((Number(a[index]) || 0) - (Number(b[index]) || 0)) <= epsilon);
}

function resolve(doc, value) {
  if (value?.kind === 'element') return value;
  if (typeof value === 'string' && value) return VMAP.resolveElement?.(doc, value) || VMAP.findElementByDmxId?.(doc, value) || null;
  return null;
}

function buildParentMap(doc) {
  const parentById = new Map();
  const world = VMAP.getWorld?.(doc);
  const visited = new Set();
  const visit = (parent, children) => {
    const parentId = String(get(parent, 'id', ''));
    for (const raw of children || []) {
      const child = resolve(doc, raw);
      if (!child) continue;
      const childId = String(get(child, 'id', ''));
      if (childId && !parentById.has(childId)) parentById.set(childId, parentId || null);
      if (childId && visited.has(childId)) continue;
      if (childId) visited.add(childId);
      visit(child, ary(child, 'children'));
    }
  };
  if (world) visit(world, ary(world, 'children'));
  return parentById;
}

function worldMatrixForElement(doc, elementId, parentById, cache = new Map(), stack = new Set()) {
  if (!elementId) return new THREE.Matrix4();
  if (cache.has(elementId)) return cache.get(elementId).clone();
  if (stack.has(elementId)) throw new Error(`Nested VMAP transform cycle detected at ${elementId}.`);
  stack.add(elementId);
  const element = VMAP.findElementByDmxId?.(doc, elementId) || VMAP.resolveElement?.(doc, elementId);
  if (!element) {
    stack.delete(elementId);
    return new THREE.Matrix4();
  }
  const parentId = parentById.get(elementId);
  const parentWorld = parentId ? worldMatrixForElement(doc, parentId, parentById, cache, stack) : new THREE.Matrix4();
  const result = parentWorld.multiply(localMatrixFromElement(element));
  cache.set(elementId, result.clone());
  stack.delete(elementId);
  return result;
}

function parentWorldMatrix(doc, object, parentById = null) {
  const parentId = object?.sourceParentDmxId;
  if (!parentId) return new THREE.Matrix4();
  const parents = parentById || buildParentMap(doc);
  return worldMatrixForElement(doc, parentId, parents);
}

function setObjectTransform(object, transform) {
  object.position = [...transform.position];
  object.rotation = [...transform.rotation];
  object.scale = [...transform.scale];
}

function updateNestedBaseline(object, local, exactWorldMatrix, world) {
  const recomposed = localMatrixFromValues(world.position, world.rotation, world.scale);
  const shearError = matrixDifference(exactWorldMatrix, recomposed);
  object.sourceNestedTransform = true;
  object.sourceLocalPosition = [...local.position];
  object.sourceLocalRotation = [...local.rotation];
  object.sourceLocalScale = [...local.scale];
  object.sourceWorldPosition = [...world.position];
  object.sourceWorldRotation = [...world.rotation];
  object.sourceWorldScale = [...world.scale];
  object.sourceNestedShear = shearError > EPSILON;
  object.sourceNestedShearError = shearError;
}

function localToWorldObject(doc, object, parentById) {
  if (!object?.dmxId || !object.sourceParentDmxId || !object.sourceDepth) return object;
  const local = {
    position: clone3(object.position, 0),
    rotation: clone3(object.rotation, 0),
    scale: clone3(object.scale, 1)
  };
  const exactWorldMatrix = parentWorldMatrix(doc, object, parentById).multiply(localMatrixFromValues(local.position, local.rotation, local.scale));
  const world = decomposeMatrix(exactWorldMatrix);
  updateNestedBaseline(object, local, exactWorldMatrix, world);
  setObjectTransform(object, world);
  return object;
}

function annotateChildSafety(doc, object) {
  if (!object?.dmxId) return;
  const element = VMAP.findElementByDmxId?.(doc, object.dmxId) || VMAP.resolveElement?.(doc, object.dmxId);
  if (!element || !ary(element, 'children').length) return;
  object.sourceHasNestedChildren = true;
  object.sourceHierarchyWorldPosition = clone3(object.position, 0);
  object.sourceHierarchyWorldRotation = clone3(object.rotation, 0);
  object.sourceHierarchyWorldScale = clone3(object.scale, 1);
}

function parentTransformWasEdited(object) {
  if (!object?.sourceHasNestedChildren) return false;
  return !same3(object.position, object.sourceHierarchyWorldPosition)
    || !same3(object.rotation, object.sourceHierarchyWorldRotation)
    || !same3(object.scale, object.sourceHierarchyWorldScale);
}

function refreshParentBaseline(object) {
  if (!object?.sourceHasNestedChildren) return;
  object.sourceHierarchyWorldPosition = clone3(object.position, 0);
  object.sourceHierarchyWorldRotation = clone3(object.rotation, 0);
  object.sourceHierarchyWorldScale = clone3(object.scale, 1);
}

function worldTransformWasEdited(object) {
  if (!object?.sourceNestedTransform) return false;
  return !same3(object.position, object.sourceWorldPosition)
    || !same3(object.rotation, object.sourceWorldRotation)
    || !same3(object.scale, object.sourceWorldScale);
}

function ensureParentTransformSafe(object) {
  if (!parentTransformWasEdited(object)) return true;
  object.vmapCompatibilityError = 'This imported Hammer node owns nested children. Its hierarchy is preserved in the VMAP but displayed flat in EasyPeasyHammer, so changing the parent transform is blocked to prevent silently moving or rescaling its children. Edit the child objects instead, or move the hierarchy in Hammer.';
  return false;
}

function setLocalForWrite(doc, object, parentById) {
  if (!object?.sourceNestedTransform) return null;
  if (object.sourceNestedShear && worldTransformWasEdited(object)) {
    object.vmapCompatibilityError = 'This nested Hammer node inherits a non-uniform transform that produces shear. Moving, rotating, or scaling it in the flat editor would lose the exact parent-relative transform, so that transform edit is blocked.';
    return false;
  }

  let local;
  if (object.sourceNestedShear && !worldTransformWasEdited(object)) {
    local = {
      position: [...object.sourceLocalPosition],
      rotation: [...object.sourceLocalRotation],
      scale: [...object.sourceLocalScale]
    };
  } else {
    const worldMatrix = localMatrixFromValues(object.position, object.rotation, object.scale);
    const inverseParent = parentWorldMatrix(doc, object, parentById).invert();
    local = decomposeMatrix(inverseParent.multiply(worldMatrix));
  }
  setObjectTransform(object, local);
  return local;
}

function restoreWorldFromCurrentLocal(doc, object, parentById) {
  if (!object?.sourceNestedTransform) return;
  const local = {
    position: clone3(object.position, 0),
    rotation: clone3(object.rotation, 0),
    scale: clone3(object.scale, 1)
  };
  const exactWorldMatrix = parentWorldMatrix(doc, object, parentById).multiply(localMatrixFromValues(local.position, local.rotation, local.scale));
  const world = decomposeMatrix(exactWorldMatrix);
  updateNestedBaseline(object, local, exactWorldMatrix, world);
  setObjectTransform(object, world);
}

if (VMAP && !VMAP.__ephNestedTransformV11) {
  VMAP.__ephNestedTransformV11 = true;

  const previousExtract = VMAP.extractObjects.bind(VMAP);
  VMAP.extractObjects = function(doc) {
    const objects = previousExtract(doc);
    const parents = buildParentMap(doc);
    for (const object of objects || []) {
      localToWorldObject(doc, object, parents);
      annotateChildSafety(doc, object);
    }
    return objects;
  };

  const previousApply = VMAP.applyObjectToDocument.bind(VMAP);
  VMAP.applyObjectToDocument = function(doc, object) {
    if (!object?.dmxId) return previousApply(doc, object);
    if (!object.__ephNestedLocalPass && !ensureParentTransformSafe(object)) return false;
    if (!object.sourceNestedTransform || object.__ephNestedLocalPass) {
      const result = previousApply(doc, object);
      if (result) {
        delete object.vmapCompatibilityError;
        refreshParentBaseline(object);
      }
      return result;
    }

    const parents = buildParentMap(doc);
    const local = setLocalForWrite(doc, object, parents);
    if (local === false) return false;
    object.__ephNestedLocalPass = true;
    let restored = false;
    try {
      const result = previousApply(doc, object);
      restoreWorldFromCurrentLocal(doc, object, parents);
      restored = true;
      if (result) {
        delete object.vmapCompatibilityError;
        refreshParentBaseline(object);
      }
      return result;
    } finally {
      delete object.__ephNestedLocalPass;
      if (!restored) restoreWorldFromCurrentLocal(doc, object, parents);
    }
  };

  const previousPrepare = VMAP.prepareForSave.bind(VMAP);
  VMAP.prepareForSave = function(doc, objects) {
    const parents = buildParentMap(doc);
    const nested = [];
    for (const object of objects || []) {
      if (!object?.dmxId) continue;
      if (!ensureParentTransformSafe(object)) throw new Error(object.vmapCompatibilityError);
      if (!object.sourceNestedTransform) continue;
      const local = setLocalForWrite(doc, object, parents);
      if (local === false) throw new Error(object.vmapCompatibilityError || 'A nested Hammer transform could not be preserved.');
      object.__ephNestedLocalPass = true;
      nested.push(object);
    }
    try {
      return previousPrepare(doc, objects);
    } finally {
      for (const object of nested) {
        delete object.__ephNestedLocalPass;
        restoreWorldFromCurrentLocal(doc, object, parents);
        refreshParentBaseline(object);
      }
    }
  };
}

window.EPH_NESTED_TRANSFORM_V11 = {
  buildParentMap,
  parentWorldMatrix,
  localMatrixFromValues,
  decomposeMatrix,
  worldTransformWasEdited,
  parentTransformWasEdited
};
