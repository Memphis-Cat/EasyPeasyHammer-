// byanca
const { BrowserWindow, dialog, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { pathToFileURL } = require('url');
const { WebSocket, WebSocketServer } = require('ws');

const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const FILE_CHUNK_BYTES = 512 * 1024;
const TRANSFER_PREFIX_BYTES = 36;

function cleanName(value, fallback = 'SharedProject') {
  const out = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 80);
  return out || fallback;
}

function safeJsonRead(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function safeJsonWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}
function randomId() { return crypto.randomUUID(); }
function encodeInvite(payload) { return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'); }
function decodeInvite(code) {
  try {
    const parsed = JSON.parse(Buffer.from(String(code || '').trim(), 'base64url').toString('utf8'));
    if (parsed?.v !== 1 || !parsed?.p || !parsed?.s || !Array.isArray(parsed?.a)) return null;
    return parsed;
  } catch { return null; }
}
function localIPv4() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) {
      if (item.family === 'IPv4' && !item.internal && item.address) out.push(item.address);
    }
  }
  return [...new Set(out)];
}
function publicIPv4(timeout = 2200) {
  return new Promise(resolve => {
    const req = https.get('https://api.ipify.org?format=json', { headers: { 'User-Agent': 'EasyPeasyHammer' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)?.ip || null); } catch { resolve(null); }
      });
    });
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function registerCollaboration({ ipcMain, app }) {
  if (globalThis.__ephCollaborationRegistered) return;
  globalThis.__ephCollaborationRegistered = true;

  const sharedFile = path.join(app.getPath('userData'), 'shared-projects.json');
  const receiveRoot = path.join(app.getPath('userData'), 'CollaborationFiles');
  const pickedFiles = new Map();
  const incoming = new Map();
  let state = {
    role: null,
    connected: false,
    sessionId: null,
    peerId: null,
    username: null,
    ownerName: null,
    inviteCode: null,
    project: null,
    revision: 0,
    snapshot: null,
    users: [],
    chatHistory: [],
  };
  let server = null;
  let client = null;
  let secret = null;
  let peers = new Map();
  let hostPort = null;

  const emit = event => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('collab:event', event);
    }
  };
  const publicState = () => ({
    role: state.role,
    connected: state.connected,
    sessionId: state.sessionId,
    peerId: state.peerId,
    username: state.username,
    ownerName: state.ownerName,
    inviteCode: state.inviteCode,
    project: state.project,
    revision: state.revision,
    users: state.users,
    chatHistory: state.chatHistory,
  });
  const sendState = () => emit({ type: 'state', state: publicState() });
  const broadcastJson = (message, except = null) => {
    const data = JSON.stringify(message);
    for (const peer of peers.values()) if (peer.ready && peer.ws.readyState === WebSocket.OPEN && peer.ws !== except) peer.ws.send(data);
  };
  const broadcastBinary = (buffer, except = null) => {
    for (const peer of peers.values()) if (peer.ready && peer.ws.readyState === WebSocket.OPEN && peer.ws !== except) peer.ws.send(buffer, { binary: true });
  };
  const updateUsers = () => {
    if (state.role === 'host') {
      state.users = [{ peerId: 'owner', username: state.username, owner: true }, ...[...peers.values()].filter(x => x.ready).map(x => ({ peerId: x.peerId, username: x.username, owner: false }))];
      broadcastJson({ type: 'presence', users: state.users });
    }
    emit({ type: 'presence', users: state.users, role: state.role, peerId: state.peerId });
    sendState();
  };
  const appendChat = message => {
    state.chatHistory.push(message);
    if (state.chatHistory.length > 300) state.chatHistory.shift();
    emit({ type: 'chat', message });
  };
  const sharedProjects = () => safeJsonRead(sharedFile, []).filter(x => x?.inviteCode && x?.name);
  const rememberShared = entry => {
    const list = sharedProjects().filter(x => x.sessionId !== entry.sessionId);
    list.unshift(entry);
    safeJsonWrite(sharedFile, list.slice(0, 50));
  };
  const forgetShared = sessionId => safeJsonWrite(sharedFile, sharedProjects().filter(x => x.sessionId !== sessionId));

  function resetNetwork(emitEvent = true) {
    try { client?.close(); } catch {}
    client = null;
    if (server) {
      for (const peer of peers.values()) try { peer.ws.close(); } catch {}
      try { server.close(); } catch {}
    }
    server = null;
    peers = new Map();
    secret = null;
    hostPort = null;
    for (const item of incoming.values()) try { item.stream?.destroy(); } catch {}
    incoming.clear();
    state = { ...state, role: null, connected: false, sessionId: null, peerId: null, ownerName: null, inviteCode: null, project: null, revision: 0, snapshot: null, users: [], chatHistory: [] };
    if (emitEvent) sendState();
  }

  function attachmentMessage(meta, localPath, peerId, username) {
    return {
      id: meta.messageId || randomId(),
      peerId,
      username,
      text: String(meta.text || '').slice(0, 8000),
      replyTo: meta.replyTo || null,
      timestamp: meta.timestamp || new Date().toISOString(),
      attachment: {
        name: cleanName(meta.name, 'file'),
        size: Number(meta.size) || 0,
        mime: String(meta.mime || 'application/octet-stream'),
        localPath,
        url: localPath ? pathToFileURL(localPath).href : null,
      }
    };
  }

  function beginIncoming(meta, peerId, username) {
    if (!meta?.transferId || Number(meta.size) < 0 || Number(meta.size) > MAX_FILE_BYTES) return null;
    const folder = path.join(receiveRoot, cleanName(state.sessionId || 'session'));
    fs.mkdirSync(folder, { recursive: true });
    const destination = path.join(folder, `${Date.now()}_${cleanName(meta.name, 'file')}`);
    const stream = fs.createWriteStream(destination);
    const item = { ...meta, peerId, username, path: destination, stream, received: 0 };
    incoming.set(meta.transferId, item);
    return item;
  }
  function writeIncoming(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length <= TRANSFER_PREFIX_BYTES) return;
    const transferId = buffer.subarray(0, TRANSFER_PREFIX_BYTES).toString('utf8');
    const item = incoming.get(transferId);
    if (!item) return;
    const chunk = buffer.subarray(TRANSFER_PREFIX_BYTES);
    item.received += chunk.length;
    if (item.received <= MAX_FILE_BYTES) item.stream.write(chunk);
    emit({ type: 'file-progress', transferId, received: item.received, size: item.size, incoming: true });
  }
  function finishIncoming(transferId) {
    const item = incoming.get(transferId);
    if (!item) return null;
    incoming.delete(transferId);
    item.stream.end();
    const message = attachmentMessage(item, item.path, item.peerId, item.username);
    appendChat(message);
    return message;
  }

  function serverHandleJson(peer, msg) {
    if (!peer.ready) {
      if (msg?.type !== 'hello' || msg.secret !== secret) {
        try { peer.ws.close(4001, 'Invalid invite'); } catch {}
        return;
      }
      peer.ready = true;
      peer.peerId = randomId();
      peer.username = String(msg.username || 'Collaborator').trim().slice(0, 32) || 'Collaborator';
      peer.ws.send(JSON.stringify({
        type: 'welcome',
        peerId: peer.peerId,
        sessionId: state.sessionId,
        ownerName: state.username,
        project: state.project,
        snapshot: state.snapshot,
        revision: state.revision,
        users: [{ peerId: 'owner', username: state.username, owner: true }, ...[...peers.values()].filter(x => x.ready).map(x => ({ peerId: x.peerId, username: x.username, owner: false }))],
        chatHistory: state.chatHistory,
      }));
      updateUsers();
      return;
    }

    if (msg?.type === 'snapshot') {
      state.revision++;
      state.snapshot = msg.snapshot;
      const packet = { type: 'snapshot', revision: state.revision, snapshot: msg.snapshot, sourcePeer: peer.peerId };
      broadcastJson(packet, peer.ws);
      emit(packet);
    } else if (msg?.type === 'selection') {
      const packet = { type: 'selection', peerId: peer.peerId, username: peer.username, selectedId: msg.selectedId || null };
      broadcastJson(packet, peer.ws); emit(packet);
    } else if (msg?.type === 'cursor') {
      const packet = { type: 'cursor', peerId: peer.peerId, username: peer.username, point: msg.point || null };
      broadcastJson(packet, peer.ws); emit(packet);
    } else if (msg?.type === 'chat') {
      const message = { id: msg.id || randomId(), peerId: peer.peerId, username: peer.username, text: String(msg.text || '').slice(0, 8000), replyTo: msg.replyTo || null, timestamp: msg.timestamp || new Date().toISOString(), attachment: null };
      broadcastJson({ type: 'chat', message }); appendChat(message);
    } else if (msg?.type === 'file-start') {
      beginIncoming(msg.meta, peer.peerId, peer.username);
      broadcastJson({ type: 'file-start', meta: { ...msg.meta, peerId: peer.peerId, username: peer.username } }, peer.ws);
    } else if (msg?.type === 'file-end') {
      finishIncoming(msg.transferId);
      broadcastJson({ type: 'file-end', transferId: msg.transferId }, peer.ws);
    }
  }

  async function startHost(payload) {
    resetNetwork(false);
    const username = String(payload?.username || 'Owner').trim().slice(0, 32) || 'Owner';
    state.role = 'host'; state.connected = true; state.sessionId = randomId(); state.peerId = 'owner'; state.username = username; state.ownerName = username;
    state.project = payload?.project || null; state.snapshot = payload?.snapshot || null; state.revision = 1; state.chatHistory = [];
    secret = crypto.randomBytes(24).toString('base64url');
    server = new WebSocketServer({ host: '0.0.0.0', port: 0, maxPayload: FILE_CHUNK_BYTES + 4096 });
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    hostPort = server.address().port;
    server.on('connection', ws => {
      const peer = { ws, ready: false, peerId: null, username: null };
      peers.set(ws, peer);
      ws.on('message', (data, isBinary) => {
        if (isBinary) { writeIncoming(Buffer.from(data)); broadcastBinary(Buffer.from(data), ws); return; }
        try { serverHandleJson(peer, JSON.parse(String(data))); } catch {}
      });
      ws.on('close', () => { const id = peer.peerId; peers.delete(ws); if (id) { broadcastJson({ type: 'peer-left', peerId: id }); updateUsers(); } });
      ws.on('error', () => {});
    });
    const publicIp = await publicIPv4();
    const addresses = [...new Set([...localIPv4(), ...(publicIp ? [publicIp] : []), '127.0.0.1'])];
    state.inviteCode = encodeInvite({ v: 1, p: hostPort, s: secret, a: addresses, n: state.project?.name || 'Shared Project', i: state.sessionId, o: username });
    updateUsers();
    return { ok: true, ...publicState(), inviteCode: state.inviteCode };
  }

  function handleClientJson(msg) {
    if (msg?.type === 'snapshot') { state.revision = msg.revision || state.revision; state.snapshot = msg.snapshot; emit(msg); }
    else if (msg?.type === 'presence') { state.users = msg.users || []; updateUsers(); }
    else if (msg?.type === 'selection' || msg?.type === 'cursor') emit(msg);
    else if (msg?.type === 'chat') { state.chatHistory.push(msg.message); if (state.chatHistory.length > 300) state.chatHistory.shift(); emit(msg); }
    else if (msg?.type === 'file-start') beginIncoming(msg.meta, msg.meta?.peerId, msg.meta?.username);
    else if (msg?.type === 'file-end') finishIncoming(msg.transferId);
    else if (msg?.type === 'kicked') {
      forgetShared(state.sessionId);
      emit({ type: 'kicked', reason: msg.reason || 'Removed by project owner.' });
      resetNetwork(false); sendState();
    } else if (msg?.type === 'peer-left') emit(msg);
  }

  function connectCandidate(address, port, invite, username, timeout = 4500) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://${address}:${port}`, { maxPayload: FILE_CHUNK_BYTES + 4096 });
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; try { socket.terminate(); } catch {} reject(new Error('Connection timed out')); } }, timeout);
      socket.once('open', () => socket.send(JSON.stringify({ type: 'hello', secret: invite.s, username })));
      socket.on('message', (data, isBinary) => {
        if (isBinary) { writeIncoming(Buffer.from(data)); return; }
        let msg; try { msg = JSON.parse(String(data)); } catch { return; }
        if (!settled && msg.type === 'welcome') { settled = true; clearTimeout(timer); resolve({ socket, welcome: msg }); return; }
        handleClientJson(msg);
      });
      socket.once('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
      socket.once('close', () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Connection closed')); } });
    });
  }

  async function joinSession(code, username) {
    const invite = decodeInvite(code);
    if (!invite) return { ok: false, error: 'Invalid invite code.' };
    resetNetwork(false);
    const cleanUser = String(username || 'Collaborator').trim().slice(0, 32) || 'Collaborator';
    let connected = null; let lastError = null;
    for (const address of [...new Set(invite.a)]) {
      try { connected = await connectCandidate(address, invite.p, invite, cleanUser); break; }
      catch (error) { lastError = error; }
    }
    if (!connected) { resetNetwork(false); return { ok: false, error: `Could not reach the project owner. ${lastError?.message || ''}`.trim() }; }
    client = connected.socket;
    const welcome = connected.welcome;
    state.role = 'client'; state.connected = true; state.sessionId = welcome.sessionId; state.peerId = welcome.peerId; state.username = cleanUser; state.ownerName = welcome.ownerName;
    state.project = welcome.project; state.snapshot = welcome.snapshot; state.revision = welcome.revision || 1; state.users = welcome.users || []; state.chatHistory = welcome.chatHistory || [];
    client.on('close', () => { if (state.connected) { state.connected = false; emit({ type: 'disconnected' }); sendState(); } });
    client.on('error', () => {});

    const sharedRoot = path.join(app.getPath('userData'), 'SharedProjects', cleanName(welcome.sessionId));
    fs.mkdirSync(sharedRoot, { recursive: true });
    const projectName = cleanName(welcome.project?.name || invite.n || 'SharedProject');
    const vmapPath = path.join(sharedRoot, `${projectName}.vmap`);
    if (welcome.snapshot?.vmapText) fs.writeFileSync(vmapPath, welcome.snapshot.vmapText, 'utf8');
    const shadowProject = { ...(welcome.project || {}), id: `shared:${welcome.sessionId}`, type: 'shared-project', name: projectName, vmapPath, projectFolder: sharedRoot, collaborationSessionId: welcome.sessionId, collaborationOwner: welcome.ownerName };
    state.project = shadowProject;
    rememberShared({ sessionId: welcome.sessionId, name: projectName, ownerName: welcome.ownerName, inviteCode: code, lastJoined: new Date().toISOString() });
    sendState();
    return { ok: true, project: shadowProject, snapshot: welcome.snapshot, state: publicState() };
  }

  function sendClientJson(message) { if (client?.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); }

  async function sendFile(token, text, replyTo) {
    const picked = pickedFiles.get(token);
    if (!picked || !fs.existsSync(picked.path)) return { ok: false, error: 'Attachment is no longer available.' };
    if (picked.size > MAX_FILE_BYTES) return { ok: false, error: 'File exceeds the 1 GB limit.' };
    const transferId = randomId();
    const messageId = randomId();
    const meta = { transferId, messageId, name: picked.name, size: picked.size, mime: picked.mime, text: String(text || '').slice(0, 8000), replyTo: replyTo || null, timestamp: new Date().toISOString() };
    const prefix = Buffer.alloc(TRANSFER_PREFIX_BYTES); prefix.write(transferId, 0, 'utf8');
    if (state.role === 'host') broadcastJson({ type: 'file-start', meta: { ...meta, peerId: 'owner', username: state.username } });
    else sendClientJson({ type: 'file-start', meta });

    const stream = fs.createReadStream(picked.path, { highWaterMark: FILE_CHUNK_BYTES });
    let sent = 0;
    for await (const chunk of stream) {
      const packet = Buffer.concat([prefix, chunk]);
      if (state.role === 'host') broadcastBinary(packet);
      else if (client?.readyState === WebSocket.OPEN) client.send(packet, { binary: true });
      sent += chunk.length;
      emit({ type: 'file-progress', transferId, sent, size: picked.size, incoming: false });
    }
    if (state.role === 'host') broadcastJson({ type: 'file-end', transferId }); else sendClientJson({ type: 'file-end', transferId });
    const message = attachmentMessage(meta, picked.path, state.peerId || 'owner', state.username || 'You');
    appendChat(message);
    pickedFiles.delete(token);
    return { ok: true, message };
  }

  ipcMain.handle('collab:get-state', () => publicState());
  ipcMain.handle('collab:host', (event, payload) => startHost(payload));
  ipcMain.handle('collab:join', (event, code, username) => joinSession(code, username));
  ipcMain.handle('collab:leave', () => { resetNetwork(); return { ok: true }; });
  ipcMain.handle('collab:kick', (event, peerId) => {
    if (state.role !== 'host') return { ok: false, error: 'Only the project owner can remove collaborators.' };
    const peer = [...peers.values()].find(x => x.peerId === peerId);
    if (!peer) return { ok: false, error: 'Collaborator is no longer connected.' };
    try { peer.ws.send(JSON.stringify({ type: 'kicked', reason: 'Removed by project owner.' })); peer.ws.close(4003, 'Removed'); } catch {}
    return { ok: true };
  });
  ipcMain.handle('collab:send-snapshot', (event, snapshot) => {
    if (!state.connected || !snapshot) return { ok: false };
    if (state.role === 'host') {
      state.revision++; state.snapshot = snapshot;
      broadcastJson({ type: 'snapshot', revision: state.revision, snapshot, sourcePeer: 'owner' });
    } else sendClientJson({ type: 'snapshot', snapshot, baseRevision: state.revision });
    return { ok: true, revision: state.revision };
  });
  ipcMain.handle('collab:send-selection', (event, selectedId) => {
    if (!state.connected) return false;
    const packet = { type: 'selection', peerId: state.peerId, username: state.username, selectedId: selectedId || null };
    if (state.role === 'host') { broadcastJson(packet); emit(packet); } else sendClientJson({ type: 'selection', selectedId });
    return true;
  });
  ipcMain.handle('collab:send-cursor', (event, point) => {
    if (!state.connected) return false;
    const packet = { type: 'cursor', peerId: state.peerId, username: state.username, point: point || null };
    if (state.role === 'host') { broadcastJson(packet); emit(packet); } else sendClientJson({ type: 'cursor', point });
    return true;
  });
  ipcMain.handle('collab:send-chat', (event, text, replyTo) => {
    if (!state.connected) return { ok: false, error: 'Not connected to a collaboration session.' };
    const message = { id: randomId(), peerId: state.peerId || 'owner', username: state.username || 'You', text: String(text || '').slice(0, 8000), replyTo: replyTo || null, timestamp: new Date().toISOString(), attachment: null };
    if (state.role === 'host') { broadcastJson({ type: 'chat', message }); appendChat(message); }
    else sendClientJson({ type: 'chat', ...message });
    return { ok: true, message };
  });
  ipcMain.handle('collab:pick-file', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win || undefined, { title: 'Attach file', properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0]; const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) return { ok: false, error: 'File exceeds the 1 GB limit.' };
    const token = randomId();
    const ext = path.extname(filePath).toLowerCase();
    const mime = ({ '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp','.svg':'image/svg+xml','.txt':'text/plain','.json':'application/json','.zip':'application/zip','.wav':'audio/wav','.mp4':'video/mp4' })[ext] || 'application/octet-stream';
    const picked = { token, path: filePath, name: path.basename(filePath), size: stat.size, mime, url: pathToFileURL(filePath).href };
    pickedFiles.set(token, picked); return { ok: true, ...picked, path: undefined };
  });
  ipcMain.handle('collab:send-file', (event, token, text, replyTo) => sendFile(token, text, replyTo));
  ipcMain.handle('collab:save-file', async (event, localPath, suggestedName) => {
    if (!localPath || !fs.existsSync(localPath)) return { ok: false, error: 'File is no longer available.' };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win || undefined, { title: 'Save attachment', defaultPath: cleanName(suggestedName || path.basename(localPath)) });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.copyFileSync(localPath, result.filePath); return { ok: true, path: result.filePath };
  });
  ipcMain.handle('collab:show-file', async (event, localPath) => { if (!localPath || !fs.existsSync(localPath)) return false; shell.showItemInFolder(localPath); return true; });
  ipcMain.handle('collab:list-shared', () => sharedProjects());
  ipcMain.handle('collab:forget-shared', (event, sessionId) => { forgetShared(sessionId); return true; });
}

module.exports = { registerCollaboration };
