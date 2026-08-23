// byanca
(() => {
  'use strict';

  if (window.__ephLargeMapSpatialV19) return;
  window.__ephLargeMapSpatialV19 = true;

  const api = window.easyPeasyHammer;
  let installed = false;

  function log(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Large Map Spatial] ${message}`, meta || '');
    api?.appLog?.(level, 'large-map-spatial', message, meta).catch?.(() => {});
  }

  function withSpatialPositions(entries) {
    let bounded = 0;
    const output = (Array.isArray(entries) ? entries : []).map(entry => {
      if (entry?.type !== 'mesh' || !Array.isArray(entry.spatialPosition) || !Number.isFinite(Number(entry.spatialRadius))) return entry;
      bounded++;
      return {
        ...entry,
        sourcePosition: Array.isArray(entry.position) ? [...entry.position] : [0, 0, 0],
        position: [...entry.spatialPosition],
        approxRadius: Math.max(4, Number(entry.spatialRadius)),
        ephSpatialIndexed: true,
      };
    });
    return { entries: output, bounded };
  }

  function install() {
    if (installed) return true;
    const stream = window.EPH_LARGE_STREAM;
    if (!stream?.open || stream.open.__ephSpatialV19) return false;

    const rawOpen = stream.open.bind(stream);
    stream.open = async function(rawLoad, project, decoded, ui) {
      let prepared = decoded;
      const token = decoded?.largeMapToken;
      if (token && api?.largeMapSpatialIndex) {
        const started = performance.now();
        try {
          const spatial = await api.largeMapSpatialIndex(token);
          if (spatial?.ok && Array.isArray(spatial.entries)) {
            const fixed = withSpatialPositions(spatial.entries);
            prepared = { ...decoded, largeMapEntries: fixed.entries, ephSpatialIndex: true };
            log('normal', `Using real mesh bounds for ${fixed.bounded.toLocaleString()} streamed meshes.`, {
              indexed: fixed.entries.length,
              bounded: fixed.bounded,
              cached: Boolean(spatial.cached),
              elapsedMs: Math.round(performance.now() - started),
            });
          } else {
            log('warning', `Spatial index unavailable; continuing with conservative fallback.`, { error: spatial?.error || 'unknown error' });
          }
        } catch (error) {
          log('error', 'Could not build streamed-map spatial index.', error?.stack || error?.message || String(error));
        }
      }
      return rawOpen(rawLoad, project, prepared, ui);
    };
    stream.open.__ephSpatialV19 = true;
    installed = true;
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => {
      if (install()) clearInterval(timer);
    }, 100);
    setTimeout(() => clearInterval(timer), 15000);
    window.addEventListener('eph3d-ready', install);
  }
})();
