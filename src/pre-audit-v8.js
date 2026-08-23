// byanca
(() => {
  if (window.__ephPreAuditV8) return;
  window.__ephPreAuditV8 = true;

  function removeObsoleteUi() {
    for (const menu of ['buildMenu', 'windowMenu', 'helpMenu']) {
      document.querySelector(`.menu-button[data-menu="${menu}"]`)?.remove();
      document.getElementById(menu)?.remove();
    }
    document.querySelector('[data-bottom-tab="build"]')?.remove();
    const hierarchy = document.querySelector('.right-tabs button:nth-child(2)');
    if (hierarchy?.textContent?.trim() === 'Hierarchy') hierarchy.remove();
    const status = document.querySelector('.status-dot');
    if (status) status.title = 'Collaboration available';
    const invite = document.getElementById('ephInviteCode');
    if (invite) {
      invite.maxLength = 4096;
      invite.placeholder = 'Paste invite code';
    }
    const hints = document.querySelectorAll('.startup-hint');
    if (hints[0]) hints[0].textContent = 'Saved locally and used as your collaboration name.';
    if (hints[1]) hints[1].textContent = 'Enter an invite code from the project owner.';
    const shared = document.querySelector('.shared-project-placeholder');
    if (shared && /will stay listed|will be able|Phase 4/i.test(shared.textContent || '')) shared.textContent = '';

    if (typeof S !== 'undefined' && S.bottomTab === 'build') S.bottomTab = 'console';
    if (typeof S !== 'undefined' && Array.isArray(S.logs)) {
      for (const entry of S.logs) {
        if (/Phase 3 single-user editor ready/i.test(entry.message || '')) entry.message = 'EasyPeasyHammer editor ready';
      }
    }
  }

  removeObsoleteUi();

  // Ctrl+R is an editor reload, not a collaboration disconnect. Flush the
  // current map state first, including when an input happens to have focus.
  window.addEventListener('keydown', async event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'r') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (window.__ephReloadInProgress) return;
    window.__ephReloadInProgress = true;
    try {
      if (typeof autosave === 'function' && typeof S !== 'undefined' && S.project) await autosave(false);
    } catch {}
    try { await window.EPH_COLLAB?.sendSnapshotNow?.(); } catch {}
    location.reload();
  }, true);

  const observer = new MutationObserver(removeObsoleteUi);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 10000);
})();
