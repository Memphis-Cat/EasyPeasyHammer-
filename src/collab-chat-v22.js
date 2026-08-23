// byanca
(() => {
  'use strict';
  if (window.__ephCollabChatV22) return;
  window.__ephCollabChatV22 = true;

  let installedRoot = null;
  let pinned = true;
  let userScrolling = false;
  let userScrollTimer = null;

  function nearBottom(messages) {
    if (!messages) return true;
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight <= 54;
  }

  function forceBottom(messages) {
    if (!messages?.isConnected) return;
    messages.scrollTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
  }

  function scheduleBottom(messages, force = false) {
    if (!messages || (!force && !pinned)) return;
    const apply = () => {
      if (!messages.isConnected || (!force && !pinned)) return;
      forceBottom(messages);
    };
    apply();
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
    setTimeout(apply, 40);
    setTimeout(apply, 120);
    setTimeout(apply, 280);
  }

  function install() {
    const root = document.getElementById('ephFloatingChat');
    const messages = document.getElementById('ephFloatingChatMessages');
    if (!root || !messages) return false;
    if (installedRoot === root && root.dataset.ephChatV22 === '1') return true;
    installedRoot = root;
    root.dataset.ephChatV22 = '1';

    // Move the in-editor chat a little farther away from the right edge.
    root.style.right = '68px';

    pinned = nearBottom(messages);
    messages.addEventListener('scroll', () => {
      if (!userScrolling) return;
      pinned = nearBottom(messages);
    }, { passive: true });
    messages.addEventListener('wheel', () => {
      userScrolling = true;
      clearTimeout(userScrollTimer);
      userScrollTimer = setTimeout(() => {
        userScrolling = false;
        pinned = nearBottom(messages);
      }, 180);
    }, { passive: true });
    messages.addEventListener('pointerdown', () => {
      userScrolling = true;
      clearTimeout(userScrollTimer);
      userScrollTimer = setTimeout(() => {
        userScrolling = false;
        pinned = nearBottom(messages);
      }, 220);
    }, { passive: true });

    const mutation = new MutationObserver(records => {
      let added = false;
      for (const record of records) {
        if (record.type === 'childList' && record.addedNodes.length) added = true;
        for (const node of record.addedNodes || []) {
          if (node.nodeType !== 1) continue;
          const images = node.matches?.('img') ? [node] : [...(node.querySelectorAll?.('img') || [])];
          for (const image of images) {
            image.addEventListener('load', () => scheduleBottom(messages), { once: true });
            image.addEventListener('error', () => scheduleBottom(messages), { once: true });
          }
        }
      }
      if (added) scheduleBottom(messages);
    });
    mutation.observe(messages, { childList: true, subtree: true });

    if (typeof ResizeObserver === 'function') {
      const resize = new ResizeObserver(() => scheduleBottom(messages));
      resize.observe(messages);
    }

    const classObserver = new MutationObserver(() => {
      if (root.classList.contains('eph-chat-open')) {
        pinned = true;
        scheduleBottom(messages, true);
      }
    });
    classObserver.observe(root, { attributes: true, attributeFilter: ['class', 'hidden'] });

    window.easyPeasyHammer?.onCollaborationEvent?.(event => {
      if (event?.type !== 'chat') return;
      if (nearBottom(messages)) pinned = true;
      scheduleBottom(messages);
    });

    scheduleBottom(messages, root.classList.contains('eph-chat-open'));
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 150);
    setTimeout(() => clearInterval(timer), 20000);
  }
  window.addEventListener('eph3d-ready', install);
})();
