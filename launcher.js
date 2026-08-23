// byanca
const electron = require('electron');

electron.app.commandLine.appendSwitch('disable-renderer-backgrounding');
electron.app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

require('./vmap-write-guard');

// Install the collaboration WebSocket shim before main.js loads app-services.
// collab-network owns the fixed port and message-size policy so it is only
// patched once instead of wrapping ws.WebSocketServer twice.
require('./collab-network');

const { registerAttachmentService } = require('./attachment-service');
registerAttachmentService({ ipcMain: electron.ipcMain, app: electron.app });

require('./main');
