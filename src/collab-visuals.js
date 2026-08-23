// byanca
import * as THREE from 'three';

const helpers = new Map();
const avatars = new Map();
const PURPLE = 0x9b5cff;
const PURPLE_LIGHT = 0xc9adff;

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
  return { group, arrow };
}

function cameraFromCursorPacket(cursorData) {
  const payload = cursorData?.point;
  if (!payload || Array.isArray(payload)) return null;
  const camera = payload.camera;
  if (!Array.isArray(camera?.position) || !Array.isArray(camera?.target)) return null;
  return camera;
}

function update() {
  const viewport = window.EPH3D;
  const collab = window.EPH_COLLAB;
  if (!viewport || !collab) return requestAnimationFrame(update);
  const state = collab.state?.() || {};
  const livePeers = new Set((state.users || []).map(user => user.peerId).filter(peerId => peerId && peerId !== state.peerId));

  for (const peerId of new Set([...helpers.keys(), ...avatars.keys()])) if (!livePeers.has(peerId)) removePeer(peerId, viewport);

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

  for (const peerId of livePeers) {
    const cursorData = collab.remoteCursors?.get(peerId);
    const camera = cameraFromCursorPacket(cursorData);
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

    avatar.group.position.copy(position);
    avatar.arrow.setDirection(direction);
    avatar.group.visible = true;
  }

  setTimeout(() => requestAnimationFrame(update), 33);
}

update();
