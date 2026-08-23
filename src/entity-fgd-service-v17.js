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

function steamRoots() {
  const roots = [];
  const programFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const steamInstalls = [path.join(programFiles86, 'Steam'), path.join(programFiles, 'Steam')];
  for (const steamRoot of steamInstalls) {
    roots.push(path.join(steamRoot, 'steamapps', 'common', 'Counter-Strike Global Offensive'));
    const libraries = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
    if (!fs.existsSync(libraries)) continue;
    try {
      const text = fs.readFileSync(libraries, 'utf8');
      for (const match of text.matchAll(/"path"\s*"([^"]+)"/gi)) {
        const library = match[1].replace(/\\\\/g, '\\');
        roots.push(path.join(library, 'steamapps', 'common', 'Counter-Strike Global Offensive'));
      }
    } catch {}
  }
  return roots;
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
      if (!['maps', 'models', 'materials', 'sounds', 'panorama', 'scripts', 'resource'].includes(entry.name.toLowerCase())) collectFgdFiles(candidate, output, depth + 1);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.fgd')) {
      try { if (fs.statSync(candidate).size <= MAX_FGD_BYTES) output.push(candidate); } catch {}
    }
  }
}

function stripLineComment(line) {
  let quoted = false, escaped = false;
  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quoted) { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === '/' && line[index + 1] === '/') return line.slice(0, index);
  }
  return line;
}

function bracketDelta(text) {
  let delta = 0, quoted = false, escaped = false;
  for (const char of String(text || '')) {
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quoted) { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === '[') delta++;
    else if (char === ']') delta--;
  }
  return delta;
}

function unquote(value) {
  const text = String(value ?? '').trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return text;
}

function splitColons(text) {
  const out = [];
  let current = '', quoted = false, escaped = false, round = 0, square = 0;
  for (const char of String(text || '')) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\' && quoted) { current += char; escaped = true; continue; }
    if (char === '"') { quoted = !quoted; current += char; continue; }
    if (!quoted) {
      if (char === '(') round++;
      else if (char === ')') round = Math.max(0, round - 1);
      else if (char === '[') square++;
      else if (char === ']') square = Math.max(0, square - 1);
      else if (char === ':' && round === 0 && square === 0) { out.push(current.trim()); current = ''; continue; }
    }
    current += char;
  }
  out.push(current.trim());
  return out;
}

function numberList(text) {
  return [...String(text || '').matchAll(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)].map(match => Number(match[0])).filter(Number.isFinite);
}

function renderHintFromHeader(header) {
  const studioArg = header.match(/\bstudio\s*\(\s*"([^"]+)"\s*\)/i)?.[1] || '';
  const spriteMatch = header.match(/\b(iconsprite|sprite)\s*\(\s*"([^"]+)"\s*\)/i);
  const colorNumbers = numberList(header.match(/\bcolor\s*\(([^)]*)\)/i)?.[1] || '');
  const sizeMatch = header.match(/\b(size|bbox|wirebox)\s*\(([^)]*)\)/i);
  const sizeNumbers = numberList(sizeMatch?.[2] || '');
  let bounds = null;
  if (sizeNumbers.length >= 6) bounds = { min: sizeNumbers.slice(0, 3), max: sizeNumbers.slice(3, 6) };
  else if (sizeNumbers.length >= 3) {
    const half = sizeNumbers.slice(0, 3).map(value => Math.abs(value) / 2);
    bounds = { min: half.map(value => -value), max: half };
  }
  const model = /[\\/]|\.(?:vmdl|mdl)$/i.test(studioArg) ? studioArg.replace(/\\/g, '/') : '';
  let type = 'none', resource = '';
  if (model) { type = 'studio'; resource = model; }
  else if (spriteMatch) { type = spriteMatch[1].toLowerCase(); resource = spriteMatch[2].replace(/\\/g, '/'); }
  else if (bounds) type = sizeMatch?.[1]?.toLowerCase() === 'size' ? 'bbox' : sizeMatch[1].toLowerCase();
  return { type, resource, color: colorNumbers.length >= 3 ? colorNumbers.slice(0, 3) : null, bounds };
}

function parseChoiceBlock(lines, startIndex) {
  const choices = [];
  let began = false, depth = 0, endIndex = startIndex;
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 180); index++) {
    const line = lines[index].trim();
    if (!began) { if (!line.includes('[')) continue; began = true; }
    depth += bracketDelta(line);
    const match = line.match(/^\s*([^:\[\]]+?)\s*:\s*"((?:\\.|[^"])*)"(?:\s*:\s*([^,\]]+))?/);
    if (match) choices.push({ value: unquote(match[1]), label: unquote(`"${match[2]}"`), default: unquote(match[3] || '') });
    endIndex = index;
    if (began && depth <= 0) break;
  }
  return { choices, endIndex };
}

function parseProperties(blockLines) {
  const properties = [];
  let depth = 1;
  for (let index = 0; index < blockLines.length; index++) {
    const line = stripLineComment(blockLines[index]).trim();
    const before = depth;
    depth += bracketDelta(line);
    if (!line || before !== 1) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*([^)]*)\)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1], type = match[2].trim();
    let rest = match[3].trim(), quoted = false, escaped = false, equalsIndex = -1;
    for (let i = 0; i < rest.length; i++) {
      const char = rest[i];
      if (escaped) { escaped = false; continue; }
      if (char === '\\' && quoted) { escaped = true; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (!quoted && char === '=') { equalsIndex = i; break; }
    }
    const definition = equalsIndex >= 0 ? rest.slice(0, equalsIndex).trim() : rest;
    const parts = splitColons(definition);
    const property = { key, type, label: unquote(parts[0] || key) || key, default: unquote(parts[1] || ''), description: unquote(parts.slice(2).join(':') || ''), choices: [] };
    if (/\b(?:choices|flags)\b/i.test(type)) property.choices = parseChoiceBlock(blockLines, index).choices;
    properties.push(property);
  }
  return properties;
}

function parseFgdDeclarations(text, sourceFile) {
  const lines = String(text || '').split(/\r?\n/).map(stripLineComment);
  const declarations = [];
  for (let index = 0; index < lines.length; index++) {
    const first = lines[index].trim();
    const kindMatch = first.match(/^@(PointClass|SolidClass|BaseClass|OverrideClass|ExtendClass)\b/i);
    if (!kindMatch) continue;
    const kindName = kindMatch[1].toLowerCase();
    const headerLines = [first];
    let cursor = index, blockStart = -1;
    while (++cursor < lines.length && cursor < index + 120) {
      const line = lines[cursor].trim();
      if (/^@(PointClass|SolidClass|BaseClass|OverrideClass|ExtendClass)\b/i.test(line)) break;
      if (line.includes('[')) { blockStart = cursor; break; }
      if (line) headerLines.push(line);
    }
    const header = headerLines.join(' ');
    const assignment = header.match(/(?:^|\s)=\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*"([^"]*)")?/);
    if (!assignment) continue;
    const className = assignment[1];
    const baseMatch = header.match(/\bbase\s*\(([^)]*)\)/i);
    const bases = baseMatch ? baseMatch[1].split(',').map(value => value.trim()).filter(Boolean) : [];
    const blockLines = [];
    if (blockStart >= 0) {
      let blockDepth = 0;
      for (let blockIndex = blockStart; blockIndex < lines.length; blockIndex++) {
        const line = lines[blockIndex];
        blockDepth += bracketDelta(line);
        if (blockIndex > blockStart) blockLines.push(line);
        if (blockDepth <= 0 && blockIndex > blockStart) { cursor = blockIndex; break; }
      }
      index = Math.max(index, cursor);
    }
    const renderHint = renderHintFromHeader(header);
    declarations.push({
      className,
      name: assignment[2]?.trim() || titleFromClass(className),
      kind: kindName === 'solidclass' ? 'solid' : kindName === 'pointclass' ? 'point' : kindName === 'baseclass' ? 'base' : 'extend',
      baseClasses: bases,
      model: renderHint.type === 'studio' ? renderHint.resource : '',
      renderHint,
      properties: parseProperties(blockLines),
      sourceFile,
    });
  }
  return declarations;
}

function mergeDeclaration(map, declaration) {
  const key = declaration.className.toLowerCase();
  const existing = map.get(key);
  if (!existing) { map.set(key, declaration); return; }
  const propertyMap = new Map((existing.properties || []).map(property => [property.key.toLowerCase(), property]));
  for (const property of declaration.properties || []) propertyMap.set(property.key.toLowerCase(), property);
  map.set(key, {
    ...existing, ...declaration,
    name: declaration.name || existing.name,
    kind: declaration.kind === 'extend' ? existing.kind : declaration.kind,
    baseClasses: [...new Set([...(existing.baseClasses || []), ...(declaration.baseClasses || [])])],
    model: declaration.model || existing.model || '',
    renderHint: declaration.renderHint?.type && declaration.renderHint.type !== 'none' ? declaration.renderHint : existing.renderHint,
    properties: [...propertyMap.values()],
  });
}

function resolveDeclaration(key, declarations, memo, stack = new Set()) {
  const normalized = String(key || '').toLowerCase();
  if (memo.has(normalized)) return memo.get(normalized);
  const declaration = declarations.get(normalized);
  if (!declaration || stack.has(normalized)) return declaration || null;
  stack.add(normalized);
  const properties = new Map();
  let inheritedHint = null, inheritedModel = '';
  for (const baseName of declaration.baseClasses || []) {
    const base = resolveDeclaration(baseName, declarations, memo, stack);
    if (!base) continue;
    for (const property of base.properties || []) properties.set(property.key.toLowerCase(), property);
    if (!inheritedHint && base.renderHint?.type && base.renderHint.type !== 'none') inheritedHint = base.renderHint;
    if (!inheritedModel && base.model) inheritedModel = base.model;
  }
  for (const property of declaration.properties || []) properties.set(property.key.toLowerCase(), property);
  const resolved = { ...declaration, model: declaration.model || inheritedModel || '', renderHint: declaration.renderHint?.type && declaration.renderHint.type !== 'none' ? declaration.renderHint : inheritedHint || declaration.renderHint, properties: [...properties.values()] };
  stack.delete(normalized);
  memo.set(normalized, resolved);
  return resolved;
}

function parseEntityClasses(text, sourceFile = '') {
  const raw = new Map();
  for (const declaration of parseFgdDeclarations(text, sourceFile)) mergeDeclaration(raw, declaration);
  const memo = new Map();
  return [...raw.keys()].map(key => resolveDeclaration(key, raw, memo)).filter(entity => entity && ['point', 'solid'].includes(entity.kind) && entity.className !== 'worldspawn');
}
function parsePointClasses(text, sourceFile = '') { return parseEntityClasses(text, sourceFile).filter(entity => entity.kind === 'point'); }

function findCs2Root(app) {
  const config = safeJson(path.join(app.getPath('userData'), 'asset-config.json'), {});
  for (const candidate of [config?.cs2Root, process.env.EPH_CS2_PATH, ...steamRoots()]) { const root = normalizeRoot(candidate); if (root) return root; }
  return null;
}

function catalogForInstall(app) {
  const root = findCs2Root(app);
  if (!root) return { ok: false, error: 'CS2 installation not configured.', entities: [] };
  const files = [];
  for (const folder of [path.join(root, 'game', 'csgo'), path.join(root, 'game', 'core'), path.join(root, 'game', 'sdktools')]) collectFgdFiles(folder, files);
  const declarations = new Map();
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const relative = path.relative(root, file).replace(/\\/g, '/');
    for (const declaration of parseFgdDeclarations(text, relative)) mergeDeclaration(declarations, declaration);
  }
  const memo = new Map();
  const entities = [...declarations.keys()].map(key => resolveDeclaration(key, declarations, memo)).filter(entity => entity && ['point', 'solid'].includes(entity.kind) && entity.className !== 'worldspawn').sort((a, b) => a.name.localeCompare(b.name) || a.className.localeCompare(b.className));
  return { ok: true, root, fgdFiles: files.length, pointEntities: entities.filter(entity => entity.kind === 'point').length, solidEntities: entities.filter(entity => entity.kind === 'solid').length, entities };
}

function registerEntityFgdServiceV17({ ipcMain, app }) {
  if (globalThis.__ephEntityFgdServiceV17) return;
  globalThis.__ephEntityFgdServiceV17 = true;
  try { ipcMain.removeHandler('entities:fgd-catalog'); } catch {}
  let cache = null, cacheTime = 0;
  ipcMain.handle('entities:fgd-catalog', () => {
    if (!cache || Date.now() - cacheTime > 60 * 1000) { cache = catalogForInstall(app); cacheTime = Date.now(); }
    return cache;
  });
}

module.exports = { registerEntityFgdServiceV17, catalogForInstall, parsePointClasses, parseEntityClasses, parseFgdDeclarations };
