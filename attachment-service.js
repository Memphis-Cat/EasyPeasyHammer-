// byanca
const { BrowserWindow, clipboard, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { installAttachmentAccess, canAccessAttachment } = require('./attachment-access');

const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
const READY_TIMEOUT_MS = 8000;
const READY_POLL_MS = 45;

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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForReadyFile(localPath, expectedSize = null, timeout = READY_TIMEOUT_MS) {
  const expected = Number(expectedSize);
  const hasExpected = Number.isFinite(expected) && expected >= 0;
  const deadline = Date.now() + timeout;
  let previousSize = -1;
  let stablePasses = 0;

  while (Date.now() <= deadline) {
    try {
      const stat = await fs.promises.stat(localPath);
      if (!stat.isFile()) return { ok: false, error: 'Attachment is not a file.' };
      if (hasExpected) {
        if (stat.size === expected) return { ok: true, stat };
        if (stat.size > expected) return { ok: false, error: 'Attachment size does not match the transfer.' };
      } else {
        if (stat.size === previousSize) stablePasses++;
        else stablePasses = 0;
        if (stablePasses >= 2) return { ok: true, stat };
      }
      previousSize = stat.size;
    } catch (error) {
      if (error?.code !== 'ENOENT') return { ok: false, error: error.message };
    }
    await sleep(READY_POLL_MS);
  }

  return { ok: false, error: hasExpected ? 'Attachment transfer is incomplete or corrupted.' : 'Attachment is still being written.' };
}

function registerAttachmentService({ ipcMain, app }) {
  if (globalThis.__ephAttachmentServiceRegistered) return;
  globalThis.__ephAttachmentServiceRegistered = true;
  installAttachmentAccess({ app });

  const trusted = localPath => canAccessAttachment(localPath)
    ? null
    : { ok: false, error: 'Attachment path is not trusted by this collaboration session.' };

  ipcMain.handle('app:copy-text', (_event, text) => {
    try {
      clipboard.writeText(String(text || ''));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('collab:attachment-data', async (_event, localPath, expectedSize) => {
    try {
      if (!localPath) return { ok: false, error: 'Attachment file is missing.' };
      const denied = trusted(localPath); if (denied) return denied;
      const ready = await waitForReadyFile(localPath, expectedSize);
      if (!ready.ok) return ready;
      if (ready.stat.size > MAX_PREVIEW_BYTES) return { ok: false, error: 'Image is too large to preview.' };
      const mime = mimeFor(localPath);
      if (!mime.startsWith('image/')) return { ok: false, error: 'Attachment is not an image.' };
      const data = await fs.promises.readFile(localPath);
      return { ok: true, dataUrl: `data:${mime};base64,${data.toString('base64')}` };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('collab:save-file-v2', async (event, localPath, suggestedName, expectedSize) => {
    try {
      if (!localPath) return { ok: false, error: 'Attachment file is missing.' };
      const denied = trusted(localPath); if (denied) return denied;
      const ready = await waitForReadyFile(localPath, expectedSize);
      if (!ready.ok) return ready;
      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      const name = safeName(suggestedName || path.basename(localPath));
      const defaultPath = app ? path.join(app.getPath('downloads'), name) : name;
      const result = await dialog.showSaveDialog(win, { title: 'Save attachment', defaultPath });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fs.promises.copyFile(localPath, result.filePath);
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('collab:show-file-v2', async (_event, localPath, expectedSize) => {
    try {
      if (!localPath) return { ok: false, error: 'Attachment file is missing.' };
      const denied = trusted(localPath); if (denied) return denied;
      const ready = await waitForReadyFile(localPath, expectedSize);
      if (!ready.ok) return ready;
      shell.showItemInFolder(localPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

module.exports = { registerAttachmentService, waitForReadyFile };
