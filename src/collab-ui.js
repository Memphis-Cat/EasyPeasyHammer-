// byanca
(() => {
  'use strict';

  if (window.__ephFloatingChatInstalled) return;
  window.__ephFloatingChatInstalled = true;

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'collab-ui.css';
  document.head.appendChild(style);

  const api = window.easyPeasyHammer;
  const HOTKEYS = new Set(['y', 'u', 'j', 'k']);
  const MAX_PASSIVE_MESSAGES = 6;
  let username = 'You';
  let state = { connected: false, users: [], chatHistory: [], peerId: null };
  let replyTo = null;
  let pickedImage = null;
  let fadeTimer = null;
  let collapseTimer = null;
  let transferTimer = null;
  const activeSounds = new Set();

  api.getProfile?.().then(result => {
    username = result?.profile?.username || 'You';
    window.EPH_COLLAB_RENDER?.();
  }).catch(() => {});

  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const editableTarget = target => Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"], dialog'));
  const messageById = id => state.chatHistory?.find(message => message.id === id) || null;

  function createFloatingChat() {
    const root = document.createElement('section');
    root.id = 'ephFloatingChat';
    root.className = 'eph-floating-chat eph-chat-faded';
    root.hidden = true;
    root.innerHTML = `
      <div class="eph-chat-hover-zone" aria-hidden="true"></div>
      <div id="ephFloatingChatMessages" class="eph-floating-chat-messages" aria-live="polite"></div>
      <button id="ephFloatingChatHoverSend" class="eph-floating-chat-hover-send" type="button">Send</button>
      <div id="ephFloatingChatReply" class="eph-floating-chat-reply" hidden><span></span><button type="button" aria-label="Cancel reply">×</button></div>
      <div class="eph-floating-chat-composer">
        <button id="ephFloatingChatImage" class="eph-floating-chat-image-button" type="button" title="Add image">＋</button>
        <textarea id="ephFloatingChatInput" rows="1" maxlength="8000" placeholder="Message collaborators..." spellcheck="true"></textarea>
        <button id="ephFloatingChatSend" class="eph-floating-chat-send" type="button">Send</button>
      </div>
      <div id="ephFloatingChatDraft" class="eph-floating-chat-draft" hidden></div>
      <div id="ephFloatingChatStatus" class="eph-floating-chat-status" hidden></div>`;
    document.body.appendChild(root);
    return root;
  }

  const root = createFloatingChat();
  const messages = root.querySelector('#ephFloatingChatMessages');
  const input = root.querySelector('#ephFloatingChatInput');
  const hoverSend = root.querySelector('#ephFloatingChatHoverSend');
  const sendButton = root.querySelector('#ephFloatingChatSend');
  const imageButton = root.querySelector('#ephFloatingChatImage');
  const replyBar = root.querySelector('#ephFloatingChatReply');
  const draft = root.querySelector('#ephFloatingChatDraft');
  const status = root.querySelector('#ephFloatingChatStatus');
  const hoverZone = root.querySelector('.eph-chat-hover-zone');

  function scheduleFade(delay = 4200) {
    clearTimeout(fadeTimer);
    if (root.classList.contains('eph-chat-open') || root.classList.contains('eph-chat-hovering')) return;
    fadeTimer = setTimeout(() => root.classList.add('eph-chat-faded'), delay);
  }

  function wakeChat(delay = 6500) {
    if (!state.connected) return;
    root.hidden = false;
    root.classList.remove('eph-chat-faded');
    scheduleFade(delay);
  }

  function clearStatusLater() {
    clearTimeout(transferTimer);
    transferTimer = setTimeout(() => {
      status.hidden = true;
      status.textContent = '';
    }, 1400);
  }

  function showStatus(text, temporary = true) {
    clearTimeout(transferTimer);
    status.hidden = false;
    status.textContent = text;
    wakeChat(8000);
    if (temporary) clearStatusLater();
  }

  function clearReply() {
    replyTo = null;
    replyBar.hidden = true;
    replyBar.querySelector('span').textContent = '';
  }

  function setReply(message) {
    if (!message?.id) return;
    replyTo = message.id;
    const summary = String(message.text || (message.attachment ? 'Image' : '')).slice(0, 90);
    replyBar.querySelector('span').textContent = `Replying to ${message.username || 'Collaborator'}${summary ? `: ${summary}` : ''}`;
    replyBar.hidden = false;
    openChat();
  }

  function clearDraft() {
    pickedImage = null;
    draft.hidden = true;
    draft.replaceChildren();
  }

  function setDraft(image) {
    pickedImage = image;
    draft.replaceChildren();
    if (!image) return clearDraft();
    const label = document.createElement('span');
    label.textContent = image.name || 'Image';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Remove image';
    remove.onclick = clearDraft;
    draft.append(label, remove);
    draft.hidden = false;
  }

  async function hydrateImage(image, attachment) {
    if (!attachment?.localPath) return;
    try {
      const result = await api.collabAttachmentData?.(attachment.localPath, attachment.size);
      if (result?.ok && result.dataUrl && image.isConnected) image.src = result.dataUrl;
      else image.classList.add('eph-chat-image-failed');
    } catch {
      image.classList.add('eph-chat-image-failed');
    }
  }

  function renderMessage(message) {
    const article = document.createElement('article');
    article.className = `eph-floating-chat-message${message.peerId === state.peerId ? ' own' : ''}`;
    article.dataset.messageId = message.id || '';

    const line = document.createElement('div');
    line.className = 'eph-floating-chat-line';
    const author = document.createElement('strong');
    author.textContent = `${message.username || 'Collaborator'}:`;
    line.appendChild(author);
    if (message.text) {
      const text = document.createElement('span');
      text.textContent = message.text;
      line.appendChild(text);
    }
    article.appendChild(line);

    if (message.replyTo) {
      const original = messageById(message.replyTo);
      const reply = document.createElement('div');
      reply.className = 'eph-floating-chat-quoted';
      reply.textContent = original ? `↳ ${original.username || 'Collaborator'}: ${String(original.text || (original.attachment ? 'Image' : '')).slice(0, 100)}` : '↳ Reply';
      article.insertBefore(reply, line);
    }

    if (message.attachment?.mime?.startsWith('image/')) {
      const image = document.createElement('img');
      image.className = 'eph-floating-chat-image';
      image.alt = message.attachment.name || 'Chat image';
      article.appendChild(image);
      hydrateImage(image, message.attachment);
    }

    return article;
  }

  function renderMessages() {
    const history = Array.isArray(state.chatHistory) ? state.chatHistory : [];
    messages.replaceChildren(...history.map(renderMessage));
    messages.scrollTop = messages.scrollHeight;
    root.dataset.passiveCount = String(Math.min(MAX_PASSIVE_MESSAGES, history.length));
  }

  function syncVisibility() {
    const editorVisible = !document.getElementById('editorScreen')?.classList.contains('hidden');
    root.hidden = !state.connected || !editorVisible;
    if (!root.hidden && state.chatHistory?.length) wakeChat(2200);
  }

  function openChat() {
    if (!state.connected) {
      toast?.('Start or join collaboration to use chat');
      return;
    }
    clearTimeout(collapseTimer);
    clearTimeout(fadeTimer);
    root.hidden = false;
    root.classList.add('eph-chat-open');
    root.classList.remove('eph-chat-faded', 'eph-chat-hovering');
    renderMessages();
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      messages.scrollTop = messages.scrollHeight;
    });
  }

  function collapseChat() {
    if (!root.classList.contains('eph-chat-open')) return;
    root.classList.remove('eph-chat-open');
    input.blur();
    scheduleFade(500);
  }

  async function pickImage() {
    const result = await api.collabPickFile?.();
    if (!result) return;
    if (!result.ok) return showStatus(result.error || 'Could not select image.');
    if (!String(result.mime || '').startsWith('image/')) return showStatus('Only images can be sent in chat.');
    setDraft(result);
    openChat();
  }

  async function stagePastedImage(file) {
    if (!file?.type?.startsWith('image/')) return false;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const staged = await api.collabStageImage?.({
        name: file.name || `pasted-image-${Date.now()}`,
        mime: file.type,
        bytes,
      });
      if (!staged?.ok) {
        showStatus(staged?.error || 'Could not paste image.');
        return true;
      }
      // The main-process bridge queues the temporary clipboard image for the
      // existing collaboration picker, so the proven file-transfer/token path
      // is reused without exposing filesystem paths to the sandboxed renderer.
      const result = await api.collabPickFile?.();
      if (!result?.ok) {
        showStatus(result?.error || 'Could not prepare pasted image.');
        return true;
      }
      setDraft(result);
      openChat();
      return true;
    } catch (error) {
      showStatus(error?.message || 'Could not paste image.');
      return true;
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text && !pickedImage) return;
    if (!state.connected) return showStatus('Collaboration is disconnected.');
    sendButton.disabled = true;
    try {
      const result = pickedImage
        ? await api.collabSendFile?.(pickedImage.token, text, replyTo)
        : await api.collabSendChat?.(text, replyTo);
      if (!result?.ok) return showStatus(result?.error || 'Message could not be sent.');
      input.value = '';
      input.style.height = '';
      clearReply();
      clearDraft();
      wakeChat(6500);
    } finally {
      sendButton.disabled = false;
      if (root.classList.contains('eph-chat-open')) input.focus({ preventScroll: true });
    }
  }

  hoverZone.addEventListener('pointerenter', event => {
    if (event.buttons !== 0 || root.classList.contains('eph-chat-open')) return;
    clearTimeout(fadeTimer);
    root.classList.add('eph-chat-hovering');
    root.classList.remove('eph-chat-faded');
  });
  root.addEventListener('pointerleave', event => {
    if (event.buttons !== 0 || root.classList.contains('eph-chat-open')) return;
    root.classList.remove('eph-chat-hovering');
    scheduleFade(450);
  });
  hoverSend.onclick = openChat;
  imageButton.onclick = pickImage;
  sendButton.onclick = send;
  replyBar.querySelector('button').onclick = clearReply;

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(112, input.scrollHeight)}px`;
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      collapseChat();
    }
  });
  input.addEventListener('paste', async event => {
    const image = [...(event.clipboardData?.items || [])]
      .find(item => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile?.();
    if (!image) return;
    event.preventDefault();
    await stagePastedImage(image);
  });

  messages.addEventListener('contextmenu', event => {
    if (!root.classList.contains('eph-chat-open')) return;
    const row = event.target.closest('.eph-floating-chat-message');
    if (!row) return;
    event.preventDefault();
    setReply(messageById(row.dataset.messageId));
  });

  document.addEventListener('pointerdown', event => {
    if (!root.classList.contains('eph-chat-open') || root.contains(event.target)) return;
    collapseTimer = setTimeout(collapseChat, 0);
  }, true);

  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || editableTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (!HOTKEYS.has(key)) return;
    const editor = document.getElementById('editorScreen');
    if (!editor || editor.classList.contains('hidden')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openChat();
  }, true);

  async function renderCollaborators() {
    const host = document.getElementById('bottomContent');
    if (!host || S.bottomTab !== 'collaborators') return;
    const live = window.EPH_COLLAB?.state?.() || await api.collabState?.() || { connected: false, users: [] };
    const isOwner = live.role === 'host';
    const users = live.users?.length ? live.users : [{ peerId: live.peerId || 'local', username, owner: isOwner }];

    host.innerHTML = `<div class="collab-interface">
      <div class="collab-toolbar">
        ${isOwner && live.connected ? '<button id="generateInvite" type="button">Invite people</button>' : !live.connected ? '<button id="generateInvite" type="button">Start collaboration</button>' : ''}
        ${live.connected ? '<button id="leaveCollab" type="button">Leave session</button>' : ''}
        <span class="collab-live-state ${live.connected ? 'online' : ''}">${live.connected ? `${users.length} connected` : 'Not connected'}</span>
      </div>
      ${isOwner && live.connected ? `<div id="inviteCodeBox" class="collab-code"><span>Invite code</span><code>${escHtml(live.inviteCode || '')}</code><button id="copyInvite" type="button">Copy</button></div>` : ''}
      <div class="collab-list">${users.map(user => `<div class="collab-person"><span class="collab-presence-dot"></span><div class="collab-person-name"><strong>${escHtml(user.username || 'Collaborator')}</strong><br><small>${user.owner ? 'Owner' : 'Collaborator'}</small></div>${isOwner && !user.owner && user.peerId !== live.peerId ? `<button class="collab-kick" data-peer="${escHtml(user.peerId)}">Kick</button>` : ''}</div>`).join('')}</div>
    </div>`;

    const invite = host.querySelector('#generateInvite');
    if (invite) invite.onclick = async () => {
      invite.disabled = true;
      const result = await window.EPH_COLLAB?.host?.();
      if (!result?.ok) toast(result?.error || 'Could not start collaboration');
      await window.EPH_COLLAB?.refreshState?.();
      renderCollaborators();
    };
    host.querySelector('#copyInvite')?.addEventListener('click', async () => {
      const text = live.inviteCode || '';
      try {
        const result = await api.copyText?.(text);
        if (result?.ok) { toast('Invite code copied'); return; }
        await navigator.clipboard.writeText(text);
        toast('Invite code copied');
      } catch { toast('Could not copy invite code'); }
    });
    host.querySelector('#leaveCollab')?.addEventListener('click', async () => {
      await window.EPH_COLLAB?.leave?.();
      renderCollaborators();
    });
    host.querySelectorAll('.collab-kick').forEach(button => button.onclick = async () => {
      const result = await window.EPH_COLLAB?.kick?.(button.dataset.peer);
      if (!result?.ok) toast(result?.error || 'Could not remove collaborator');
    });
  }

  if (typeof renderBottom === 'function' && !renderBottom.__ephCollabUi) {
    const original = renderBottom;
    renderBottom = function() {
      original();
      if (S.bottomTab === 'collaborators') renderCollaborators();
    };
    renderBottom.__ephCollabUi = true;
  }

  const inviteInput = document.getElementById('ephInviteCode');
  if (inviteInput) { inviteInput.maxLength = 4096; inviteInput.placeholder = 'Paste invite code'; }

  api.onCollaborationEvent?.(event => {
    if (event?.type === 'state') {
      state = { ...state, ...(event.state || {}) };
      renderMessages();
      syncVisibility();
      renderCollaborators();
    } else if (event?.type === 'presence') {
      state.users = event.users || [];
      renderCollaborators();
    } else if (event?.type === 'chat' && event.message) {
      state.chatHistory ||= [];
      if (!state.chatHistory.some(message => message.id === event.message.id)) state.chatHistory.push(event.message);
      if (state.chatHistory.length > 300) state.chatHistory.splice(0, state.chatHistory.length - 300);
      renderMessages();
      wakeChat(7000);
    } else if (event?.type === 'file-progress') {
      const total = Math.max(0, Number(event.size) || 0);
      const done = Math.max(0, Number(event.sent ?? event.received) || 0);
      const percent = total ? Math.min(100, Math.round(done / total * 100)) : 100;
      showStatus(`${event.incoming ? 'Receiving' : 'Sending'} image… ${percent}%`, percent >= 100);
    } else if (event?.type === 'file-error') {
      showStatus(event.error || 'Image transfer failed.');
    } else if (event?.type === 'kicked' || event?.type === 'disconnected') {
      state.connected = false;
      syncVisibility();
    }
  });

  window.EPH_COLLAB_RENDER = renderCollaborators;
  window.EPH_FLOATING_CHAT = { open: openChat, close: collapseChat, wake: wakeChat };
  window.EPH_COLLAB_NOTIFY = async () => {
    if (root.classList.contains('eph-chat-open') && document.activeElement === input) return;
    if (!window.EPH_BELL1) return;
    const sound = new Audio(window.EPH_BELL1);
    sound.volume = 1;
    activeSounds.add(sound);
    const release = () => activeSounds.delete(sound);
    sound.addEventListener('ended', release, { once: true });
    sound.addEventListener('error', release, { once: true });
    sound.play().catch(release);
  };

  const editorScreen = document.getElementById('editorScreen');
  if (editorScreen) new MutationObserver(syncVisibility).observe(editorScreen, { attributes: true, attributeFilter: ['class'] });

  (async () => {
    try { state = { ...state, ...(await api.collabState?.()) }; } catch {}
    renderMessages();
    syncVisibility();
  })();
})();
