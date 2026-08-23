// byanca
'use strict';

const { dialog } = require('electron');
const path = require('path');

const allowed = new Map();
const ALLOW_MS = 24 * 60 * 60 * 1000;
let installed = false;
let appRef = null;

function key(filePath) {
  try { return path.resolve(String(filePath || '')).toLowerCase(); }
  catch { return ''; }
}

function inside(parent, child) {
  try {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch { return false; }
}

function allowAttachmentPath(filePath, ttl = ALLOW_MS) {
  const resolved = key(filePath);
  if (!resolved) return false;
  allowed.set(resolved, Date.now() + Math.max(60_000, Number(ttl) || ALLOW_MS));
  if (allowed.size > 512) {
    const now = Date.now();
    for (const [candidate, expires] of allowed) if (expires <= now) allowed.delete(candidate);
    while (allowed.size > 512) allowed.delete(allowed.keys().next().value);
  }
  return true;
}

function canAccessAttachment(filePath) {
  const resolved = key(filePath);
  if (!resolved) return false;
  const now = Date.now();
  const expires = allowed.get(resolved);
  if (expires && expires > now) return true;
  if (expires) allowed.delete(resolved);

  if (!appRef) return false;
  for (const folder of ['CollaborationFiles', 'ChatImageDrafts']) {
    try {
      const root = path.join(appRef.getPath('userData'), folder);
      if (inside(root, resolved)) return true;
    } catch {}
  }
  return false;
}

function installAttachmentAccess({ app }) {
  appRef = app || appRef;
  if (installed) return;
  installed = true;
  const raw = dialog.showOpenDialog.bind(dialog);
  dialog.showOpenDialog = async function(...args) {
    const result = await raw(...args);
    for (const filePath of result?.filePaths || []) allowAttachmentPath(filePath);
    return result;
  };
}

module.exports = { installAttachmentAccess, allowAttachmentPath, canAccessAttachment };
