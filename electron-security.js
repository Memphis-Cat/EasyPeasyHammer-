// byanca
'use strict';

const { app, session } = require('electron');

if (!globalThis.__ephElectronSecurityInstalled) {
  globalThis.__ephElectronSecurityInstalled = true;

  app.on('web-contents-created', (_event, contents) => {
    // EasyPeasyHammer renders only local application files. A renderer-initiated
    // navigation must never be able to carry the preload bridge onto a remote
    // page, and popup windows are not required by the editor.
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  app.whenReady().then(() => {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
  }).catch(() => {});
}

module.exports = true;
