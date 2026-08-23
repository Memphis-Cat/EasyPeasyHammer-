// byanca
(() => {
  'use strict';
  if (window.__ephTransformPrecisionV23) return;
  window.__ephTransformPrecisionV23 = true;

  const MOVE_KEY = 'eph-move-snap';
  const SCALE_KEY = 'eph-scale-step-v21';
  const MIN_STEP = 0.0001;
  const RAD = Math.PI / 180;
  let viewport = null;

  const state = () => typeof S !== 'undefined' ? S : window.S;
  const cleanStep = (value, fallback = 1) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.max(MIN_STEP, number) : fallback;
  };

  function ensureStyle() {
    if (document.getElementById('ephTransformPrecisionV23Style')) return;
    const style = document.createElement('style');
    style.id = 'ephTransformPrecisionV23Style';
    style.textContent = `
      .eph-transform-option input#ephMoveSnap,
      #ephScaleV21 input#ephScaleStep,
      .status-select input#angleSnap{width:72px!important;min-width:72px;height:30px;background:#0b0c0e;color:#eee;border:1px solid #34383e;border-radius:3px;padding:0 6px;outline:none;font:12px "Segoe UI",Arial,sans-serif}
      .eph-transform-option input#ephMoveSnap:focus,
      #ephScaleV21 input#ephScaleStep:focus,
      .status-select input#angleSnap:focus{border-color:#6b747e}
      #ephScaleV21 .eph-scale-grid-button{height:30px;padding:0 7px;border:1px solid #34383e;border-radius:3px;background:#111317;color:#ddd;cursor:pointer}
      #ephScaleV21 .eph-scale-grid-button:hover{background:#1a1d22}
    `;
    document.head.appendChild(style);
  }

  function moveStep() {
    const stored = localStorage.getItem(MOVE_KEY);
    if (stored != null) return cleanStep(stored, 1);
    return cleanStep(viewport?.moveSnap, 1);
  }

  function applyPrecisionSnaps(vp = viewport || state()?.viewport || window.EPH3D) {
    if (!vp?.transform) return false;
    viewport = vp;
    const s = state();
    const move = moveStep();
    const angle = cleanStep(s?.angleSnap ?? vp.angleSnap, 15);
    vp.moveSnap = move;
    vp.angleSnap = angle;
    vp.transform.setTranslationSnap?.(vp.snap ? move : null);
    vp.transform.setRotationSnap?.(vp.snap ? angle * RAD : null);
    if (vp.tool === 'scale') vp.transform.setScaleSnap?.(null);
    return true;
  }

  function installMoveInput() {
    const old = document.getElementById('ephMoveSnap');
    if (!old) return false;
    if (old.dataset.ephPrecisionV23 === '1') return true;
    const input = old.cloneNode(true);
    input.dataset.ephPrecisionV23 = '1';
    input.type = 'number';
    input.min = String(MIN_STEP);
    input.step = 'any';
    input.value = String(moveStep());
    input.title = 'Exact translation snap in Source 2 world units. Any positive decimal is allowed.';
    const apply = () => {
      const value = cleanStep(input.value, moveStep());
      input.value = String(value);
      localStorage.setItem(MOVE_KEY, String(value));
      applyPrecisionSnaps();
    };
    input.onchange = apply;
    input.onblur = apply;
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(); input.blur(); }
    });
    old.replaceWith(input);
    return true;
  }

  function installScaleInput() {
    const old = document.getElementById('ephScaleStep');
    if (!old) return false;
    if (old.tagName === 'INPUT' && old.dataset.ephPrecisionV23 === '1') return true;
    const stored = localStorage.getItem(SCALE_KEY);
    const initial = stored === 'grid' || stored == null
      ? cleanStep(state()?.gridSize, 64)
      : cleanStep(stored, 1);
    const input = document.createElement('input');
    input.id = 'ephScaleStep';
    input.className = 'eph-scale-step';
    input.type = 'number';
    input.min = String(MIN_STEP);
    input.step = 'any';
    input.value = String(initial);
    input.dataset.ephPrecisionV23 = '1';
    input.title = 'Exact resize step in Source 2 world units. Any positive decimal is allowed.';
    const apply = () => {
      const value = cleanStep(input.value, 1);
      input.value = String(value);
      localStorage.setItem(SCALE_KEY, String(value));
      applyPrecisionSnaps();
    };
    input.onchange = apply;
    input.onblur = apply;
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(); input.blur(); }
    });
    old.replaceWith(input);

    if (!document.getElementById('ephScaleUseGrid')) {
      const button = document.createElement('button');
      button.id = 'ephScaleUseGrid';
      button.type = 'button';
      button.className = 'eph-scale-grid-button';
      button.textContent = 'Grid';
      button.title = 'Use the current grid size as the resize step';
      button.onclick = () => {
        const value = cleanStep(state()?.gridSize, 64);
        input.value = String(value);
        localStorage.setItem(SCALE_KEY, String(value));
        applyPrecisionSnaps();
      };
      input.after(button);
    }
    return true;
  }

  function installAngleInput() {
    const old = document.getElementById('angleSnap');
    if (!old) return false;
    if (old.tagName === 'INPUT' && old.dataset.ephPrecisionV23 === '1') return true;
    // advanced-ui.js still inspects the original SELECT.options while it creates
    // its rotate controls. Do not replace the status select until that synchronous
    // setup has completed, otherwise its whole viewport install throws.
    if (!document.querySelector('.rotate-options')) return false;
    const input = document.createElement('input');
    input.id = 'angleSnap';
    input.type = 'number';
    input.min = String(MIN_STEP);
    input.step = 'any';
    input.inputMode = 'decimal';
    input.dataset.ephPrecisionV23 = '1';
    input.value = String(cleanStep(state()?.angleSnap, 15));
    input.title = 'Exact rotation snap in degrees. Any positive decimal is allowed.';
    const apply = () => {
      const s = state();
      const value = cleanStep(input.value, cleanStep(s?.angleSnap, 15));
      input.value = String(value);
      if (s) s.angleSnap = value;
      const vp = viewport || s?.viewport || window.EPH3D;
      vp?.setSnap?.(s?.snap !== false, s?.gridSize || 64, value);
      applyPrecisionSnaps(vp);
    };
    input.onchange = apply;
    input.onblur = apply;
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(); input.blur(); }
    });
    old.replaceWith(input);
    return true;
  }

  function installPropertyPrecision(root = document) {
    root.querySelectorAll?.('.prop-value[data-key="position"], .prop-value[data-key="size"], .prop-value[data-key="scale"]').forEach(input => {
      input.step = 'any';
      input.setAttribute('step', 'any');
      input.inputMode = 'decimal';
    });
    root.querySelectorAll?.('.prop-value[data-key="rotation"]').forEach((input, index) => {
      input.step = 'any';
      input.setAttribute('step', 'any');
      input.inputMode = 'decimal';
      input.title = ['Pitch — rotates around Source 2 Y', 'Yaw — rotates around Source 2 Z', 'Roll — rotates around Source 2 X'][Number(input.dataset.i) || index] || 'Source 2 rotation';
      const row = input.closest('.xyz-row');
      const label = row?.querySelector('label');
      if (label && !label.dataset.ephQAngleV23) {
        label.dataset.ephQAngleV23 = '1';
        label.textContent = 'Rotation P/Y/R';
        label.title = 'Source 2 QAngle: Pitch around Y, Yaw around Z, Roll around X';
      }
    });
  }

  function installViewport(vp) {
    if (!vp?.transform) return false;
    viewport = vp;
    if (!vp.__ephPrecisionEventsV23) {
      vp.__ephPrecisionEventsV23 = true;
      const canvas = vp.renderer?.domElement;
      canvas?.addEventListener('pointerdown', () => applyPrecisionSnaps(vp), true);
      vp.transform.addEventListener('dragging-changed', event => {
        if (event.value) applyPrecisionSnaps(vp);
      });
    }
    applyPrecisionSnaps(vp);
    return true;
  }

  function installRenderControlGuard() {
    if (typeof renderViewportControls !== 'function' || renderViewportControls.__ephPrecisionV23) return;
    const raw = renderViewportControls;
    const wrapped = function() {
      const result = raw();
      const angle = document.getElementById('angleSnap');
      if (angle?.tagName === 'INPUT') angle.value = String(cleanStep(state()?.angleSnap, 15));
      installMoveInput();
      installScaleInput();
      installAngleInput();
      applyPrecisionSnaps();
      return result;
    };
    wrapped.__ephPrecisionV23 = true;
    wrapped.__ephPrevious = raw;
    renderViewportControls = wrapped;
    window.renderViewportControls = wrapped;
  }

  function install() {
    ensureStyle();
    installViewport(window.EPH3D || state()?.viewport);
    installMoveInput();
    installScaleInput();
    installAngleInput();
    installPropertyPrecision();
    installRenderControlGuard();
    applyPrecisionSnaps();
  }

  install();
  window.addEventListener('eph3d-ready', event => { installViewport(event.detail); install(); });
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        installPropertyPrecision(node);
      }
    }
    installMoveInput();
    installScaleInput();
    installAngleInput();
  }).observe(document.body, { childList: true, subtree: true });
  const timer = setInterval(install, 300);
  setTimeout(() => clearInterval(timer), 30000);
  console.info('[Transform Precision V23] Arbitrary decimal move/size/rotation precision installed.');
})();
