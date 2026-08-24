// byanca
import * as THREE from 'three';

const helpers = new Map();
const avatars = new Map();
const cameras = new Map();
const PURPLE = 0x9b5cff;
const PURPLE_LIGHT = 0xc9adff;
const POSITION_RESPONSE = 13;
const DIRECTION_RESPONSE = 16;
let lastFrameAt = performance.now();

function colorFor(value) {
  let hash = 2166136261;
  for (const char of String(value || 'peer')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  const color = new THREE.Color();
  color.setHSL((Math.abs(hash) % 360) / 360, 0.72, 0.58);
  return color;
}

function disposeTree(object) {
  object?.traverse?.(node => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach(material => material?.dispose?.());
    else node.material?.dispose?.();
  });
}

function removePeer(peerId, viewport) {
  const helper = helpers.get(peerId);
  if (helper) { viewport.scene.remove(helper); helper.geometry?.dispose?.(); helper.material?.dispose?.(); helpers.delete(peerId); }
  const avatar = avatars.get(peerId);
  if (avatar) { viewport.scene.remove(avatar.group); disposeTree(avatar.group); avatars.delete(peerId); }
  cameras.delete(peerId);
}

function makeAvatar() {
  const group = new THREE.Group();
  group.name = 'RemoteCollaborator';

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(21, 24, 14),
    new THREE.MeshBasicMaterial({ color: PURPLE, transparent: true, opacity: .09, depthWrite: false })
  );
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(20, 16, 10),
    new THREE.MeshBasicMaterial({ color: PURPLE_LIGHT, wireframe: true, transparent: true, opacity: .82, depthTest: false, depthWrite: false })
  );
  glow.renderOrder = 1700;
  globe.renderOrder = 1701;
  group.add(glow, globe);

  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 56, PURPLE, 17, 11);
  arrow.line.material.transparent = true;
  arrow.line.material.opacity = .95;
  arrow.line.material.depthTest = false;
  arrow.line.material.depthWrite = false;
  arrow.cone.material.transparent = true;
  arrow.cone.material.opacity = .95;
  arrow.cone.material.depthTest = false;
  arrow.cone.material.depthWrite = false;
  arrow.line.renderOrder = 1702;
  arrow.cone.renderOrder = 1702;
  group.add(arrow);

  group.visible = false;
  return {
    group,
    arrow,
    initialized: false,
    targetPosition: new THREE.Vector3(),
    currentDirection: new THREE.Vector3(0, 1, 0),
    targetDirection: new THREE.Vector3(0, 1, 0),
  };
}

function updateCameraCache(peerId, cursorData) {
  const payload = cursorData?.point;
  if (!payload || Array.isArray(payload)) return cameras.get(peerId) || null;
  const camera = payload.camera;
  if (Array.isArray(camera?.position) && Array.isArray(camera?.target)) cameras.set(peerId, camera);
  return cameras.get(peerId) || null;
}

function alphaFor(response, dt) {
  return 1 - Math.exp(-Math.max(0, response) * Math.max(0, dt));
}

function update() {
  const now = performance.now();
  const dt = Math.min(.1, Math.max(0, (now - lastFrameAt) / 1000));
  lastFrameAt = now;

  const viewport = window.EPH3D;
  const collab = window.EPH_COLLAB;
  if (!viewport || !collab) {
    requestAnimationFrame(update);
    return;
  }

  const state = collab.state?.() || {};
  const livePeers = new Set((state.users || []).map(user => user.peerId).filter(peerId => peerId && peerId !== state.peerId));

  for (const peerId of new Set([...helpers.keys(), ...avatars.keys(), ...cameras.keys()])) if (!livePeers.has(peerId)) removePeer(peerId, viewport);

  for (const [peerId, selection] of collab.remoteSelections || []) {
    if (!livePeers.has(peerId) || !selection?.selectedId) continue;
    const root = viewport.objectRoots?.get(selection.selectedId);
    if (!root) {
      const helper = helpers.get(peerId);
      if (helper) helper.visible = false;
      continue;
    }
    let helper = helpers.get(peerId);
    if (!helper) {
      helper = new THREE.BoxHelper(root, colorFor(peerId));
      helper.material.depthTest = false;
      helper.renderOrder = 1500;
      viewport.scene.add(helper);
      helpers.set(peerId, helper);
    }
    helper.object = root;
    helper.visible = true;
    helper.update();
  }

  const positionAlpha = alphaFor(POSITION_RESPONSE, dt);
  const directionAlpha = alphaFor(DIRECTION_RESPONSE, dt);

  for (const peerId of livePeers) {
    const camera = updateCameraCache(peerId, collab.remoteCursors?.get(peerId));
    let avatar = avatars.get(peerId);
    if (!avatar) {
      avatar = makeAvatar();
      avatars.set(peerId, avatar);
      viewport.scene.add(avatar.group);
    }
    if (!camera) { avatar.group.visible = false; continue; }

    const position = new THREE.Vector3(Number(camera.position[0]) || 0, Number(camera.position[1]) || 0, Number(camera.position[2]) || 0);
    const target = new THREE.Vector3(Number(camera.target[0]) || 0, Number(camera.target[1]) || 0, Number(camera.target[2]) || 0);
    const direction = target.sub(position).normalize();
    if (direction.lengthSq() < .00001) direction.set(0, 1, 0);

    avatar.targetPosition.copy(position);
    avatar.targetDirection.copy(direction);

    if (!avatar.initialized || !avatar.group.visible) {
      avatar.group.position.copy(avatar.targetPosition);
      avatar.currentDirection.copy(avatar.targetDirection);
      avatar.initialized = true;
    } else {
      avatar.group.position.lerp(avatar.targetPosition, positionAlpha);
      avatar.currentDirection.lerp(avatar.targetDirection, directionAlpha);
      if (avatar.currentDirection.lengthSq() < .00001) avatar.currentDirection.copy(avatar.targetDirection);
      else avatar.currentDirection.normalize();
    }

    avatar.arrow.setDirection(avatar.currentDirection);
    avatar.group.visible = true;
  }

  requestAnimationFrame(update);
}

update();