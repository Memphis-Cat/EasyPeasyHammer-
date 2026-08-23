// byanca
'use strict';

const fs = require('fs');
const { assertValidVmapText } = require('./vmap-text-preflight');

if (!fs.__ephVmapWriteGuardInstalled) {
  fs.__ephVmapWriteGuardInstalled = true;

  const rawWriteFileSync = fs.writeFileSync.bind(fs);
  const rawCopyFileSync = fs.copyFileSync.bind(fs);
  const rawReadFileSync = fs.readFileSync.bind(fs);

  const normalized = filePath => String(filePath || '').toLowerCase();
  const isGeneratedVmapWrite = filePath => {
    const value = normalized(filePath);
    return value.endsWith('.vmap') || value.endsWith('.vmap.eph-tmp');
  };
  const isGeneratedTemp = filePath => normalized(filePath).endsWith('.vmap.eph-tmp');

  const textFromData = (data, options) => {
    if (Buffer.isBuffer(data)) return data.toString(typeof options === 'string' ? options : options?.encoding || 'utf8');
    if (typeof data === 'string') return data;
    return null;
  };

  fs.writeFileSync = function(filePath, data, options) {
    if (isGeneratedVmapWrite(filePath)) {
      const text = textFromData(data, options);
      if (text === null) throw new Error('VMAP disk write refused non-text data.');
      assertValidVmapText(text);
    }
    return rawWriteFileSync(filePath, data, options);
  };

  fs.copyFileSync = function(source, destination, mode) {
    // Backups may intentionally preserve an original binary DMX VMAP byte-for-byte.
    // Only validate copies sourced from EasyPeasyHammer's generated text temp file.
    if (isGeneratedVmapWrite(destination) && isGeneratedTemp(source)) {
      const text = rawReadFileSync(source, 'utf8');
      assertValidVmapText(text);
    }
    return rawCopyFileSync(source, destination, mode);
  };
}

module.exports = true;
