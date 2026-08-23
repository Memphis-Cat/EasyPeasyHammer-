// byanca
(() => {
  'use strict';

  if (window.__ephLargeMapSpatialV19) return;
  window.__ephLargeMapSpatialV19 = true;

  const api = window.easyPeasyHammer;
  let lastStream = null;
  let lastHealth = '';
  let lastHealthAt = 0;

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
    const stream = window.EPH_LARGE_STREAM;
    if (!stream?.open) return false;
    if (stream === lastStream && stream.open.__ephSpatialV19) return true;
    if (stream.open.__ephSpatialV19) { lastStream = stream; return true; }

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
            log(fixed.bounded ? 'normal' : 'error', `Using real mesh bounds for ${fixed.bounded.toLocaleString()} streamed meshes.`, {
              indexed: fixed.entries.length,
              bounded: fixed.bounded,
              meshCount: spatial.meshCount,
              cached: Boolean(spatial.cached),
              elapsedMs: Math.round(performance.now() - started),
            });
          } else {
            log('warning', 'Spatial index unavailable; continuing with conservative fallback.', { error: spatial?.error || 'unknown error' });
          }
        } catch (error) {
          log('error', 'Could not build streamed-map spatial index.', error?.stack || error?.message || String(error));
        }
      }
      return rawOpen(rawLoad, project, prepared, ui);
    };
    stream.open.__ephSpatialV19 = true;
    stream.open.__ephSpatialRawOpen = rawOpen;
    lastStream = stream;
    log('normal', 'Spatial culling wrapper attached to large-map streamer.');
    return true;
  }

  function health() {
    if (!window.EPH_LARGE_STREAM?.active?.()) return;
    const state = window.EPH_LARGE_STREAM.state?.() || {};
    const signature = `${state.loaded || 0}/${state.entries || 0}/${state.pending || 0}`;
    const now = Date.now();
    if (signature === lastHealth && now - lastHealthAt < 30000) return;
    lastHealth = signature;
    lastHealthAt = now;
    const resident = Number(state.loaded || 0);
    const indexed = Number(state.entries || 0);
    const pending = Number(state.pending || 0);
    const level = indexed > 1000 && resident <= 1 && pending === 0 ? 'warning' : 'normal';
    log(level, `Stream health: ${resident.toLocaleString()} resident / ${indexed.toLocaleString()} indexed (${pending.toLocaleString()} pending).`, {
      selectedId: typeof S !== 'undefined' ? S?.selectedId || null : null,
      camera: typeof S !== 'undefined' && S?.viewport?.camera ? S.viewport.camera.position.toArray().map(value => Number(value.toFixed(1))) : null,
    });
  }

  install();
  // The streamer arrives asynchronously, but it only needs a few bounded
  // startup attempts. The old forever 500 ms attach loop kept waking even after
  // the wrapper had already been installed.
  [250, 750, 1500, 3000, 5000].forEach(delay => setTimeout(install, delay));
  const healthTimer = setInterval(health, 10000);
  healthTimer.unref?.();
  window.addEventListener('eph3d-ready', install, { once: true });
})();
