// byanca
(() => {
  const api = window.easyPeasyHammer;
  const messages = document.getElementById('chatMessages');
  const input = document.getElementById('chatInput');
  const fileDraft = document.getElementById('chatFileDraft');
  const replying = document.getElementById('chatReplying');
  const people = document.getElementById('chatPeople');
  let state = { connected: false, users: [], chatHistory: [], peerId: null };
  let replyTo = null;
  let pickedFile = null;
  const rendered = new Set();

  const fmtBytes = bytes => {
    const n = Number(bytes) || 0;
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
    if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  };

  function messageById(id) { return state.chatHistory?.find(x => x.id === id) || null; }
  function textNode(tag, text, className = '') {
    const node = document.createElement(tag); if (className) node.className = className; node.textContent = text; return node;
  }
  function renderPeople() {
    const users = state.users || [];
    people.textContent = state.connected ? `${users.length || 1} connected` : 'Disconnected';
  }
  async function hydrateImage(image, attachment) {
    if (!image || !attachment) return;
    if (attachment.localPath && api.collabAttachmentData) {
      try {
        const result = await api.collabAttachmentData(attachment.localPath);
        if (result?.ok && result.dataUrl) { image.src = result.dataUrl; return; }
      } catch {}
    }
    if (attachment.url) image.src = attachment.url;
  }
  function renderMessage(message) {
    if (!message?.id || rendered.has(message.id)) return;
    rendered.add(message.id);
    const article = document.createElement('article');
    article.className = `chat-message${message.peerId === state.peerId ? ' own' : ''}`;
    article.dataset.messageId = message.id;
    article.appendChild(textNode('div', `${message.username || 'Collaborator'} • ${new Date(message.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'chat-meta'));
    if (message.replyTo) {
      const original = messageById(message.replyTo);
      article.appendChild(textNode('div', original ? `Reply to ${original.username}: ${String(original.text || original.attachment?.name || '').slice(0, 120)}` : 'Reply', 'chat-reply'));
    }
    if (message.text) article.appendChild(textNode('div', message.text, 'chat-text'));
    if (message.attachment) {
      const card = document.createElement('div'); card.className = 'chat-file-card';
      if (message.attachment.mime?.startsWith('image/')) {
        const image = document.createElement('img');
        image.className = 'chat-image-preview';
        image.alt = message.attachment.name || 'Image';
        card.appendChild(image);
        hydrateImage(image, message.attachment);
      }
      const info = document.createElement('div'); info.className = 'chat-file-info';
      const label = textNode('span', `${message.attachment.name || 'file'} • ${fmtBytes(message.attachment.size)}`);
      info.appendChild(label);
      if (message.attachment.localPath) {
        const save = textNode('button', 'Save'); save.type = 'button';
        save.onclick = async () => {
          save.disabled = true;
          try {
            const result = await api.collabSaveFile(message.attachment.localPath, message.attachment.name);
            if (!result?.ok && !result?.canceled) fileDraft.textContent = result?.error || 'Could not save attachment.';
          } finally { save.disabled = false; }
        };
        const show = textNode('button', 'Show'); show.type = 'button';
        show.onclick = async () => {
          show.disabled = true;
          try {
            const result = await api.collabShowFile(message.attachment.localPath);
            if (!result?.ok) fileDraft.textContent = result?.error || 'Could not show attachment.';
          } finally { show.disabled = false; }
        };
        info.append(save, show);
      }
      card.appendChild(info); article.appendChild(card);
    }
    messages.appendChild(article);
    messages.scrollTop = messages.scrollHeight;
  }
  function renderAll() {
    messages.replaceChildren(); rendered.clear();
    for (const message of state.chatHistory || []) renderMessage(message);
    renderPeople();
  }
  function clearReply() { replyTo = null; replying.classList.remove('visible'); replying.querySelector('span').textContent = ''; }
  function setReply(message) {
    replyTo = message?.id || null;
    if (!replyTo) return clearReply();
    replying.querySelector('span').textContent = `Replying to ${message.username || 'Collaborator'}: ${String(message.text || message.attachment?.name || '').slice(0, 100)}`;
    replying.classList.add('visible'); input.focus();
  }
  function clearFile() { pickedFile = null; fileDraft.textContent = 'Attach images or files up to 1 GB.'; }

  document.getElementById('chatMinimize').onclick = () => api.windowMinimize();
  document.getElementById('chatMaximize').onclick = () => api.windowToggleMaximize();
  document.getElementById('chatClose').onclick = () => api.windowClose();
  document.getElementById('cancelReply').onclick = clearReply;
  document.getElementById('chatAttach').onclick = async () => {
    const result = await api.collabPickFile();
    if (!result) return;
    if (!result.ok) { fileDraft.textContent = result.error || 'Could not attach file.'; return; }
    pickedFile = result;
    fileDraft.replaceChildren();
    if (result.mime?.startsWith('image/') && result.url) {
      const img = document.createElement('img'); img.className = 'chat-draft-image'; img.src = result.url; img.alt = result.name; fileDraft.appendChild(img);
    }
    fileDraft.appendChild(textNode('span', `${result.name} • ${fmtBytes(result.size)}`));
    const remove = textNode('button', '×'); remove.type = 'button'; remove.onclick = clearFile; fileDraft.appendChild(remove);
  };

  messages.addEventListener('contextmenu', event => {
    const row = event.target.closest('.chat-message'); if (!row) return;
    event.preventDefault(); setReply(messageById(row.dataset.messageId));
  });

  async function send() {
    const text = input.value.trim();
    if (!text && !pickedFile) return;
    const sendButton = document.getElementById('chatSend'); sendButton.disabled = true;
    try {
      let result;
      if (pickedFile) result = await api.collabSendFile(pickedFile.token, text, replyTo);
      else result = await api.collabSendChat(text, replyTo);
      if (!result?.ok) { fileDraft.textContent = result?.error || 'Message could not be sent.'; return; }
      input.value = ''; clearReply(); clearFile();
    } finally { sendButton.disabled = false; input.focus(); }
  }
  document.getElementById('chatSend').onclick = send;
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } });

  api.onCollaborationEvent?.(event => {
    if (event?.type === 'state') { state = { ...state, ...event.state }; renderPeople(); }
    else if (event?.type === 'presence') { state.users = event.users || []; renderPeople(); }
    else if (event?.type === 'chat' && event.message) {
      state.chatHistory ||= [];
      if (!state.chatHistory.some(x => x.id === event.message.id)) state.chatHistory.push(event.message);
      renderMessage(event.message);
    } else if (event?.type === 'file-progress') {
      const total = Number(event.size) || 1; const done = Number(event.sent ?? event.received) || 0;
      fileDraft.textContent = `${event.incoming ? 'Receiving' : 'Sending'} file… ${Math.min(100, Math.round(done / total * 100))}%`;
    } else if (event?.type === 'kicked') {
      state.connected = false; renderPeople(); fileDraft.textContent = event.reason || 'Removed from project.';
    } else if (event?.type === 'disconnected') { state.connected = false; renderPeople(); }
  });

  (async () => {
    state = await api.collabState(); renderAll(); input.focus();
  })();
})();
