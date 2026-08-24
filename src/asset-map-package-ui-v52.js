// byanca
(() => {
  'use strict';
  if (window.__ephAssetMapPackageUiV52) return;
  window.__ephAssetMapPackageUiV52 = true;

  const sourceKind = source => {
    const value = String(source || '').toLowerCase();
    if (value.startsWith('map-vpk:')) return { tag: 'MAP', label: 'Official map VPK' };
    if (value.startsWith('addon-vpk:')) return { tag: 'ADDON', label: 'Compiled addon VPK' };
    if (value.startsWith('workshop-vpk:')) return { tag: 'WS', label: 'Workshop map VPK' };
    return null;
  };

  function installStyle() {
    if (document.getElementById('ephAssetMapPackageUiV52Style')) return;
    const style = document.createElement('style');
    style.id = 'ephAssetMapPackageUiV52Style';
    style.textContent = `
      #assetGrid .asset-card.eph-map-package-asset .asset-thumb{position:relative;}
      #assetGrid .asset-card.eph-map-package-asset .asset-thumb::after{
        content:attr(data-source-tag);position:absolute;right:3px;bottom:3px;padding:1px 4px;
        border-radius:3px;background:rgba(0,0,0,.72);color:#ffd84d;font-size:8px;font-weight:700;
        line-height:12px;letter-spacing:.2px;pointer-events:none;
      }
    `;
    document.head.appendChild(style);
  }

  function decorateAssets() {
    const search = document.getElementById('assetSearch');
    if (search) search.placeholder = 'Search assets or map name…';
    const grid = document.getElementById('assetGrid');
    if (!grid) return;
    for (const card of grid.querySelectorAll('.asset-card[data-i]')) {
      const item = S?.assetItems?.[Number(card.dataset.i)];
      const kind = sourceKind(item?.source);
      card.classList.toggle('eph-map-package-asset', Boolean(kind));
      const thumb = card.querySelector('.asset-thumb');
      if (thumb) {
        if (kind) thumb.dataset.sourceTag = kind.tag;
        else delete thumb.dataset.sourceTag;
      }
      if (item) {
        const base = String(item.path || item.model || item.className || '');
        card.title = kind ? `${base}\n${kind.label}: ${item.source}` : base;
      }
    }
  }

  function decorateStatus() {
    const status = S?.assetStatus;
    const element = document.getElementById('assetSourceStatus');
    if (!status?.available || !element) return;
    const embedded = Number(status.mapEmbeddedAssetCount || 0);
    const packages = Number(status.indexedMapPackageCount || 0);
    if (!embedded && !packages) return;
    const suffix = ` • +${embedded.toLocaleString()} map assets / ${packages.toLocaleString()} map VPKs`;
    const oldSuffix = /\s•\s\+[\d,.]+ map assets \/ [\d,.]+ map VPKs$/;
    element.textContent = `${element.textContent.replace(oldSuffix, '')}${suffix}`;
    element.title = `Official map VPKs: ${Number(status.officialMapPackageCount || 0).toLocaleString()}\nAddon VPKs: ${Number(status.addonPackageCount || 0).toLocaleString()}\nWorkshop VPKs: ${Number(status.workshopPackageCount || 0).toLocaleString()}\nDeep-index cache: ${status.deepIndexCacheHit ? 'hit' : 'rebuilt'} (${Number(status.deepScanMilliseconds || 0).toLocaleString()} ms)`;
  }

  installStyle();

  if (typeof renderAssets === 'function' && !renderAssets.__ephMapPackageUiV52) {
    const raw = renderAssets;
    const wrapped = function(...args) {
      const result = raw.apply(this, args);
      decorateAssets();
      return result;
    };
    wrapped.__ephMapPackageUiV52 = true;
    wrapped.__ephPrevious = raw;
    renderAssets = wrapped;
    window.renderAssets = wrapped;
  }

  if (typeof renderAssetStatus === 'function' && !renderAssetStatus.__ephMapPackageUiV52) {
    const raw = renderAssetStatus;
    const wrapped = function(...args) {
      const result = raw.apply(this, args);
      decorateStatus();
      return result;
    };
    wrapped.__ephMapPackageUiV52 = true;
    wrapped.__ephPrevious = raw;
    renderAssetStatus = wrapped;
    window.renderAssetStatus = wrapped;
  }

  decorateAssets();
  decorateStatus();
  console.info('[Asset Map Packages V52] Map/addon/workshop VPK assets are labeled and searchable by package/map name.');
})();
