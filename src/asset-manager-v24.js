// byanca
(() => {
  'use strict';
  if (window.__ephAssetManagerV24) return;
  window.__ephAssetManagerV24 = true;

  const SEARCH_LIMIT = 260;
  const RENDER_LIMIT = 180;
  const THUMB_CONCURRENCY = 8;
  const TAB_KIND = { materials: 'material', props: 'model', models: 'model', sounds: 'sound', particles: 'particle' };
  const TAB_LABEL = { materials: 'MAT', props: 'MDL', models: 'MDL', sounds: 'SND', particles: 'VFX', entities: 'ENT' };

  let userActivated = false;
  let searchTimer = null;
  let thumbObserver = null;
  const thumbCache = new Map();
  const thumbQueue = [];
  const thumbQueued = new Set();
  let thumbWorkers = 0;

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
      #assetGrid{contain:layout style;}
      .asset-card{contain:layout style paint;}
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
    if (tabs.dataset.ephAssetTabsV24 !== '1') {
      tabs.dataset.ephAssetTabsV24 = '1';
      tabs.addEventListener('click', event => {
        const button = event.target.closest('[data-tab]');
        if (!button) return;
        userActivated = true;
        S.assetTab = button.dataset.tab;
        S.assetItems = [];
        S.assetTotal = totalForTab(S.assetTab);
        renderAssets();
        queueAssetSearch(true);
      });
    }
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

  queueAssetSearch = function(immediate = false) {
    clearTimeout(searchTimer);
    const query = document.getElementById('assetSearch')?.value?.trim() || '';
    if (!userActivated && !query) {
      if (S.assetTab === 'materials' && (!S.assetItems?.length || S.assetItems.length > CORE_MATERIALS.length)) {
        S.assetItems = [...CORE_MATERIALS];
        S.assetTotal = totalForTab('materials');
        renderAssets();
      }
      return;
    }
    searchTimer = setTimeout(searchAssets, immediate ? 0 : 70);
  };
  window.queueAssetSearch = queueAssetSearch;

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
    const result = await api.searchAssets(kind, query, SEARCH_LIMIT);
    if (seq !== S.assetQuerySeq) return;
    let items = result?.ok ? result.items || [] : [];
    S.assetTotal = Number(result?.total ?? totalForTab(S.assetTab) ?? items.length);

    if (S.assetTab === 'materials') {
      const seen = new Set(items.map(item => String(item.path || '').toLowerCase()));
      items = [
        ...CORE_MATERIALS
          .filter(item => !query || `${item.name} ${item.path}`.toLowerCase().includes(query.toLowerCase()))
          .filter(item => !seen.has(String(item.path || '').toLowerCase())),
        ...items,
      ];
    }
    if (S.assetTab === 'props' || S.assetTab === 'models') items = items.map(item => ({ ...item, kind: 'prop', className: 'prop_static', model: item.path }));
    S.assetItems = items;
    renderAssets();
  };
  window.searchAssets = searchAssets;

  function resetThumbObserver() {
    thumbObserver?.disconnect?.();
    thumbObserver = null;
  }

  async function cachedThumb(path) {
    if (!path || path === 'ERROR') return null;
    if (!thumbCache.has(path)) {
      thumbCache.set(path, Promise.resolve(api.materialPreview(path)).then(result => result?.ok && result.url ? result.url : null).catch(() => null));
      if (thumbCache.size > 768) thumbCache.delete(thumbCache.keys().next().value);
    }
    return thumbCache.get(path);
  }

  function pumpThumbQueue() {
    while (thumbWorkers < THUMB_CONCURRENCY && thumbQueue.length) {
      const task = thumbQueue.shift();
      thumbQueued.delete(task.key);
      if (!task.thumb?.isConnected) continue;
      thumbWorkers++;
      cachedThumb(task.path).then(url => {
        if (!url || !task.thumb?.isConnected || task.thumb.dataset.assetPath !== task.path) return;
        task.thumb.style.backgroundImage = `url("${url}")`;
        task.thumb.classList.add('real-thumb');
        task.thumb.textContent = '';
      }).finally(() => { thumbWorkers--; pumpThumbQueue(); });
    }
  }

  function queueThumb(thumb, path, urgent = false) {
    const key = `${path}|${thumb.dataset.thumb || ''}`;
    if (!path || path === 'ERROR' || thumbQueued.has(key) || thumb.classList.contains('real-thumb')) return;
    thumbQueued.add(key);
    const task = { key, thumb, path };
    if (urgent) thumbQueue.unshift(task);
    else thumbQueue.push(task);
    pumpThumbQueue();
  }

  function observeMaterialThumbs(grid) {
    resetThumbObserver();
    if (S.assetTab !== 'materials') return;
    const thumbs = [...grid.querySelectorAll('.asset-thumb[data-asset-path]')];
    if (!thumbs.length) return;
    if (typeof IntersectionObserver !== 'function') {
      thumbs.slice(0, 48).forEach(thumb => queueThumb(thumb, thumb.dataset.assetPath, true));
      return;
    }
    thumbObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const thumb = entry.target;
        thumbObserver.unobserve(thumb);
        queueThumb(thumb, thumb.dataset.assetPath, entry.intersectionRatio > 0);
      }
    }, { root: grid, rootMargin: '480px' });
    thumbs.forEach(thumb => thumbObserver.observe(thumb));
  }

  function installGridDelegation(grid) {
    if (!grid || grid.dataset.ephAssetDelegationV24 === '1') return;
    grid.dataset.ephAssetDelegationV24 = '1';
    grid.addEventListener('click', event => {
      const card = event.target.closest('.asset-card[data-i]');
      if (!card) return;
      userActivated = true;
      const item = S.assetItems?.[Number(card.dataset.i)];
      if (!item) return;
      grid.querySelector('.asset-card.selected')?.classList.remove('selected');
      card.classList.add('selected');
      if (S.assetTab === 'materials' && current()?.type === 'part') applyMaterial(item.path);
    });
    grid.addEventListener('dblclick', event => {
      const card = event.target.closest('.asset-card[data-i]');
      if (!card) return;
      const item = S.assetItems?.[Number(card.dataset.i)];
      if (!item) return;
      if (S.assetTab === 'entities') addEntity(item);
      else if (S.assetTab === 'props' || S.assetTab === 'models') addProp(item);
      else if (S.assetTab === 'sounds' || S.assetTab === 'particles') {
        api.copyText?.(item.path);
        toast?.(`Copied ${S.assetTab === 'sounds' ? 'sound' : 'particle'} path`);
      }
    });
  }

  renderAssets = function() {
    document.querySelectorAll('#assetTabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === S.assetTab));
    const fullList = S.assetItems || [];
    const list = fullList.slice(0, RENDER_LIMIT);
    const label = TAB_LABEL[S.assetTab] || 'ASSET';
    const extraClass = S.assetTab === 'sounds' ? ' eph-asset-sound' : S.assetTab === 'particles' ? ' eph-asset-particle' : '';
    const grid = document.getElementById('assetGrid');
    if (!grid) return;
    installGridDelegation(grid);
    grid.innerHTML = list.map((item, index) => {
      const path = String(item.path || item.className || item.model || '');
      return `<button class="asset-card" data-i="${index}" title="${esc(path)}"><div class="asset-thumb${extraClass}" data-thumb="${index}" data-asset-path="${esc(path)}">${label}</div><div class="asset-name">${esc(item.name)}</div></button>`;
    }).join('');

    const count = document.getElementById('assetCount');
    if (count) {
      const total = Number.isFinite(Number(S.assetTotal)) ? Number(S.assetTotal) : totalForTab(S.assetTab);
      const searchable = ['materials', 'props', 'models', 'sounds', 'particles'].includes(S.assetTab) && S.assetStatus?.available;
      if (searchable && total != null) count.textContent = `${fullList.length.toLocaleString()} matched / ${Number(total).toLocaleString()} • ${list.length.toLocaleString()} rendered`;
      else count.textContent = `${fullList.length.toLocaleString()} items`;
    }
    observeMaterialThumbs(grid);
    renderAssetStatus();
  };
  window.renderAssets = renderAssets;

  function activateAssets() {
    if (userActivated) return;
    userActivated = true;
    queueAssetSearch(true);
  }

  installStyles();
  installTabs();
  const search = document.getElementById('assetSearch');
  search?.addEventListener('focus', activateAssets, { once: true });
  search?.addEventListener('input', () => { userActivated = true; queueAssetSearch(false); });
  document.getElementById('assetGrid')?.addEventListener('pointerenter', activateAssets, { once: true, passive: true });

  S.assetTotal = totalForTab(S.assetTab);
  if (S.assetTab === 'materials') S.assetItems = [...CORE_MATERIALS];
  renderAssetStatus();
  renderAssets();

  window.addEventListener('eph-runtime-ready', () => {
    installTabs();
    renderAssetStatus();
  }, { once: true });

  console.info('[Asset Manager V24] Faster material search, visible-first thumbnail decoding and bounded asset rendering enabled.');
})();