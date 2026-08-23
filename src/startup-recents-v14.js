// byanca
(() => {
  'use strict';

  if (window.__ephStartupRecentsV14) return;
  window.__ephStartupRecentsV14 = true;

  const api = window.easyPeasyHammer;
  if (!api) return;

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'startup-recents-v14.css';
  document.head.appendChild(style);

  const card = document.querySelector('#startupScreen .startup-card');
  if (!card) return;
  card.classList.add('eph-recent-startup');

  const legacyResume = document.getElementById('resumePanel');
  const legacyForget = document.getElementById('forgetSessionButton');
  const actions = card.querySelector('.startup-actions');

  const section = document.createElement('section');
  section.id = 'ephRecentMaps';
  section.className = 'eph-recent-maps';
  section.innerHTML = `
    <div class="eph-recent-maps-title">Recent maps</div>
    <div id="ephRecentMapsList" class="eph-recent-maps-list">
      <div class="eph-recent-maps-empty">Loading maps…</div>
    </div>`;
  if (actions) card.insertBefore(section, actions);
  else card.appendChild(section);

  const list = section.querySelector('#ephRecentMapsList');
  let renderToken = 0;
  let pendingDelete = null;

  const deleteDialog = document.createElement('dialog');
  deleteDialog.id = 'ephDeleteMapDialog';
  deleteDialog.className = 'eph-delete-map-dialog';
  deleteDialog.innerHTML = `
    <form class="eph-delete-map-card" method="dialog">
      <h2>Delete map?</h2>
      <p id="ephDeleteMapName" class="eph-delete-map-name"></p>
      <p id="ephDeleteMapPath" class="eph-delete-map-path"></p>
      <div class="eph-delete-map-warning">
        This moves the map to the Windows Recycle Bin. If it is an EasyPeasyHammer project, its whole project folder is moved. If it is an external VMAP, only that VMAP file is moved.
      </div>
      <div class="modal-actions">
        <button id="ephDeleteMapCancel" type="button" class="secondary-button">Cancel</button>
        <button id="ephDeleteMapConfirm" type="button" class="eph-delete-danger">Delete map</button>
      </div>
    </form>`;
  document.body.appendChild(deleteDialog);

  const deleteName = deleteDialog.querySelector('#ephDeleteMapName');
  const deletePath = deleteDialog.querySelector('#ephDeleteMapPath');
  const deleteCancel = deleteDialog.querySelector('#ephDeleteMapCancel');
  const deleteConfirm = deleteDialog.querySelector('#ephDeleteMapConfirm');

  function hideLegacySingleMapUi() {
    legacyResume?.classList.add('hidden');
    legacyForget?.classList.add('hidden');
  }

  function timeLabel(value) {
    const timestamp = Date.parse(value || '');
    if (!timestamp) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    try {
      return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  async function openRecent(entry, button) {
    const vmapPath = entry?.project?.vmapPath;
    if (!vmapPath || typeof window.loadProject !== 'function') return;
    button.disabled = true;
    try {
      const recent = await api.openRecentProject?.(vmapPath);
      if (!recent?.project) {
        window.toast?.('That recent map is no longer available');
        await renderRecentMaps();
        return;
      }
      const loaded = await window.loadProject(recent.project, recent.uiState || null);
      if (!loaded) window.toast?.('Could not open that map');
    } catch (error) {
      window.toast?.(error?.message || 'Could not open that map');
    } finally {
      button.disabled = false;
    }
  }

  function askDelete(entry) {
    const project = entry?.project;
    if (!project?.vmapPath) return;
    pendingDelete = entry;
    deleteName.textContent = `${project.name || 'Untitled'}.vmap`;
    deletePath.textContent = project.vmapPath;
    if (!deleteDialog.open) deleteDialog.showModal();
  }

  async function deletePending() {
    const entry = pendingDelete;
    const vmapPath = entry?.project?.vmapPath;
    if (!vmapPath) return;
    deleteConfirm.disabled = true;
    deleteCancel.disabled = true;
    try {
      const result = await api.deleteRecentProject?.(vmapPath);
      if (!result?.ok) {
        window.toast?.(result?.error || 'Could not delete that map');
        return;
      }
      pendingDelete = null;
      deleteDialog.close();
      window.toast?.(result.deletedProjectFolder ? 'Project moved to Recycle Bin' : 'VMAP moved to Recycle Bin');
      await renderRecentMaps();
    } catch (error) {
      window.toast?.(error?.message || 'Could not delete that map');
    } finally {
      deleteConfirm.disabled = false;
      deleteCancel.disabled = false;
    }
  }

  deleteCancel.onclick = () => {
    pendingDelete = null;
    deleteDialog.close();
  };
  deleteConfirm.onclick = deletePending;
  deleteDialog.addEventListener('cancel', event => {
    event.preventDefault();
    pendingDelete = null;
    deleteDialog.close();
  });

  async function renderRecentMaps() {
    hideLegacySingleMapUi();
    const token = ++renderToken;
    let result;
    try { result = await api.listRecentProjects?.(24); }
    catch (error) { result = { ok: false, error: error?.message }; }
    if (token !== renderToken) return;

    const projects = Array.isArray(result?.projects) ? result.projects : [];
    list.replaceChildren();
    if (!projects.length) {
      const empty = document.createElement('div');
      empty.className = 'eph-recent-maps-empty';
      empty.textContent = 'No recent maps yet.';
      list.appendChild(empty);
      return;
    }

    for (const entry of projects) {
      const project = entry.project || {};
      const row = document.createElement('div');
      row.className = 'eph-recent-map-row';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'eph-recent-map';
      button.tabIndex = -1;
      button.title = project.vmapPath || project.name || 'Open map';

      const main = document.createElement('span');
      main.className = 'eph-recent-map-main';
      const name = document.createElement('span');
      name.className = 'eph-recent-map-name';
      name.textContent = `${project.name || 'Untitled'}.vmap`;
      const path = document.createElement('span');
      path.className = 'eph-recent-map-path';
      path.textContent = project.vmapPath || '';
      main.append(name, path);

      const time = document.createElement('span');
      time.className = 'eph-recent-map-time';
      time.textContent = timeLabel(entry.savedAt);
      button.append(main, time);
      button.onclick = () => openRecent(entry, button);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'eph-recent-map-delete';
      remove.tabIndex = -1;
      remove.textContent = 'Delete';
      remove.title = `Delete ${project.name || 'map'}`;
      remove.onclick = () => askDelete(entry);

      row.append(button, remove);
      list.appendChild(row);
    }
  }

  const rawHome = typeof window.home === 'function' ? window.home : null;
  if (rawHome && !rawHome.__ephRecentMapsV14) {
    const wrappedHome = async function(...args) {
      const result = await rawHome(...args);
      hideLegacySingleMapUi();
      await renderRecentMaps();
      return result;
    };
    wrappedHome.__ephRecentMapsV14 = true;
    window.home = wrappedHome;
    try { home = wrappedHome; } catch {}
  }

  hideLegacySingleMapUi();
  renderRecentMaps();
})();
