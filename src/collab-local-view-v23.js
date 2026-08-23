// byanca
(() => {
  'use strict';
  if (window.__ephCollabLocalViewV23) return;
  window.__ephCollabLocalViewV23 = true;

  let wrappedLoadProject = null;
  let wrappedMakeSnapshot = null;

  function clone(value) {
    if (value === undefined) return undefined;
    try { return structuredClone(value); }
    catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
  }

  function sharedOnly(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    const out = {
      phase: 4,
      vmapText: snapshot.vmapText,
      objectExtras: clone(snapshot.objectExtras || null),
      ephFolders: clone(snapshot.ephFolders || []),
      ephParents: clone(snapshot.ephParents || {}),
    };
    // Keep only data that describes the actual shared map/document. Never
    // include a collaborator's personal camera, tool, selection, panels,
    // wireframe/shading, grid, snapping, or viewport mode.
    return out;
  }

  function isCollabSnapshot(ui) {
    return Boolean(ui && (ui.phase === 4 || Array.isArray(ui.ephFolders) || ui.ephParents));
  }

  function installLoadProjectGuard() {
    if (typeof loadProject !== 'function') return false;
    if (loadProject === wrappedLoadProject || loadProject.__ephCollabLocalViewV23) return true;
    const raw = loadProject;
    const wrapped = async function(project, ui) {
      return raw(project, isCollabSnapshot(ui) ? sharedOnly(ui) : ui);
    };
    wrapped.__ephCollabLocalViewV23 = true;
    wrapped.__ephPrevious = raw;
    loadProject = wrapped;
    window.loadProject = wrapped;
    wrappedLoadProject = wrapped;
    return true;
  }

  function installPublicSnapshotGuard() {
    const collab = window.EPH_COLLAB;
    if (!collab?.makeSnapshot) return false;
    if (collab.makeSnapshot === wrappedMakeSnapshot || collab.makeSnapshot.__ephCollabLocalViewV23) return true;
    const raw = collab.makeSnapshot.bind(collab);
    const wrapped = function() { return sharedOnly(raw()); };
    wrapped.__ephCollabLocalViewV23 = true;
    wrapped.__ephPrevious = raw;
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
