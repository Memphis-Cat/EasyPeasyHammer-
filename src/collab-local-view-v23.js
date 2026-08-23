// byanca
(() => {
  'use strict';
  if (window.__ephCollabLocalViewV23) return;
  window.__ephCollabLocalViewV23 = true;

  let wrappedMakeSnapshot = null;

  function clone(value) {
    if (value === undefined) return undefined;
    try { return structuredClone(value); }
    catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
  }

  function chainHas(fn, marker) {
    const seen = new Set();
    let current = fn;
    for (let i = 0; current && typeof current === 'function' && i < 32 && !seen.has(current); i++) {
      if (current[marker]) return true;
      seen.add(current);
      current = current.__ephPrevious;
    }
    return false;
  }

  function sharedOnly(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    return {
      phase: 4,
      vmapText: snapshot.vmapText,
      objectExtras: clone(snapshot.objectExtras || null),
      ephFolders: clone(snapshot.ephFolders || []),
      ephParents: clone(snapshot.ephParents || {}),
    };
  }

  function isCollabSnapshot(ui) {
    return Boolean(ui && (ui.phase === 4 || Array.isArray(ui.ephFolders) || ui.ephParents));
  }

  function installLoadProjectGuard() {
    if (typeof loadProject !== 'function') return false;
    if (chainHas(loadProject, '__ephCollabLocalViewV23')) return true;
    const raw = loadProject;
    const wrapped = async function(project, ui) {
      return raw(project, isCollabSnapshot(ui) ? sharedOnly(ui) : ui);
    };
    wrapped.__ephCollabLocalViewV23 = true;
    wrapped.__ephPrevious = raw;
    loadProject = wrapped;
    window.loadProject = wrapped;
    return true;
  }

  function installPublicSnapshotGuard() {
    const collab = window.EPH_COLLAB;
    if (!collab?.makeSnapshot) return false;
    if (chainHas(collab.makeSnapshot, '__ephCollabLocalViewV23')) return true;
    const raw = collab.makeSnapshot.bind(collab);
    const previous = collab.makeSnapshot;
    const wrapped = function() { return sharedOnly(raw()); };
    wrapped.__ephCollabLocalViewV23 = true;
    wrapped.__ephPrevious = previous;
    collab.makeSnapshot = wrapped;
    wrappedMakeSnapshot = wrapped;
    return true;
  }

  function install() {
    installLoadProjectGuard();
    installPublicSnapshotGuard();
  }

  install();
  const timer = setInterval(install, 250);
  setTimeout(() => clearInterval(timer), 30000);
  console.info('[Collaboration V23] Camera, shading, wireframe, grid, snap, tool and panel state are local-only.');
})();
