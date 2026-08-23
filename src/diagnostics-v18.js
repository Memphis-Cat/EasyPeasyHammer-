// byanca
(() => {
  'use strict';
  if (window.__ephDiagnosticsV18) return;
  window.__ephDiagnosticsV18 = true;

  const api = window.easyPeasyHammer;
  const synced = new Set();
  let syncing = null;

  const keyFor = row => `${row?.at || 0}|${row?.level || ''}|${row?.source || ''}|${row?.message || ''}|${row?.meta || ''}`;

  async function syncPersistentLogs() {
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const result = await api?.appLogs?.();
        if (!result?.ok || !Array.isArray(result.records)) return;
        for (const row of result.records) {
          const key = keyFor(row);
          if (synced.has(key)) continue;
          synced.add(key);
          const level = row.level === 'error' ? 'error' : row.level === 'warning' ? 'warning' : 'normal';
          const stamp = row.at ? new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
          const message = `${stamp ? `[${stamp}] ` : ''}[${row.source || 'app'}] ${row.message || ''}${row.meta ? ` | ${row.meta}` : ''}`;
          window.EPH_DIAGNOSTICS?.record?.(level, [message], 'persistent');
        }
      } catch (error) {
        console.error('Could not read persistent EasyPeasyHammer logs', error);
      }
    })();
    try { await syncing; } finally { syncing = null; }
  }

  function installStartupButton() {
    const card = document.querySelector('#startupScreen .startup-card');
    if (!card || document.getElementById('ephStartupLogs')) return;
    const button = document.createElement('button');
    button.id = 'ephStartupLogs';
    button.type = 'button';
    button.className = 'text-button eph-startup-logs';
    button.textContent = 'Logs';
    button.title = 'Open complete EasyPeasyHammer diagnostics';
    button.onclick = async () => {
      await syncPersistentLogs();
      window.EPH_DIAGNOSTICS?.open?.();
    };
    card.appendChild(button);
  }

  function augmentDiagnostics() {
    if (!window.EPH_DIAGNOSTICS || window.EPH_DIAGNOSTICS.__ephV18) return false;
    const previous = window.EPH_DIAGNOSTICS;
    const rawOpen = previous.open?.bind(previous);
    const rawCopy = previous.copy?.bind(previous);
    previous.open = async () => { await syncPersistentLogs(); return rawOpen?.(); };
    previous.copy = async () => { await syncPersistentLogs(); return rawCopy?.(); };
    previous.syncPersistent = syncPersistentLogs;
    previous.__ephV18 = true;

    const clear = document.getElementById('ephDiagnosticsClear');
    clear?.addEventListener('click', async () => {
      try { await api?.clearAppLogs?.(); synced.clear(); }
      catch (error) { console.error('Could not clear persistent logs', error); }
    });

    const actions = document.querySelector('.eph-diagnostics-actions');
    if (actions && !document.getElementById('ephDiagnosticsRefresh')) {
      const refresh = document.createElement('button');
      refresh.id = 'ephDiagnosticsRefresh';
      refresh.type = 'button';
      refresh.textContent = 'Refresh logs';
      refresh.onclick = async () => { await syncPersistentLogs(); rawOpen?.(); };
      actions.insertBefore(refresh, actions.lastElementChild);
    }
    return true;
  }

  const style = document.createElement('style');
  style.textContent = `
    #ephStartupLogs { margin-top:8px; color:#fff !important; }
    #ephStartupLogs:hover { color:#fff !important; text-decoration:underline; }
  `;
  document.head.appendChild(style);

  installStartupButton();
  if (!augmentDiagnostics()) {
    setTimeout(augmentDiagnostics, 100);
    setTimeout(augmentDiagnostics, 500);
    setTimeout(augmentDiagnostics, 1500);
  }
  setTimeout(installStartupButton, 300);

  // Keep persistent logs close enough to current that opening the dialog after a
  // failed map load immediately shows the failure without requiring navigation.
  setInterval(() => {
    if (document.visibilityState === 'visible') syncPersistentLogs();
  }, 2500);
})();
