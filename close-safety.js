// byanca
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');

if (!globalThis.__ephCloseSafetyInstalled) {
  globalThis.__ephCloseSafetyInstalled = true;
  const approved = new WeakSet();
  const waiting = new WeakSet();
  const timers = new WeakMap();

  function isEditorWindow(win) {
    if (!win || win.isDestroyed()) return false;
    const url = String(win.webContents?.getURL?.() || '');
    return /\/src\/index\.html(?:[?#]|$)/i.test(url.replace(/\\/g, '/'));
  }

  app.on('browser-window-created', (_event, win) => {
    win.on('close', event => {
      if (approved.has(win) || !isEditorWindow(win) || win.webContents?.isDestroyed()) return;
      event.preventDefault();
      if (waiting.has(win)) return;
      waiting.add(win);
      try { win.webContents.send('app:prepare-close'); } catch {}

      const timer = setTimeout(() => {
        if (win.isDestroyed()) return;
        approved.add(win);
        waiting.delete(win);
        win.close();
      }, 2500);
      timers.set(win, timer);
    });
    win.on('closed', () => {
      const timer = timers.get(win);
      if (timer) clearTimeout(timer);
      timers.delete(win);
    });
  });

  ipcMain.handle('app:close-ready', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    const timer = timers.get(win);
    if (timer) clearTimeout(timer);
    timers.delete(win);
    waiting.delete(win);
    approved.add(win);
    win.close();
    return true;
  });
}

module.exports = true;
