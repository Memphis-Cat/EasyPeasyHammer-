// byanca
'use strict';

const fs = require('fs');
const path = require('path');
const { assertValidVmapText } = require('./vmap-text-preflight');

if (!fs.__ephVmapWriteGuardInstalled) {
  fs.__ephVmapWriteGuardInstalled = true;

  const rawWriteFileSync = fs.writeFileSync.bind(fs);
  const rawCopyFileSync = fs.copyFileSync.bind(fs);
  const rawReadFileSync = fs.readFileSync.bind(fs);

  const isVmapTarget = filePath => {
    const value = String(filePath || '').toLowerCase();
    return value.endsWith('.vmap') || value.endsWith('.vmap.eph-tmp');
  };

  const textFromData = (data, options) => {
    if (Buffer.isBuffer(data)) return data.toString(typeof options === 'string' ? options : options?.encoding || 'utf8');
    if (typeof data === 'string') return data;
    return null;
  };

  fs.writeFileSync = function(filePath, data, options) {
    if (isVmapTarget(filePath)) {
      const text = textFromData(data, options);
      if (text === null) throw new Error('VMAP disk write refused non-text data.');
      assertValidVmapText(text);
    }
    return rawWriteFileSync(filePath, data, options);
  };

  fs.copyFileSync = function(source, destination, mode) {
    if (isVmapTarget(destination)) {
      const text = rawReadFileSync(source, 'utf8');
      assertValidVmapText(text);
    }
    return rawCopyFileSync(source, destination, mode);
  };
}

module.exports = true;
