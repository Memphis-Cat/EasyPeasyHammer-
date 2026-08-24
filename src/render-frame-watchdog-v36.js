// byanca
(() => {
  'use strict';
  if (window.__ephRenderFrameWatchdogV36) return;
  window.__ephRenderFrameWatchdogV36 = true;

  const api = window.easyPeasyHammer;
  let installedViewport = null;
  let wrappedLoadProject = null;
  let lastFrame = -1;
  let lastCheck = 0;
  let stalledChecks = 0;
  let forcing = false;

  function report(level, message, meta = null) {
    const method = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info';
    console[method](`[Render Frame V36] ${message}`, meta || '');
    try { api?.appLog?.(level, 'render-frame-v36', message, meta)?.catch?.(() => {}); } catch {}
  }

  function viewportNow() {
    return (typeof S !== 'undefined' ? S?.viewport : null) || window.EPH3D || null;
  }

  function editorVisible() {
    const editor = document.getElementById('editorScreen');
    return Boolean(editor && !editor.classList.contains('hidden'));
  }

  function normalMap() {
    return !window.EPH_LARGE_STREAM?.active?.();
  }

  function renderableRoots(viewport) {
    if (!viewport?.objectRoots) return 0;
    let count = 0;
    for (const root of viewport.objectRoots.values()) if (root?.visible !== false) count++;
    return count;
  }

  function resetWebglState(viewport, width, height) {
    const renderer = viewport?.renderer;
    if (!renderer) return false;
    try {
      // A stale render target/scissor/raw GL state can increment Three's frame
      // counter while every draw goes somewhere other than the visible canvas.
      // Always restore the default framebuffer before a recovery render.
      renderer.setRenderTarget?.(null);
      renderer.setScissorTest?.(false);
      renderer.state?.reset?.();
      renderer.resetState?.();
      renderer.setViewport?.(0, 0, width, height);
      renderer.autoClear = true;
      renderer.setClearColor?.(0x111318, 1);
      return true;
    } catch (error) {
      report('error', 'Could not reset visible WebGL framebuffer state.', error?.stack || error?.message || String(error));
      return false;
    }
  }

  function stabilizeRenderer(viewport) {
    if (!viewport?.renderer || !viewport?.camera || !viewport?.scene || !viewport?.container) return false;
    window.EPH_VIEWPORT_LAYOUT?.repair?.();
    window.EPH_RENDER_INTEGRITY?.reconcile?.();

    const width = Math.max(1, Math.floor(viewport.container.clientWidth || viewport.container.getBoundingClientRect?.().width || 1));
    const height = Math.max(1, Math.floor(viewport.container.clientHeight || viewport.container.getBoundingClientRect?.().height || 1));
    const canvas = viewport.renderer.domElement;
    if (width < 2 || height < 2 || !canvas) return false;

    canvas.style.setProperty('display', 'block', 'important');
    canvas.style.setProperty('visibility', 'visible', 'important');
    canvas.style.setProperty('opacity', '1', 'important');
    canvas.style.setProperty('width', '100%', 'important');
    canvas.style.setProperty('height', '100%', 'important');

    try {
      if (canvas.width < 2 || canvas.height < 2) viewport.renderer.setSize(width, height, false);
    } catch (error) {
      report('error', 'Could not restore the WebGL canvas size.', error?.stack || error?.message || String(error));
      return false;
    }
    if (!resetWebglState(viewport, width, height)) return false;

    viewport.scene.visible = true;
    viewport.scene.overrideMaterial = null;
    if (viewport.objectGroup) viewport.objectGroup.visible = true;
    if (viewport.editGroup) viewport.editGroup.visible = true;
    if (viewport.gridHelper) viewport.gridHelper.visible = typeof S === 'undefined' ? true : S.grid !== false;
    viewport.camera.aspect = width / height;
    viewport.camera.near = 0.1;
    viewport.camera.far = Math.max(500000, Number(viewport.camera.far) || 0);
    viewport.camera.layers?.enable?.(0);
    viewport.camera.updateProjectionMatrix();
    viewport.camera.updateMatrixWorld?.(true);
    viewport.scene.updateMatrixWorld?.(true);
    return true;
  }

  function framebufferSample(viewport) {
    const renderer = viewport?.renderer;
    const canvas = renderer?.domElement;
    const gl = renderer?.getContext?.();
    if (!gl || !canvas || canvas.width < 1 || canvas.height < 1 || gl.isContextLost?.()) return null;
    try {
      const pixel = new Uint8Array(4);
      const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(canvas.width / 2)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height / 2)));
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    } catch {
      return null;
    }
  }

  function visiblePixel(sample) {
    return Array.isArray(sample) && sample.length >= 4 && (sample[0] > 0 || sample[1] > 0 || sample[2] > 0) && sample[3] > 0;
  }

  function forceFrame(reason = 'manual', allowFrameFallback = false) {
    const viewport = viewportNow();
    if (!viewport || forcing || !editorVisible()) return null;
    forcing = true;
    try {
      if (!stabilizeRenderer(viewport)) return null;
      viewport.renderer.render(viewport.scene, viewport.camera);
      let info = viewport.renderer.info?.render || {};
      let pixel = framebufferSample(viewport);

      // Root-count checks can say everything is healthy while the camera draws
      // zero calls. On a normal map, frame the scene once only when a forced
      // render proves that absolutely nothing is in the drawable frustum.
      if (allowFrameFallback && normalMap() && renderableRoots(viewport) > 0 && Number(info.calls || 0) === 0) {
        viewport.frameAll?.();
        viewport.camera.updateMatrixWorld?.(true);
        viewport.scene.updateMatrixWorld?.(true);
        resetWebglState(viewport, Math.max(1, viewport.container.clientWidth), Math.max(1, viewport.container.clientHeight));
        viewport.renderer.render(viewport.scene, viewport.camera);
        info = viewport.renderer.info?.render || {};
        pixel = framebufferSample(viewport);
        report('warning', 'No draw calls were visible after project load; framed the map and rendered again.', {
          reason,
          roots: renderableRoots(viewport),
          calls: Number(info.calls || 0),
          triangles: Number(info.triangles || 0),
          pixel,
        });
      }

      // The clear color is intentionally charcoal, so [0,0,0,0/255] after a
      // render means the visible default framebuffer still was not updated.
      // Reset raw renderer state once more and prove the visible buffer changed.
      if (!visiblePixel(pixel)) {
        const width = Math.max(1, Math.floor(viewport.container.clientWidth || 1));
        const height = Math.max(1, Math.floor(viewport.container.clientHeight || 1));
        resetWebglState(viewport, width, height);
        viewport.renderer.clear?.(true, true, true);
        viewport.renderer.render(viewport.scene, viewport.camera);
        info = viewport.renderer.info?.render || {};
        pixel = framebufferSample(viewport);
        report(visiblePixel(pixel) ? 'warning' : 'error', visiblePixel(pixel)
          ? 'Recovered a black/default framebuffer by resetting WebGL state.'
          : 'Visible WebGL framebuffer remained black after forced recovery.', {
          reason,
          calls: Number(info.calls || 0),
          triangles: Number(info.triangles || 0),
          roots: renderableRoots(viewport),
          pixel,
        });
      }

      lastFrame = Number(viewport.renderer.info?.render?.frame ?? lastFrame);
      stalledChecks = 0;
      return {
        frame: lastFrame,
        calls: Number(viewport.renderer.info?.render?.calls || 0),
        triangles: Number(viewport.renderer.info?.render?.triangles || 0),
        points: Number(viewport.renderer.info?.render?.points || 0),
        lines: Number(viewport.renderer.info?.render?.lines || 0),
        roots: renderableRoots(viewport),
        canvas: [viewport.renderer.domElement.width || 0, viewport.renderer.domElement.height || 0],
        pixel,
        framebufferVisible: visiblePixel(pixel),
      };
    } catch (error) {
      report('error', 'Forced WebGL frame failed.', { reason, error: error?.stack || error?.message || String(error) });
      return null;
    } finally {
      forcing = false;
    }
  }

  function scheduleFrame(reason) {
    requestAnimationFrame(() => requestAnimationFrame(() => forceFrame(reason, false)));
  }

  function installViewport(viewport = viewportNow()) {
    if (!viewport?.renderer?.domElement || !viewport?.scene || !viewport?.camera) return false;
    if (installedViewport === viewport && viewport.__ephRenderFrameV36) return true;
    installedViewport = viewport;
    if (viewport.__ephRenderFrameV36) return true;
    viewport.__ephRenderFrameV36 = true;

    const rawSet = viewport.setObjects?.bind(viewport);
    if (rawSet) viewport.setObjects = function(...args) {
      const result = rawSet(...args);
      scheduleFrame('setObjects');
      return result;
    };

    const rawUpdate = viewport.updateObject?.bind(viewport);
    if (rawUpdate) viewport.updateObject = function(...args) {
      const result = rawUpdate(...args);
      scheduleFrame('updateObject');
      return result;
    };

    const editor = document.getElementById('editorScreen');
    if (editor) new MutationObserver(() => {
      if (editorVisible()) scheduleFrame('editor-visible');
    }).observe(editor, { attributes: true, attributeFilter: ['class', 'style'] });

    window.addEventListener('resize', () => scheduleFrame('window-resize'), { passive: true });
    scheduleFrame('viewport-install');
    return true;
  }

  function installLoadProject() {
    const current = window.loadProject || (typeof loadProject === 'function' ? loadProject : null);
    if (typeof current !== 'function') return false;
    if (current.__ephRenderFrameV36) { wrappedLoadProject = current; return true; }
    const raw = current;
    const wrapped = async function(project, ui, ...rest) {
      const result = await raw(project, ui, ...rest);
      if (!result) return result;
      installViewport(viewportNow());
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const frame = forceFrame('project-load', true);
      report(frame?.framebufferVisible ? 'normal' : 'warning', 'Actual visible WebGL framebuffer verified after project load.', {
        map: project?.name || null,
        streamed: !normalMap(),
        ...(frame || { frame: null, calls: null, roots: renderableRoots(viewportNow()), framebufferVisible: false }),
      });
      return result;
    };
    wrapped.__ephRenderFrameV36 = true;
    wrapped.__ephPrevious = raw;
    try { loadProject = wrapped; } catch {}
    window.loadProject = wrapped;
    wrappedLoadProject = wrapped;
    return true;
  }

  function watchdog(now) {
    const viewport = viewportNow();
    if (viewport && editorVisible() && now - lastCheck >= 1000) {
      lastCheck = now;
      const frame = Number(viewport.renderer?.info?.render?.frame ?? -1);
      if (frame === lastFrame) {
        stalledChecks++;
        if (stalledChecks >= 2) {
          const forced = forceFrame('stalled-render-loop', false);
          report('warning', 'Render loop stopped advancing; forced a recovery frame.', {
            observedFrame: frame,
            stalledChecks,
            recovery: forced,
          });
        }
      } else {
        lastFrame = frame;
        stalledChecks = 0;
      }
    }
    requestAnimationFrame(watchdog);
  }

  installViewport();
  installLoadProject();
  window.addEventListener('eph3d-ready', event => installViewport(event.detail), { once: true });
  window.addEventListener('eph-runtime-ready', () => {
    installViewport();
    installLoadProject();
    scheduleFrame('runtime-ready');
  }, { once: true });
  requestAnimationFrame(watchdog);

  window.EPH_RENDER_FRAME = {
    force: () => forceFrame('manual', true),
    state: () => ({ viewport: Boolean(viewportNow()), frame: lastFrame, stalledChecks }),
  };
  report('normal', 'Actual visible WebGL framebuffer watchdog installed.');
})();
