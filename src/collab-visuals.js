// byanca
import * as THREE from 'three';

const helpers = new Map();
const cursors = new Map();

function colorFor(value) {
  let hash = 2166136261;
  for (const char of String(value || 'peer')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  const color = new THREE.Color();
  color.setHSL((Math.abs(hash) % 360) / 360, 0.72, 0.58);
  return color;
}

function removePeer(peerId, viewport) {
  const helper = helpers.get(peerId);
  if (helper) { viewport.scene.remove(helper); helper.geometry?.dispose?.(); helper.material?.dispose?.(); helpers.delete(peerId); }
  const cursor = cursors.get(peerId);
  if (cursor) { viewport.scene.remove(cursor); cursor.geometry?.dispose?.(); cursor.material?.dispose?.(); cursors.delete(peerId); }
}

function update() {
  const viewport = window.EPH3D;
  const collab = window.EPH_COLLAB;
  if (!viewport || !collab) return requestAnimationFrame(update);
  const state = collab.state?.() || {};
  const livePeers = new Set((state.users || []).map(x => x.peerId).filter(x => x && x !== state.peerId));

  for (const peerId of new Set([...helpers.keys(), ...cursors.keys()])) if (!livePeers.has(peerId)) removePeer(peerId, viewport);

  for (const [peerId, selection] of collab.remoteSelections || []) {
    if (!livePeers.has(peerId) || !selection?.selectedId) continue;
    const root = viewport.objectRoots?.get(selection.selectedId);
    if (!root) {
      const helper = helpers.get(peerId); if (helper) helper.visible = false;
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

  for (const [peerId, cursorData] of collab.remoteCursors || []) {
    if (!livePeers.has(peerId)) continue;
    const point = cursorData?.point;
    let cursor = cursors.get(peerId);
    if (!Array.isArray(point) || point.length < 3) { if (cursor) cursor.visible = false; continue; }
    if (!cursor) {
      cursor = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), new THREE.MeshBasicMaterial({ color: colorFor(peerId), depthTest: false }));
      cursor.renderOrder = 1600;
      viewport.scene.add(cursor);
      cursors.set(peerId, cursor);
    }
    cursor.position.set(Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0);
    cursor.visible = true;
  }

  setTimeout(() => requestAnimationFrame(update), 60);
}

update();
