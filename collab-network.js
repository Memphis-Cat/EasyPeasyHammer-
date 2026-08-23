// byanca
const ws = require('ws');

const COLLAB_PORT = 27015;
const MAX_COLLAB_MESSAGE_BYTES = 128 * 1024 * 1024;

if (!globalThis.__ephFixedCollaborationPort) {
  globalThis.__ephFixedCollaborationPort = true;

  const NativeWebSocketServer = ws.WebSocketServer;
  ws.WebSocketServer = class EasyPeasyHammerWebSocketServer extends NativeWebSocketServer {
    constructor(options = {}, callback) {
      const next = { ...options };
      if (!next.server && !next.noServer && (next.port === 0 || next.port == null)) next.port = COLLAB_PORT;
      next.maxPayload = Math.max(Number(next.maxPayload) || 0, MAX_COLLAB_MESSAGE_BYTES);
      super(next, callback);
    }
  };
  ws.Server = ws.WebSocketServer;

  const NativeWebSocket = ws.WebSocket;
  class EasyPeasyHammerWebSocket extends NativeWebSocket {
    constructor(address, protocols, options) {
      if (protocols && typeof protocols === 'object' && !Array.isArray(protocols)) {
        const next = { ...protocols, maxPayload: Math.max(Number(protocols.maxPayload) || 0, MAX_COLLAB_MESSAGE_BYTES) };
        super(address, next);
        return;
      }
      const next = { ...(options || {}), maxPayload: Math.max(Number(options?.maxPayload) || 0, MAX_COLLAB_MESSAGE_BYTES) };
      super(address, protocols, next);
    }
  }
  ws.WebSocket = EasyPeasyHammerWebSocket;
}

module.exports = require('./collab-service');
