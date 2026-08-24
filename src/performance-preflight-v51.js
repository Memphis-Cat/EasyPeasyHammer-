// byanca
(() => {
  'use strict';
  if (window.__ephPerformancePreflightV51) return;
  window.__ephPerformancePreflightV51 = true;

  const rawSetInterval = window.setInterval.bind(window);
  const redundantGuards = new Set([
    'entity-model-basis-v41.js',
    'hammer-fgd-visuals-v42.js',
    'hammer-parity-v45.js',
    'solid-entity-runtime-v24.js',
    'prop-fidelity-v37.js',
  ]);
  const suppressed = new Map();

  function callerFile() {
    const stack = String(new Error().stack || '').toLowerCase();
    for (const file of redundantGuards) if (stack.includes(file)) return file;
    return '';
  }

  const guardedSetInterval = function(callback, delay, ...args) {
    const file = Number(delay) === 250 ? callerFile() : '';
    if (file) {
      suppressed.set(file, (suppressed.get(file) || 0) + 1);
      return 0;
    }
    return rawSetInterval(callback, delay, ...args);
  };
  window.setInterval = guardedSetInterval;
  window.addEventListener('eph-runtime-ready', () => {
    if (window.setInterval === guardedSetInterval) window.setInterval = rawSetInterval;
  }, { once: true });

  window.EPH_PERFORMANCE_PREFLIGHT_V51 = {
    suppressed,
    summary: () => Object.fromEntries(suppressed),
  };
})();
