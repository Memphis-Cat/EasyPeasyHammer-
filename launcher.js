// byanca
const electron = require('electron');

electron.app.commandLine.appendSwitch('disable-renderer-backgrounding');
electron.app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

require('./electron-security');
require('./close-safety');

// Install diagnostics first so every later IPC handler/main-process failure is
// recorded, including failures that happen before the editor screen opens.
const { registerAppLogService } = require('./src/app-log-service-v18');
registerAppLogService({ ipcMain: electron.ipcMain, app: electron.app });

require('./vmap-write-guard');
require('./vmap-dmx-bridge');

// Install the collaboration WebSocket shim before main.js loads app-services.
require('./collab-network');

const { registerAttachmentService } = require('./attachment-service');
registerAttachmentService({ ipcMain: electron.ipcMain, app: electron.app });

const { registerRecentProjectService } = require('./recent-project-service');
registerRecentProjectService({ ipcMain: electron.ipcMain, app: electron.app });

const { registerEntityFgdService } = require('./entity-fgd-service');
registerEntityFgdService({ ipcMain: electron.ipcMain, app: electron.app });

const { registerEntityFgdServiceV17 } = require('./src/entity-fgd-service-v17');
registerEntityFgdServiceV17({ ipcMain: electron.ipcMain, app: electron.app });

const { registerEntityFgdServiceV18 } = require('./src/entity-fgd-service-v18');
registerEntityFgdServiceV18({ ipcMain: electron.ipcMain, app: electron.app });

const { registerLargeMapService } = require('./large-map-service');
registerLargeMapService({ ipcMain: electron.ipcMain, app: electron.app });

// Replace only the block-read handler. This keeps the reverted large-map system
// intact while preventing one 25-128 MB Anubis element from poisoning a batch.
const { registerLargeMapBlockServiceV34 } = require('./src/large-map-block-service-v34');
registerLargeMapBlockServiceV34({ ipcMain: electron.ipcMain, app: electron.app });

const { registerLargeMapSpatialServiceV19 } = require('./large-map-spatial-service-v19');
registerLargeMapSpatialServiceV19({ ipcMain: electron.ipcMain, app: electron.app });

const { registerMapLocalModelServiceV20 } = require('./map-local-model-service-v20');
registerMapLocalModelServiceV20({ ipcMain: electron.ipcMain, app: electron.app });

const { registerMapLocalMaterialServiceV19 } = require('./map-local-material-service-v19');
registerMapLocalMaterialServiceV19({ ipcMain: electron.ipcMain, app: electron.app });

const { registerProjectNameService } = require('./project-name-service');
registerProjectNameService({ ipcMain: electron.ipcMain, app: electron.app });

require('./main');
