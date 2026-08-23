// byanca
const electron = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ws = require('ws');

const COLLAB_PORT = 27015;
const MAX_COLLAB_MESSAGE_BYTES = 128 * 1024 * 1024;
const MAX_PASTED_IMAGE_BYTES = 64 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const IMAGE_MIME_EXT = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/bmp', '.bmp'],
  ['image/x-ms-bmp', '.bmp'],
]);

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

const collaboration = require('./collab-service');

function safeImageName(value, extension) {
  const raw = String(value || `pasted-image${extension}`)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || `pasted-image${extension}`;
  const existing = path.extname(raw).toLowerCase();
  if (IMAGE_EXTENSIONS.has(existing)) return `${raw.slice(0, -existing.length)}${extension}`;
  return `${raw}${extension}`;
}

function imagePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function payloadBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  return null;
}

function installChatImageBridge({ ipcMain, app }) {
  if (globalThis.__ephChatImageBridgeInstalled) return;
  globalThis.__ephChatImageBridgeInstalled = true;

  const queuedImages = new Map();
  const rawOpenDialog = electron.dialog.showOpenDialog.bind(electron.dialog);
  const getDraftRoot = () => path.join(app.getPath('userData'), 'ChatImageDrafts');

  electron.dialog.showOpenDialog = async function(...args) {
    const hasWindow = args.length > 1;
    const browserWindow = hasWindow ? args[0] : null;
    const options = (hasWindow ? args[1] : args[0]) || {};
    if (options.title !== 'Attach file' && options.title !== 'Attach image') return rawOpenDialog(...args);

    const senderId = browserWindow?.webContents?.id;
    const queued = senderId ? queuedImages.get(senderId) : null;
    if (queued) {
      queuedImages.delete(senderId);
      if (fs.existsSync(queued) && imagePath(queued)) return { canceled: false, filePaths: [queued] };
    }

    const next = {
      ...options,
      title: 'Attach image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    };
    const result = hasWindow ? await rawOpenDialog(browserWindow, next) : await rawOpenDialog(next);
    if (result?.canceled || !result?.filePaths?.[0]) return result;
    if (!imagePath(result.filePaths[0])) return { canceled: true, filePaths: [] };
    return result;
  };

  ipcMain.handle('collab:stage-image', (event, payload) => {
    try {
      const mime = String(payload?.mime || '').toLowerCase();
      const extension = IMAGE_MIME_EXT.get(mime);
      if (!extension) return { ok: false, error: 'Only PNG, JPEG, GIF, WebP, and BMP images can be pasted.' };
      const buffer = payloadBuffer(payload?.bytes);
      if (!buffer?.length) return { ok: false, error: 'Clipboard image is empty.' };
      if (buffer.length > MAX_PASTED_IMAGE_BYTES) return { ok: false, error: 'Pasted image exceeds the 64 MB clipboard limit.' };

      const draftRoot = getDraftRoot();
      fs.mkdirSync(draftRoot, { recursive: true });
      const now = Date.now();
      try {
        for (const entry of fs.readdirSync(draftRoot, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const candidate = path.join(draftRoot, entry.name);
          try { if (now - fs.statSync(candidate).mtimeMs > 24 * 60 * 60 * 1000) fs.rmSync(candidate, { force: true }); } catch {}
        }
      } catch {}

      const name = safeImageName(payload?.name, extension);
      const filePath = path.join(draftRoot, `${now}_${crypto.randomUUID().slice(0, 8)}_${name}`);
      fs.writeFileSync(filePath, buffer, { flag: 'wx' });
      queuedImages.set(event.sender.id, filePath);
      return { ok: true, name, mime, size: buffer.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

module.exports = {
  ...collaboration,
  registerCollaboration(options) {
    installChatImageBridge(options);
    return collaboration.registerCollaboration(options);
  },
};
