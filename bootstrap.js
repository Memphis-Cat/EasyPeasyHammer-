// byanca
const { app, ipcMain } = require('electron');
const { registerAppServices } = require('./app-services');

registerAppServices({ app, ipcMain });
require('./main');
