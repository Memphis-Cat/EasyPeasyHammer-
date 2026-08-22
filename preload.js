// byanca
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyPeasyHammer', {
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  getStartupState: () => ipcRenderer.invoke('app:get-startup-state'),
  checkVersion: () => ipcRenderer.invoke('app:version-status'),
  getProfile: () => ipcRenderer.invoke('profile:get'),
  saveProfile: (username) => ipcRenderer.invoke('profile:set', username),
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
  openWorkshopTools: () => ipcRenderer.invoke('tools:open-workshop'),
  openCollaboratorChat: () => ipcRenderer.invoke('collab:open-chat'),
  isCollaboratorChatFocused: () => ipcRenderer.invoke('collab:is-chat-focused'),
  collabState: () => ipcRenderer.invoke('collab:get-state'),
  collabHost: (payload) => ipcRenderer.invoke('collab:host', payload),
  collabJoin: (code, username) => ipcRenderer.invoke('collab:join', code, username),
  collabLeave: () => ipcRenderer.invoke('collab:leave'),
  collabKick: (peerId) => ipcRenderer.invoke('collab:kick', peerId),
  collabSendSnapshot: (snapshot) => ipcRenderer.invoke('collab:send-snapshot', snapshot),
  collabSendLiveObject: (object) => ipcRenderer.invoke('collab:send-live-object', object),
  collabSendSelection: (selectedId) => ipcRenderer.invoke('collab:send-selection', selectedId),
  collabSendCursor: (point) => ipcRenderer.invoke('collab:send-cursor', point),
  collabSendChat: (text, replyTo = null) => ipcRenderer.invoke('collab:send-chat', text, replyTo),
  collabPickFile: () => ipcRenderer.invoke('collab:pick-file'),
  collabSendFile: (token, text = '', replyTo = null) => ipcRenderer.invoke('collab:send-file', token, text, replyTo),
  collabSaveFile: (localPath, suggestedName) => ipcRenderer.invoke('collab:save-file', localPath, suggestedName),
  collabShowFile: (localPath) => ipcRenderer.invoke('collab:show-file', localPath),
  collabListShared: () => ipcRenderer.invoke('collab:list-shared'),
  collabForgetShared: (sessionId) => ipcRenderer.invoke('collab:forget-shared', sessionId),
  onCollaborationEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('collab:event', listener);
    return () => ipcRenderer.removeListener('collab:event', listener);
  }
});
