// byanca
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'mesh-topology-repair-v36.js'), 'utf8');
const window = {
  EPH_VMAP: { applyObjectToDocument() { return true; } },
  easyPeasyHammer: null,
};
const context = vm.createContext({
  window,
  console: { info() {}, warn() {}, error() {} },
  Map,
  Set,
  Number,
  Array,
  String,
  Math,
});
vm.runInContext(source, context, { filename: 'mesh-topology-repair-v36.js' });

const topology = window.EPH_MESH_TOPOLOGY;
if (!topology?.repairTjunctions || !topology?.topologySummary) {
  throw new Error('Mesh Topology V36 API was not exposed.');
}

// Representative box-minus-box BSP output. The boolean operation itself is
// correct, but its 41 polygon faces contain T-junctions: Hammer's half-edge
// writer sees branching boundary vertices unless the long edges are split at
// the neighboring BSP vertices first.
const vertices = [[-2,-2,-2],[-2,2,-2],[2,2,-2],[2,-2,-2],[-2,-2,2],[2,-2,2],[2,2,2],[-2,2,2],[-1.75,-2,-1.75],[2,-2,-1.75],[-2,-2,-1.75],[0.25,-2,0.25],[2,-2,0.25],[-2,-2,0.25],[2,-1.75,-1.75],[2,2,-1.75],[2,0.25,0.25],[2,2,0.25],[2,-1.75,0.25],[1.75,2,-1.75],[-2,2,-1.75],[-0.25,2,0.25],[-2,2,0.25],[-0.5,2,0.25],[-0.5,2,-1.75],[-2,1.75,-1.75],[-2,-0.25,0.25],[-2,-1.75,0.25],[-2,-1.75,-1.75],[-2,0.25,-0.25],[-2,0.25,-1.75],[-2,0.25,0.25],[-2,-1.25,-1.75],[-0.5,0.25,-1.75],[-0.5,-1.75,-1.75],[-2,-1.25,0.25],[-0.5,0.25,0.25],[-0.5,-1.75,0.25],[-2,-1.75,-1.25]];
const faces = [[0,1,2],[0,2,3],[4,5,6],[4,6,7],[8,0,3,9],[10,0,8],[11,12,5],[13,11,5,4],[11,8,9,12],[13,10,8,11],[14,3,2,15],[9,3,14],[16,17,6],[12,16,6,5],[18,12,9,14],[16,14,15,17],[18,14,16],[19,2,1,20],[15,2,19],[21,22,7],[17,21,7,6],[23,21,19,24],[17,15,19,21],[23,24,20,22],[25,1,0,10],[20,1,25],[26,13,4],[22,26,4,7],[27,28,10,13],[29,25,30],[31,22,20,25,29],[32,33,30],[28,34,33,32],[35,36,37,27],[31,36,35],[38,37,34,28],[27,37,38],[36,33,34],[37,36,34],[29,30,33],[36,31,29,33]];

if (faces.length !== 41) throw new Error(`Regression fixture changed: expected 41 faces, got ${faces.length}.`);
const before = topology.topologySummary(faces);
if (!before.nonManifoldBoundaryVertices.length) throw new Error('Regression fixture no longer reproduces a non-manifold BSP boundary.');

const repaired = topology.repairTjunctions(vertices, faces);
if (!repaired.ok || !repaired.changed) {
  throw new Error(`T-junction repair failed: ${repaired.reason || 'unknown reason'}.`);
}
if (repaired.faces.length !== 41) throw new Error(`Topology repair changed polygon count unexpectedly: ${repaired.faces.length}.`);

const after = topology.topologySummary(repaired.faces);
if (!after.valid || after.nonManifoldBoundaryVertices.length || after.overusedEdges.length || after.sameWindingEdges.length) {
  throw new Error('Repaired BSP result is still non-manifold.');
}
if (after.boundaryEdges.length !== 0) {
  throw new Error(`Closed carve fixture still has ${after.boundaryEdges.length} unmatched boundary edges after repair.`);
}

console.log(`Mesh topology self-test passed. Repaired 41-face BSP carve with ${repaired.splits} edge split(s) in ${repaired.passes} pass(es).`);
