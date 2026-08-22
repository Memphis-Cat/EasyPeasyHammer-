// byanca
const fs = require('fs');
const path = require('path');
const electron = require('electron');

try {
  const encoded = fs.readFileSync(path.join(__dirname, 'assets', 'app.ico.b64'), 'utf8').replace(/\s+/g, '');
  const icon = electron.nativeImage.createFromBuffer(Buffer.from(encoded, 'base64'));
  const OriginalBrowserWindow = electron.BrowserWindow;
  electron.BrowserWindow = class EasyPeasyHammerWindow extends OriginalBrowserWindow {
    constructor(options = {}) {
      super({ ...options, icon: options.icon || icon });
    }
  };
} catch (error) {
  console.warn('EasyPeasyHammer icon could not be loaded:', error.message);
}

require('./main');
