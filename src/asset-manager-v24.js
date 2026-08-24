// byanca
(() => {
  'use strict';
  if (window.__ephAssetManagerV24) return;
  window.__ephAssetManagerV24 = true;

  const TAB_KIND = {
    materials: 'material',
    props: 'model',
    models: 'model',
    sounds: 'sound',
    particles: 'particle'
  };

  const TAB_LABEL = {
    materials: 'MAT',
    props: 'MDL',
    models: 'MDL',
    sounds: 'SND',
    particles: 'VFX',
    entities: 'ENT'
  };

  const totalForTab = tab => {
    if (!S?.assetStatus?.available) return null;
    if (tab === 'materials') return Number(S.assetStatus.materialCount || 0);
    if (tab === 'props' || tab === 'models') return Number(S.assetStatus.modelCount || 0);
    if (tab === 'sounds') return Number(S.assetStatus.soundCount || 0);
    if (tab === 'particles') return Number(S.assetStatus.particleCount || 0);
    return null;
  };

  function installStyles() {
    if (document.getElementById('ephAssetManagerV24Style')) return;
    const style = document.createElement('style');
    style.id = 'ephAssetManagerV24Style';
    style.textContent = `
      #assetTabs{grid-template-columns:repeat(5,minmax(0,1fr));}
      #assetTabs button{font-size:10px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .asset-thumb.eph-asset-sound{background:linear-gradient(135deg,#153b53,#2380a8);border-color:#285d78;}
      .asset-thumb.eph-asset-particle{background:linear-gradient(135deg,#4d2e14,#b36d20);border-color:#71502c;}
      .asset-source-row{min-height:24px;}
      #assetSourceStatus{white-space:normal;line-height:1.25;}
    `;
    document.head.appendChild(style);
  }

  function installTabs() {
    const tabs = document.getElementById('assetTabs');
    if (!tabs) return false;

    const modelButton = tabs.querySelector('[data-tab="props"]');
    if (modelButton) modelButton.textContent = 'Models';

    const entityButton = tabs.querySelector('[data-tab="entities"]');
    const ensureButton = (tab, text) => {
      let button = tabs.querySelector(`[data-tab="${tab}"]`);
      if (!button) {
        button = document.createElement('button');
        button.dataset.tab = tab;
        button.textContent = text;
        tabs.insertBefore(button, entityButton || null);
      }
      return button;
    };

    ensureButton('sounds', 'Sounds');
    ensureButton('particles', 'Particles');

    tabs.querySelectorAll('[data-tab]').forEach(button => {
      button.onclick = () => {
        S.assetTab = button.dataset.tab;
        S.assetItems = [];
        S.assetTotal = totalForTab(S.assetTab);
        renderAssets();
        queueAssetSearch(true);
      };
    });
    return true;
  }

  const originalRenderAssetStatus = renderAssetStatus;
  renderAssetStatus = function() {
    const element = document.getElementById('assetSourceStatus');
    if (!element) return originalRenderAssetStatus?.();
    const dot = document.querySelector('.status-dot');
    if (dot) dot.classList.toggle('online', Boolean(S.assetStatus?.available));
    if (!S.assetStatus?.available) {
      element.textContent = 'CS2 assets not connected';
      element.classList.remove('online');
      return;
    }

    const mats = Number(S.assetStatus.materialCount || 0).toLocaleString();
    const models = Number(S.assetStatus.modelCount || 0).toLocaleString();
    const sounds = Number(S.assetStatus.soundCount || 0).toLocaleString();
    const particles = Number(S.assetStatus.particleCount || 0).toLocaleString();
    element.textContent = `CS2 • ${mats} mats • ${models} models • ${sounds} sounds • ${particles} particles`;
    element.classList.add('online');
  };

  searchAssets = async function() {
    const seq = ++S.assetQuerySeq;
    const query = document.getElementById('assetSearch')?.value?.trim() || '';

    if (S.assetTab === 'entities') {
      S.assetItems = ENTITIES.filter(item => `${item.name} ${item.className}`.toLowerCase().includes(query.toLowerCase()));
      S.assetTotal = S.assetItems.length;
      return renderAssets();
    }

    if (!S.assetStatus?.available) {
      S.assetItems = S.assetTab === 'materials'
        ? CORE_MATERIALS.filter(item => `${item.name} ${item.path}`.toLowerCase().includes(query.toLowerCase()))
        : [];
      S.assetTotal = S.assetItems.length;
      return renderAssets();
    }

    const kind = TAB_KIND[S.assetTab] || 'material';
    const result = await api.searchAssets(kind, query, 800);
    if (seq !== S.assetQuerySeq) return;

    let items = result?.ok ? result.items || [] : [];
    S.assetTotal = Number(result?.total ?? totalForTab(S.assetTab) ?? items.length);

    if (S.assetTab === 'materials') {
      const seen = new Set(items.map(item => String(item.path || '').toLowerCase()));
      items = [
        ...CORE_MATERIALS
          .filter(item => !query || `${item.name} ${item.path}`.toLowerCase().includes(query.toLowerCase()))
          .filter(item => !seen.has(String(item.path || '').toLowerCase())),
        ...items
      ];
    }

    if (S.assetTab === 'props' || S.assetTab === 'models') {
      items = items.map(item => ({ ...item, kind: 'prop', className: 'prop_static', model: item.path }));
    }

    S.assetItems = items;
    renderAssets();
  };

  renderAssets = function() {
    document.querySelectorAll('#assetTabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === S.assetTab));
    const list = S.assetItems || [];
    const label = TAB_LABEL[S.assetTab] || 'ASSET';
    const extraClass = S.assetTab === 'sounds' ? ' eph-asset-sound' : S.assetTab === 'particles' ? ' eph-asset-particle' : '';

    const grid = document.getElementById('assetGrid');
    if (!grid) return;
    grid.innerHTML = list.map((item, index) => `
      <button class="asset-card" data-i="${index}" title="${esc(item.path || item.className || item.model || '')}">
        <div class="asset-thumb${extraClass}" data-thumb="${index}">${label}</div>
        <div class="asset-name">${esc(item.name)}</div>
      </button>`).join('');

    const count = document.getElementById('assetCount');
    if (count) {
      const total = Number.isFinite(Number(S.assetTotal)) ? Number(S.assetTotal) : totalForTab(S.assetTab);
      const searchableAsset = ['materials', 'props', 'models', 'sounds', 'particles'].includes(S.assetTab) && S.assetStatus?.available;
      count.textContent = searchableAsset && total != null && total > list.length
        ? `${list.length.toLocaleString()} shown / ${Number(total).toLocaleString()}`
        : `${list.length.toLocaleString()} items`;
    }

    grid.querySelectorAll('.asset-card').forEach(card => {
      const item = list[Number(card.dataset.i)];
      card.onclick = () => {
        grid.querySelectorAll('.asset-card').forEach(other => other.classList.remove('selected'));
        card.classList.add('selected');
        if (S.assetTab === 'materials' && current()?.type === 'part') applyMaterial(item.path);
      };
      card.ondblclick = () => {
        if (S.assetTab === 'entities') addEntity(item);
        else if (S.assetTab === 'props' || S.assetTab === 'models') addProp(item);
        else if (S.assetTab === 'sounds' || S.assetTab === 'particles') {
          api.copyText?.(item.path);
          toast?.(`Copied ${S.assetTab === 'sounds' ? 'sound' : 'particle'} path`);
        }
      };
    });

    if (S.assetTab === 'materials') loadMaterialThumbs(list.slice(0, 40));
    renderAssetStatus();
  };

  function loadExtension(src) {
    if ([...document.scripts].some(script => script.getAttribute('src')?.endsWith(`/${src}`) || script.getAttribute('src') === src)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.ephAssetExtension = src;
    document.body.appendChild(script);
  }

  installStyles();
  installTabs();
  S.assetTotal = totalForTab(S.assetTab);
  renderAssetStatus();
  renderAssets();
  queueAssetSearch(true);
  loadExtension('part-numbering-v25.js');
  loadExtension('prop-fidelity-v37.js');
  loadExtension('weather-volume-v27.js');
  loadExtension('weather-audio-v37.js');
  loadExtension('particle-placement-v25.js');
  loadExtension('hammer-parity-v45.js');
  // Selection parity intentionally loads last so it reflects the final visual
  // produced by all material/model/entity helper passes above.
  loadExtension('hammer-selection-v46.js');

  window.addEventListener('eph-runtime-ready', () => {
    installTabs();
    renderAssetStatus();
  }, { once: true });

  console.info('[Asset Manager V24] Models, materials, sounds and particles enabled.');
})();