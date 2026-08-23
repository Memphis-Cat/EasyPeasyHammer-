// byanca
(() => {
  'use strict';

  if (window.__ephLayoutSafeV14) return;
  window.__ephLayoutSafeV14 = true;

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'layout-safe-v14.css';
  document.head.appendChild(style);

  const left = document.getElementById('leftPanel');
  const rail = document.getElementById('toolRail');
  if (!left || !rail) return;
  left.style.position ||= 'relative';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'eph-toolrail-toggle-safe';
  button.tabIndex = -1;
  left.appendChild(button);

  const apply = hidden => {
    left.classList.toggle('eph-toolrail-hidden', hidden);
    button.textContent = hidden ? '›' : '‹';
    button.title = hidden ? 'Show tool rail' : 'Hide tool rail';
    localStorage.setItem('eph-toolrail-hidden', hidden ? '1' : '0');
    try { window.dispatchEvent(new Event('resize')); } catch {}
  };

  apply(localStorage.getItem('eph-toolrail-hidden') === '1');
  button.onclick = () => apply(!left.classList.contains('eph-toolrail-hidden'));

  const viewMenu = document.getElementById('viewMenu');
  if (viewMenu && !document.getElementById('ephToggleToolRailMenu')) {
    const menuButton = document.createElement('button');
    menuButton.id = 'ephToggleToolRailMenu';
    menuButton.type = 'button';
    menuButton.textContent = 'Toggle Tool Rail';
    menuButton.onclick = () => {
      apply(!left.classList.contains('eph-toolrail-hidden'));
      window.closeMenus?.();
    };
    viewMenu.appendChild(menuButton);
  }
})();
