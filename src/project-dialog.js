// byanca
(() => {
  const modal = document.getElementById('newProjectModal');
  const input = document.getElementById('newProjectName');
  const confirm = document.getElementById('confirmCreateButton');
  const cancel = document.getElementById('cancelCreateButton');
  if (!modal || !input) return;

  const isOpen = () => !modal.classList.contains('hidden');
  const focusInput = () => {
    if (!isOpen()) return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    try { input.setSelectionRange(end, end); } catch {}
  };

  const observer = new MutationObserver(() => {
    if (isOpen()) requestAnimationFrame(() => requestAnimationFrame(focusInput));
  });
  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!isOpen()) return;
      const active = document.activeElement;
      if (active === confirm || active === cancel || modal.contains(active)) return;
      focusInput();
    }, 0);
  });

  modal.addEventListener('mousedown', event => {
    if (event.target === modal) {
      event.preventDefault();
      focusInput();
    }
  });

  window.addEventListener('keydown', event => {
    if (!isOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      cancel?.click();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      confirm?.click();
      return;
    }

    if (document.activeElement === input) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (event.key.length === 1) {
      event.preventDefault();
      focusInput();
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.setRangeText(event.key, start, end, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      focusInput();
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      if (start !== end) input.setRangeText('', start, end, 'end');
      else if (start > 0) input.setRangeText('', start - 1, start, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);

  document.getElementById('createProjectButton')?.addEventListener('click', () => setTimeout(focusInput, 0));
  document.getElementById('toolbarNew')?.addEventListener('click', () => setTimeout(focusInput, 0));
})();
