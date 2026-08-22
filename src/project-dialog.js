// byanca
(() => {
  const modal = document.getElementById('newProjectModal');
  const input = document.getElementById('newProjectName');
  if (!modal || !input) return;

  const focusInput = () => {
    if (modal.classList.contains('hidden')) return;
    input.disabled = false;
    input.readOnly = false;
    input.focus({ preventScroll: true });
  };

  const observer = new MutationObserver(() => {
    if (!modal.classList.contains('hidden')) requestAnimationFrame(focusInput);
  });
  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });

  input.addEventListener('keydown', event => {
    event.stopPropagation();
  });

  input.addEventListener('keyup', event => {
    event.stopPropagation();
  });
})();
