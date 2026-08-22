// byanca
(() => {
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'collab-ui.css';
  document.head.appendChild(style);

  let username = 'You';
  window.easyPeasyHammer.getProfile?.().then(result => { username = result?.profile?.username || 'You'; }).catch(() => {});

  function renderCollaborators() {
    const host = document.getElementById('bottomContent');
    if (!host) return;
    host.innerHTML = `<div class="collab-interface"><div class="collab-toolbar"><button id="generateInvite" type="button">Invite people</button><button id="openChat" type="button">Open chat</button></div><div id="inviteCodeBox" class="collab-code"><span>Invite code</span><code>----</code><button id="copyInvite" type="button" disabled>Copy</button></div><div class="collab-list"><div class="collab-person"><div class="collab-person-name"><strong>${username}</strong><br><small>Owner</small></div></div><div class="collab-person"><div class="collab-person-name"><small>Invited collaborators will appear here.</small></div><button class="collab-kick" disabled>Kick</button></div></div><div class="collab-phase-note">Interface only: code generation, joining, kicking, message delivery and file transfer intentionally have no network logic yet.</div></div>`;

    host.querySelector('#openChat').onclick = async () => {
      const result = await window.easyPeasyHammer.openCollaboratorChat?.();
      if (!result?.ok) toast(result?.error || 'Could not open collaborator chat');
    };

    host.querySelector('#generateInvite').onclick = () => {
      host.querySelector('#inviteCodeBox code').textContent = 'PHASE4-CODE';
      toast('Invite code generation will be enabled in Phase 4');
    };
  }

  if (typeof renderBottom === 'function' && !renderBottom.__ephCollabUi) {
    const original = renderBottom;
    renderBottom = function() {
      original();
      if (S.bottomTab === 'collaborators') renderCollaborators();
    };
    renderBottom.__ephCollabUi = true;
  }

  window.EPH_COLLAB_NOTIFY = async () => {
    try {
      if (await window.easyPeasyHammer.isCollaboratorChatFocused?.()) return;
    } catch {}
    if (window.EPH_BELL1) new Audio(window.EPH_BELL1).play().catch(() => {});
  };
})();
