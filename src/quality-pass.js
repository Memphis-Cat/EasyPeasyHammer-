// byanca
(() => {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'quality-pass.css';
  document.head.appendChild(style);

  const q = id => document.getElementById(id);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const isLight = o => o?.type === 'entity' && String(o.className || '').startsWith('light_');
  const propertyPreviewCache = new Map();
  const chatState = { open: false, messages: [], replyTo: null, objectUrls: [] };
  let currentProfile = null;
  let currentInviteCode = '';

  function showGate(text, detail = '', blocking = true) {
    let gate = q('ephVersionGate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'ephVersionGate';
      gate.className = 'eph-version-gate';
      gate.innerHTML = `<div class="eph-version-card"><div class="eph-version-mark">EasyPeasyHammer</div><h2 id="ephVersionTitle"></h2><p id="ephVersionDetail"></p><button id="ephVersionExit" type="button">Exit</button></div>`;
      document.body.appendChild(gate);
      q('ephVersionExit').onclick = () => window.easyPeasyHammer?.windowClose?.();
    }
    q('ephVersionTitle').textContent = text;
    q('ephVersionDetail').textContent = detail;
    gate.classList.toggle('blocking', blocking);
    q('ephVersionExit').classList.toggle('hidden', !blocking);
    return gate;
  }

  async function versionGate() {
    if (!window.easyPeasyHammer?.versionStatus) return;
    const gate = showGate('Checking application version…', 'Comparing this build with the current GitHub version.', false);
    try {
      const status = await window.easyPeasyHammer.versionStatus();
      if (status?.outdated) {
        showGate(
          'This build is outdated',
          `Installed ${status.localVersion || 'unknown'} • Current ${status.remoteVersion || 'unknown'}. Ask the developer for the latest EasyPeasyHammer source/build. This version cannot open the editor.`,
          true
        );
        return;
      }
      if (!status?.ok && status?.error) {
        gate.remove();
        toast?.(`Version check unavailable: ${status.error}`);
        return;
      }
      gate.remove();
    } catch {
      gate.remove();
    }
  }

  function startupProfileUi() {
    const card = document.querySelector('.startup-card');
    if (!card || q('ephProfileBlock')) return;
    const block = document.createElement('div');
    block.id = 'ephProfileBlock';
    block.className = 'eph-profile-block';
    block.innerHTML = `
      <div class="eph-profile-head"><span>Your editor username</span><span id="ephProfileState">Not saved</span></div>
      <div class="eph-profile-row">
        <input id="ephUsername" type="text" maxlength="32" autocomplete="off" spellcheck="false" placeholder="Username" />
        <button id="ephSaveUsername" type="button">Save</button>
      </div>
      <div class="eph-profile-hint">Saved locally in a hidden profile file. It will be used by collaboration later.</div>`;
    const subtitle = card.querySelector('.startup-subtitle');
    subtitle?.after(block);

    const join = document.createElement('div');
    join.className = 'eph-join-block';
    join.innerHTML = `
      <div class="eph-join-title">Join a collaboration</div>
      <div class="eph-profile-row">
        <input id="ephInviteInput" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="Invite code" />
        <button id="ephJoinInvite" type="button">Join</button>
      </div>
      <div id="ephJoinedProjects" class="eph-joined-projects"></div>`;
    card.appendChild(join);

    const setProjectButtons = enabled => {
      ['openVmapButton', 'createProjectButton', 'continueButton'].forEach(id => {
        const button = q(id);
        if (button) button.disabled = !enabled;
      });
    };

    const renderJoined = () => {
      const host = q('ephJoinedProjects');
      const stubs = JSON.parse(localStorage.getItem('ephJoinedProjectStubs') || '[]');
      host.innerHTML = stubs.length
        ? stubs.map(x => `<div class="eph-joined-row"><div><strong>Shared project</strong><span>${esc(x.code)}</span></div><button type="button" disabled title="Networking arrives in Phase 4">Open</button></div>`).join('')
        : `<div class="eph-joined-empty">Joined projects will stay listed here once Phase 4 networking is connected.</div>`;
    };

    const saveProfile = async () => {
      const username = q('ephUsername').value.trim();
      if (!username) return toast?.('Enter a username');
      const result = await window.easyPeasyHammer?.setProfile?.(username);
      if (!result?.ok) return toast?.(result?.error || 'Could not save username');
      currentProfile = result.profile;
      q('ephProfileState').textContent = 'Saved';
      setProjectButtons(true);
      toast?.('Username saved');
      if (S.bottomTab === 'collaborators') renderBottom();
    };

    q('ephSaveUsername').onclick = saveProfile;
    q('ephUsername').onkeydown = event => { if (event.key === 'Enter') saveProfile(); };
    q('ephJoinInvite').onclick = () => {
      const code = q('ephInviteInput').value.trim().toUpperCase();
      if (!code) return toast?.('Enter an invite code');
      const stubs = JSON.parse(localStorage.getItem('ephJoinedProjectStubs') || '[]');
      if (!stubs.some(x => x.code === code)) {
        stubs.push({ code, addedAt: Date.now() });
        localStorage.setItem('ephJoinedProjectStubs', JSON.stringify(stubs.slice(-12)));
      }
      renderJoined();
      toast?.('Invite UI saved locally — networking is not enabled yet');
    };

    window.easyPeasyHammer?.getProfile?.().then(result => {
      currentProfile = result?.profile || null;
      if (currentProfile?.username) {
        q('ephUsername').value = currentProfile.username;
        q('ephProfileState').textContent = 'Saved';
        setProjectButtons(true);
      } else {
        setProjectButtons(false);
        q('ephUsername').focus();
      }
    });
    renderJoined();
  }

  function editorCollabUi() {
    const editor = q('editorScreen');
    if (!editor || q('ephChatScreen')) return;
    const chat = document.createElement('section');
    chat.id = 'ephChatScreen';
    chat.className = 'eph-chat-screen hidden';
    chat.innerHTML = `
      <header class="eph-chat-header">
        <div><strong>Collaborator Chat</strong><span id="ephChatProject">Local interface preview</span></div>
        <button id="ephCloseChat" type="button">×</button>
      </header>
      <div id="ephChatMessages" class="eph-chat-messages"></div>
      <div id="ephReplyBar" class="eph-reply-bar hidden"><span id="ephReplyText"></span><button id="ephCancelReply" type="button">×</button></div>
      <div id="ephEmojiTray" class="eph-emoji-tray hidden"></div>
      <footer class="eph-chat-compose">
        <button id="ephEmojiButton" type="button" title="Emoji">☺</button>
        <button id="ephAttachButton" type="button" title="Attach up to 1 GB">＋</button>
        <input id="ephFileInput" type="file" hidden />
        <textarea id="ephChatInput" rows="1" maxlength="8000" placeholder="Message collaborators…"></textarea>
        <button id="ephSendChat" type="button">Send</button>
      </footer>`;
    editor.appendChild(chat);

    const emojis = ['😀','😂','😭','❤️','👍','👎','🔥','✅','❌','👀','🎉','💀','🤝','🛠️','📌','🚀'];
    q('ephEmojiTray').innerHTML = emojis.map(e => `<button type="button">${e}</button>`).join('');
    q('ephEmojiTray').querySelectorAll('button').forEach(button => button.onclick = () => {
      const input = q('ephChatInput');
      input.value += button.textContent;
      input.focus();
    });

    q('ephCloseChat').onclick = closeChat;
    q('ephEmojiButton').onclick = () => q('ephEmojiTray').classList.toggle('hidden');
    q('ephAttachButton').onclick = () => q('ephFileInput').click();
    q('ephCancelReply').onclick = () => setReply(null);
    q('ephSendChat').onclick = sendChat;
    q('ephChatInput').onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChat();
      }
    };
    q('ephFileInput').onchange = event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (file.size > 1024 * 1024 * 1024) return toast?.('Files are limited to 1 GB');
      const url = URL.createObjectURL(file);
      chatState.objectUrls.push(url);
      addChatMessage({
        author: currentProfile?.username || 'You',
        mine: true,
        text: '',
        replyTo: chatState.replyTo,
        attachment: { name: file.name, size: file.size, type: file.type, url, image: file.type.startsWith('image/') }
      });
      setReply(null);
    };
  }

  function openChat() {
    editorCollabUi();
    chatState.open = true;
    q('ephChatScreen').classList.remove('hidden');
    q('ephChatProject').textContent = S.project?.name || 'Project';
    renderChat();
    requestAnimationFrame(() => q('ephChatInput')?.focus());
  }

  function closeChat() {
    chatState.open = false;
    q('ephChatScreen')?.classList.add('hidden');
  }

  function setReply(index) {
    chatState.replyTo = Number.isInteger(index) ? index : null;
    const bar = q('ephReplyBar');
    if (!bar) return;
    if (chatState.replyTo == null || !chatState.messages[chatState.replyTo]) {
      bar.classList.add('hidden');
      return;
    }
    const message = chatState.messages[chatState.replyTo];
    q('ephReplyText').textContent = `Replying to ${message.author}: ${message.text || message.attachment?.name || 'attachment'}`;
    bar.classList.remove('hidden');
  }

  function bytes(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
    return `${(size / 1024 ** 3).toFixed(2)} GB`;
  }

  function renderChat() {
    const host = q('ephChatMessages');
    if (!host) return;
    host.innerHTML = chatState.messages.map((m, index) => {
      const reply = Number.isInteger(m.replyTo) && chatState.messages[m.replyTo]
        ? `<div class="eph-chat-reply">↳ ${esc(chatState.messages[m.replyTo].author)}: ${esc(chatState.messages[m.replyTo].text || chatState.messages[m.replyTo].attachment?.name || 'attachment')}</div>`
        : '';
      const attachment = m.attachment
        ? m.attachment.image
          ? `<a class="eph-chat-image" href="${m.attachment.url}" download="${esc(m.attachment.name)}"><img src="${m.attachment.url}" alt="${esc(m.attachment.name)}" /></a>`
          : `<a class="eph-chat-file" href="${m.attachment.url}" download="${esc(m.attachment.name)}"><span>FILE</span><div><strong>${esc(m.attachment.name)}</strong><small>${bytes(m.attachment.size)}</small></div><b>Download</b></a>`
        : '';
      return `<article class="eph-chat-message ${m.mine ? 'mine' : ''}" data-message="${index}">
        <div class="eph-chat-meta"><strong>${esc(m.author)}</strong><span>${new Date(m.time || Date.now()).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>
        ${reply}${m.text ? `<div class="eph-chat-text">${esc(m.text)}</div>` : ''}${attachment}
        <button class="eph-chat-reply-button" type="button">Reply</button>
      </article>`;
    }).join('');
    host.querySelectorAll('.eph-chat-message').forEach(node => {
      node.querySelector('.eph-chat-reply-button').onclick = () => {
        setReply(Number(node.dataset.message));
        q('ephChatInput').focus();
      };
    });
    host.scrollTop = host.scrollHeight;
  }

  function playBellIfNeeded() {
    if (chatState.open && document.hasFocus()) return;
    if (!window.EPH_BELL1) return;
    try {
      const audio = new Audio(window.EPH_BELL1);
      audio.volume = 0.72;
      audio.play().catch(() => {});
    } catch {}
  }

  function addChatMessage(message, incoming = false) {
    chatState.messages.push({ ...message, time: Date.now() });
    if (chatState.messages.length > 500) chatState.messages.shift();
    renderChat();
    if (incoming) playBellIfNeeded();
  }

  function sendChat() {
    const input = q('ephChatInput');
    const text = input?.value.trim();
    if (!text) return;
    addChatMessage({ author: currentProfile?.username || 'You', mine: true, text, replyTo: chatState.replyTo });
    input.value = '';
    setReply(null);
    q('ephEmojiTray')?.classList.add('hidden');
  }

  window.EPH_COLLAB_RECEIVE = message => addChatMessage({
    author: message?.author || 'Collaborator',
    mine: false,
    text: String(message?.text || ''),
    replyTo: Number.isInteger(message?.replyTo) ? message.replyTo : null,
    attachment: message?.attachment || null
  }, true);

  function collaborationPanel() {
    const host = q('bottomContent');
    if (!host) return;
    if (!currentInviteCode) currentInviteCode = `EPH-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    host.innerHTML = `
      <div class="eph-collab-panel">
        <div class="eph-collab-toolbar">
          <button id="ephInvitePeople" type="button">Invite people</button>
          <button id="ephOpenChat" type="button">Open chat</button>
          <span>Phase 4 interface preview — no network sync yet</span>
        </div>
        <div id="ephInviteBox" class="eph-invite-box hidden">
          <label>Invite code</label><code>${currentInviteCode}</code>
          <button id="ephCopyInvite" type="button">Copy</button>
        </div>
        <div class="eph-collab-list">
          <div class="eph-collab-person"><div class="eph-collab-avatar">${esc((currentProfile?.username || 'Y').slice(0,1).toUpperCase())}</div><div><strong>${esc(currentProfile?.username || 'You')}</strong><span>Owner • local</span></div><button type="button" disabled>You</button></div>
          <div class="eph-collab-person placeholder"><div class="eph-collab-avatar">?</div><div><strong>Connected collaborator</strong><span>Kick control appears here</span></div><button type="button" disabled>Kick</button></div>
        </div>
      </div>`;
    q('ephInvitePeople').onclick = () => q('ephInviteBox').classList.toggle('hidden');
    q('ephOpenChat').onclick = openChat;
    q('ephCopyInvite').onclick = async () => {
      try { await navigator.clipboard.writeText(currentInviteCode); toast?.('Invite code copied'); }
      catch { toast?.(currentInviteCode); }
    };
  }

  function installCollaborationBottom() {
    const rawRenderBottom = renderBottom;
    renderBottom = function() {
      if (S.bottomTab !== 'collaborators') return rawRenderBottom();
      collaborationPanel();
    };
  }

  function parseColor255(value) {
    const nums = String(value || '255 255 255').trim().split(/\s+/).slice(0,3).map(x => clamp(Number(x) || 0, 0, 255));
    while (nums.length < 3) nums.push(255);
    return nums;
  }

  function rgbHex(value) {
    return `#${parseColor255(value).map(n => Math.round(n).toString(16).padStart(2,'0')).join('')}`;
  }

  function hexRgb(value) {
    const h = String(value || '#ffffff').replace('#','').padEnd(6,'f').slice(0,6);
    return `${parseInt(h.slice(0,2),16)} ${parseInt(h.slice(2,4),16)} ${parseInt(h.slice(4,6),16)}`;
  }

  function ensureLight(o) {
    if (!isLight(o)) return;
    o.entityProperties ??= {};
    o.entityProperties.enabled ??= '1';
    o.entityProperties.color ??= '255 244 220';
    o.entityProperties.brightness ??= o.className === 'light_environment' ? '1.5' : '2.0';
    o.entityProperties.range ??= o.className === 'light_environment' ? '0' : '512';
    o.entityProperties.castshadows ??= '1';
    o.entityProperties.style ??= '0';
  }

  async function previewFor(resource) {
    if (!resource || resource === 'ERROR') return null;
    if (!propertyPreviewCache.has(resource)) {
      propertyPreviewCache.set(resource, window.easyPeasyHammer.materialPreview(resource).then(r => r?.ok ? r.url : null).catch(() => null));
    }
    return propertyPreviewCache.get(resource);
  }

  function hydratePropertyPreviews(o) {
    if (o?.type !== 'part') return;
    const rows = [...document.querySelectorAll('#propertiesContent .face-row')];
    rows.forEach((row, i) => {
      const preview = row.querySelector('.material-preview');
      const resource = o.faceMaterials?.[i] || 'ERROR';
      if (!preview) return;
      preview.dataset.resource = resource;
      previewFor(resource).then(url => {
        if (!url || !preview.isConnected || preview.dataset.resource !== resource) return;
        preview.style.backgroundImage = `url("${url}")`;
        preview.classList.remove('error');
        preview.classList.add('real-property-preview');
      });
    });
    const selected = [...S.selectedFaces][0] ?? 0;
    const resource = o.faceMaterials?.[selected] || 'ERROR';
    const row = q('selectedMaterial')?.closest('.material-apply-row');
    if (row && !q('selectedMaterialPreview')) {
      const p = document.createElement('div');
      p.id = 'selectedMaterialPreview';
      p.className = 'material-preview selected-property-preview';
      row.prepend(p);
      previewFor(resource).then(url => {
        if (!url || !p.isConnected) return;
        p.style.backgroundImage = `url("${url}")`;
        p.classList.add('real-property-preview');
      });
    }
  }

  function renderLightProperties(o) {
    ensureLight(o);
    const host = q('propertiesContent');
    const ep = o.entityProperties;
    const range = o.className === 'light_environment' ? '' : `<div class="field-row"><label>Range</label><input id="ephLightRange" class="prop-input" type="number" min="0" step="16" value="${esc(ep.range)}"></div>`;
    host.innerHTML = `
      <div class="property-name-row"><input id="objectName" class="prop-input" value="${esc(o.name)}"><span class="type-badge">LIGHT</span></div>
      <div class="property-section"><div class="property-section-title">Transform</div>${xyz('Position','position',o.position)}${xyz('Rotation','rotation',o.rotation)}</div>
      <div class="property-section"><div class="property-section-title">CS2 Light</div>
        <div class="toggle-row"><span>Enabled</span><button id="ephLightEnabled" class="toggle ${String(ep.enabled) !== '0' ? 'on' : ''}"></button></div>
        <div class="field-row"><label>Color</label><input id="ephLightColor" class="eph-color-input" type="color" value="${rgbHex(ep.color)}"><input id="ephLightColorText" class="prop-input" value="${esc(ep.color)}"></div>
        <div class="field-row"><label>Brightness</label><input id="ephLightBrightness" class="prop-input" type="number" min="0" step=".1" value="${esc(ep.brightness)}"></div>
        ${range}
        <div class="field-row"><label>Cast Shadows</label><select id="ephLightShadows" class="prop-select"><option value="0" ${ep.castshadows==='0'?'selected':''}>No</option><option value="1" ${ep.castshadows==='1'?'selected':''}>Yes</option><option value="2" ${ep.castshadows==='2'?'selected':''}>Baked only</option></select></div>
        <div class="field-row"><label>Appearance</label><select id="ephLightStyle" class="prop-select"><option value="0">Normal</option><option value="10" ${ep.style==='10'?'selected':''}>Fluorescent flicker</option><option value="5" ${ep.style==='5'?'selected':''}>Gentle pulse</option><option value="3" ${ep.style==='3'?'selected':''}>Candle</option><option value="9" ${ep.style==='9'?'selected':''}>Slow strobe</option></select></div>
        ${o.className === 'light_environment' ? `<div class="field-row"><label>Sun Spread</label><input id="ephSunSpread" class="prop-input" type="number" min="0" step=".1" value="${esc(ep.angulardiameter ?? '1')}"></div>` : ''}
      </div>
      <div class="selection-info">This viewport preview uses real-time Three.js lights to approximate the CS2 Source 2 light values.</div>`;

    bindName(o);
    document.querySelectorAll('#propertiesContent .prop-value').forEach(input => input.onchange = () => {
      pushHistory();
      const key = input.dataset.key, index = Number(input.dataset.i), value = Number(input.value);
      if (!Number.isFinite(value)) return;
      o[key][index] = value;
      VMAP.applyObjectToDocument(S.doc, o);
      S.viewport?.updateObject(o);
      markDirty(`Changed ${o.name}`);
    });

    const saveLight = () => {
      VMAP.applyObjectToDocument(S.doc, o);
      S.viewport?.updateObject(o);
      markDirty(`Changed light ${o.name}`);
    };
    q('ephLightEnabled').onclick = () => { pushHistory(); ep.enabled = ep.enabled === '0' ? '1' : '0'; renderProperties(); saveLight(); };
    q('ephLightColor').oninput = event => { ep.color = hexRgb(event.target.value); q('ephLightColorText').value = ep.color; saveLight(); };
    q('ephLightColorText').onchange = event => { ep.color = event.target.value.trim() || '255 255 255'; renderProperties(); saveLight(); };
    q('ephLightBrightness').onchange = event => { ep.brightness = String(Math.max(0, Number(event.target.value) || 0)); saveLight(); };
    if (q('ephLightRange')) q('ephLightRange').onchange = event => { ep.range = String(Math.max(0, Number(event.target.value) || 0)); saveLight(); };
    q('ephLightShadows').onchange = event => { ep.castshadows = event.target.value; saveLight(); };
    q('ephLightStyle').onchange = event => { ep.style = event.target.value; saveLight(); };
    if (q('ephSunSpread')) q('ephSunSpread').onchange = event => { ep.angulardiameter = String(Math.max(0, Number(event.target.value) || 0)); saveLight(); };
  }

  function installPropertyPass() {
    const rawRenderProperties = renderProperties;
    renderProperties = function() {
      const o = ensureObject(current());
      if (isLight(o)) {
        renderLightProperties(o);
        return;
      }
      rawRenderProperties();
      hydratePropertyPreviews(o);
    };
  }

  function installFolders() {
    const tabs = document.querySelector('.right-tabs');
    if (tabs) {
      tabs.querySelectorAll('button').forEach((button, index) => { if (index > 0) button.remove(); });
      if (!q('ephAddFolder')) {
        const add = document.createElement('button');
        add.id = 'ephAddFolder';
        add.type = 'button';
        add.className = 'eph-add-folder';
        add.textContent = '+ Folder';
        tabs.appendChild(add);
        add.onclick = addFolder;
      }
    }

    const rawSnapshot = uiSnapshot;
    uiSnapshot = function() {
      const value = rawSnapshot();
      value.editorFolders = S.objects.filter(o => o.type === 'folder' && o.editorOnly).map(o => ({ id:o.id, name:o.name, parent:o.parent, expanded:o.expanded !== false }));
      value.editorParents = Object.fromEntries(S.objects.filter(o => o.dmxId).map(o => [o.id, o.parent || 'world']));
      value.rotateOuterRing = S.rotateOuterRing !== false;
      return value;
    };

    const rawLoadProject = loadProject;
    loadProject = async function(project, ui) {
      const ok = await rawLoadProject(project, ui);
      if (!ok) return ok;
      S.objects = S.objects.filter(o => o.type !== 'folder' || !o.editorOnly);
      for (const f of ui?.editorFolders || []) {
        S.objects.push({ id:f.id, name:f.name || 'Folder', type:'folder', parent:f.parent || 'world', expanded:f.expanded !== false, editorOnly:true });
      }
      for (const o of S.objects) if (o.dmxId && ui?.editorParents?.[o.id]) o.parent = ui.editorParents[o.id];
      S.rotateOuterRing = ui?.rotateOuterRing !== false;
      renderTree();
      renderProperties();
      S.viewport?.setObjects(S.objects, S.selectedId);
      return ok;
    };
    window.loadProject = loadProject;

    renderTree = function() {
      const root = q('sceneTree');
      if (!root) return;
      root.innerHTML = '';
      const query = q('sceneSearch')?.value.trim().toLowerCase() || '';

      const descendants = id => {
        const out = new Set();
        const walk = parent => S.objects.filter(o => o.parent === parent).forEach(o => { out.add(o.id); walk(o.id); });
        walk(id);
        return out;
      };

      const visibleByQuery = o => {
        if (!query) return true;
        if (String(o.name || '').toLowerCase().includes(query)) return true;
        return S.objects.some(x => x.parent === o.id && visibleByQuery(x));
      };

      function addRow(o, depth) {
        if (!visibleByQuery(o)) return;
        const kids = S.objects.filter(x => x.parent === o.id);
        const row = document.createElement('div');
        row.className = `tree-row${o.id === S.selectedId ? ' selected' : ''}`;
        row.dataset.objectId = o.id;
        row.draggable = o.id !== 'world';
        const icon = o.type === 'world' ? 'hierarchy_world.png' : o.type === 'folder' ? (o.expanded === false ? 'hierarchy_folder_closed.png' : 'hierarchy_folder_open.png') : 'hierarchy_part.png';
        const chevron = kids.length ? (o.expanded === false ? 'hierarchy_chevron_right.png' : 'hierarchy_chevron_down.png') : null;
        row.innerHTML = `<span class="tree-indent" style="width:${depth * 14}px"></span>${chevron ? `<img class="tree-chevron" src="../assets/icons/hierarchy/${chevron}">` : '<span class="tree-chevron"></span>'}<img class="tree-icon" src="../assets/icons/hierarchy/${icon}"><span class="tree-name">${esc(o.name)}</span>${o.dmxId ? `<button class="tree-eye" title="Visibility">${o.visible === false ? '○' : '●'}</button>` : ''}`;
        root.appendChild(row);
        icons(row);

        row.onclick = event => {
          if (event.target.closest('.tree-eye')) {
            event.stopPropagation();
            pushHistory();
            o.visible = o.visible === false;
            VMAP.applyObjectToDocument(S.doc, o);
            S.viewport?.updateObject(o);
            markDirty(`Changed visibility on ${o.name}`);
            return renderTree();
          }
          if (event.target.closest('.tree-chevron') && kids.length) {
            o.expanded = o.expanded === false;
            markDirty();
            return renderTree();
          }
          S.selectedId = o.id;
          S.selectedFaces = new Set([0]);
          S.subSelection = null;
          S.viewport?.select(o.id, false);
          renderTree();
          renderProperties();
        };

        row.querySelector('.tree-name').ondblclick = event => {
          if (o.type !== 'folder') return;
          event.stopPropagation();
          const name = prompt('Folder name', o.name);
          if (!name?.trim()) return;
          o.name = name.trim().slice(0,80);
          markDirty(`Renamed folder to ${o.name}`);
          renderTree(); renderProperties();
        };

        row.ondragstart = event => {
          event.dataTransfer.setData('text/eph-object', o.id);
          event.dataTransfer.effectAllowed = 'move';
        };
        row.ondragover = event => {
          if (!['folder','world'].includes(o.type)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          row.classList.add('drag-target');
        };
        row.ondragleave = () => row.classList.remove('drag-target');
        row.ondrop = event => {
          row.classList.remove('drag-target');
          if (!['folder','world'].includes(o.type)) return;
          event.preventDefault();
          const id = event.dataTransfer.getData('text/eph-object');
          const moving = S.objects.find(x => x.id === id);
          if (!moving || moving.id === o.id) return;
          if (moving.type === 'folder' && descendants(moving.id).has(o.id)) return toast?.('A folder cannot be moved inside itself');
          moving.parent = o.id;
          o.expanded = true;
          markDirty(`Moved ${moving.name} into ${o.name}`);
          renderTree();
        };

        if (o.expanded !== false || query) kids.forEach(k => addRow(k, depth + 1));
      }

      S.objects.filter(o => o.parent == null).forEach(o => addRow(o, 0));
    };
  }

  function addFolder() {
    if (!S.project) return;
    const parent = current()?.type === 'folder' ? current().id : 'world';
    const folder = { id:`folder:${crypto.randomUUID()}`, name:'New Folder', type:'folder', parent, expanded:true, editorOnly:true };
    S.objects.push(folder);
    S.selectedId = folder.id;
    markDirty('Added editor folder');
    renderTree();
    renderProperties();
  }

  function installRotateControls(viewport) {
    const rotate = document.querySelector('.tool-mode[data-tool="rotate"]');
    if (!rotate || q('ephRotateStep')) return;
    const wrap = document.createElement('div');
    wrap.className = 'eph-rotate-controls';
    wrap.innerHTML = `<select id="ephRotateStep" title="Rotation snap"><option>5</option><option>15</option><option>30</option><option selected>45</option><option>90</option><option>180</option></select><button id="ephOuterRing" type="button" title="Show/hide the outer free-rotate ring">Outer ring</button>`;
    rotate.after(wrap);

    const bottom = q('angleSnap');
    if (bottom) {
      for (const n of [90,180]) if (![...bottom.options].some(o => o.value === `${n}°`)) bottom.add(new Option(`${n}°`, `${n}°`));
    }
    const initial = [5,15,30,45,90,180].includes(Number(S.angleSnap)) ? Number(S.angleSnap) : 45;
    q('ephRotateStep').value = String(initial);
    S.angleSnap = initial;

    const applyOuter = () => {
      const visible = S.rotateOuterRing !== false;
      const helper = viewport.transform.getHelper?.();
      helper?.traverse?.(child => {
        if (child.name === 'E' || child.name === 'XYZE') child.visible = visible;
      });
      q('ephOuterRing').classList.toggle('off', !visible);
      q('ephOuterRing').textContent = visible ? 'Outer ring' : 'Ring hidden';
    };
    viewport.setRotateOuterRingVisible = visible => { S.rotateOuterRing = Boolean(visible); applyOuter(); };

    q('ephRotateStep').onchange = event => {
      S.angleSnap = Number(event.target.value) || 45;
      if (bottom) bottom.value = `${S.angleSnap}°`;
      viewport.setSnap(S.snap, S.gridSize, S.angleSnap);
      markDirty();
    };
    q('ephOuterRing').onclick = () => viewport.setRotateOuterRingVisible(S.rotateOuterRing === false);
    rotate.addEventListener('click', () => requestAnimationFrame(applyOuter));
    setTimeout(applyOuter, 0);
  }

  function installMaterialUv(viewport) {
    if (viewport.__ephUvPatch) return;
    viewport.__ephUvPatch = true;
    const raw = viewport.createPartVisual.bind(viewport);
    viewport.createPartVisual = function(object) {
      const mesh = raw(object);
      const geometry = mesh?.geometry;
      const pos = geometry?.getAttribute?.('position');
      if (!geometry || !pos || !geometry.groups?.length || geometry.getAttribute('uv')) return mesh;
      const uv = new Float32Array(pos.count * 2);
      const get = i => [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const cross = (a,b,c) => {
        const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
        return [ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
      };
      for (const group of geometry.groups) {
        const start = group.start, end = group.start + group.count;
        if (group.count < 3) continue;
        const n = cross(get(start), get(start+1), get(start+2));
        const axis = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
        for (let i=start;i<end;i++) {
          const p=get(i);
          let u,v;
          if (axis===0) { u=p[1]/128; v=p[2]/128; }
          else if (axis===1) { u=p[0]/128; v=p[2]/128; }
          else { u=p[0]/128; v=p[1]/128; }
          uv[i*2]=u; uv[i*2+1]=v;
        }
      }
      geometry.setAttribute('uv', new pos.constructor(uv, 2));
      geometry.attributes.uv.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };
  }

  function installSelectionSync(viewport) {
    const canvas = viewport.renderer.domElement;
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || viewport.transform.dragging || viewport.transform.axis) return;
      if (['vertex','edge','face','extrude'].includes(viewport.tool)) return;
      const rect = canvas.getBoundingClientRect();
      viewport.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      viewport.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      viewport.raycaster.setFromCamera(viewport.pointer, viewport.camera);
      const hits = viewport.raycaster.intersectObjects([...viewport.objectRoots.values()], true);
      if (!hits.length) return;
      let root = hits[0].object;
      while (root.parent && root.parent !== viewport.objectGroup) root = root.parent;
      const id = root.userData?.ephId;
      if (!id) return;
      event.stopImmediatePropagation();
      viewport.select(id, true);
      S.selectedId = id;
      S.selectedFaces = new Set([0]);
      S.subSelection = null;
      renderTree();
      renderProperties();
    }, true);
  }

  function installPropPlacement(viewport, THREE) {
    const canvas = viewport.renderer.domElement;
    let lastPointer = null;
    canvas.addEventListener('pointermove', event => {
      const r = canvas.getBoundingClientRect();
      lastPointer = { x:event.clientX-r.left, y:event.clientY-r.top, width:r.width, height:r.height };
    });

    viewport.getPropPlacement = () => {
      const pointer = new THREE.Vector2();
      if (lastPointer) {
        pointer.x = lastPointer.x / lastPointer.width * 2 - 1;
        pointer.y = -(lastPointer.y / lastPointer.height) * 2 + 1;
      } else {
        pointer.set(0,0);
      }
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, viewport.camera);
      const partRoots = S.objects.filter(o => o.type === 'part' && o.visible !== false).map(o => viewport.objectRoots.get(o.id)).filter(Boolean);
      const hits = ray.intersectObjects(partRoots, true);
      let point;
      if (hits.length) {
        point = hits[0].point.clone();
        let normal = hits[0].face?.normal?.clone?.() || new THREE.Vector3(0,0,1);
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hits[0].object.matrixWorld);
        normal.applyMatrix3(normalMatrix).normalize();
        point.addScaledVector(normal, 24);
      } else {
        const plane = new THREE.Plane(new THREE.Vector3(0,0,1), 0);
        point = new THREE.Vector3();
        if (!ray.ray.intersectPlane(plane, point) || point.distanceTo(viewport.camera.position) > 4096) {
          point.copy(viewport.camera.position).add(ray.ray.direction.clone().multiplyScalar(320));
        }
      }
      if (S.snap) {
        point.x = Math.round(point.x / S.gridSize) * S.gridSize;
        point.y = Math.round(point.y / S.gridSize) * S.gridSize;
        point.z = Math.round(point.z / S.gridSize) * S.gridSize;
      }
      return [point.x,point.y,point.z];
    };

    addProp = function(item) {
      if (!S.doc) return;
      const model = item?.model || item?.path || '';
      if (!model) return toast?.('That prop has no model path');
      pushHistory();
      viewport.loadModel?.(model);
      const object = ensureObject(VMAP.addEntity(S.doc, {
        className: item?.className || 'prop_static',
        model,
        position: viewport.getPropPlacement(),
        collision: true
      }));
      object.type = 'prop';
      object.model = model;
      object.size = [64,64,64];
      S.objects.push(object);
      S.selectedId = object.id;
      S.selectedFaces = new Set([0]);
      viewport.objects = S.objects;
      viewport.updateObject(object);
      viewport.select(object.id, false);
      setTool('move');
      markDirty(`Added prop ${model}`);
      renderTree(); renderProperties();
    };
  }

  function installLightPreview(viewport, THREE) {
    viewport.renderer.shadowMap.enabled = true;
    viewport.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const rawMarker = viewport.createEntityMarker.bind(viewport);
    viewport.createEntityMarker = function(object) {
      if (!isLight(object)) return rawMarker(object);
      ensureLight(object);
      const ep = object.entityProperties;
      const [r,g,b] = parseColor255(ep.color);
      const color = new THREE.Color(r/255,g/255,b/255);
      const enabled = String(ep.enabled) !== '0';
      const brightness = Math.max(0, Number(ep.brightness) || 0);
      const range = Math.max(0, Number(ep.range) || 0);
      const group = new THREE.Group();
      const marker = new THREE.Mesh(new THREE.SphereGeometry(9,12,8), new THREE.MeshBasicMaterial({ color, wireframe:true }));
      group.add(marker);
      if (object.className === 'light_environment') {
        const light = new THREE.DirectionalLight(color, enabled ? brightness * 1.3 : 0);
        light.position.set(0,0,96);
        light.target.position.set(0,96,0);
        group.add(light, light.target);
        light.castShadow = ep.castshadows === '1';
        light.shadow.mapSize.set(1024,1024);
      } else {
        const light = new THREE.PointLight(color, enabled ? Math.max(1, brightness * 90) : 0, range || 0, 2);
        light.castShadow = ep.castshadows === '1';
        light.shadow.mapSize.set(512,512);
        group.add(light);
        const ring = new THREE.Mesh(new THREE.SphereGeometry(Math.max(24, Math.min(range || 128, 256)), 16, 10), new THREE.MeshBasicMaterial({ color, wireframe:true, transparent:true, opacity:.05, depthWrite:false }));
        group.add(ring);
      }
      group.userData.ephVisual = true;
      return group;
    };

    const baseLights = viewport.scene.children.filter(x => x.isHemisphereLight || x.isDirectionalLight);
    const rawSetObjects = viewport.setObjects.bind(viewport);
    viewport.setObjects = function(objects, selectedId = null) {
      const result = rawSetObjects(objects, selectedId);
      const hasLights = (objects || []).some(isLight);
      baseLights.forEach(light => {
        if (light.isHemisphereLight) light.intensity = hasLights ? .35 : 1.65;
        else if (light.isDirectionalLight && !light.parent?.userData?.ephVisual) light.intensity = hasLights ? .35 : 2.0;
      });
      return result;
    };
  }

  function addLightEntity() {
    if (!ENTITIES.some(x => x.className === 'light_omni2')) ENTITIES.push({ name:'Light Omni', className:'light_omni2', kind:'entity' });
  }

  async function installViewportQuality(viewport) {
    if (!viewport || viewport.__ephQualityPass) return;
    viewport.__ephQualityPass = true;
    const THREE = await import('three');
    installMaterialUv(viewport);
    installRotateControls(viewport);
    installSelectionSync(viewport);
    installPropPlacement(viewport, THREE);
    installLightPreview(viewport, THREE);
    if (S.project) viewport.setObjects(S.objects, S.selectedId);
  }

  function start() {
    versionGate();
    startupProfileUi();
    editorCollabUi();
    installCollaborationBottom();
    installPropertyPass();
    installFolders();
    addLightEntity();
    if (window.EPH3D) installViewportQuality(window.EPH3D);
    window.addEventListener('eph3d-ready', event => installViewportQuality(event.detail), { once:true });
  }

  start();
})();
