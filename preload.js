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
  clearLastSession: () => ipcRenderer.invoke('project:clear-last-session'),
  assetStatus: () => ipcRenderer.invoke('assets:status'),
  detectCs2: () => ipcRenderer.invoke('assets:detect'),
  chooseCs2Folder: () => ipcRenderer.invoke('assets:choose-cs2-folder'),
  searchAssets: (kind, query = '', limit = 200) => ipcRenderer.invoke('assets:search', kind, query, limit),
  materialPreview: (resourcePath) => ipcRenderer.invoke('assets:material-preview', resourcePath),
  modelPreview: (resourcePath) => ipcRenderer.invoke('assets:model-preview', resourcePath),
  openWorkshopTools: () => ipcRenderer.invoke('tools:open-workshop')
});
