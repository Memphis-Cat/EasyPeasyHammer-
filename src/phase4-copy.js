// byanca
(() => {
  function clean() {
    const hints = document.querySelectorAll('.startup-hint');
    if (hints[0] && hints[0].textContent !== 'Saved locally and used as your collaboration name.') hints[0].textContent = 'Saved locally and used as your collaboration name.';
    if (hints[1] && hints[1].textContent !== 'Enter an invite code from the project owner.') hints[1].textContent = 'Enter an invite code from the project owner.';

    const shared = document.querySelector('.shared-project-placeholder');
    if (shared && /will stay listed|will be able|Phase 4/i.test(shared.textContent || '')) shared.textContent = '';

    const help = document.querySelector('#helpMenu [data-action="phase-info"]');
    if (help && help.textContent !== 'About EasyPeasyHammer') help.textContent = 'About EasyPeasyHammer';

    const status = document.querySelector('.status-dot');
    if (status && /single-user|phase/i.test(status.title || '')) status.title = 'Collaboration available';

    document.querySelectorAll('.collab-phase-note').forEach(node => node.remove());

    let logsChanged = false;
    if (typeof S !== 'undefined' && Array.isArray(S.logs)) {
      for (const entry of S.logs) {
        if (/Phase 3 single-user editor ready/i.test(entry.message || '')) { entry.message = 'EasyPeasyHammer editor ready'; logsChanged = true; }
      }
      if (logsChanged && S.bottomTab === 'console' && typeof renderBottom === 'function') renderBottom();
    }
  }

  clean();
  const observer = new MutationObserver(clean);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 8000);
})();
