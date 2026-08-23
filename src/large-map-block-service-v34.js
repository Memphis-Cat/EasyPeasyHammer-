// byanca
'use strict';

const fs = require('fs');
const path = require('path');

const VALID_TOKEN = /^[a-f0-9]{40}$/i;
const MAX_BLOCKS = 24;
const NORMAL_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_SINGLE_BLOCK_BYTES = 128 * 1024 * 1024;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function loadCache(app, token) {
  const value = String(token || '');
  if (!VALID_TOKEN.test(value)) return null;
  const folder = path.join(app.getPath('userData'), 'LargeMapCache', value);
  const index = readJson(path.join(folder, 'index.json'));
  const filePath = path.join(folder, 'decoded.vmap');
  if (!Array.isArray(index?.entries) || !fs.existsSync(filePath)) return null;
  return { filePath, byId: new Map(index.entries.map(entry => [String(entry.entryId), entry])) };
}

function readEntry(fd, entry, id) {
  const length = Number(entry?.length);
  const start = Number(entry?.start);
  if (!Number.isSafeInteger(length) || !Number.isSafeInteger(start) || length <= 0 || start < 0) return null;
  const buffer = Buffer.allocUnsafe(length);
  const bytes = fs.readSync(fd, buffer, 0, length, start);
  return { entryId: id, text: buffer.subarray(0, bytes).toString('utf8'), bytes };
}

function getBlocks(app, token, ids) {
  const cache = loadCache(app, token);
  if (!cache) return { ok: false, error: 'Large-map cache is unavailable.' };
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, MAX_BLOCKS);
  const entries = wanted.map(id => ({ id, entry: cache.byId.get(id) })).filter(item => item.entry?.length);

  const fatal = entries.find(item => Number(item.entry.length) > MAX_SINGLE_BLOCK_BYTES);
  if (fatal) return { ok: false, error: `Large-map block ${fatal.id} exceeds the 128 MB hard safety limit.`, fatalEntryId: fatal.id };

  // If a normal batch contains an oversized-but-legitimate element, return that
  // element by itself. The renderer clears pending state for the omitted IDs and
  // requests them on the next visibility pass, so one huge CMapMesh no longer
  // poisons all of its neighboring blocks.
  const oversized = entries.find(item => Number(item.entry.length) > NORMAL_RESPONSE_BYTES);
  const selected = oversized ? [oversized] : entries;

  const fd = fs.openSync(cache.filePath, 'r');
  const blocks = [];
  let total = 0;
  try {
    for (const item of selected) {
      const length = Number(item.entry.length);
      if (!oversized && total + length > NORMAL_RESPONSE_BYTES) break;
      const block = readEntry(fd, item.entry, item.id);
      if (!block) continue;
      blocks.push({ entryId: block.entryId, text: block.text });
      total += block.bytes;
      if (oversized) break;
    }
  } finally {
    fs.closeSync(fd);
  }

  return {
    ok: true,
    blocks,
    bytes: total,
    isolatedOversized: oversized?.id || null,
    omitted: Math.max(0, wanted.length - blocks.length),
  };
}

function registerLargeMapBlockServiceV34({ ipcMain, app }) {
  ipcMain.removeHandler('large-map:get-blocks');
  ipcMain.handle('large-map:get-blocks', (event, token, ids) => getBlocks(app, token, ids));
}

module.exports = { registerLargeMapBlockServiceV34, getBlocks, NORMAL_RESPONSE_BYTES, MAX_SINGLE_BLOCK_BYTES };
