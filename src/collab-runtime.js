// byanca
(() => {
  const api = window.easyPeasyHammer;
  if (!api || window.EPH_COLLAB) return;

  let collabState = { role: null, connected: false, users: [], chatHistory: [] };
  let applyingRemote = false;
  let snapshotTimer = null;
  let liveSnapshotTimer = null;
  let lastLiveSnapshotAt = 0;
  let persistenceTimer = null;
  let lastSelection = Symbol('initial');
  let lastCursorSent = 0;
  const remoteSelections = new Map();
  const remoteCursors = new Map();

  function foldersForSnapshot() {
    const folders = (S.objects || []).filter(x => x.type === 'folder').map(x => ({ id: x.id, type: 'folder', name: x.name, parent: x.parent || 'world', expanded: x.expanded !== false, sourceClass: 'EPH_UI_FOLDER' }));
    const parents = Object.fromEntries((S.objects || []).filter(x => x.dmxId && x.parent && x.parent !== 'world').map(x => [x.id, x.parent]));
    return { folders, parents };
  }

  function makeSnapshot() {
    const snapshot = uiSnapshot();
    snapshot.phase = 4;
    const grouping = foldersForSnapshot();
    snapshot.ephFolders = grouping.folders;
    snapshot.ephParents = grouping.parents;
    snapshot.selectedId = null;
    snapshot.selectedFaces = [];
    snapshot.cameraState = null;
    return snapshot;
  }

  function applyGrouping(snapshot) {
    S.objects = S.objects.filter(x => x.type !== 'folder');
    for (const folder of snapshot?.ephFolders || []) S.objects.push({ ...folder, type: 'folder', sourceClass: 'EPH_UI_FOLDER' });
    for (const object of S.objects) {
      if (!object.dmxId) continue;
      const parent = snapshot?.ephParents?.[object.id];
      object.parent = parent && S.objects.some(x => x.id === parent) ? parent : (object.parent || 'world');
    }
  }

  async function persistRemote() {
    if (!S.project || !S.doc) return;
    try {
      await api.autosave({ project: S.project, uiState: uiSnapshot() });
      if (collabState.role === 'host' && S.project.vmapPath) await api.saveVmap(S.project.vmapPath, saveText(), false);
    } catch {}
  }

  async function applySnapshot(snapshot, revision) {
    if (!snapshot?.vmapText || applyingRemote) return;
    applyingRemote = true;
    try {
      const localSelection = S.selectedId;
      const localCamera = S.viewport?.getCameraState?.() || S.camera;
      const doc = VMAP.parse(snapshot.vmapText);
      const check = VMAP.validate(doc);
      if (!check.ok) throw new Error(check.errors.join(' '));
      S.doc = doc;
      S.objects = VMAP.extractObjects(doc).map(ensureObject);
      applyExtras(snapshot.objectExtras);
      applyGrouping(snapshot);
      S.selectedId = S.objects.some(x => x.id === localSelection) ? localSelection : 'world';
      S.selectedFaces = new Set([0]);
      S.subSelection = null;
      S.dirty = true;
      renderAll();
      S.viewport?.setObjects(S.objects, S.selectedId);
      if (localCamera) S.viewport?.setCameraState(localCamera);
      updateTitle();
      if (Number.isFinite(Number(revision))) collabState.revision = Number(revision);
      clearTimeout(persistenceTimer);
      persistenceTimer = setTimeout(persistRemote, 700);
    } catch (error) {
      log(`Collaboration update rejected: ${error.message}`, 'warning');
    } finally {
      applyingRemote = false;
    }
  }

  async function refreshState() {
    try { collabState = await api.collabState(); } catch {}
    window.EPH_COLLAB_RENDER?.();
    return collabState;
  }

  async function sendSnapshotNow() {
    if (applyingRemote || !collabState.connected || !S.project || !S.doc) return;
    try { await api.collabSendSnapshot(makeSnapshot()); } catch {}
  }

  function scheduleSnapshot(delay = 120) {
    if (applyingRemote || !collabState.connected || !S.project || !S.doc) return;
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(sendSnapshotNow, Math.max(0, delay));
  }

  function streamLiveSnapshot() {
    if (applyingRemote || !collabState.connected || !S.project || !S.doc) return;
    const frameMs = 33;
    const now = performance.now();
    const wait = Math.max(0, frameMs - (now - lastLiveSnapshotAt));
    if (liveSnapshotTimer) return;
    liveSnapshotTimer = setTimeout(async () => {
      liveSnapshotTimer = null;
      lastLiveSnapshotAt = performance.now();
      await sendSnapshotNow();
    }, wait);
  }

  function installLiveViewportSync() {
    const viewport = S.viewport || window.EPH3D;
    if (!viewport || viewport.__ephLiveCollabSync) return;
    viewport.__ephLiveCollabSync = true;
    const original = viewport.callbacks.change;
    viewport.callbacks.change = (object, commit) => {
      original?.(object, commit);
      if (applyingRemote || !collabState.connected) return;
      if (commit) {
        clearTimeout(liveSnapshotTimer);
        liveSnapshotTimer = null;
        lastLiveSnapshotAt = performance.now();
        sendSnapshotNow();
      } else {
        streamLiveSnapshot();
      }
    };
  }

  if (typeof markDirty === 'function' && !markDirty.__ephCollaboration) {
    const originalMarkDirty = markDirty;
    markDirty = function(message) {
      originalMarkDirty(message);
      scheduleSnapshot(80);
    };
    markDirty.__ephCollaboration = true;
  }

  async function profileName() {
    const result = await api.getProfile?.();
    return result?.profile?.username || 'Collaborator';
  }

  async function host() {
    if (!S.project || !S.doc) return { ok: false, error: 'Open a project first.' };
    if (collabState.role === 'host' && collabState.connected) return { ok: true, inviteCode: collabState.inviteCode, ...collabState };
    const result = await api.collabHost({ project: S.project, username: await profileName(), snapshot: makeSnapshot() });
    if (result?.ok) {
      collabState = result;
      log('Collaboration session started', 'success');
      window.EPH_COLLAB_RENDER?.();
    }
    return result;
  }

  async function join(code) {
    const invite = String(code || '').trim();
    if (!invite) return { ok: false, error: 'Enter an invite code.' };
    const result = await api.collabJoin(invite, await profileName());
    if (!result?.ok) return result;
    collabState = result.state || await api.collabState();
    const loaded = await loadProject(result.project, result.snapshot || null);
    if (!loaded) {
      await api.collabLeave();
      return { ok: false, error: 'The shared project could not be loaded.' };
    }
    applyGrouping(result.snapshot || null);
    renderTree();
    S.viewport?.setObjects(S.objects, S.selectedId);
    log(`Joined ${result.project.name}`, 'success');
    window.EPH_COLLAB_RENDER?.();
    await refreshSharedProjects();
    return result;
  }

  async function leave() {
    const result = await api.collabLeave();
    collabState = { role: null, connected: false, users: [], chatHistory: [] };
    remoteSelections.clear(); remoteCursors.clear();
    window.EPH_COLLAB_RENDER?.();
    return result;
  }

  async function refreshSharedProjects() {
    const host = document.getElementById('ephSharedProjectsList');
    if (!host) return;
    let projects = [];
    try { projects = await api.collabListShared(); } catch {}
    if (!projects.length) {
      host.innerHTML = '<div class="shared-project-empty">No shared projects yet.</div>';
      return;
    }
    host.innerHTML = projects.map((project, i) => `<div class="shared-project-row" data-i="${i}"><div><strong>${esc(project.name)}</strong><small>${esc(project.ownerName || 'Project owner')}</small></div><button type="button" class="secondary-button shared-rejoin">Rejoin</button><button type="button" class="text-button shared-forget">Remove</button></div>`).join('');
    host.querySelectorAll('.shared-project-row').forEach(row => {
      const project = projects[Number(row.dataset.i)];
      row.querySelector('.shared-rejoin').onclick = async () => {
        row.querySelector('.shared-rejoin').disabled = true;
        const result = await join(project.inviteCode);
        if (!result?.ok) toast(result?.error || 'Could not join shared project');
        row.querySelector('.shared-rejoin').disabled = false;
      };
      row.querySelector('.shared-forget').onclick = async () => { await api.collabForgetShared(project.sessionId); refreshSharedProjects(); };
    });
  }

  function installStartupJoin() {
    const button = document.getElementById('ephJoinProject');
    if (!button || button.dataset.ephLive === '1') return;
    button.dataset.ephLive = '1';
    const hints = document.querySelectorAll('.startup-hint');
    if (hints[0]) hints[0].textContent = 'Saved locally and used as your collaboration name.';
    if (hints[1]) hints[1].textContent = 'Enter an invite code from the project owner.';
    const shared = document.querySelector('.startup-shared');
    if (shared && !document.getElementById('ephSharedProjectsList')) {
      const old = shared.querySelector('.shared-project-placeholder');
      if (old) { old.id = 'ephSharedProjectsList'; old.className = 'shared-project-list'; old.textContent = ''; }
    }
    button.onclick = async () => {
      const code = document.getElementById('ephInviteCode')?.value?.trim();
      button.disabled = true;
      const result = await join(code);
      if (!result?.ok) toast(result?.error || 'Could not join project');
      button.disabled = false;
    };
    refreshSharedProjects();
  }

  function cleanVisiblePlaceholderText() {
    const help = document.querySelector('#helpMenu [data-action="phase-info"]');
    if (help) help.textContent = 'About EasyPeasyHammer';
    const dot = document.querySelector('.status-dot');
    if (dot) dot.title = collabState.connected ? 'Collaboration connected' : 'Collaboration available';
    const hierarchy = document.querySelector('.right-tabs button:nth-child(2)');
    if (hierarchy?.textContent?.trim() === 'Hierarchy') hierarchy.remove();
  }

  function installCursorSharing() {
    const viewport = S.viewport || window.EPH3D;
    const canvas = viewport?.renderer?.domElement;
    if (!canvas || canvas.dataset.ephCollabCursor === '1') return;
    canvas.dataset.ephCollabCursor = '1';
    canvas.addEventListener('pointermove', event => {
      if (!collabState.connected || Date.now() - lastCursorSent < 100) return;
      lastCursorSent = Date.now();
      const rect = canvas.getBoundingClientRect();
      viewport.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      viewport.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      viewport.raycaster.setFromCamera(viewport.pointer, viewport.camera);
      const hits = viewport.raycaster.intersectObjects([...viewport.objectRoots.values()], true);
      api.collabSendCursor(hits[0]?.point?.toArray?.() || null).catch?.(() => {});
    }, { passive: true });
  }

  api.onCollaborationEvent?.(event => {
    if (!event) return;
    if (event.type === 'state') {
      collabState = event.state || collabState;
      cleanVisiblePlaceholderText();
      window.EPH_COLLAB_RENDER?.();
    } else if (event.type === 'presence') {
      collabState.users = event.users || [];
      window.EPH_COLLAB_RENDER?.();
    } else if (event.type === 'snapshot' && event.sourcePeer !== collabState.peerId) {
      applySnapshot(event.snapshot, event.revision);
    } else if (event.type === 'selection') {
      if (event.peerId !== collabState.peerId) remoteSelections.set(event.peerId, event);
    } else if (event.type === 'cursor') {
      if (event.peerId !== collabState.peerId) remoteCursors.set(event.peerId, event);
    } else if (event.type === 'chat') {
      collabState.chatHistory ||= [];
      if (!collabState.chatHistory.some(x => x.id === event.message?.id)) collabState.chatHistory.push(event.message);
      if (event.message?.peerId !== collabState.peerId) window.EPH_COLLAB_NOTIFY?.();
    } else if (event.type === 'kicked') {
      toast(event.reason || 'You were removed from the shared project.');
      collabState = { role: null, connected: false, users: [], chatHistory: [] };
      setTimeout(() => { if (S.project) exitMap(); }, 250);
      refreshSharedProjects();
    } else if (event.type === 'disconnected') {
      collabState.connected = false;
      toast('Collaboration connection closed.');
      window.EPH_COLLAB_RENDER?.();
    }
  });

  setInterval(() => {
    installStartupJoin();
    installCursorSharing();
    installLiveViewportSync();
    cleanVisiblePlaceholderText();
    if (collabState.connected && S.selectedId !== lastSelection) {
      lastSelection = S.selectedId;
      api.collabSendSelection(S.selectedId).catch?.(() => {});
    }
  }, 120);

  window.EPH_COLLAB = {
    state: () => collabState,
    refreshState,
    makeSnapshot,
    host,
    join,
    leave,
    kick: peerId => api.collabKick(peerId),
    refreshSharedProjects,
    sendSnapshotNow,
    scheduleSnapshot,
    remoteSelections,
    remoteCursors,
  };

  refreshState();
})();