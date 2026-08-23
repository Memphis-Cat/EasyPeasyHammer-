// byanca
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function normalize(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function projectFile(vmapPath, resource) {
  try {
    const root = path.resolve(path.dirname(String(vmapPath || '')));
    const relative = normalize(resource);
    if (!root || !relative || path.isAbsolute(relative) || relative.includes('\0')) return null;
    const candidate = path.resolve(root, ...relative.split('/'));
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (candidate !== root && !candidate.toLowerCase().startsWith(prefix.toLowerCase())) return null;
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function quotedValue(text, key) {
  const pattern = new RegExp(`(?:^|\\n)\\s*"?${String(key).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}"?\\s*(?:=|\\s)\\s*"([^"]+)"`, 'im');
  return text.match(pattern)?.[1] || '';
}

function textureCandidates(text) {
  const keys = ['TextureColor', 'g_tColor', 'g_tColor1', 'g_tBaseColor', 'g_tDiffuse', 'g_tAlbedo', 'TextureBase'];
  const output = [];
  for (const key of keys) {
    const value = quotedValue(text, key);
    if (value) output.push(normalize(value));
  }
  for (const match of text.matchAll(/"([^"\r\n]+\.(?:png|jpe?g|webp|bmp|tga|vtex))"/gi)) output.push(normalize(match[1]));
  return [...new Set(output)];
}

function imageForReference(vmapPath, vmatPath, reference) {
  const direct = projectFile(vmapPath, reference);
  if (direct && /\.(?:png|jpe?g|webp|bmp)$/i.test(direct)) return direct;

  const root = path.dirname(path.resolve(vmapPath));
  const baseReference = reference.replace(/_c$/i, '').replace(/\.(?:vtex|tga|png|jpe?g|webp|bmp)$/i, '');
  const referenceCandidates = [
    `${baseReference}.png`, `${baseReference}.jpg`, `${baseReference}.jpeg`, `${baseReference}.webp`, `${baseReference}.bmp`,
  ];
  for (const candidate of referenceCandidates) {
    const file = projectFile(vmapPath, candidate);
    if (file) return file;
  }

  const siblingBase = path.join(path.dirname(vmatPath), path.basename(baseReference));
  for (const extension of ['.png', '.jpg', '.jpeg', '.webp', '.bmp']) {
    const file = `${siblingBase}${extension}`;
    if (file.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`) && fs.existsSync(file)) return file;
  }
  return null;
}

function localMaterial(vmapPath, resourcePath) {
  const normalized = normalize(resourcePath);
  let vmatPath = projectFile(vmapPath, normalized);
  if (!vmatPath && !/\.vmat$/i.test(normalized)) vmatPath = projectFile(vmapPath, `${normalized}.vmat`);
  if (!vmatPath || path.extname(vmatPath).toLowerCase() !== '.vmat') return { ok: false, local: false, error: 'Map-local VMAT was not found.' };

  try {
    const text = fs.readFileSync(vmatPath, 'utf8');
    const references = textureCandidates(text);
    for (const reference of references) {
      const image = imageForReference(vmapPath, vmatPath, reference);
      if (!image) continue;
      const result = {
        ok: true,
        local: true,
        resource: normalized,
        source: path.relative(path.dirname(path.resolve(vmapPath)), vmatPath).replace(/\\/g, '/'),
        texture: reference,
        path: image,
        url: pathToFileURL(image).href,
      };
      globalThis.__ephAppLog?.('normal', 'map-local-material', 'Resolved map-local material texture.', {
        resource: normalized,
        source: result.source,
        texture: reference,
      });
      return result;
    }
    globalThis.__ephAppLog?.('warning', 'map-local-material', 'Map-local VMAT has no browser-previewable loose texture.', { resource: normalized, references });
    return { ok: false, local: true, error: 'Map-local VMAT exists, but no loose PNG/JPG/WebP/BMP texture could be resolved.', references };
  } catch (error) {
    globalThis.__ephAppLog?.('error', 'map-local-material', 'Could not read map-local VMAT.', { resource: normalized, error: error.message });
    return { ok: false, local: true, error: error.message };
  }
}

function registerMapLocalMaterialServiceV19({ ipcMain }) {
  if (globalThis.__ephMapLocalMaterialServiceV19) return;
  globalThis.__ephMapLocalMaterialServiceV19 = true;
  ipcMain.handle('map-local:material', (_event, vmapPath, resourcePath) => localMaterial(vmapPath, resourcePath));
}

module.exports = { registerMapLocalMaterialServiceV19, localMaterial };
