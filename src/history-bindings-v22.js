// byanca
(() => {
  'use strict';
  if (window.__ephHistoryBindingsV22) return;
  window.__ephHistoryBindingsV22 = true;

  let installed = false;

  function install() {
    const history = window.EPH_LOCAL_HISTORY;
    if (installed || !history?.active?.()) return installed;

    const undoButton = document.getElementById('toolbarUndo');
    const redoButton = document.getElementById('toolbarRedo');
    if (undoButton) undoButton.onclick = event => { event?.preventDefault?.(); history.undo(); };
    if (redoButton) redoButton.onclick = event => { event?.preventDefault?.(); history.redo(); };

    document.addEventListener('click', event => {
      const action = event.target?.closest?.('[data-action]')?.dataset?.action;
      if (action !== 'undo' && action !== 'redo') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === 'undo') history.undo(); else history.redo();
    }, true);

    installed = true;
    console.info('[History Bindings V22] Toolbar and menu use local-only undo/redo.');
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 150);
    setTimeout(() => clearInterval(timer), 30000);
  }
})();
