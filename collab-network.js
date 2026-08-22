// byanca
const ws = require('ws');

if (!globalThis.__ephFixedCollaborationPort) {
  globalThis.__ephFixedCollaborationPort = true;
  const NativeWebSocketServer = ws.WebSocketServer;
  ws.WebSocketServer = class EasyPeasyHammerWebSocketServer extends NativeWebSocketServer {
    constructor(options = {}, callback) {
      const next = { ...options };
      if (next.port === 0) next.port = 27015;
      super(next, callback);
    }
  };
}

module.exports = require('./collab-service');
