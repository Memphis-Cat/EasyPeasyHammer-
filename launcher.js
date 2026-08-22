// byanca
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

const { registerCollaboration } = require('./collab-service');
registerCollaboration({ ipcMain: electron.ipcMain, app: electron.app });

require('./main');
