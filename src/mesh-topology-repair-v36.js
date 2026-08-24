// byanca
(() => {
  'use strict';
  if (window.__ephMeshTopologyRepairV36) return;
  window.__ephMeshTopologyRepairV36 = true;

  const VMAP = window.EPH_VMAP;
  const api = window.easyPeasyHammer;
  const EPSILON = 0.0002;
  const MAX_PASSES = 8;
  const MAX_BOUNDARY_VERTICES = 6000;
  let installed = false;

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Mesh Topology V36] ${message}`, meta || '');
    try { api?.appLog?.(level, 'mesh-topology-v36', message, meta)?.catch?.(() => {}); } catch {}
  }

  const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const finiteVertex = value => Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(item => Number.isFinite(Number(item)));

  function cleanFace(face, vertexCount) {
    if (!Array.isArray(face)) return [];
    const clean = [];
    for (const raw of face) {
      const index = Number(raw);
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount) continue;
      if (clean.at(-1) !== index) clean.push(index);
    }
    if (clean.length >= 2 && clean[0] === clean.at(-1)) clean.pop();
    return new Set(clean).size >= 3 ? clean : [];
  }

  function edgeUsage(faces) {
    const map = new Map();
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
      const face = faces[faceIndex];
      for (let edgeIndex = 0; edgeIndex < face.length; edgeIndex++) {
        const a = face[edgeIndex];
        const b = face[(edgeIndex + 1) % face.length];
        if (a === b) continue;
        const key = edgeKey(a, b);
        const list = map.get(key) || [];
        list.push({ faceIndex, edgeIndex, a, b });
        map.set(key, list);
      }
    }
    return map;
  }

  function topologySummary(faces) {
    const usage = edgeUsage(faces);
    const boundaryEdges = [];
    const overusedEdges = [];
    const sameWindingEdges = [];
    const boundaryOut = new Map();
    const boundaryIn = new Map();

    for (const [key, list] of usage) {
      if (list.length === 1) {
        const edge = list[0];
        boundaryEdges.push(edge);
        // The unused opposite half-edge is b -> a.
        boundaryOut.set(edge.b, (boundaryOut.get(edge.b) || 0) + 1);
        boundaryIn.set(edge.a, (boundaryIn.get(edge.a) || 0) + 1);
      } else if (list.length > 2) {
        overusedEdges.push({ key, count: list.length });
      } else {
        const [a, b] = list;
        if (a.a === b.a && a.b === b.b) sameWindingEdges.push({ key, count: 2 });
      }
    }

    const boundaryVertices = new Set();
    for (const edge of boundaryEdges) { boundaryVertices.add(edge.a); boundaryVertices.add(edge.b); }
    const nonManifoldBoundaryVertices = [];
    for (const vertex of boundaryVertices) {
      const out = boundaryOut.get(vertex) || 0;
      const incoming = boundaryIn.get(vertex) || 0;
      if (out !== 1 || incoming !== 1) nonManifoldBoundaryVertices.push({ vertex, out, incoming });
    }

    return {
      usage,
      boundaryEdges,
      boundaryVertices,
      overusedEdges,
      sameWindingEdges,
      nonManifoldBoundaryVertices,
      valid: !overusedEdges.length && !sameWindingEdges.length && !nonManifoldBoundaryVertices.length,
    };
  }

  // BSP subtraction on an already-carved concave mesh can return a perfectly
  // usable surface whose neighboring polygons are locally wound the same way.
  // Hammer rejects that even when the geometry is otherwise manifold. Resolve
  // the orientation as a graph-parity problem before doing T-junction repair:
  // every edge shared by exactly two faces must run in opposite directions.
  function orientFacesConsistently(sourceFaces) {
    const faces = sourceFaces.map(face => [...face]);
    const usage = edgeUsage(faces);
    const graph = Array.from({ length: faces.length }, () => []);

    for (const list of usage.values()) {
      if (list.length !== 2) continue;
      const left = list[0], right = list[1];
      const sameDirection = left.a === right.a && left.b === right.b;
      graph[left.faceIndex].push({ face: right.faceIndex, xor: sameDirection ? 1 : 0 });
      graph[right.faceIndex].push({ face: left.faceIndex, xor: sameDirection ? 1 : 0 });
    }

    const flip = Array(faces.length).fill(null);
    let conflicts = 0;
    for (let start = 0; start < faces.length; start++) {
      if (flip[start] !== null) continue;
      flip[start] = 0;
      const queue = [start];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const current = queue[cursor];
        for (const edge of graph[current]) {
          const wanted = flip[current] ^ edge.xor;
          if (flip[edge.face] === null) {
            flip[edge.face] = wanted;
            queue.push(edge.face);
          } else if (flip[edge.face] !== wanted) conflicts++;
        }
      }
    }

    let changed = false;
    let flipped = 0;
    for (let index = 0; index < faces.length; index++) {
      if (!flip[index]) continue;
      faces[index].reverse();
      changed = true;
      flipped++;
    }
    return { faces, changed, flipped, conflicts };
  }

  function pointOnSegment(point, start, end) {
    if (!finiteVertex(point) || !finiteVertex(start) || !finiteVertex(end)) return null;
    const ax = Number(start[0]), ay = Number(start[1]), az = Number(start[2]);
    const bx = Number(end[0]), by = Number(end[1]), bz = Number(end[2]);
    const px = Number(point[0]), py = Number(point[1]), pz = Number(point[2]);
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    if (lengthSq <= EPSILON * EPSILON) return null;
    const t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lengthSq;
    if (t <= 1e-7 || t >= 1 - 1e-7) return null;
    const cx = ax + dx * t, cy = ay + dy * t, cz = az + dz * t;
    const ex = px - cx, ey = py - cy, ez = pz - cz;
    if (ex * ex + ey * ey + ez * ez > EPSILON * EPSILON) return null;
    return t;
  }

  function repairTjunctions(vertices, sourceFaces) {
    if (!Array.isArray(vertices) || !vertices.length || !Array.isArray(sourceFaces) || !sourceFaces.length) {
      return { ok: false, changed: false, faces: sourceFaces || [], reason: 'missing-geometry' };
    }
    if (!vertices.every(finiteVertex)) return { ok: false, changed: false, faces: sourceFaces, reason: 'non-finite-vertex' };

    let faces = sourceFaces.map(face => cleanFace(face, vertices.length)).filter(face => face.length >= 3);
    if (!faces.length) return { ok: false, changed: false, faces, reason: 'no-valid-faces' };

    const orientation = orientFacesConsistently(faces);
    faces = orientation.faces;
    let totalSplits = 0;
    let changed = orientation.changed;
    const initial = topologySummary(faces);

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const summary = topologySummary(faces);
      if (!summary.nonManifoldBoundaryVertices.length) {
        return {
          ok: !summary.overusedEdges.length && !summary.sameWindingEdges.length,
          changed,
          faces,
          splits: totalSplits,
          flipped: orientation.flipped,
          orientationConflicts: orientation.conflicts,
          passes: pass,
          beforeBoundaryEdges: initial.boundaryEdges.length,
          afterBoundaryEdges: summary.boundaryEdges.length,
          summary,
        };
      }
      if (summary.boundaryVertices.size > MAX_BOUNDARY_VERTICES) {
        return { ok: false, changed, faces, splits: totalSplits, flipped: orientation.flipped, reason: 'too-many-boundary-vertices', summary };
      }

      const candidates = [...summary.boundaryVertices];
      let passSplits = 0;
      const nextFaces = [];

      for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
        const face = faces[faceIndex];
        const output = [];
        for (let edgeIndex = 0; edgeIndex < face.length; edgeIndex++) {
          const a = face[edgeIndex];
          const b = face[(edgeIndex + 1) % face.length];
          output.push(a);
          const usage = summary.usage.get(edgeKey(a, b));
          if (!usage || usage.length !== 1) continue;

          const hits = [];
          const start = vertices[a];
          const end = vertices[b];
          for (const index of candidates) {
            if (index === a || index === b) continue;
            const t = pointOnSegment(vertices[index], start, end);
            if (t == null) continue;
            hits.push({ index, t });
          }
          hits.sort((left, right) => left.t - right.t);

          let previous = a;
          for (const hit of hits) {
            if (hit.index === previous || hit.index === b || output.at(-1) === hit.index) continue;
            output.push(hit.index);
            previous = hit.index;
            passSplits++;
          }
        }
        const clean = cleanFace(output, vertices.length);
        if (clean.length >= 3) nextFaces.push(clean);
      }

      if (!passSplits) {
        const summaryAfter = topologySummary(faces);
        return { ok: summaryAfter.valid, changed, faces, splits: totalSplits, flipped: orientation.flipped, reason: 'no-more-splits', summary: summaryAfter };
      }
      totalSplits += passSplits;
      changed = true;
      faces = nextFaces;
    }

    const finalSummary = topologySummary(faces);
    return {
      ok: finalSummary.valid,
      changed,
      faces,
      splits: totalSplits,
      flipped: orientation.flipped,
      passes: MAX_PASSES,
      beforeBoundaryEdges: initial.boundaryEdges.length,
      afterBoundaryEdges: finalSummary.boundaryEdges.length,
      reason: finalSummary.valid ? null : 'pass-limit',
      summary: finalSummary,
    };
  }

  function shouldRepair(error, object) {
    if (!object || object.type !== 'part' || !Array.isArray(object.vertices) || !Array.isArray(object.faces)) return false;
    if (object.sourceHasAdvancedMeshData) return false;
    const message = String(error?.message || error || '');
    return /Cannot create Hammer mesh:/i.test(message)
      && /(Boundary|same winding|used by more than one face|does not close)/i.test(message);
  }

  function install() {
    if (!VMAP?.applyObjectToDocument || installed) return Boolean(VMAP?.applyObjectToDocument);
    if (VMAP.applyObjectToDocument.__ephMeshTopologyRepairV36) { installed = true; return true; }

    const previous = VMAP.applyObjectToDocument;
    const raw = previous.bind(VMAP);
    const wrapped = function(doc, object) {
      try {
        return raw(doc, object);
      } catch (error) {
        if (!shouldRepair(error, object)) throw error;
        const repair = repairTjunctions(object.vertices, object.faces);
        if (!repair.changed || !repair.ok) {
          report('error', `Could not conform ${object.name || object.id || 'Part'} to Hammer topology.`, {
            reason: repair.reason || 'topology-still-invalid',
            boundaryEdges: repair.summary?.boundaryEdges?.length || 0,
            sameWindingEdges: repair.summary?.sameWindingEdges?.length || 0,
            overusedEdges: repair.summary?.overusedEdges?.length || 0,
            nonManifoldVertices: repair.summary?.nonManifoldBoundaryVertices?.length || 0,
            flippedFaces: repair.flipped || 0,
            originalError: error?.message || String(error),
          });
          throw error;
        }

        const oldFaces = object.faces;
        object.faces = repair.faces;
        if (Array.isArray(object.faceMaterials) && object.faceMaterials.length < object.faces.length) {
          const fallback = object.faceMaterials[0] || 'ERROR';
          object.faceMaterials = object.faces.map((_, index) => object.faceMaterials[index] || fallback);
        }
        try {
          const result = raw(doc, object);
          report('normal', `Repaired Hammer mesh topology for ${object.name || object.id || 'Part'}.`, {
            flippedFaces: repair.flipped || 0,
            splits: repair.splits,
            passes: repair.passes,
            boundaryEdgesBefore: repair.beforeBoundaryEdges,
            boundaryEdgesAfter: repair.afterBoundaryEdges,
          });
          return result;
        } catch (retryError) {
          object.faces = oldFaces;
          report('error', `Hammer mesh topology repair did not validate for ${object.name || object.id || 'Part'}.`, {
            originalError: error?.message || String(error),
            retryError: retryError?.message || String(retryError),
          });
          throw retryError;
        }
      }
    };
    wrapped.__ephMeshTopologyRepairV36 = true;
    wrapped.__ephPrevious = previous;
    VMAP.applyObjectToDocument = wrapped;
    installed = true;
    report('normal', 'T-junction and face-winding conformance is active for topology-changing Hammer mesh writes.');
    return true;
  }

  install();
  window.EPH_MESH_TOPOLOGY = { repairTjunctions, topologySummary, orientFacesConsistently, install };
})();
