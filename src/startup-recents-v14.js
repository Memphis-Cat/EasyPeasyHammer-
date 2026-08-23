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
      list.appendChild(button);
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
