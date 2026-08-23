// byanca
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_FGD_FILES = 160;
const MAX_FGD_BYTES = 4 * 1024 * 1024;

function safeJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function normalizeRoot(candidate) {
  if (!candidate) return null;
  try {
    let root = path.resolve(String(candidate).trim().replace(/^"|"$/g, ''));
    if (path.basename(root).toLowerCase() === 'csgo') root = path.resolve(root, '..', '..');
    else if (path.basename(root).toLowerCase() === 'game') root = path.resolve(root, '..');
    return fs.existsSync(path.join(root, 'game', 'csgo', 'gameinfo.gi')) ? root : null;
  } catch {
    return null;
  }
}

function titleFromClass(className) {
  return String(className || '')
    .split('_')
    .filter(Boolean)
    .map(word => word.length <= 3 && /^[a-z0-9]+$/i.test(word) ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function collectFgdFiles(folder, output, depth = 0) {
  if (!folder || depth > 3 || output.length >= MAX_FGD_FILES) return;
  let entries = [];
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (output.length >= MAX_FGD_FILES) break;
    const candidate = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!['maps', 'models', 'materials', 'sounds', 'panorama', 'scripts', 'resource'].includes(entry.name.toLowerCase())) {
        collectFgdFiles(candidate, output, depth + 1);
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.fgd')) {
      try {
        if (fs.statSync(candidate).size <= MAX_FGD_BYTES) output.push(candidate);
      } catch {}
    }
  }
}

function stripLineComment(line) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quoted) { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === '/' && line[index + 1] === '/') return line.slice(0, index);
  }
  return line;
}

function parsePointClasses(text, sourceFile) {
  const lines = String(text || '').split(/\r?\n/);
  const entities = [];
  let declaration = null;

  const finish = () => { declaration = null; };

  for (let rawLine of lines) {
    rawLine = stripLineComment(rawLine);
    const line = rawLine.trim();
    if (!line) continue;

    if (/^@PointClass\b/i.test(line)) {
      declaration = {
        lines: [line],
        model: line.match(/\bstudio\s*\(\s*"([^"]+)"/i)?.[1] || '',
        sourceFile,
      };
    } else if (declaration) {
      if (/^@(PointClass|SolidClass|BaseClass|OverrideClass|ExtendClass)\b/i.test(line)) {
        declaration = /^@PointClass\b/i.test(line) ? {
          lines: [line],
          model: line.match(/\bstudio\s*\(\s*"([^"]+)"/i)?.[1] || '',
          sourceFile,
        } : null;
      } else {
        declaration.lines.push(line);
        if (!declaration.model) declaration.model = line.match(/\bstudio\s*\(\s*"([^"]+)"/i)?.[1] || '';
      }
    }

    if (!declaration) continue;
    const joined = declaration.lines.join(' ');
    const assignmentMatches = [...joined.matchAll(/(?:^|\s)=\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*"([^"]*)")?/g)];
    if (!assignmentMatches.length) {
      if (declaration.lines.length > 80) finish();
      continue;
    }

    const match = assignmentMatches[assignmentMatches.length - 1];
    const className = match[1];
    if (!className || className === 'worldspawn') { finish(); continue; }
    entities.push({
      className,
      name: match[2]?.trim() || titleFromClass(className),
      model: declaration.model || '',
      sourceFile,
      kind: 'point',
    });
    finish();
  }

  return entities;
}

function findCs2Root(app) {
  const config = safeJson(path.join(app.getPath('userData'), 'asset-config.json'), {});
  const candidates = [config?.cs2Root, process.env.EPH_CS2_PATH];
  const programFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  candidates.push(
    path.join(programFiles86, 'Steam', 'steamapps', 'common', 'Counter-Strike Global Offensive'),
    path.join(programFiles, 'Steam', 'steamapps', 'common', 'Counter-Strike Global Offensive')
  );
  for (const candidate of candidates) {
    const root = normalizeRoot(candidate);
    if (root) return root;
  }
  return null;
}

function catalogForInstall(app) {
  const root = findCs2Root(app);
  if (!root) return { ok: false, error: 'CS2 installation not configured.', entities: [] };

  const files = [];
  for (const folder of [path.join(root, 'game', 'csgo'), path.join(root, 'game', 'core'), path.join(root, 'game', 'sdktools')]) {
    collectFgdFiles(folder, files);
  }

  const byClass = new Map();
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch { continue; }
    for (const entity of parsePointClasses(text, path.relative(root, file).replace(/\\/g, '/'))) {
      if (!byClass.has(entity.className.toLowerCase())) byClass.set(entity.className.toLowerCase(), entity);
    }
  }

  const entities = [...byClass.values()].sort((a, b) => a.name.localeCompare(b.name) || a.className.localeCompare(b.className));
  return { ok: true, root, fgdFiles: files.length, entities };
}

function registerEntityFgdService({ ipcMain, app }) {
  if (globalThis.__ephEntityFgdService) return;
  globalThis.__ephEntityFgdService = true;
  let cache = null;
  let cacheTime = 0;

  ipcMain.handle('entities:fgd-catalog', () => {
    if (!cache || Date.now() - cacheTime > 60 * 1000) {
      cache = catalogForInstall(app);
      cacheTime = Date.now();
    }
    return cache;
  });
}

module.exports = { registerEntityFgdService, catalogForInstall, parsePointClasses };
