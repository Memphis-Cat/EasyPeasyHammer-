// byanca
(() => {
  'use strict';
  if (window.__ephInstantAssetsV56) return;
  window.__ephInstantAssetsV56 = true;

  const api = window.easyPeasyHammer;
  const TAB_KIND = { materials: 'material', props: 'model', models: 'model', sounds: 'sound', particles: 'particle' };
  const PRELOAD_LIMIT = 260;
  const caches = new Map();
  const pending = new Map();
  const warmed = new Set();
  const thumbUrls = new Map();

  const state = () => (typeof S !== 'undefined' ? S : window.S);
  const viewport = () => window.EPH3D || state()?.viewport || null;

  function normalizeItems(tab, items, query = '') {
    let result = Array.isArray(items) ? items : [];
    if (tab === 'materials') {
      const q = String(query || '').toLowerCase();
      const core = (typeof CORE_MATERIALS !== 'undefined' && Array.isArray(CORE_MATERIALS) ? CORE_MATERIALS : [])
        .filter(item => !q || `${item.name} ${item.path}`.toLowerCase().includes(q));
      const seen = new Set(result.map(item => String(item?.path || '').toLowerCase()));
      result = [...core.filter(item => !seen.has(String(item?.path || '').toLowerCase())), ...result];
    }
    if (tab === 'props' || tab === 'models') {
      result = result.map(item => ({ ...item, kind: 'prop', className: 'prop_static', model: item.model || item.path }));
    }
    return result;
  }

  async function ensureAssetStatus() {
    const s = state();
    if (!s || !api) return null;
    if (s.assetStatus?.available) return s.assetStatus;
    try {
      let status = await api.assetStatus?.();
      if (!status?.available) status = await api.detectCs2?.();
      if (status) s.assetStatus = status;
      try { renderAssetStatus?.(); } catch {}
      return status || null;
    } catch (error) {
      console.warn('[Instant Assets V56] CS2 asset status warmup failed.', error);
      return s.assetStatus || null;
    }
  }

  function cacheKey(tab, query = '') { return `${tab}\u0000${String(query || '').trim().toLowerCase()}`; }

  async function primeTab(tab, query = '') {
    const s = state();
    if (!s || !api) return [];
    if (tab === 'entities') {
      const q = String(query || '').toLowerCase();
      const items = (typeof ENTITIES !== 'undefined' && Array.isArray(ENTITIES) ? ENTITIES : [])
        .filter(item => !q || `${item.name} ${item.className}`.toLowerCase().includes(q));
      caches.set(cacheKey(tab, query), items);
      return items;
    }
    const kind = TAB_KIND[tab];
    if (!kind) return [];
    const key = cacheKey(tab, query);
    if (caches.has(key)) return caches.get(key);
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      await ensureAssetStatus();
      if (!state()?.assetStatus?.available) return tab === 'materials' ? normalizeItems(tab, [], query) : [];
      const result = await api.searchAssets(kind, query, PRELOAD_LIMIT);
      const items = normalizeItems(tab, result?.ok ? result.items || [] : [], query);
      caches.set(key, items);
      return items;
    })().catch(() => []).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  function showItems(tab, items) {
    const s = state();
    if (!s || s.assetTab !== tab) return;
    s.assetItems = Array.isArray(items) ? items : [];
    const status = s.assetStatus || {};
    if (tab === 'materials') s.assetTotal = Number(status.materialCount || s.assetItems.length);
    else if (tab === 'props' || tab === 'models') s.assetTotal = Number(status.modelCount || s.assetItems.length);
    else if (tab === 'sounds') s.assetTotal = Number(status.soundCount || s.assetItems.length);
    else if (tab === 'particles') s.assetTotal = Number(status.particleCount || s.assetItems.length);
    else s.assetTotal = s.assetItems.length;
    try { renderAssets?.(); } catch {}
  }

  function warmMaterial(item, thumb = null) {
    const path = String(item?.path || '').trim();
    if (!path || path === 'ERROR' || !thumb || thumb.classList.contains('real-thumb')) return;
    if (!thumbUrls.has(path)) {
      thumbUrls.set(path, Promise.resolve(api.materialPreview?.(path))
        .then(result => result?.ok && result.url ? result.url : null)
        .catch(() => null));
    }
    thumbUrls.get(path).then(url => {
      if (!url || !thumb.isConnected || thumb.dataset.assetPath !== path) return;
      thumb.style.backgroundImage = `url("${url}")`;
      thumb.classList.add('real-thumb');
      thumb.textContent = '';
    });
  }

  function warmModel(item) {
    const path = String(item?.model || item?.path || '').trim();
    if (!path || warmed.has(path)) return;
    warmed.add(path);
    viewport()?.loadModel?.(path).catch?.(() => warmed.delete(path));
  }

  function warmCard(card) {
    const s = state();
    const item = s?.assetItems?.[Number(card?.dataset?.i)];
    if (!item) return;
    if (s.assetTab === 'materials') warmMaterial(item, card.querySelector('.asset-thumb'));
    else if (s.assetTab === 'props' || s.assetTab === 'models') warmModel(item);
  }

  function warmVisible() {
    const s = state();
    const grid = document.getElementById('assetGrid');
    if (!s || !grid) return;
    const cards = [...grid.querySelectorAll('.asset-card[data-i]')];
    if (s.assetTab === 'props' || s.assetTab === 'models') cards.slice(0, 12).forEach(card => warmCard(card));
  }

  async function switchTab(tab) {
    const s = state();
    if (!s || !tab) return;
    s.assetTab = tab;
    const query = document.getElementById('assetSearch')?.value?.trim() || '';
    const key = cacheKey(tab, query);
    if (caches.has(key)) showItems(tab, caches.get(key));
    else if (tab === 'entities') showItems(tab, await primeTab(tab, query));
    else {
      s.assetItems = [];
      try { renderAssets?.(); } catch {}
      const items = await primeTab(tab, query);
      if (state()?.assetTab === tab && (document.getElementById('assetSearch')?.value?.trim() || '') === query) showItems(tab, items);
    }
  }

  function installSingleClickTabs() {
    const tabs = document.getElementById('assetTabs');
    if (!tabs || tabs.dataset.ephInstantTabsV56 === '1') return;
    tabs.dataset.ephInstantTabsV56 = '1';
    tabs.addEventListener('click', event => {
      const button = event.target.closest?.('[data-tab]');
      if (!button || !tabs.contains(button)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      switchTab(button.dataset.tab);
    }, true);
  }

  function installCardWarmup() {
    const grid = document.getElementById('assetGrid');
    if (!grid || grid.dataset.ephWarmV56 === '1') return;
    grid.dataset.ephWarmV56 = '1';
    const warm = event => {
      const card = event.target.closest?.('.asset-card[data-i]');
      if (card && grid.contains(card)) warmCard(card);
    };
    grid.addEventListener('pointerover', warm, { passive: true });
    grid.addEventListener('pointerdown', warm, true);
  }

  function wrapRenderAssets() {
    if (typeof renderAssets !== 'function' || renderAssets.__ephInstantV56) return;
    const previous = renderAssets;
    const wrapped = function(...args) {
      const result = previous.apply(this, args);
      warmVisible();
      return result;
    };
    wrapped.__ephInstantV56 = true;
    wrapped.__ephPrevious = previous;
    renderAssets = wrapped;
    window.renderAssets = wrapped;
  }

  async function primeEverything() {
    await ensureAssetStatus();
    const materials = await primeTab('materials', '');
    const s = state();
    const query = document.getElementById('assetSearch')?.value?.trim() || '';
    if (s && !query && s.assetTab === 'materials') showItems('materials', materials);

    setTimeout(() => {
      Promise.allSettled(['props', 'sounds', 'particles'].map(tab => primeTab(tab, ''))).then(() => {
        const current = state();
        const currentQuery = document.getElementById('assetSearch')?.value?.trim() || '';
        if (current && !currentQuery && caches.has(cacheKey(current.assetTab, ''))) showItems(current.assetTab, caches.get(cacheKey(current.assetTab, '')));
      });
    }, 0);
  }

  function install() {
    installSingleClickTabs();
    installCardWarmup();
    wrapRenderAssets();
    try { window.EPH_MODEL_QUEUE?.setLimit?.(8); } catch {}
    warmVisible();
  }

  install();
  window.addEventListener('eph3d-ready', install);
  queueMicrotask(() => { install(); primeEverything(); });

  window.EPH_INSTANT_ASSETS_V56 = {
    install,
    primeEverything,
    switchTab,
    clearCache: () => caches.clear(),
  };

  console.info('[Instant Assets V56] Material-first asset caches, single-query tab switching and hover-priority previews enabled.');
})();