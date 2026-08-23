// byanca
(() => {
  'use strict';

  const api = window.easyPeasyHammer;
  const projectActionIds = ['openVmapButton', 'createProjectButton', 'continueButton'];
  const interactiveSelector = [
    '#startupScreen button',
    '#startupScreen input',
    '#newProjectModal button',
    '#newProjectModal input',
    '#ephWindowChrome button',
    '.eph-window-controls',
    '.eph-window-controls button'
  ].join(',');

  function makeInteractive(element) {
    if (!element) return;
    element.style.pointerEvents = 'auto';
    element.style.webkitAppRegion = 'no-drag';
  }

  function restoreProjectActions() {
    for (const id of projectActionIds) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.disabled = false;
      button.removeAttribute('aria-disabled');
      makeInteractive(button);
    }
  }

  function restorePointerTargets() {
    document.querySelectorAll(interactiveSelector).forEach(makeInteractive);
    makeInteractive(document.getElementById('startupScreen'));
    makeInteractive(document.querySelector('.startup-card'));
  }

  function hardenWindowControls() {
    const chrome = document.getElementById('ephWindowChrome');
    const controls = chrome?.querySelector('.eph-window-controls');
    if (!chrome || !controls || !api) return;

    makeInteractive(controls);
    controls.querySelectorAll('button').forEach(makeInteractive);

    const minimize = document.getElementById('ephMinimize');
    const maximize = document.getElementById('ephMaximize');
    const close = document.getElementById('ephClose');

    if (minimize && !minimize.dataset.ephInteractionFixed) {
      minimize.dataset.ephInteractionFixed = '1';
      minimize.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        api.windowMinimize?.();
      };
    }

    if (maximize && !maximize.dataset.ephInteractionFixed) {
      maximize.dataset.ephInteractionFixed = '1';
      maximize.onclick = async event => {
        event.preventDefault();
        event.stopPropagation();
        const maximized = await api.windowToggleMaximize?.();
        maximize.textContent = maximized ? '❐' : '□';
        maximize.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
      };
    }

    if (close && !close.dataset.ephInteractionFixed) {
      close.dataset.ephInteractionFixed = '1';
      close.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        api.windowClose?.();
      };
    }
  }

  function repair() {
    restoreProjectActions();
    restorePointerTargets();
    hardenWindowControls();
  }

  repair();
  requestAnimationFrame(repair);
  setTimeout(repair, 100);
  setTimeout(repair, 500);

  const observer = new MutationObserver(mutations => {
    let needsRepair = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        needsRepair = true;
        break;
      }
      if (mutation.type === 'attributes' && mutation.attributeName === 'disabled') {
        const target = mutation.target;
        if (target?.id && projectActionIds.includes(target.id)) {
          needsRepair = true;
          break;
        }
      }
    }
    if (needsRepair) queueMicrotask(repair);
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled']
  });

  window.addEventListener('pageshow', repair);
  window.addEventListener('focus', repair);
})();
