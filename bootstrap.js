// byanca
const path = require('path');
const fs = require('fs');
const electron = require('electron');

const COLLAB_PORT = 27015;
const iconPath = path.join(__dirname, 'build', 'icon.ico');

// Force the collaboration WebSocket server to use TCP 27015 instead of a random port.
const ws = require('ws');
const NativeWebSocketServer = ws.WebSocketServer;
class EasyPeasyHammerWebSocketServer extends NativeWebSocketServer {
  constructor(options = {}, callback) {
    const next = { ...options };
    if (!next.server && !next.noServer && (next.port === 0 || next.port == null)) next.port = COLLAB_PORT;
    super(next, callback);
  }
}
ws.WebSocketServer = EasyPeasyHammerWebSocketServer;
ws.Server = EasyPeasyHammerWebSocketServer;

// Apply the EasyPeasyHammer icon to every Electron window while developing too.
electron.app.on('browser-window-created', (_event, window) => {
  try {
    if (fs.existsSync(iconPath)) window.setIcon(iconPath);
  } catch {}
});

require('./main');
const { registerCollaboration } = require('./collab-service');
registerCollaboration({ ipcMain: electron.ipcMain, app: electron.app });
