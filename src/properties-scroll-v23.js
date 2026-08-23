// byanca
(() => {
  'use strict';
  if (window.__ephPropertiesScrollV23) return;
  window.__ephPropertiesScrollV23 = true;

  function installStyle() {
    if (document.getElementById('ephPropertiesScrollV23Style')) return;
    const style = document.createElement('style');
    style.id = 'ephPropertiesScrollV23Style';
    style.textContent = `
      #rightPanel,
      #rightPanel .properties-panel {
        min-height: 0 !important;
        min-width: 0 !important;
      }

      #rightPanel .properties-panel {
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }

      #rightPanel .properties-panel > .panel-title {
        flex: 0 0 36px !important;
      }

      #propertiesContent.properties-content {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        min-width: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        overflow-y: scroll !important;
        overflow-x: hidden !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        padding: 10px 12px 34px 10px !important;
      }

      #propertiesContent::-webkit-scrollbar { width: 10px; }
      #propertiesContent::-webkit-scrollbar-track { background: #0b0d10; }
      #propertiesContent::-webkit-scrollbar-thumb {
        background: #3a3f46;
        border: 2px solid #0b0d10;
        border-radius: 8px;
      }
      #propertiesContent::-webkit-scrollbar-thumb:hover { background: #565d66; }

      #propertiesContent *,
      #propertiesContent *::before,
      #propertiesContent *::after { min-width: 0; }

      #propertiesContent .xyz-row {
        grid-template-columns: minmax(60px, auto) repeat(3, minmax(0, 1fr)) !important;
      }
      #propertiesContent .field-row {
        grid-template-columns: minmax(84px, auto) minmax(0, 1fr) !important;
      }
      #propertiesContent .face-row {
        grid-template-columns: minmax(48px, auto) minmax(0, 1fr) 28px !important;
      }

      #propertiesContent input,
      #propertiesContent select,
      #propertiesContent textarea,
      #propertiesContent .prop-input,
      #propertiesContent .prop-select {
        max-width: 100% !important;
      }

      #propertiesContent .eph-negative-actions {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      #propertiesContent .eph-negative-actions button,
      #propertiesContent .mini-button,
      #propertiesContent button.wide {
        max-width: 100% !important;
        white-space: normal !important;
        overflow-wrap: anywhere;
      }

      #propertiesContent .selection-info,
      #propertiesContent .property-section,
      #propertiesContent .property-section-title,
      #propertiesContent .toggle-row,
      #propertiesContent label,
      #propertiesContent p,
      #propertiesContent small {
        max-width: 100%;
        overflow-wrap: anywhere;
      }
    `;
    document.head.appendChild(style);
  }

  function repair() {
    installStyle();
    const content = document.getElementById('propertiesContent');
    const panel = content?.closest?.('.properties-panel');
    if (!content || !panel) return false;
    panel.style.minHeight = '0';
    content.style.minHeight = '0';
    content.style.flex = '1 1 auto';
    content.style.overflowY = 'scroll';
    content.style.overflowX = 'hidden';
    return true;
  }

  repair();
  requestAnimationFrame(repair);
  setTimeout(repair, 100);
  setTimeout(repair, 500);
  setTimeout(repair, 1500);
  new MutationObserver(() => repair()).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('eph3d-ready', repair);
})();
