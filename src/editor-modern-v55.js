// byanca
(() => {
  'use strict';
  if (window.__ephEditorModernV55) return;
  window.__ephEditorModernV55 = true;

  const editor = document.getElementById('editorScreen');
  const rail = document.getElementById('toolRail');
  if (!editor || !rail) return;

  const contextSelectors = {
    move: ['.move-options', '#ephSurfaceSnap', '[data-move-option]', '[data-eph-move-option]'],
    rotate: ['.rotate-options', '#rotateSnapSelect', '#outerRingButton', '[data-rotate-option]', '[data-eph-rotate-option]'],
    scale: ['.scale-options', '[data-scale-option]', '[data-eph-scale-option]'],
  };

  function activeTool() {
    const explicit = document.querySelector('.tool-mode[data-tool].active')?.dataset?.tool;
    if (explicit) return explicit;
    try { return S?.tool || 'select'; } catch { return 'select'; }
  }

  function classifyContextElement(element) {
    if (!element || element.closest?.('#toolRail')) return null;
    for (const [tool, selectors] of Object.entries(contextSelectors)) {
      if (selectors.some(selector => element.matches?.(selector) || element.closest?.(selector))) return tool;
    }
    if (element.id === 'spaceModeButton') return activeTool() === 'rotate' ? 'rotate' : activeTool() === 'scale' ? 'scale' : 'move';
    if (element.matches?.('.tool-mode,[data-tool],.icon-button') || element.id === 'topAddPart') return null;
    const text = String(element.textContent || '').trim().toLowerCase();
    if (!text) return null;
    if (/outer\s*ring|ring hidden|rotation\s*snap|degrees?|^\s*(15|30|45|90|180)\s*°?\s*$/.test(text)) return 'rotate';
    if (/one\s*side|scale\s*(step|amount)?|^\s*0\.0?1\s*$/.test(text)) return 'scale';
    if (/surface|move\s*(step|amount)?|units?|^\s*0\.1\s*$/.test(text)) return 'move';
    return null;
  }

  function markContextualControls() {
    const toolbar = editor.querySelector('.toolbar-row');
    if (!toolbar) return;
    const candidates = new Set([
      ...toolbar.querySelectorAll('.move-options,.rotate-options,.scale-options,.eph-transform-option,#ephSurfaceSnap,#rotateSnapSelect,#outerRingButton,#spaceModeButton,[data-move-option],[data-scale-option],[data-rotate-option]'),
      ...toolbar.querySelectorAll('.mode-group > *'),
    ]);
    for (const element of candidates) {
      const tool = classifyContextElement(element);
      if (!tool) continue;
      let target = element;
      if (element.matches?.('#rotateSnapSelect,#outerRingButton') && element.closest('.rotate-options')) target = element.closest('.rotate-options');
      if (target.matches?.('.tool-mode,[data-tool="move"],[data-tool="rotate"],[data-tool="scale"]')) continue;
      target.dataset.ephToolContext = tool;
    }
    editor.dataset.ephActiveTool = activeTool();
  }

  function terrainCandidate() {
    const all = [...document.querySelectorAll('button')];
    return all.find(button => {
      if (rail.contains(button)) return false;
      const id = String(button.id || '').toLowerCase();
      const tool = String(button.dataset?.tool || '').toLowerCase();
      const title = String(button.title || '').toLowerCase();
      const text = String(button.textContent || '').toLowerCase();
      return tool.includes('terrain') || id.includes('terrain') || title.includes('terrain') || /add\s+terrain/.test(text);
    }) || null;
  }

  function moveTerrainToRail() {
    const existing = rail.querySelector('[data-eph-terrain-rail="1"]');
    if (existing) return;
    const source = terrainCandidate();
    if (!source) return;
    source.dataset.ephTerrainRail = '1';
    source.classList.add('eph-terrain-rail');
    source.classList.remove('icon-button', 'tool-mode', 'toolbar-dropdown');
    if (!source.dataset.tool) source.dataset.tool = 'terrain';
    const text = source.querySelector('span');
    if (text) text.textContent = /add/i.test(text.textContent || '') ? 'Terrain' : (text.textContent || 'Terrain');
    else if (!String(source.textContent || '').trim()) {
      const label = document.createElement('span');
      label.textContent = 'Terrain';
      source.appendChild(label);
    }
    rail.appendChild(source);
  }

  function removeSidebarSelect() {
    const select = rail.querySelector('[data-tool="select"]');
    if (!select) return;
    select.hidden = true;
    select.setAttribute('aria-hidden', 'true');
    select.style.display = 'none';
  }

  const clutterPatterns = [
    /0\s*=\s*fully visible/i,
    /100\s*=\s*fully invisible/i,
    /loaded from .*fgd/i,
    /these are the fields hammer defines/i,
    /viewport uses a real three/i,
    /edit geometry directly in the viewport/i,
    /collision and gameplay stay unchanged/i,
  ];

  function hidePropertyClutter() {
    const host = document.getElementById('propertiesContent');
    if (!host) return;
    host.querySelectorAll('.selection-info,.property-help,.property-description,.field-description,.eph-property-help,.eph-fgd-help,.hammer-fgd-description').forEach(node => {
      node.hidden = true;
      node.style.display = 'none';
    });
    for (const node of host.querySelectorAll('p,small,.collab-state,div,span')) {
      if (node.children.length > 1) continue;
      const text = String(node.textContent || '').trim();
      if (!text || text.length > 260) continue;
      if (clutterPatterns.some(pattern => pattern.test(text))) {
        node.hidden = true;
        node.style.display = 'none';
      }
    }
  }

  let scheduled = false;
  function repair() {
    scheduled = false;
    removeSidebarSelect();
    moveTerrainToRail();
    markContextualControls();
    hidePropertyClutter();
  }
  function scheduleRepair() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(repair);
  }

  editor.addEventListener('click', event => {
    const tool = event.target.closest?.('.tool-mode[data-tool], #toolRail [data-tool]');
    if (!tool) return;
    queueMicrotask(() => {
      editor.dataset.ephActiveTool = tool.dataset.tool || activeTool();
      markContextualControls();
    });
  }, true);

  new MutationObserver(scheduleRepair).observe(editor, { childList: true, subtree: true });
  window.addEventListener('eph-runtime-ready', scheduleRepair);
  window.addEventListener('eph3d-ready', scheduleRepair);
  scheduleRepair();
})();
