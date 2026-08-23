// byanca
(() => {
  const install = () => {
    const button = document.getElementById('topAddPart');
    if (button) button.onclick = () => addPart();
  };
  install();
  window.addEventListener('eph3d-ready', install, { once: true });
})();
