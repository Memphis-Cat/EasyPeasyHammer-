// byanca
(() => {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'collab-ui.css';
  document.head.appendChild(style);

  let username = 'You';
  window.easyPeasyHammer.getProfile?.().then(result => { username = result?.profile?.username || 'You'; }).catch(() => {});

  const chat = document.createElement('section');
  chat.id = 'collabChatScreen';
  chat.className = 'collab-chat-screen hidden';
  chat.innerHTML = `
    <div class="chat-header"><button id="closeCollabChat" type="button">← Back</button><strong>Project chat</strong><span class="collab-phase-note">Phase 4 interface</span></div>
    <div id="chatMessages" class="chat-messages"><div class="chat-message"><div class="meta">EasyPeasyHammer</div><div>Collaboration chat is ready visually. Networking will be connected in Phase 4.</div><div class="chat-file-card">Replies, emoji, images and files up to 1 GB are represented by this interface.</div></div></div>
    <div class="chat-composer">
      <div id="chatReplying" class="chat-replying">Replying to a message <button id="cancelReply" type="button">×</button></div>
      <div id="chatEmojiPicker" class="chat-emoji-picker">${['😀','😂','❤️','👍','🔥','😭','💀','✅','👀','🎉'].map(x=>`<button type="button">${x}</button>`).join('')}</div>
      <div class="chat-compose-row"><button id="chatEmoji" type="button" title="Emoji">☺</button><button id="chatAttach" type="button" title="Attach up to 1 GB">＋</button><textarea id="chatInput" placeholder="Message collaborators..."></textarea><button id="chatSend" class="chat-send" type="button">Send</button></div>
      <input id="chatFileInput" type="file" hidden><div id="chatFileDraft" class="chat-file-note">Files: up to 1 GB. Images will preview inline. Other files will appear as downloadable file cards once networking is implemented.</div>
    </div>`;
  document.body.appendChild(chat);

  const messages = chat.querySelector('#chatMessages');
  const input = chat.querySelector('#chatInput');
  const picker = chat.querySelector('#chatEmojiPicker');
  const fileInput = chat.querySelector('#chatFileInput');
  const fileDraft = chat.querySelector('#chatFileDraft');
  const replying = chat.querySelector('#chatReplying');

  chat.querySelector('#closeCollabChat').onclick = () => chat.classList.add('hidden');
  chat.querySelector('#chatEmoji').onclick = () => picker.classList.toggle('visible');
  picker.querySelectorAll('button').forEach(button => button.onclick = () => { input.value += button.textContent; input.focus(); });
  chat.querySelector('#chatAttach').onclick = () => fileInput.click();
  chat.querySelector('#cancelReply').onclick = () => replying.classList.remove('visible');
  fileInput.onchange = () => {
    const file = fileInput.files?.[0]; if (!file) return;
    if (file.size > 1024 * 1024 * 1024) { fileDraft.textContent = 'That file is larger than the 1 GB limit.'; fileInput.value = ''; return; }
    fileDraft.textContent = `${file.name} • ${(file.size / 1024 / 1024).toFixed(file.size > 1024 * 1024 ? 1 : 3)} MB • ready for Phase 4 upload`;
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      const preview = document.createElement('img'); preview.className = 'chat-image-preview'; preview.src = url; preview.alt = file.name;
      fileDraft.replaceChildren(preview, document.createTextNode(` ${file.name}`));
    }
  };
  messages.addEventListener('contextmenu', event => {
    if (!event.target.closest('.chat-message')) return;
    event.preventDefault(); replying.classList.add('visible'); input.focus();
  });
  chat.querySelector('#chatSend').onclick = () => toast('Chat sending will be connected in Phase 4');

  function renderCollaborators() {
    const host = document.getElementById('bottomContent'); if (!host) return;
    host.innerHTML = `<div class="collab-interface"><div class="collab-toolbar"><button id="generateInvite" type="button">Invite people</button><button id="openChat" type="button">Open chat</button></div><div id="inviteCodeBox" class="collab-code"><span>Invite code</span><code>----</code><button id="copyInvite" type="button" disabled>Copy</button></div><div class="collab-list"><div class="collab-person"><div class="collab-person-name"><strong>${username}</strong><br><small>Owner</small></div></div><div class="collab-person"><div class="collab-person-name"><small>Invited collaborators will appear here.</small></div><button class="collab-kick" disabled>Kick</button></div></div><div class="collab-phase-note">Interface only: code generation, joining, kicking, message delivery and file transfer intentionally have no network logic yet.</div></div>`;
    host.querySelector('#openChat').onclick = () => { chat.classList.remove('hidden'); input.focus(); };
    host.querySelector('#generateInvite').onclick = () => { host.querySelector('#inviteCodeBox code').textContent = 'PHASE4-CODE'; toast('Invite code generation will be enabled in Phase 4'); };
  }

  if (typeof renderBottom === 'function' && !renderBottom.__ephCollabUi) {
    const original = renderBottom;
    renderBottom = function() {
      original();
      if (S.bottomTab === 'collaborators') renderCollaborators();
    };
    renderBottom.__ephCollabUi = true;
  }

  window.EPH_COLLAB_NOTIFY = () => {
    if (!chat.classList.contains('hidden') && document.hasFocus()) return;
    if (window.EPH_BELL1) new Audio(window.EPH_BELL1).play().catch(() => {});
  };
})();
