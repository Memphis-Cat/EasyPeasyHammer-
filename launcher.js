// byanca
const electron = require('electron');

electron.app.commandLine.appendSwitch('disable-renderer-backgrounding');
electron.app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

require('./vmap-write-guard');
require('./vmap-dmx-bridge');

// Install the collaboration WebSocket shim before main.js loads app-services.
// collab-network owns the fixed port and message-size policy so it is only
// patched once instead of wrapping ws.WebSocketServer twice.
require('./collab-network');

const { registerAttachmentService } = require('./attachment-service');
registerAttachmentService({ ipcMain: electron.ipcMain, app: electron.app });

const { registerRecentProjectService } = require('./recent-project-service');
registerRecentProjectService({ ipcMain: electron.ipcMain, app: electron.app });

const { registerEntityFgdService } = require('./entity-fgd-service');
registerEntityFgdService({ ipcMain: electron.ipcMain, app: electron.app });

// v17 replaces the basic point-only FGD handler with Hammer's installed
// PointClass + SolidClass metadata, inherited properties, choices and render hints.
const { registerEntityFgdServiceV17 } = require('./src/entity-fgd-service-v17');
registerEntityFgdServiceV17({ ipcMain: electron.ipcMain, app: electron.app });

const { registerLargeMapService } = require('./large-map-service');
registerLargeMapService({ ipcMain: electron.ipcMain, app: electron.app });

const { registerProjectNameService } = require('./project-name-service');
registerProjectNameService({ ipcMain: electron.ipcMain, app: electron.app });

require('./main');
