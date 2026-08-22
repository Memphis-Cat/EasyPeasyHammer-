// byanca
(() => {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'collab-ui.css';
  document.head.appendChild(style);

  const api = window.easyPeasyHammer;
  let username = 'You';
  api.getProfile?.().then(result => { username = result?.profile?.username || 'You'; window.EPH_COLLAB_RENDER?.(); }).catch(() => {});

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function renderCollaborators() {
    const host = document.getElementById('bottomContent');
    if (!host || S.bottomTab !== 'collaborators') return;
    const state = window.EPH_COLLAB?.state?.() || await api.collabState?.() || { connected: false, users: [] };
    const isOwner = state.role === 'host';
    const users = state.users?.length ? state.users : [{ peerId: state.peerId || 'local', username, owner: isOwner }];

    host.innerHTML = `<div class="collab-interface">
      <div class="collab-toolbar">
        ${isOwner && state.connected ? '<button id="generateInvite" type="button">Invite people</button>' : !state.connected ? '<button id="generateInvite" type="button">Start collaboration</button>' : ''}
        <button id="openChat" type="button" ${state.connected ? '' : 'disabled'}>Open chat</button>
        ${state.connected ? '<button id="leaveCollab" type="button">Leave session</button>' : ''}
        <span class="collab-live-state ${state.connected ? 'online' : ''}">${state.connected ? `${users.length} connected` : 'Not connected'}</span>
      </div>
      ${isOwner && state.connected ? `<div id="inviteCodeBox" class="collab-code"><span>Invite code</span><code>${escHtml(state.inviteCode || '')}</code><button id="copyInvite" type="button">Copy</button></div>` : ''}
      <div class="collab-list">${users.map(user => `<div class="collab-person"><span class="collab-presence-dot"></span><div class="collab-person-name"><strong>${escHtml(user.username || 'Collaborator')}</strong><br><small>${user.owner ? 'Owner' : 'Collaborator'}</small></div>${isOwner && !user.owner && user.peerId !== state.peerId ? `<button class="collab-kick" data-peer="${escHtml(user.peerId)}">Kick</button>` : ''}</div>`).join('')}</div>
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
      try { await navigator.clipboard.writeText(state.inviteCode || ''); toast('Invite code copied'); }
      catch { toast('Could not copy invite code'); }
    });
    host.querySelector('#openChat')?.addEventListener('click', async () => {
      const result = await api.openCollaboratorChat?.();
      if (!result?.ok) toast(result?.error || 'Could not open collaborator chat');
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

  window.EPH_COLLAB_RENDER = renderCollaborators;
  window.EPH_COLLAB_NOTIFY = async () => {
    try { if (await api.isCollaboratorChatFocused?.()) return; } catch {}
    if (window.EPH_BELL1) new Audio(window.EPH_BELL1).play().catch(() => {});
  };
})();
