// byanca
(() => {
  const api = window.easyPeasyHammer;
  const messages = document.getElementById('chatMessages');
  const input = document.getElementById('chatInput');
  const fileInput = document.getElementById('chatFileInput');
  const fileDraft = document.getElementById('chatFileDraft');
  const replying = document.getElementById('chatReplying');
  let objectUrl = null;

  document.getElementById('chatMinimize').onclick = () => api.windowMinimize();
  document.getElementById('chatMaximize').onclick = () => api.windowToggleMaximize();
  document.getElementById('chatClose').onclick = () => api.windowClose();

  document.getElementById('chatAttach').onclick = () => fileInput.click();
  document.getElementById('cancelReply').onclick = () => replying.classList.remove('visible');

  fileInput.onchange = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }

    const file = fileInput.files?.[0];
    if (!file) {
      fileDraft.textContent = 'Attach images or files up to 1 GB.';
      return;
    }

    if (file.size > 1024 * 1024 * 1024) {
      fileDraft.textContent = 'That file is larger than the 1 GB limit.';
      fileInput.value = '';
      return;
    }

    const sizeMb = file.size / 1024 / 1024;
    const label = `${file.name} • ${sizeMb.toFixed(sizeMb >= 1 ? 1 : 3)} MB`;
    if (file.type.startsWith('image/')) {
      objectUrl = URL.createObjectURL(file);
      const row = document.createElement('div');
      row.className = 'chat-file-draft-preview';
      const image = document.createElement('img');
      image.src = objectUrl;
      image.alt = file.name;
      const text = document.createElement('span');
      text.textContent = `${label} • ready for Phase 4 upload`;
      row.append(image, text);
      fileDraft.replaceChildren(row);
    } else {
      fileDraft.textContent = `${label} • ready for Phase 4 upload`;
    }
  };

  messages.addEventListener('contextmenu', event => {
    const message = event.target.closest('.chat-message');
    if (!message) return;
    event.preventDefault();
    replying.classList.add('visible');
    input.focus();
  });

  document.getElementById('chatSend').onclick = () => {
    const text = input.value.trim();
    const hasFile = Boolean(fileInput.files?.[0]);
    if (!text && !hasFile) return;
    fileDraft.textContent = 'Message sending and file transfer will be connected in Phase 4.';
  };

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      document.getElementById('chatSend').click();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  input.focus();
})();
