// byanca
(() => {
  const applyViewportTheme = viewport => {
    if (!viewport) return;
    if (viewport.scene?.background?.set) viewport.scene.background.set(0x17181b);
    if (viewport.gridHelper?.material) {
      viewport.gridHelper.material.opacity = 0.28;
      viewport.gridHelper.material.transparent = true;
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

  const previewCache = new Map();
  const previewPending = new Map();
  let thumbObserver = null;

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

  async function hydrateMaterialThumb(thumb, item) {
    if (!thumb?.isConnected || thumb.dataset.loading === '1') return;
    thumb.dataset.loading = '1';
    const url = await materialPreviewUrl(item);
    if (!thumb.isConnected) return;

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
      if (!thumb.isConnected) return;
      thumb.replaceChildren(image);
      thumb.classList.add('real-thumb');
      thumb.classList.remove('preview-unavailable');
      thumb.dataset.loading = '0';
    };
    image.onerror = () => {
      previewCache.delete(item.path);
      if (!thumb.isConnected) return;
      thumb.classList.add('preview-unavailable');
      thumb.dataset.loading = '0';
    };
    image.src = url;
  }

  function watchMaterialThumbs(list) {
    thumbObserver?.disconnect();
    const grid = $('assetGrid');
    if (!grid) return;
    thumbObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const thumb = entry.target;
        const item = list[Number(thumb.dataset.thumb)];
        thumbObserver.unobserve(thumb);
        hydrateMaterialThumb(thumb, item);
      }
    }, { root: grid, rootMargin: '350px 0px', threshold: 0.01 });
    grid.querySelectorAll('.asset-thumb[data-thumb]').forEach(thumb => thumbObserver.observe(thumb));
  }

  searchAssets = async function() {
    const seq = ++S.assetQuerySeq;
    const query = $('assetSearch')?.value?.trim() || '';
    if (S.assetTab === 'entities') {
      S.assetItems = ENTITIES.filter(x => `${x.name} ${x.className}`.toLowerCase().includes(query.toLowerCase()));
      return renderAssets();
    }
    if (!S.assetStatus?.available) {
      S.assetItems = S.assetTab === 'materials' ? CORE_MATERIALS.filter(x => `${x.name} ${x.path}`.toLowerCase().includes(query.toLowerCase())) : [];
      return renderAssets();
    }

    const kind = S.assetTab === 'materials' ? 'material' : 'model';
    const result = await api.searchAssets(kind, query, 800);
    if (seq !== S.assetQuerySeq) return;
    let items = result?.ok ? result.items || [] : [];
    if (S.assetTab === 'materials') {
      const seen = new Set(items.map(x => x.path.toLowerCase()));
      const core = CORE_MATERIALS
        .filter(x => !query || `${x.name} ${x.path}`.toLowerCase().includes(query.toLowerCase()))
        .filter(x => !seen.has(x.path.toLowerCase()));
      items = [...core, ...items];
    }
    if (S.assetTab === 'props') items = items.map(x => ({ ...x, kind: 'prop', className: 'prop_static', model: x.path }));
    S.assetItems = items;
    renderAssets();
  };

  renderAssets = function() {
    document.querySelectorAll('#assetTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.assetTab));
    const list = S.assetItems || [];
    const grid = $('assetGrid');
    grid.innerHTML = list.map((x, i) => `<button class="asset-card" data-i="${i}" title="${esc(x.path || x.className || x.model || '')}"><div class="asset-thumb" data-thumb="${i}">${S.assetTab === 'materials' ? 'MAT' : S.assetTab === 'entities' ? 'ENT' : S.assetTab === 'props' ? 'PROP' : 'MDL'}</div><div class="asset-name">${esc(x.name)}</div></button>`).join('');
    $('assetCount').textContent = `${list.length}${S.assetStatus?.available && ['materials', 'models', 'props'].includes(S.assetTab) ? ' shown' : ' items'}`;

    grid.querySelectorAll('.asset-card').forEach(card => {
      const item = list[Number(card.dataset.i)];
      card.onclick = () => {
        grid.querySelectorAll('.asset-card').forEach(x => x.classList.remove('selected'));
        card.classList.add('selected');
        if (S.assetTab === 'materials' && current()?.type === 'part') applyMaterial(item.path);
      };
      card.ondblclick = () => {
        if (S.assetTab === 'entities') addEntity(item);
        else if (['props', 'models'].includes(S.assetTab)) addProp(item);
      };
    });

    if (S.assetTab === 'materials') watchMaterialThumbs(list);
    else thumbObserver?.disconnect();
    renderAssetStatus();
  };

  window.addEventListener('eph3d-ready', event => applyViewportTheme(event.detail));
  if (window.EPH3D) applyViewportTheme(window.EPH3D);
  setTimeout(() => applyViewportTheme(window.EPH3D), 250);
  installWindowChrome();
})();
