// byanca
const { BrowserWindow, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;

function mimeFor(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml'
  })[ext] || 'application/octet-stream';
}

function safeName(value, fallback = 'file') {
  return String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || fallback;
}

function registerAttachmentService({ ipcMain }) {
  if (globalThis.__ephAttachmentServiceRegistered) return;
  globalThis.__ephAttachmentServiceRegistered = true;

  ipcMain.handle('collab:attachment-data', async (_event, localPath) => {
    try {
      if (!localPath || !fs.existsSync(localPath)) return { ok: false, error: 'Attachment file is missing.' };
      const stat = fs.statSync(localPath);
      if (!stat.isFile()) return { ok: false, error: 'Attachment is not a file.' };
      if (stat.size > MAX_PREVIEW_BYTES) return { ok: false, error: 'Image is too large to preview.' };
      const mime = mimeFor(localPath);
      if (!mime.startsWith('image/')) return { ok: false, error: 'Attachment is not an image.' };
      const data = fs.readFileSync(localPath).toString('base64');
      return { ok: true, dataUrl: `data:${mime};base64,${data}` };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('collab:save-file-v2', async (event, localPath, suggestedName) => {
    try {
      if (!localPath || !fs.existsSync(localPath)) return { ok: false, error: 'Attachment file is missing.' };
      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      const result = await dialog.showSaveDialog(win, {
        title: 'Save attachment',
        defaultPath: safeName(suggestedName || path.basename(localPath))
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      fs.copyFileSync(localPath, result.filePath);
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('collab:show-file-v2', async (_event, localPath) => {
    try {
      if (!localPath || !fs.existsSync(localPath)) return { ok: false, error: 'Attachment file is missing.' };
      shell.showItemInFolder(localPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

module.exports = { registerAttachmentService };
