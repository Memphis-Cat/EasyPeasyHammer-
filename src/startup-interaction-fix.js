// byanca
(() => {
  'use strict';

  const api = window.easyPeasyHammer;
  const projectActionIds = ['openVmapButton', 'createProjectButton', 'continueButton'];

  function makeInteractive(element) {
    if (!element) return;
    element.style.pointerEvents = 'auto';
    element.style.webkitAppRegion = 'no-drag';
  }

  function repair() {
    for (const id of projectActionIds) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.disabled = false;
      button.removeAttribute('aria-disabled');
      makeInteractive(button);
    }

    document.querySelectorAll('#startupScreen button, #startupScreen input, #newProjectModal button, #newProjectModal input, .eph-window-controls, .eph-window-controls button').forEach(makeInteractive);

    const minimize = document.getElementById('ephMinimize');
    const maximize = document.getElementById('ephMaximize');
    const close = document.getElementById('ephClose');

    if (minimize) minimize.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      api?.windowMinimize?.();
    };

    if (maximize) maximize.onclick = async event => {
      event.preventDefault();
      event.stopPropagation();
      const maximized = await api?.windowToggleMaximize?.();
      maximize.textContent = maximized ? '❐' : '□';
      maximize.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
    };

    if (close) close.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      api?.windowClose?.();
    };
  }

  // Bounded repairs only. Do not observe DOM mutations here: a previous
  // version used a MutationObserver and could amplify other startup mutations.
  repair();
  requestAnimationFrame(repair);
  setTimeout(repair, 100);
  setTimeout(repair, 500);
  window.addEventListener('pageshow', repair, { once: true });
})();
