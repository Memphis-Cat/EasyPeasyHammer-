// byanca
const { app } = require('electron');

if (!global.__ephWindowFocusV62) {
  global.__ephWindowFocusV62 = true;

  try { app.commandLine.appendSwitch('disable-background-timer-throttling'); } catch {}
  try { app.commandLine.appendSwitch('disable-backgrounding-occluded-windows'); } catch {}

  app.on('browser-window-created', (_event, win) => {
    const webContents = win?.webContents;
    if (!win || !webContents) return;

    try { webContents.setBackgroundThrottling?.(false); } catch {}

    let queued = false;
    const repaint = () => {
      if (queued || win.isDestroyed?.() || webContents.isDestroyed?.()) return;
      queued = true;
      setImmediate(() => {
        queued = false;
        if (win.isDestroyed?.() || webContents.isDestroyed?.()) return;
        try { webContents.setBackgroundThrottling?.(false); } catch {}
        try { webContents.invalidate?.(); } catch {}
        try { win.setBackgroundColor?.('#070708'); } catch {}
      });
    };

    win.on('focus', repaint);
    win.on('show', repaint);
    win.on('restore', repaint);
    webContents.on('did-finish-load', repaint);
  });
}
