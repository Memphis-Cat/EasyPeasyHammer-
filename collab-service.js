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
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 4500;

function cleanName(value, fallback = 'SharedProject') {
  const out = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 80);
  return out || fallback;
}

function safeJsonRead(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function safeJsonWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    try { fs.renameSync(temp, file); }
    catch {
      fs.copyFileSync(temp, file);
      fs.rmSync(temp, { force: true });
    }
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}
function randomId() { return crypto.randomUUID(); }
function encodeInvite(payload) { return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'); }
function decodeInvite(code) {
  try {
    const parsed = JSON.parse(Buffer.from(String(code || '').trim(), 'base64url').toString('utf8'));
    const port = Number(parsed?.p);
    if (parsed?.v !== 1 || !Number.isInteger(port) || port < 1 || port > 65535 || !parsed?.s || !Array.isArray(parsed?.a)) return null;
    const addresses = parsed.a.map(value => String(value || '').trim()).filter(Boolean).slice(0, 16);
    if (!addresses.length) return null;
    return { ...parsed, p: port, a: [...new Set(addresses)] };
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
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    const req = https.get('https://api.ipify.org?format=json', { headers: { 'User-Agent': 'EasyPeasyHammer' } }, res => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) { res.resume(); finish(null); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        if (body.length < 4096) body += chunk;
        if (body.length >= 4096) req.destroy();
      });
      res.on('end', () => {
        try { finish(JSON.parse(body)?.ip || null); } catch { finish(null); }
      });
    });
    req.setTimeout(timeout, () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('collab:event', event);
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
  const readyPeers = except => [...peers.values()].filter(peer => peer.ready && peer.ws.readyState === WebSocket.OPEN && peer.ws !== except);
  const broadcastJson = (message, except = null) => {
    const data = JSON.stringify(message);
    for (const peer of readyPeers(except)) {
      try { peer.ws.send(data); } catch {}
    }
  };
  const broadcastBinary = (buffer, except = null) => {
    for (const peer of readyPeers(except)) {
      try { peer.ws.send(buffer, { binary: true }); } catch {}
    }
  };
  const waitForBackpressure = async sockets => {
    while (sockets.some(socket => socket.readyState === WebSocket.OPEN && socket.bufferedAmount > MAX_BUFFERED_BYTES)) await sleep(8);
    if (sockets.some(socket => socket.readyState !== WebSocket.OPEN)) throw new Error('A collaboration connection closed during the file transfer.');
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
    if (!message?.id || state.chatHistory.some(item => item.id === message.id)) return;
    state.chatHistory.push(message);
    if (state.chatHistory.length > 300) state.chatHistory.splice(0, state.chatHistory.length - 300);
    emit({ type: 'chat', message });
  };
  const sharedProjects = () => safeJsonRead(sharedFile, []).filter(x => x?.inviteCode && x?.name);
  const rememberShared = entry => {
    const list = sharedProjects().filter(x => x.sessionId !== entry.sessionId);
    list.unshift(entry);
    safeJsonWrite(sharedFile, list.slice(0, 50));
  };
  const forgetShared = sessionId => safeJsonWrite(sharedFile, sharedProjects().filter(x => x.sessionId !== sessionId));

  function removePartial(item) {
    if (!item) return;
    try { item.stream?.destroy(); } catch {}
    try { if (item.path && fs.existsSync(item.path)) fs.rmSync(item.path, { force: true }); } catch {}
  }

  function resetNetwork(emitEvent = true) {
    try { client?.terminate?.(); } catch { try { client?.close(); } catch {} }
    client = null;
    if (server) {
      for (const peer of peers.values()) try { peer.ws.terminate?.(); } catch { try { peer.ws.close(); } catch {} }
      try { server.close(); } catch {}
    }
    server = null;
    peers = new Map();
    secret = null;
    hostPort = null;
    for (const item of incoming.values()) removePartial(item);
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

  function validTransferMeta(meta) {
    const size = Number(meta?.size);
    return Boolean(meta?.transferId)
      && String(meta.transferId).length === TRANSFER_PREFIX_BYTES
      && Number.isSafeInteger(size)
      && size >= 0
      && size <= MAX_FILE_BYTES;
  }

  function beginIncoming(meta, peerId, username) {
    if (!validTransferMeta(meta) || incoming.has(meta.transferId)) return null;
    const folder = path.join(receiveRoot, cleanName(state.sessionId || 'session'));
    fs.mkdirSync(folder, { recursive: true });
    const destination = path.join(folder, `${Date.now()}_${randomId().slice(0, 8)}_${cleanName(meta.name, 'file')}`);
    const stream = fs.createWriteStream(destination, { flags: 'wx' });
    const item = { ...meta, size: Number(meta.size), peerId, username, path: destination, stream, received: 0, failed: false, streamError: null };
    stream.on('error', error => { item.failed = true; item.streamError = error; });
    incoming.set(meta.transferId, item);
    return item;
  }

  function writeIncoming(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length <= TRANSFER_PREFIX_BYTES) return false;
    const transferId = buffer.subarray(0, TRANSFER_PREFIX_BYTES).toString('utf8');
    const item = incoming.get(transferId);
    if (!item || item.failed) return false;
    const chunk = buffer.subarray(TRANSFER_PREFIX_BYTES);
    if (item.received + chunk.length > item.size || item.received + chunk.length > MAX_FILE_BYTES) {
      item.failed = true;
      item.streamError = new Error('Received more file data than declared.');
      return false;
    }
    item.received += chunk.length;
    if (!item.stream.write(chunk)) item.stream.once('drain', () => {});
    emit({ type: 'file-progress', transferId, received: item.received, size: item.size, incoming: true });
    return true;
  }

  async function finishIncoming(transferId) {
    const item = incoming.get(transferId);
    if (!item) return null;
    incoming.delete(transferId);
    await new Promise(resolve => {
      if (item.stream.destroyed) return resolve();
      item.stream.end(resolve);
    });
    if (item.failed || item.streamError || item.received !== item.size) {
      removePartial(item);
      emit({ type: 'file-error', transferId, error: item.streamError?.message || `Incomplete file transfer (${item.received}/${item.size} bytes).` });
      return null;
    }
    const message = attachmentMessage(item, item.path, item.peerId, item.username);
    appendChat(message);
    return message;
  }

  async function serverHandleJson(peer, msg) {
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

    if (msg?.type === 'snapshot' && msg.snapshot) {
      state.revision++;
      state.snapshot = msg.snapshot;
      const packet = { type: 'snapshot', revision: state.revision, snapshot: msg.snapshot, sourcePeer: peer.peerId };
      broadcastJson(packet);
      emit(packet);
    } else if (msg?.type === 'live-object' && msg.object?.id) {
      const packet = { type: 'live-object', peerId: peer.peerId, username: peer.username, object: msg.object };
      broadcastJson(packet, peer.ws);
      emit(packet);
    } else if (msg?.type === 'selection') {
      const packet = { type: 'selection', peerId: peer.peerId, username: peer.username, selectedId: msg.selectedId || null };
      broadcastJson(packet, peer.ws);
      emit(packet);
    } else if (msg?.type === 'cursor') {
      const packet = { type: 'cursor', peerId: peer.peerId, username: peer.username, point: msg.point || null };
      broadcastJson(packet, peer.ws);
      emit(packet);
    } else if (msg?.type === 'chat') {
      const message = { id: msg.id || randomId(), peerId: peer.peerId, username: peer.username, text: String(msg.text || '').slice(0, 8000), replyTo: msg.replyTo || null, timestamp: msg.timestamp || new Date().toISOString(), attachment: null };
      broadcastJson({ type: 'chat', message });
      appendChat(message);
    } else if (msg?.type === 'file-start') {
      const item = beginIncoming(msg.meta, peer.peerId, peer.username);
      if (item) broadcastJson({ type: 'file-start', meta: { ...msg.meta, peerId: peer.peerId, username: peer.username } }, peer.ws);
    } else if (msg?.type === 'file-end') {
      const message = await finishIncoming(msg.transferId);
      if (message) broadcastJson({ type: 'file-end', transferId: msg.transferId }, peer.ws);
    }
  }

  async function startHost(payload) {
    resetNetwork(false);
    const username = String(payload?.username || 'Owner').trim().slice(0, 32) || 'Owner';
    state.role = 'host';
    state.connected = false;
    state.sessionId = randomId();
    state.peerId = 'owner';
    state.username = username;
    state.ownerName = username;
    state.project = payload?.project || null;
    state.snapshot = payload?.snapshot || null;
    state.revision = 1;
    state.chatHistory = [];
    secret = crypto.randomBytes(24).toString('base64url');

    try {
      server = new WebSocketServer({ host: '0.0.0.0', port: 0, maxPayload: FILE_CHUNK_BYTES + 4096 });
      await new Promise((resolve, reject) => {
        const onListen = () => { server.off('error', onError); resolve(); };
        const onError = error => { server.off('listening', onListen); reject(error); };
        server.once('listening', onListen);
        server.once('error', onError);
      });
    } catch (error) {
      resetNetwork(false);
      return { ok: false, error: `Could not start collaboration on TCP port 27015. ${error.message}` };
    }

    state.connected = true;
    hostPort = server.address().port;
    server.on('connection', ws => {
      const peer = { ws, ready: false, peerId: null, username: null };
      peers.set(ws, peer);
      ws.on('message', async (data, isBinary) => {
        if (isBinary) {
          const buffer = Buffer.from(data);
          if (writeIncoming(buffer)) broadcastBinary(buffer, ws);
          return;
        }
        try { await serverHandleJson(peer, JSON.parse(String(data))); } catch (error) { emit({ type: 'collab-error', error: error.message }); }
      });
      ws.on('close', () => {
        const id = peer.peerId;
        peers.delete(ws);
        if (id) {
          const packet = { type: 'peer-left', peerId: id };
          broadcastJson(packet);
          emit(packet);
          updateUsers();
        }
      });
      ws.on('error', () => {});
    });
    server.on('error', error => emit({ type: 'collab-error', error: error.message }));

    const publicIp = await publicIPv4();
    const addresses = [...new Set([...(publicIp ? [publicIp] : []), ...localIPv4(), '127.0.0.1'])];
    state.inviteCode = encodeInvite({ v: 1, p: hostPort, s: secret, a: addresses, n: state.project?.name || 'Shared Project', i: state.sessionId, o: username });
    updateUsers();
    return { ok: true, ...publicState(), inviteCode: state.inviteCode };
  }

  async function handleClientJson(msg) {
    if (msg?.type === 'snapshot') {
      state.revision = Number(msg.revision) || state.revision;
      state.snapshot = msg.snapshot;
      emit(msg);
    } else if (msg?.type === 'presence') {
      state.users = msg.users || [];
      updateUsers();
    } else if (msg?.type === 'live-object' || msg?.type === 'selection' || msg?.type === 'cursor') emit(msg);
    else if (msg?.type === 'chat' && msg.message) {
      appendChat(msg.message);
    } else if (msg?.type === 'file-start') {
      beginIncoming(msg.meta, msg.meta?.peerId, msg.meta?.username);
    } else if (msg?.type === 'file-end') {
      await finishIncoming(msg.transferId);
    } else if (msg?.type === 'file-error') {
      emit(msg);
    } else if (msg?.type === 'kicked') {
      forgetShared(state.sessionId);
      emit({ type: 'kicked', reason: msg.reason || 'Removed by project owner.' });
      resetNetwork(false);
      sendState();
    } else if (msg?.type === 'peer-left') emit(msg);
  }

  function connectCandidate(address, port, invite, username, timeout = CONNECT_TIMEOUT_MS) {
    let socket = null;
    let settled = false;
    let timer = null;
    const promise = new Promise((resolve, reject) => {
      try { socket = new WebSocket(`ws://${address}:${port}`, { maxPayload: FILE_CHUNK_BYTES + 4096 }); }
      catch (error) { reject(error); return; }
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.terminate(); } catch {}
        reject(new Error('Connection timed out'));
      }, timeout);
      socket.once('open', () => socket.send(JSON.stringify({ type: 'hello', secret: invite.s, username })));
      socket.on('message', async (data, isBinary) => {
        if (isBinary) { writeIncoming(Buffer.from(data)); return; }
        let msg;
        try { msg = JSON.parse(String(data)); } catch { return; }
        if (!settled && msg.type === 'welcome') {
          settled = true;
          clearTimeout(timer);
          resolve({ socket, welcome: msg });
          return;
        }
        await handleClientJson(msg);
      });
      socket.once('error', error => {
        if (!settled) { settled = true; clearTimeout(timer); reject(error); }
      });
      socket.once('close', () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Connection closed')); }
      });
    });
    return { promise, socket: () => socket };
  }

  async function connectAnyCandidate(addresses, port, invite, username) {
    const candidates = [];
    return new Promise((resolve, reject) => {
      let finished = false;
      let failures = 0;
      let lastError = null;
      const unique = [...new Set(addresses)].slice(0, 16);
      const fail = error => {
        failures++;
        lastError = error;
        if (!finished && failures >= unique.length) { finished = true; reject(lastError || new Error('Connection failed')); }
      };
      unique.forEach((address, index) => {
        setTimeout(() => {
          if (finished) return;
          const candidate = connectCandidate(address, port, invite, username);
          candidates.push(candidate);
          candidate.promise.then(result => {
            if (finished) { try { result.socket.terminate(); } catch {} return; }
            finished = true;
            for (const other of candidates) {
              const socket = other.socket();
              if (socket && socket !== result.socket) try { socket.terminate(); } catch {}
            }
            resolve(result);
          }).catch(fail);
        }, index * 220);
      });
    });
  }

  async function joinSession(code, username) {
    const invite = decodeInvite(code);
    if (!invite) return { ok: false, error: 'Invalid invite code.' };
    resetNetwork(false);
    const cleanUser = String(username || 'Collaborator').trim().slice(0, 32) || 'Collaborator';
    let connected;
    try { connected = await connectAnyCandidate(invite.a, invite.p, invite, cleanUser); }
    catch (error) {
      resetNetwork(false);
      return { ok: false, error: `Could not reach the project owner. ${error?.message || ''}`.trim() };
    }

    client = connected.socket;
    const welcome = connected.welcome;
    state.role = 'client';
    state.connected = true;
    state.sessionId = welcome.sessionId;
    state.peerId = welcome.peerId;
    state.username = cleanUser;
    state.ownerName = welcome.ownerName;
    state.project = welcome.project;
    state.snapshot = welcome.snapshot;
    state.revision = Number(welcome.revision) || 1;
    state.users = welcome.users || [];
    state.chatHistory = Array.isArray(welcome.chatHistory) ? welcome.chatHistory.slice(-300) : [];
    client.on('close', () => {
      if (!state.connected) return;
      state.connected = false;
      state.users = [];
      emit({ type: 'disconnected' });
      sendState();
    });
    client.on('error', error => emit({ type: 'collab-error', error: error.message }));

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

  function sendClientJson(message) {
    if (client?.readyState !== WebSocket.OPEN) return false;
    try { client.send(JSON.stringify(message)); return true; } catch { return false; }
  }

  async function sendFile(token, text, replyTo) {
    if (!state.connected) return { ok: false, error: 'Not connected to a collaboration session.' };
    const picked = pickedFiles.get(token);
    if (!picked || !fs.existsSync(picked.path)) return { ok: false, error: 'Attachment is no longer available.' };
    const actualStat = fs.statSync(picked.path);
    if (!actualStat.isFile()) return { ok: false, error: 'Attachment is not a file.' };
    if (actualStat.size !== picked.size) return { ok: false, error: 'Attachment changed after it was selected. Select it again.' };
    if (!Number.isSafeInteger(picked.size) || picked.size < 0 || picked.size > MAX_FILE_BYTES) return { ok: false, error: 'File exceeds the 1 GB limit.' };

    const transferId = randomId();
    const messageId = randomId();
    const meta = { transferId, messageId, name: picked.name, size: picked.size, mime: picked.mime, text: String(text || '').slice(0, 8000), replyTo: replyTo || null, timestamp: new Date().toISOString() };
    const prefix = Buffer.alloc(TRANSFER_PREFIX_BYTES);
    prefix.write(transferId, 0, 'utf8');

    if (state.role === 'host') broadcastJson({ type: 'file-start', meta: { ...meta, peerId: 'owner', username: state.username } });
    else if (!sendClientJson({ type: 'file-start', meta })) return { ok: false, error: 'Collaboration connection is closed.' };

    const stream = fs.createReadStream(picked.path, { highWaterMark: FILE_CHUNK_BYTES });
    let sent = 0;
    try {
      for await (const chunk of stream) {
        const packet = Buffer.concat([prefix, chunk]);
        if (state.role === 'host') {
          const sockets = readyPeers().map(peer => peer.ws);
          await waitForBackpressure(sockets);
          broadcastBinary(packet);
        } else {
          if (client?.readyState !== WebSocket.OPEN) throw new Error('Collaboration connection closed during the file transfer.');
          await waitForBackpressure([client]);
          client.send(packet, { binary: true });
        }
        sent += chunk.length;
        emit({ type: 'file-progress', transferId, sent, size: picked.size, incoming: false });
      }
      if (sent !== picked.size) throw new Error(`File read ended early (${sent}/${picked.size} bytes).`);
      if (state.role === 'host') broadcastJson({ type: 'file-end', transferId });
      else if (!sendClientJson({ type: 'file-end', transferId })) throw new Error('Collaboration connection closed before the transfer completed.');
    } catch (error) {
      try { stream.destroy(); } catch {}
      if (state.role === 'host') broadcastJson({ type: 'file-error', transferId, error: error.message });
      else sendClientJson({ type: 'file-error', transferId, error: error.message });
      emit({ type: 'file-error', transferId, error: error.message });
      return { ok: false, error: error.message };
    }

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
    if (!state.connected || !snapshot) return { ok: false, error: 'Not connected to a collaboration session.' };
    if (state.role === 'host') {
      state.revision++;
      state.snapshot = snapshot;
      broadcastJson({ type: 'snapshot', revision: state.revision, snapshot, sourcePeer: 'owner' });
      return { ok: true, revision: state.revision };
    }
    if (!sendClientJson({ type: 'snapshot', snapshot, baseRevision: state.revision })) return { ok: false, error: 'Collaboration connection is closed.' };
    return { ok: true, revision: state.revision };
  });
  ipcMain.handle('collab:send-live-object', (event, object) => {
    if (!state.connected || !object?.id) return false;
    const packet = { type: 'live-object', peerId: state.peerId || 'owner', username: state.username || 'You', object };
    if (state.role === 'host') { broadcastJson(packet); emit(packet); return true; }
    return sendClientJson({ type: 'live-object', object });
  });
  ipcMain.handle('collab:send-selection', (event, selectedId) => {
    if (!state.connected) return false;
    const packet = { type: 'selection', peerId: state.peerId, username: state.username, selectedId: selectedId || null };
    if (state.role === 'host') { broadcastJson(packet); emit(packet); return true; }
    return sendClientJson({ type: 'selection', selectedId });
  });
  ipcMain.handle('collab:send-cursor', (event, point) => {
    if (!state.connected) return false;
    const packet = { type: 'cursor', peerId: state.peerId, username: state.username, point: point || null };
    if (state.role === 'host') { broadcastJson(packet); emit(packet); return true; }
    return sendClientJson({ type: 'cursor', point });
  });
  ipcMain.handle('collab:send-chat', (event, text, replyTo) => {
    if (!state.connected) return { ok: false, error: 'Not connected to a collaboration session.' };
    const message = { id: randomId(), peerId: state.peerId || 'owner', username: state.username || 'You', text: String(text || '').slice(0, 8000), replyTo: replyTo || null, timestamp: new Date().toISOString(), attachment: null };
    if (state.role === 'host') { broadcastJson({ type: 'chat', message }); appendChat(message); }
    else if (!sendClientJson({ type: 'chat', ...message })) return { ok: false, error: 'Collaboration connection is closed.' };
    return { ok: true, message };
  });
  ipcMain.handle('collab:pick-file', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win || undefined, { title: 'Attach file', properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      const filePath = result.filePaths[0];
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { ok: false, error: 'Selected attachment is not a file.' };
      if (stat.size > MAX_FILE_BYTES) return { ok: false, error: 'File exceeds the 1 GB limit.' };
      const token = randomId();
      const ext = path.extname(filePath).toLowerCase();
      const mime = ({ '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp','.svg':'image/svg+xml','.txt':'text/plain','.json':'application/json','.zip':'application/zip','.wav':'audio/wav','.mp4':'video/mp4' })[ext] || 'application/octet-stream';
      const picked = { token, path: filePath, name: path.basename(filePath), size: stat.size, mime, url: pathToFileURL(filePath).href, pickedAt: Date.now() };
      for (const [oldToken, old] of pickedFiles) if (Date.now() - Number(old.pickedAt || 0) > 60 * 60 * 1000) pickedFiles.delete(oldToken);
      while (pickedFiles.size >= 32) pickedFiles.delete(pickedFiles.keys().next().value);
      pickedFiles.set(token, picked);
      return { ok: true, ...picked, path: undefined };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('collab:send-file', (event, token, text, replyTo) => sendFile(token, text, replyTo));
  ipcMain.handle('collab:save-file', async (event, localPath, suggestedName) => {
    if (!localPath || !fs.existsSync(localPath)) return { ok: false, error: 'File is no longer available.' };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win || undefined, { title: 'Save attachment', defaultPath: cleanName(suggestedName || path.basename(localPath)) });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.copyFileSync(localPath, result.filePath);
    return { ok: true, path: result.filePath };
  });
  ipcMain.handle('collab:show-file', async (event, localPath) => {
    if (!localPath || !fs.existsSync(localPath)) return false;
    shell.showItemInFolder(localPath);
    return true;
  });
  ipcMain.handle('collab:list-shared', () => sharedProjects());
  ipcMain.handle('collab:forget-shared', (event, sessionId) => { forgetShared(sessionId); return true; });
}

module.exports = { registerCollaboration };
