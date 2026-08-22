// byanca
const fs = require('fs');
const path = require('path');
const electron = require('electron');
const ws = require('ws');

const NativeWebSocketServer = ws.WebSocketServer;
ws.WebSocketServer = class EasyPeasyHammerWebSocketServer extends NativeWebSocketServer {
  constructor(options = {}, callback) {
    const next = { ...options };
    if (next.port === 0) next.port = 27015;
    super(next, callback);
  }
};

try {
  const encoded = fs.readFileSync(path.join(__dirname, 'assets', 'app.ico.b64'), 'utf8').replace(/\s+/g, '');
  const icon = electron.nativeImage.createFromBuffer(Buffer.from(encoded, 'base64'));
  const NativeBrowserWindow = electron.BrowserWindow;
  const IconBrowserWindow = class EasyPeasyHammerWindow extends NativeBrowserWindow {
    constructor(options = {}) {
      super({ ...options, icon: options.icon || icon });
    }
  };
  try { Object.defineProperty(electron, 'BrowserWindow', { value: IconBrowserWindow, configurable: true }); }
  catch { try { electron.BrowserWindow = IconBrowserWindow; } catch {} }
} catch (error) {
  console.warn('EasyPeasyHammer icon could not be loaded:', error.message);
}

const { registerCollaboration } = require('./collab-service');
registerCollaboration({ ipcMain: electron.ipcMain, app: electron.app });

require('./main');
