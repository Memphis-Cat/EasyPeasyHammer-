// byanca
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_FGD_BYTES = 8 * 1024 * 1024;
const MAX_INCLUDE_DEPTH = 32;

const safeJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const slash = value => String(value || '').replace(/\\/g, '/');

function normalizeRoot(candidate) {
  if (!candidate) return null;
  try {
    let root = path.resolve(String(candidate).trim().replace(/^"|"$/g, ''));
    if (path.basename(root).toLowerCase() === 'csgo') root = path.resolve(root, '..', '..');
    else if (path.basename(root).toLowerCase() === 'game') root = path.resolve(root, '..');
    return fs.existsSync(path.join(root, 'game', 'csgo', 'gameinfo.gi')) ? root : null;
  } catch { return null; }
}

function steamRoots() {
  const out = [];
  const installs = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')
  ];
  for (const steam of installs) {
    out.push(path.join(steam, 'steamapps', 'common', 'Counter-Strike Global Offensive'));
    const libraries = path.join(steam, 'steamapps', 'libraryfolders.vdf');
    try {
      const text = fs.readFileSync(libraries, 'utf8');
      for (const match of text.matchAll(/"path"\s*"([^"]+)"/gi)) {
        out.push(path.join(match[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', 'Counter-Strike Global Offensive'));
      }
    } catch {}
  }
  return out;
}

function findCs2Root(app) {
  const config = safeJson(path.join(app.getPath('userData'), 'asset-config.json'), {});
  for (const candidate of [config?.cs2Root, process.env.EPH_CS2_PATH, ...steamRoots()]) {
    const root = normalizeRoot(candidate);
    if (root) return root;
  }
  return null;
}

function stripComment(line) {
  let quoted = false, escaped = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted && c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

function delta(text, open, close) {
  let value = 0, quoted = false, escaped = false;
  for (const c of String(text || '')) {
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === open) value++;
    else if (c === close) value--;
  }
  return value;
}

function numbers(text) {
  return [...String(text || '').matchAll(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)].map(match => Number(match[0])).filter(Number.isFinite);
}

function unquote(value) {
  const text = String(value ?? '').trim();
  return text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    : text;
}

function titleFromClass(value) {
  return String(value || '').split('_').filter(Boolean).map(word => word.length <= 3 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function splitColons(text) {
  const out = [];
  let current = '', quoted = false, escaped = false, round = 0, square = 0, curly = 0;
  for (const c of String(text || '')) {
    if (escaped) { current += c; escaped = false; continue; }
    if (quoted && c === '\\') { current += c; escaped = true; continue; }
    if (c === '"') { quoted = !quoted; current += c; continue; }
    if (!quoted) {
      if (c === '(') round++; else if (c === ')') round = Math.max(0, round - 1);
      else if (c === '[') square++; else if (c === ']') square = Math.max(0, square - 1);
      else if (c === '{') curly++; else if (c === '}') curly = Math.max(0, curly - 1);
      else if (c === ':' && !round && !square && !curly) { out.push(current.trim()); current = ''; continue; }
    }
    current += c;
  }
  out.push(current.trim());
  return out;
}

function matchingBlock(text, start) {
  const open = text[start], close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) return -1;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

function topLevelIndex(text, wanted) {
  let quoted = false, escaped = false, round = 0, square = 0, curly = 0;
  for (let i = 0; i < String(text || '').length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === '(') round++; else if (c === ')') round = Math.max(0, round - 1);
    else if (c === '[') square++; else if (c === ']') square = Math.max(0, square - 1);
    else if (c === '{') curly++; else if (c === '}') curly = Math.max(0, curly - 1);
    else if (c === wanted && !round && !square && !curly) return i;
  }
  return -1;
}

function stripLeadingAttributes(text) {
  let value = String(text || '').trim();
  for (let guard = 0; guard < 16; guard++) {
    if (!value.startsWith('[') && !value.startsWith('{')) return { complete: true, text: value };
    const end = matchingBlock(value, 0);
    if (end < 0) return { complete: false, text: value };
    value = value.slice(end + 1).trim();
  }
  return { complete: true, text: value };
}

function classAssignment(text) {
  const source = String(text || '');
  let quoted = false, escaped = false, round = 0, square = 0, curly = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === '(') round++; else if (c === ')') round = Math.max(0, round - 1);
    else if (c === '[') square++; else if (c === ']') square = Math.max(0, square - 1);
    else if (c === '{') curly++; else if (c === '}') curly = Math.max(0, curly - 1);
    else if (c === '=' && !round && !square && !curly) {
      const match = source.slice(i + 1).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*"([^"]*)")?/);
      if (match) return { className: match[1], description: match[2] || '', index: i };
    }
  }
  return null;
}

function canonicalModelResource(value) {
  let resource = slash(value).replace(/^\/+/, '').trim();
  if (resource && !/\.[a-z0-9]+$/i.test(resource)) resource += '.vmdl';
  return resource;
}

function canonicalMaterialResource(value) {
  let resource = slash(value).replace(/^\/+/, '').trim();
  if (!resource) return '';
  if (!/\.[a-z0-9]+$/i.test(resource)) resource += '.vmat';
  if (/\.vmat$/i.test(resource) && !resource.toLowerCase().startsWith('materials/')) resource = `materials/${resource}`;
  return resource;
}

const VISUAL_HELPERS = new Set([
  'editormodel', 'studio', 'iconsprite', 'sprite', 'size', 'bbox', 'wirebox', 'sphere', 'cylinder', 'line', 'selected_line',
  'light', 'lightcone', 'frustum', 'decal', 'quadbounds', 'path', 'origin', 'arc_range', 'box_oriented', 'box_world_aligned',
  'centered_box_oriented', 'vecline_local', 'text_local', 'drawangles', 'drawangles_local', 'externalhelper', 'particle', 'tonemap',
  'overlay', 'orientedwidthheight', 'volumetric_fog_controller', 'cubemap_fog', 'gradientfog', 'player_visibility', 'skybox',
  'skybox_map', 'helper_particle_glow', 'sweptplayerhull', 'fog', 'model'
]);

function helperCalls(header) {
  const source = String(header || '');
  const helpers = [];
  for (let i = 0; i < source.length;) {
    const match = source.slice(i).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*/);
    if (!match) { i++; continue; }
    const name = match[1].toLowerCase();
    let cursor = i + match[0].length;
    const open = source[cursor];
    if ((open !== '(' && open !== '{') || !VISUAL_HELPERS.has(name)) { i += Math.max(1, match[0].length); continue; }
    const end = matchingBlock(source, cursor);
    if (end < 0) { i = cursor + 1; continue; }
    helpers.push({ type: name, raw: source.slice(cursor + 1, end).trim() });
    i = end + 1;
  }
  return helpers;
}

function renderHints(header) {
  const colorValues = numbers(header.match(/\bcolor\s*\(([^)]*)\)/i)?.[1] || '');
  const color = colorValues.length >= 3 ? colorValues.slice(0, 3) : null;
  const result = [];
  for (const helper of helperCalls(header)) {
    const quoted = helper.raw.match(/"([^"]+)"/)?.[1] || '';
    if (helper.type === 'editormodel' || helper.type === 'studio') {
      result.push({ type: helper.type, resource: canonicalModelResource(quoted), raw: helper.raw, color, fixedBounds: /\bfixedbounds\b/i.test(helper.raw) });
      continue;
    }
    if (helper.type === 'iconsprite' || helper.type === 'sprite') {
      result.push({ type: helper.type, resource: canonicalMaterialResource(quoted), raw: helper.raw, color });
      continue;
    }
    if (helper.type === 'size' || helper.type === 'bbox' || helper.type === 'wirebox') {
      const n = numbers(helper.raw);
      let bounds = null;
      if (n.length >= 6) bounds = { min: n.slice(0, 3), max: n.slice(3, 6) };
      else if (n.length >= 3) {
        const half = n.slice(0, 3).map(value => Math.abs(value) / 2);
        bounds = { min: half.map(value => -value), max: half };
      }
      result.push({ type: helper.type === 'size' ? 'bbox' : helper.type, raw: helper.raw, bounds, color, selectionBounds: helper.type === 'size' });
      continue;
    }
    result.push({ type: helper.type, args: helper.raw, raw: helper.raw, numbers: numbers(helper.raw), color });
  }
  return result;
}

function metadata(header) {
  return {
    name: header.match(/\bentity_tool_name\s*=\s*"([^"]+)"/i)?.[1] || '',
    tip: header.match(/\bentity_tool_tip\s*=\s*"([^"]+)"/i)?.[1] || '',
    group: header.match(/\bentity_tool_group\s*=\s*"([^"]+)"/i)?.[1] || ''
  };
}

function collectPropertyHeader(lines, start, type) {
  let joined = '';
  for (let i = start; i < Math.min(lines.length, start + 40); i++) {
    const line = stripComment(lines[i]).trim();
    if (!line) continue;
    joined += `${joined ? ' ' : ''}${line}`;
    const close = joined.indexOf(')');
    if (close < 0) continue;
    const stripped = stripLeadingAttributes(joined.slice(close + 1));
    if (!stripped.complete) continue;
    const rest = stripped.text;
    const eq = topLevelIndex(rest, '=');
    if (/\b(?:choices|flags)\b/i.test(type)) {
      if (eq >= 0) return { end: i, rest, beforeEquals: rest.slice(0, eq).trim() };
      continue;
    }
    if (rest.startsWith(':')) return { end: i, rest, beforeEquals: eq >= 0 ? rest.slice(0, eq).trim() : rest };
  }
  return null;
}

function choiceBlock(lines, headerEnd) {
  let text = '', began = false, depth = 0, end = headerEnd;
  for (let i = headerEnd; i < Math.min(lines.length, headerEnd + 260); i++) {
    let line = stripComment(lines[i]);
    if (i === headerEnd) {
      const eq = topLevelIndex(line, '=');
      line = eq >= 0 ? line.slice(eq + 1) : '';
    }
    if (!began) {
      const at = line.indexOf('[');
      if (at < 0) continue;
      began = true; line = line.slice(at + 1); depth = 1;
    }
    let segment = line;
    let q = false, e = false, d = depth, closeAt = -1;
    for (let x = 0; x < line.length; x++) {
      const c = line[x];
      if (e) { e = false; continue; }
      if (q && c === '\\') { e = true; continue; }
      if (c === '"') { q = !q; continue; }
      if (q) continue;
      if (c === '[') d++;
      else if (c === ']' && --d === 0) { closeAt = x; break; }
    }
    if (closeAt >= 0) { segment = line.slice(0, closeAt); depth = 0; }
    else depth += delta(line, '[', ']');
    text += `${text ? '\n' : ''}${segment}`; end = i;
    if (began && depth <= 0) break;
  }
  const choices = [];
  const regex = /(?:^|\n)\s*(?:"((?:\\.|[^"])*)"|([^:\r\n]+?))\s*:\s*"((?:\\.|[^"])*)"(?:\s*:\s*([^\r\n]+?))?\s*(?=\n|$)/gm;
  for (const match of text.matchAll(regex)) choices.push({ value: unquote(match[1] ?? match[2] ?? ''), label: String(match[3] || '').replace(/\\"/g, '"'), default: unquote(match[4] || '') });
  return { choices, end };
}

function parseProperties(blockLines) {
  const properties = [];
  let squareDepth = 1, curlyDepth = 0;
  for (let i = 0; i < blockLines.length; i++) {
    const line = stripComment(blockLines[i]).trim();
    const beforeSquare = squareDepth, beforeCurly = curlyDepth;
    const squareChange = delta(line, '[', ']'), curlyChange = delta(line, '{', '}');
    if (line && beforeSquare === 1 && beforeCurly === 0 && !/^(?:input|output)\b/i.test(line)) {
      const start = line.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\(\s*([^)]*)\)/);
      if (start) {
        const key = start[1], type = start[2].trim(), header = collectPropertyHeader(blockLines, i, type);
        if (header) {
          const clean = header.beforeEquals.replace(/^\s*:\s*/, '');
          const parts = clean ? splitColons(clean) : [];
          const joined = blockLines.slice(i, header.end + 1).join(' ');
          const close = joined.indexOf(')'), attr = close >= 0 ? joined.slice(close + 1) : '';
          let choices = [];
          if (/\b(?:choices|flags)\b/i.test(type)) choices = choiceBlock(blockLines, header.end).choices;
          let defaultValue = unquote(parts[1] || '');
          if (/\bflags\b/i.test(type) && !defaultValue && choices.length) {
            let mask = 0;
            for (const choice of choices) if (/^(?:1|true|yes)$/i.test(String(choice.default || '')) && Number.isFinite(Number(choice.value))) mask |= Number(choice.value);
            defaultValue = String(mask);
          }
          properties.push({
            key, type, label: unquote(parts[0] || key) || key, default: defaultValue,
            description: unquote(parts.slice(2).join(':') || ''), group: attr.match(/\bgroup\s*=\s*"([^"]+)"/i)?.[1] || '', choices
          });
        }
      }
    }
    squareDepth += squareChange; curlyDepth += curlyChange;
    if (squareDepth <= 0) break;
  }
  const byKey = new Map();
  for (const property of properties) byKey.set(property.key.toLowerCase(), property);
  return [...byKey.values()];
}

function parseDeclarations(text, sourceFile) {
  const lines = String(text || '').split(/\r?\n/).map(stripComment);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i].trim();
    const kindMatch = first.match(/^@(PointClass|SolidClass|BaseClass|OverrideClass|ExtendClass)\b/i);
    if (!kindMatch) continue;
    const startLine = i;
    const headerLines = [first];
    let cursor = i, blockStart = -1, curlyDepth = delta(first, '{', '}'), assignment = classAssignment(first);
    while (++cursor < lines.length && cursor < i + 400) {
      const line = lines[cursor].trim();
      if (!line) continue;
      if (curlyDepth === 0 && /^@(PointClass|SolidClass|BaseClass|OverrideClass|ExtendClass|include|exclude)\b/i.test(line) && !assignment) break;
      const candidate = `${headerLines.join(' ')} ${line}`;
      const found = classAssignment(candidate);
      if (curlyDepth === 0 && found && /^\[/.test(line)) { blockStart = cursor; assignment = found; break; }
      headerLines.push(line); curlyDepth += delta(line, '{', '}'); assignment = found || assignment;
    }
    const header = headerLines.join(' ');
    assignment = classAssignment(header) || assignment;
    if (!assignment) continue;
    const helpers = renderHints(header), meta = metadata(header);
    const base = header.match(/\bbase\s*\(([^)]*)\)/i)?.[1]?.split(',').map(value => value.trim()).filter(Boolean) || [];
    const block = [];
    if (blockStart >= 0) {
      let d = 0;
      for (let j = blockStart; j < lines.length; j++) {
        const line = lines[j]; d += delta(line, '[', ']');
        if (j > blockStart) block.push(line);
        if (d <= 0 && j > blockStart) { cursor = j; break; }
      }
      i = Math.max(i, cursor);
    }
    const rawKind = kindMatch[1].toLowerCase();
    const kind = rawKind === 'solidclass' ? 'solid' : rawKind === 'pointclass' ? 'point' : rawKind === 'baseclass' ? 'base' : 'patch';
    const modelHint = [...helpers].reverse().find(hint => hint.type === 'editormodel' || hint.type === 'studio');
    const primary = modelHint || helpers.find(hint => hint.type === 'iconsprite' || hint.type === 'sprite') || helpers.find(hint => hint.bounds) || helpers[0] || { type: 'none' };
    out.push({
      startLine, declarationType: rawKind, className: assignment.className,
      name: meta.name || assignment.description?.trim() || titleFromClass(assignment.className),
      description: meta.tip || assignment.description?.trim() || '', group: meta.group || '', kind,
      baseClasses: base, model: modelHint?.resource || '', renderHint: primary, renderHints: helpers,
      properties: parseProperties(block), sourceFile
    });
  }
  return out;
}

function parseFileOperations(text, sourceFile) {
  const operations = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim();
    const include = line.match(/^@include\s+"([^"]+)"/i);
    if (include) operations.push({ type: 'include', startLine: i, include: slash(include[1]) });
    const exclude = line.match(/^@exclude\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (exclude) operations.push({ type: 'exclude', startLine: i, className: exclude[1] });
  }
  for (const declaration of parseDeclarations(text, sourceFile)) operations.push({ type: 'declaration', startLine: declaration.startLine, declaration });
  operations.sort((a, b) => a.startLine - b.startLine || (a.type === 'include' ? -1 : 1));
  return operations;
}

function mountedFgdRoots(root) {
  const gameRoot = path.join(root, 'game');
  const gameInfo = path.join(gameRoot, 'csgo', 'gameinfo.gi');
  const mounts = [];
  const add = candidate => {
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved) || mounts.some(item => item.toLowerCase() === resolved.toLowerCase())) return;
    mounts.push(resolved);
  };

  try {
    const lines = fs.readFileSync(gameInfo, 'utf8').split(/\r?\n/).map(stripComment);
    let inSearch = false, depth = 0;
    for (const raw of lines) {
      const line = raw.trim();
      if (!inSearch) {
        if (/^SearchPaths\b/i.test(line)) { inSearch = true; depth += delta(line, '{', '}'); }
        continue;
      }
      depth += delta(line, '{', '}');
      const match = line.match(/^(?:Game|Game_LowViolence|Mod)\s+(?:"([^"]+)"|([^\s{}]+))/i);
      if (match) {
        let value = (match[1] || match[2] || '').trim();
        if (/^\|gameinfo_path\|/i.test(value)) value = value.replace(/^\|gameinfo_path\|[\\/]?/i, 'csgo/');
        if (!value.includes('|') && !/[*!]/.test(value)) add(path.join(gameRoot, value.replace(/[\\/]+/g, path.sep)));
      }
      if (depth <= 0 && line.includes('}')) break;
    }
  } catch {}

  for (const fallback of ['csgo', 'csgo_imported', 'csgo_core', 'core', 'sdktools']) add(path.join(gameRoot, fallback));
  return mounts;
}

function resolveInclude(currentFile, includeName, mountRoots) {
  const relative = includeName.replace(/[\\/]+/g, path.sep);
  const candidates = [path.resolve(path.dirname(currentFile), relative), ...mountRoots.map(root => path.resolve(root, relative))];
  return candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile() && fs.statSync(candidate).size <= MAX_FGD_BYTES; }
    catch { return false; }
  }) || null;
}

function mergePatch(existing, patch) {
  if (!existing) return { ...patch, kind: patch.kind === 'patch' ? 'point' : patch.kind };
  const properties = new Map((existing.properties || []).map(property => [property.key.toLowerCase(), property]));
  for (const property of patch.properties || []) properties.set(property.key.toLowerCase(), property);
  const helpers = [...(existing.renderHints || [])];
  for (const helper of patch.renderHints || []) {
    const signature = `${helper.type}|${helper.resource || ''}|${helper.raw || helper.args || ''}`.toLowerCase();
    if (!helpers.some(item => `${item.type}|${item.resource || ''}|${item.raw || item.args || ''}`.toLowerCase() === signature)) helpers.push(helper);
  }
  const ownModel = [...(patch.renderHints || [])].reverse().find(hint => hint.type === 'editormodel' || hint.type === 'studio')?.resource || '';
  const primary = ownModel
    ? [...helpers].reverse().find(hint => (hint.type === 'editormodel' || hint.type === 'studio') && hint.resource === ownModel)
    : patch.renderHint?.type && patch.renderHint.type !== 'none' ? patch.renderHint : existing.renderHint;
  return {
    ...existing,
    name: patch.name || existing.name,
    description: patch.description || existing.description,
    group: patch.group || existing.group,
    baseClasses: patch.baseClasses?.length ? patch.baseClasses : existing.baseClasses,
    model: ownModel || patch.model || existing.model || '',
    renderHint: primary || existing.renderHint,
    renderHints: helpers,
    properties: [...properties.values()],
    sourceFile: patch.sourceFile || existing.sourceFile,
    kind: existing.kind
  };
}

function resolveDeclaration(name, all, memo, stack = new Set()) {
  const key = String(name || '').toLowerCase();
  if (memo.has(key)) return memo.get(key);
  const own = all.get(key);
  if (!own || stack.has(key)) return own || null;
  stack.add(key);
  const properties = new Map(), helpers = [];
  let inheritedModel = '', inheritedHint = null;
  for (const baseName of own.baseClasses || []) {
    const base = resolveDeclaration(baseName, all, memo, stack);
    if (!base) continue;
    for (const property of base.properties || []) properties.set(property.key.toLowerCase(), property);
    for (const helper of base.renderHints || []) helpers.push(helper);
    if (!inheritedModel) inheritedModel = base.model || '';
    if (!inheritedHint && base.renderHint?.type !== 'none') inheritedHint = base.renderHint;
  }
  for (const property of own.properties || []) properties.set(property.key.toLowerCase(), property);
  for (const helper of own.renderHints || []) helpers.push(helper);
  const uniqueHelpers = [];
  const seen = new Set();
  for (const helper of helpers) {
    const signature = `${helper.type}|${helper.resource || ''}|${helper.raw || helper.args || ''}`.toLowerCase();
    if (seen.has(signature)) continue;
    seen.add(signature); uniqueHelpers.push(helper);
  }
  const value = {
    ...own,
    model: own.model || inheritedModel,
    renderHint: own.renderHint?.type !== 'none' ? own.renderHint : inheritedHint || own.renderHint,
    renderHints: uniqueHelpers,
    properties: [...properties.values()]
  };
  stack.delete(key); memo.set(key, value); return value;
}

function catalogForInstall(app) {
  const root = findCs2Root(app);
  if (!root) return { ok: false, error: 'CS2 installation not configured.', entities: [] };
  const mountRoots = mountedFgdRoots(root);
  const primary = [
    path.join(root, 'game', 'csgo', 'csgo.fgd'),
    path.join(root, 'game', 'csgo_core', 'csgo.fgd'),
    path.join(root, 'game', 'core', 'base.fgd')
  ].find(file => fs.existsSync(file));
  if (!primary) return { ok: false, error: 'Hammer FGD entry file was not found.', entities: [] };

  const all = new Map(), visited = new Set(), files = [], missingIncludes = [];
  let parseErrors = 0;

  const processFile = (file, depth = 0) => {
    if (!file || depth > MAX_INCLUDE_DEPTH) return;
    const resolved = path.resolve(file), key = resolved.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key); files.push(resolved);
    let text;
    try { text = fs.readFileSync(resolved, 'utf8'); }
    catch (error) { parseErrors++; return; }
    const rel = slash(path.relative(root, resolved));
    let operations;
    try { operations = parseFileOperations(text, rel); }
    catch (error) { parseErrors++; globalThis.__ephAppLog?.('warning', 'fgd', `Could not parse ${rel}`, error); return; }
    for (const operation of operations) {
      if (operation.type === 'include') {
        const include = resolveInclude(resolved, operation.include, mountRoots);
        if (include) processFile(include, depth + 1);
        else missingIncludes.push(`${rel} -> ${operation.include}`);
        continue;
      }
      if (operation.type === 'exclude') {
        all.delete(operation.className.toLowerCase());
        continue;
      }
      const declaration = operation.declaration;
      const classKey = declaration.className.toLowerCase();
      if (declaration.kind === 'patch') all.set(classKey, mergePatch(all.get(classKey), declaration));
      else all.set(classKey, declaration);
    }
  };

  processFile(primary);

  const memo = new Map();
  const entities = [...all.keys()]
    .map(key => resolveDeclaration(key, all, memo))
    .filter(entity => entity && (entity.kind === 'point' || entity.kind === 'solid') && entity.className !== 'worldspawn')
    .sort((a, b) => a.name.localeCompare(b.name) || a.className.localeCompare(b.className));
  const pointEntities = entities.filter(entity => entity.kind === 'point').length;
  const solidEntities = entities.filter(entity => entity.kind === 'solid').length;
  const searchPaths = mountRoots.map(folder => slash(path.relative(path.join(root, 'game'), folder)) || '.');

  globalThis.__ephAppLog?.('normal', 'fgd', `Hammer FGD V42 catalog: ${entities.length} entities from ${files.length} include-resolved files`, {
    point: pointEntities, solid: solidEntities, parseErrors, missingIncludes: missingIncludes.length, searchPaths
  });
  return {
    ok: true, root, primaryFgd: slash(path.relative(root, primary)), fgdFiles: files.length, parseErrors,
    missingIncludes, pointEntities, solidEntities, searchPaths, entities
  };
}

function registerEntityFgdServiceV42({ ipcMain, app }) {
  if (globalThis.__ephEntityFgdServiceV42) return;
  globalThis.__ephEntityFgdServiceV42 = true;
  try { ipcMain.removeHandler('entities:fgd-catalog'); } catch {}
  let cache = null, time = 0;
  ipcMain.handle('entities:fgd-catalog', () => {
    if (!cache || Date.now() - time > 60 * 1000) { cache = catalogForInstall(app); time = Date.now(); }
    return cache;
  });
}

module.exports = { registerEntityFgdServiceV42, catalogForInstall, parseDeclarations, parseFileOperations, mountedFgdRoots, canonicalMaterialResource };
