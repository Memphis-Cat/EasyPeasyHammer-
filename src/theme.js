// byanca
(() => {
  const uiFixes = document.createElement('link');
  uiFixes.rel = 'stylesheet';
  uiFixes.href = 'ui-fixes.css';
  document.head.appendChild(uiFixes);

  const setBundledIcon = (img, key) => {
    if (!img) return;
    const bundled = window.EPH_ICONS?.[key];
    img.src = bundled || key;
  };

  function correctViewportIcons() {
    const buttons = [...document.querySelectorAll('.viewport-top-right .viewport-icon')];
    setBundledIcon(buttons[0]?.querySelector('img'), '../assets/icons/view_toolbar/view_grid_03.png');
    setBundledIcon(buttons[1]?.querySelector('img'), '../assets/icons/viewport/viewport_grid.png');
    setBundledIcon(buttons[2]?.querySelector('img'), '../assets/icons/viewport/viewport_more.png');
    setBundledIcon(document.querySelector('#gridButton img'), '../assets/icons/viewport/viewport_grid_mode.png');
  }

  const compatibleMaterialCache = new Map();

  function baseNameNoExt(value) {
    const clean = String(value || '').replace(/\\/g, '/');
    const name = clean.slice(clean.lastIndexOf('/') + 1);
    return name.replace(/\.(vmdl|vmat|vtex)$/i, '').toLowerCase();
  }

  function parentPath(value) {
    const clean = String(value || '').replace(/\\/g, '/').toLowerCase();
    const i = clean.lastIndexOf('/');
    return i < 0 ? '' : clean.slice(0, i);
  }

  async function findCompatibleMaterial(modelPath) {
    if (!modelPath || !api?.searchAssets) return null;
    if (compatibleMaterialCache.has(modelPath)) return compatibleMaterialCache.get(modelPath);

    const pending = (async () => {
      const stem = baseNameNoExt(modelPath);
      if (!stem) return null;
      try {
        const result = await api.searchAssets('material', stem, 48);
        if (!result?.ok || !Array.isArray(result.items) || !result.items.length) return null;
        const modelDir = parentPath(modelPath);
        let best = null;
        let bestScore = -1;
        for (const item of result.items) {
          const matStem = baseNameNoExt(item.path);
          const matDir = parentPath(item.path);
          let score = 0;
          if (matStem === stem) score += 120;
          else if (matStem.startsWith(stem) || stem.startsWith(matStem)) score += 65;
          else if (matStem.includes(stem) || stem.includes(matStem)) score += 38;
          if (modelDir && matDir === modelDir) score += 45;
          else if (modelDir && matDir && (matDir.startsWith(modelDir) || modelDir.startsWith(matDir))) score += 22;
          if (score > bestScore) { best = item; bestScore = score; }
        }
        return bestScore >= 60 ? best : null;
      } catch {
        return null;
      }
    })();

    compatibleMaterialCache.set(modelPath, pending);
    return pending;
  }

  const applyViewportTheme = viewport => {
    if (!viewport) return;
    if (viewport.scene?.background?.set) viewport.scene.background.set(0x17181b);
    if (viewport.gridHelper?.material) {
      viewport.gridHelper.material.opacity = 0.28;
      viewport.gridHelper.material.transparent = true;
    }

    if (!viewport.__ephMaterialResolverPatched && typeof viewport.loadModel === 'function') {
      viewport.__ephMaterialResolverPatched = true;
      const originalLoadModel = viewport.loadModel.bind(viewport);
      viewport.loadModel = async resource => {
        const materialPromise = findCompatibleMaterial(resource);
        const data = await originalLoadModel(resource);
        if (!data || data.__ephCompatibleMaterialChecked) return data;
        data.__ephCompatibleMaterialChecked = true;

        const missingMaps = [];
        data.scene?.traverse?.(child => {
          if (!child.isMesh || !child.material) return;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) if (material && !material.map) missingMaps.push(material);
        });
        if (!missingMaps.length) return data;

        const compatible = await materialPromise;
        if (!compatible?.path || typeof viewport.loadMaterialTexture !== 'function') return data;
        const texture = await viewport.loadMaterialTexture(compatible.path);
        if (!texture) return data;
        for (const material of missingMaps) {
          material.map = texture;
          material.color?.set?.(0xffffff);
          material.needsUpdate = true;
        }
        data.compatibleMaterial = compatible.path;
        return data;
      };
    }
  };

  function installWindowChrome() {
    if (document.getElementById('ephWindowChrome')) return;
    const chrome = document.createElement('div');
    chrome.id = 'ephWindowChrome';
    chrome.innerHTML = `
      <div class="eph-window-drag">
        <span class="eph-window-mark">◈</span>
        <span class="eph-window-title">EasyPeasyHammer</span>
      </div>
      <div class="eph-window-controls">
        <button id="ephMinimize" type="button" aria-label="Minimize">—</button>
        <button id="ephMaximize" type="button" aria-label="Maximize">□</button>
        <button id="ephClose" class="close" type="button" aria-label="Close">×</button>
      </div>`;
    document.body.prepend(chrome);

    const appApi = window.easyPeasyHammer;
    const max = document.getElementById('ephMaximize');
    const updateMax = async state => {
      const maximized = typeof state === 'boolean' ? state : await appApi.windowIsMaximized?.();
      max.textContent = maximized ? '❐' : '□';
      max.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
    };

    document.getElementById('ephMinimize').onclick = () => appApi.windowMinimize?.();
    max.onclick = async () => updateMax(await appApi.windowToggleMaximize?.());
    document.getElementById('ephClose').onclick = () => appApi.windowClose?.();
    chrome.querySelector('.eph-window-drag').ondblclick = async () => updateMax(await appApi.windowToggleMaximize?.());
    window.addEventListener('resize', () => updateMax());
    updateMax();
  }

  function installInteractionFixes() {
    window.addEventListener('keydown', event => {
      const editable = event.target?.closest?.('input, textarea, [contenteditable="true"]');
      if (!editable || !(event.ctrlKey || event.metaKey)) return;
      if (['z', 'y', 'd'].includes(event.key.toLowerCase())) event.stopImmediatePropagation();
    }, true);

    const viewportButtons = [...document.querySelectorAll('.viewport-top-right .viewport-icon')];
    if (viewportButtons[0]) {
      viewportButtons[0].title = 'Frame all objects';
      viewportButtons[0].onclick = () => S.viewport?.frameAll?.();
    }
    if (viewportButtons[1]) {
      viewportButtons[1].title = 'Toggle grid';
      viewportButtons[1].onclick = () => { S.grid = !S.grid; renderViewportControls(); };
    }
    if (viewportButtons[2]) {
      viewportButtons[2].title = 'More viewport options / toggle wireframe';
      viewportButtons[2].onclick = () => { S.shading = S.shading === 'Lit' ? 'Wireframe' : 'Lit'; renderViewportControls(); };
    }
  }

  const previewCache = new Map();
  const previewPending = new Map();
  const searchCache = new Map();
  const thumbQueue = [];
  let thumbObserver = null;
  let thumbWorkerRunning = false;
  let thumbGeneration = 0;
  let previewPauseUntil = 0;
  let fastSearchTimer = null;
  let lastAssetRenderKey = '';

  async function materialPreviewUrl(item) {
    if (!item?.path || item.path === 'ERROR') return null;
    if (previewCache.has(item.path)) return previewCache.get(item.path);
    if (previewPending.has(item.path)) return previewPending.get(item.path);

    const pending = (async () => {
      try {
        const result = await api.materialPreview(item.path);
        if (!result?.ok || !result.url) return null;
        previewCache.set(item.path, result.url);
        return result.url;
      } catch {
        return null;
      } finally {
        previewPending.delete(item.path);
      }
    })();
    previewPending.set(item.path, pending);
    return pending;
  }

  async function hydrateMaterialThumb(thumb, item, generation) {
    if (!thumb?.isConnected || generation !== thumbGeneration) return;
    thumb.dataset.loading = '1';
    const url = await materialPreviewUrl(item);
    if (!thumb.isConnected || generation !== thumbGeneration) return;

    if (!url) {
      thumb.dataset.loading = '0';
      thumb.classList.add('preview-unavailable');
      thumb.title = 'This material has no previewable color texture';
      return;
    }

    const image = new Image();
    image.className = 'asset-thumb-image';
    image.alt = '';
    image.decoding = 'async';
    image.onload = () => {
      if (!thumb.isConnected || generation !== thumbGeneration) return;
      thumb.replaceChildren(image);
      thumb.classList.add('real-thumb');
      thumb.classList.remove('preview-unavailable');
      thumb.dataset.loading = '0';
    };
    image.onerror = () => {
      previewCache.delete(item.path);
      if (!thumb.isConnected || generation !== thumbGeneration) return;
      thumb.classList.add('preview-unavailable');
      thumb.dataset.loading = '0';
    };
    image.src = url;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function pumpThumbQueue() {
    if (thumbWorkerRunning) return;
    thumbWorkerRunning = true;
    while (thumbQueue.length) {
      const wait = previewPauseUntil - performance.now();
      if (wait > 0) await sleep(Math.min(wait, 120));
      const job = thumbQueue.shift();
      if (!job || job.generation !== thumbGeneration || !job.thumb.isConnected) continue;
      await hydrateMaterialThumb(job.thumb, job.item, job.generation);
      await sleep(1);
    }
    thumbWorkerRunning = false;
  }

  function watchMaterialThumbs(list) {
    thumbObserver?.disconnect();
    thumbQueue.length = 0;
    const generation = ++thumbGeneration;
    const grid = $('assetGrid');
    if (!grid) return;
    thumbObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const thumb = entry.target;
        const item = list[Number(thumb.dataset.thumb)];
        thumbObserver.unobserve(thumb);
        if (item) thumbQueue.push({ thumb, item, generation });
      }
      pumpThumbQueue();
    }, { root: grid, rootMargin: '220px 0px', threshold: 0.01 });
    grid.querySelectorAll('.asset-thumb[data-thumb]').forEach(thumb => thumbObserver.observe(thumb));
  }

  function normalizeSearchItems(items, tab, query) {
    let result = Array.isArray(items) ? items : [];
    if (tab === 'materials') {
      const seen = new Set(result.map(x => String(x.path || '').toLowerCase()));
      const core = CORE_MATERIALS
        .filter(x => !query || `${x.name} ${x.path}`.toLowerCase().includes(query))
        .filter(x => !seen.has(x.path.toLowerCase()));
      result = [...core, ...result];
    }
    if (tab === 'props') result = result.map(x => ({ ...x, kind: 'prop', className: 'prop_static', model: x.path }));
    return result;
  }

  function locallyFilter(items, query) {
    const words = query.split(/\s+/).filter(Boolean);
    if (!words.length) return items;
    return items.filter(item => {
      const haystack = `${item.name || ''} ${item.path || ''} ${item.className || ''}`.toLowerCase();
      return words.every(word => haystack.includes(word));
    });
  }

  queueAssetSearch = function(immediate = false) {
    clearTimeout(fastSearchTimer);
    previewPauseUntil = performance.now() + 160;
    thumbQueue.length = 0;
    thumbGeneration++;
    fastSearchTimer = setTimeout(searchAssets, immediate ? 0 : 55);
  };

  searchAssets = async function() {
    const seq = ++S.assetQuerySeq;
    const tab = S.assetTab;
    const query = ($('assetSearch')?.value?.trim() || '').toLowerCase();
    previewPauseUntil = performance.now() + 120;

    if (tab === 'entities') {
      S.assetItems = ENTITIES.filter(x => `${x.name} ${x.className}`.toLowerCase().includes(query));
      return renderAssets();
    }
    if (!S.assetStatus?.available) {
      S.assetItems = tab === 'materials' ? CORE_MATERIALS.filter(x => `${x.name} ${x.path}`.toLowerCase().includes(query)) : [];
      return renderAssets();
    }

    const key = `${tab}|${query}`;
    if (searchCache.has(key)) {
      S.assetItems = searchCache.get(key);
      renderAssets();
      return;
    }

    let provisional = null;
    let provisionalLength = -1;
    for (const [cachedKey, cachedItems] of searchCache) {
      const split = cachedKey.indexOf('|');
      const cachedTab = cachedKey.slice(0, split);
      const cachedQuery = cachedKey.slice(split + 1);
      if (cachedTab !== tab || !query.startsWith(cachedQuery) || cachedQuery.length <= provisionalLength) continue;
      provisional = locallyFilter(cachedItems, query);
      provisionalLength = cachedQuery.length;
    }
    if (provisional) {
      S.assetItems = provisional;
      renderAssets();
    }

    const kind = tab === 'materials' ? 'material' : 'model';
    const result = await api.searchAssets(kind, query, 800);
    if (seq !== S.assetQuerySeq || tab !== S.assetTab) return;
    const items = normalizeSearchItems(result?.ok ? result.items || [] : [], tab, query);
    searchCache.set(key, items);
    if (searchCache.size > 80) searchCache.delete(searchCache.keys().next().value);
    S.assetItems = items;
    renderAssets();
  };

  const originalAddProp = addProp;
  addProp = function(item) {
    const model = item?.model || item?.path || '';
    if (model) S.viewport?.loadModel?.(model);
    return originalAddProp(item);
  };

  renderAssets = function() {
    document.querySelectorAll('#assetTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.assetTab));
    const list = S.assetItems || [];
    const grid = $('assetGrid');
    const renderKey = `${S.assetTab}|${$('assetSearch')?.value || ''}`;
    const oldScroll = renderKey === lastAssetRenderKey ? grid.scrollTop : 0;
    grid.innerHTML = list.map((x, i) => `<button class="asset-card" data-i="${i}" title="${esc(x.path || x.className || x.model || '')}"><div class="asset-thumb" data-thumb="${i}">${S.assetTab === 'materials' ? 'MAT' : S.assetTab === 'entities' ? 'ENT' : S.assetTab === 'props' ? 'PROP' : 'MDL'}</div><div class="asset-name">${esc(x.name)}</div></button>`).join('');
    grid.scrollTop = oldScroll;
    lastAssetRenderKey = renderKey;
    $('assetCount').textContent = `${list.length}${S.assetStatus?.available && ['materials', 'models', 'props'].includes(S.assetTab) ? ' shown' : ' items'}`;

    grid.querySelectorAll('.asset-card').forEach(card => {
      const item = list[Number(card.dataset.i)];
      card.onclick = () => {
        grid.querySelectorAll('.asset-card').forEach(x => x.classList.remove('selected'));
        card.classList.add('selected');
        if (S.assetTab === 'materials' && current()?.type === 'part') applyMaterial(item.path);
      };
      card.onpointerdown = () => {
        if (['props', 'models'].includes(S.assetTab)) {
          const model = item?.model || item?.path || '';
          if (model) S.viewport?.loadModel?.(model);
        }
      };
      card.ondblclick = () => {
        if (S.assetTab === 'entities') addEntity(item);
        else if (['props', 'models'].includes(S.assetTab)) addProp(item);
      };
    });

    if (S.assetTab === 'materials') watchMaterialThumbs(list);
    else {
      thumbObserver?.disconnect();
      thumbQueue.length = 0;
      thumbGeneration++;
    }
    renderAssetStatus();
  };

  window.addEventListener('eph3d-ready', event => applyViewportTheme(event.detail));
  if (window.EPH3D) applyViewportTheme(window.EPH3D);
  setTimeout(() => applyViewportTheme(window.EPH3D), 250);
  correctViewportIcons();
  installWindowChrome();
  installInteractionFixes();
})();
