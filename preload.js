// byanca
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyPeasyHammer', {
  getStartupState: () => ipcRenderer.invoke('app:get-startup-state'),
  openVmap: () => ipcRenderer.invoke('project:open-vmap'),
  createProject: (name) => ipcRenderer.invoke('project:create', name),
  loadVmap: (vmapPath) => ipcRenderer.invoke('project:load-vmap', vmapPath),
  saveVmap: (vmapPath, text, backup = true) => ipcRenderer.invoke('project:save-vmap', vmapPath, text, backup),
  continueLast: () => ipcRenderer.invoke('project:continue-last'),
  autosave: (snapshot) => ipcRenderer.invoke('project:autosave', snapshot),
  returnHome: (snapshot) => ipcRenderer.invoke('project:return-home', snapshot),
  revealProject: (projectFolder) => ipcRenderer.invoke('project:reveal', projectFolder),
  clearLastSession: () => ipcRenderer.invoke('project:clear-last-session')
});
