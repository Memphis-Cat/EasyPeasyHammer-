// byanca
const fs = require('fs');
const path = require('path');
const Module = require('module');

const sourcePath = path.join(__dirname, 'collab-service.js');
let source = fs.readFileSync(sourcePath, 'utf8');

const original = "new WebSocketServer({ host: '0.0.0.0', port: 0, maxPayload: FILE_CHUNK_BYTES + 4096 })";
const replacement = "new WebSocketServer({ host: '0.0.0.0', port: Number(process.env.EPH_COLLAB_PORT || 27015), maxPayload: FILE_CHUNK_BYTES + 4096 })";

if (!source.includes(original)) {
  throw new Error('Could not configure EasyPeasyHammer collaboration port.');
}
source = source.replace(original, replacement);

const runtimeModule = new Module(sourcePath, module);
runtimeModule.filename = sourcePath;
runtimeModule.paths = module.paths;
runtimeModule._compile(source, sourcePath);

module.exports = runtimeModule.exports;
