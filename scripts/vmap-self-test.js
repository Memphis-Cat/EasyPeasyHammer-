// byanca
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { assertValidVmapText } = require('../vmap-text-preflight');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src');
const sourceFiles = [
  'vmap.js',
  'vmap-compat-v9.js',
  'vmap-helper-compat-v9.js',
  'vmap-finalize-v10.js'
];
const syntaxOnlyFiles = [
  path.join(root, 'launcher.js'),
  path.join(root, 'vmap-text-preflight.js'),
  path.join(root, 'vmap-write-guard.js'),
  path.join(sourceRoot, 'project-dialog.js'),
  path.join(sourceRoot, 'save-guard-v10.js')
];

function compileScript(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Required compatibility source is missing: ${path.relative(root, filePath)}`);
  const source = fs.readFileSync(filePath, 'utf8');
  new vm.Script(source, { filename: filePath });
}

function runSource(context, fileName) {
  const filePath = path.join(sourceRoot, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`VMAP self-test source is missing: ${fileName}`);
  const source = fs.readFileSync(filePath, 'utf8');
  new vm.Script(source, { filename: filePath }).runInContext(context, { timeout: 5000 });
}

function testDiskGuard(validText) {
  require('../vmap-write-guard');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'eph-vmap-check-'));
  const validPath = path.join(folder, 'valid.vmap');
  const invalidPath = path.join(folder, 'invalid.vmap');
  try {
    fs.writeFileSync(validPath, validText, 'utf8');
    if (!fs.existsSync(validPath)) throw new Error('VMAP disk guard prevented a valid VMAP write.');

    let rejected = false;
    try {
      fs.writeFileSync(invalidPath, '<!-- dmx encoding keyvalues2 4 format vmap 40 -->\n"Broken"\n{\n', 'utf8');
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('VMAP disk guard allowed malformed VMAP text to be written.');
    if (fs.existsSync(invalidPath)) throw new Error('Malformed VMAP reached disk before the write guard rejected it.');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

function main() {
  for (const filePath of syntaxOnlyFiles) compileScript(filePath);

  const sandbox = {
    console,
    structuredClone,
    crypto: crypto.webcrypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  for (const file of sourceFiles) runSource(context, file);

  const VMAP = context.EPH_VMAP;
  if (!VMAP) throw new Error('EPH_VMAP did not initialize.');
  if (typeof VMAP.selfTest !== 'function') throw new Error('VMAP selfTest is missing.');

  const result = VMAP.selfTest();
  if (!result?.ok) throw new Error(`Browser VMAP self-test failed: ${(result?.failures || ['unknown failure']).join(' ')}`);

  const doc = VMAP.createEmptyDocument();
  const part = VMAP.addPart(doc, {
    size: [320, 160, 80],
    position: [32, -48, 96],
    material: 'materials/dev/dev_measuregeneric01b.vmat',
    collision: true
  });
  part.name = 'Part_001';
  part.ephProjectionMode = 'tile16';
  part.faceTextureSizes = part.faces.map((_, index) => index % 2 ? [1024, 512] : [512, 1024]);
  part.blockPlayers = true;
  part.blockGrenades = true;
  part.blockBullets = true;

  const terrainVertices = [];
  const terrainFaces = [];
  const side = 5;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) terrainVertices.push([x * 64, y * 64, ((x + y) % 3) * 8]);
  }
  for (let y = 0; y < side - 1; y++) {
    for (let x = 0; x < side - 1; x++) {
      const a = y * side + x;
      terrainFaces.push([a, a + 1, a + side + 1, a + side]);
    }
  }
  const terrain = VMAP.addPart(doc, {
    vertices: terrainVertices,
    faces: terrainFaces,
    faceMaterials: terrainFaces.map(() => 'materials/dev/dev_measuregeneric01b.vmat'),
    collision: true,
    meshName: 'EPH_TERRAIN_SELFTEST'
  });
  terrain.type = 'part';

  const prepared = VMAP.prepareForSave(doc, [part, terrain]);
  const validation = VMAP.validate(prepared);
  if (!validation.ok) throw new Error(`Prepared VMAP validation failed: ${validation.errors.join(' ')}`);

  const text = VMAP.stringify(prepared);
  assertValidVmapText(text);
  if (!text.includes('EPH_HELPER_grenades_')) throw new Error('Grenade collision helper was not serialized.');
  if (!text.includes('EPH_HELPER_bullets_')) throw new Error('Bullet collision helper was not serialized.');

  const reparsed = VMAP.parse(text);
  const revalidation = VMAP.validate(reparsed);
  if (!revalidation.ok) throw new Error(`Serialized VMAP round-trip failed: ${revalidation.errors.join(' ')}`);

  const extracted = VMAP.extractObjects(reparsed).filter(object => object?.dmxId);
  if (extracted.length < 2) throw new Error(`Expected the Part and terrain after round-trip, got ${extracted.length} editable nodes.`);

  testDiskGuard(text);

  console.log('VMAP compatibility self-test passed.');
  console.log(`Validated ${text.length.toLocaleString()} characters of serialized VMAP text.`);
  console.log('Validated final disk-write rejection for malformed VMAP text.');
}

try {
  main();
} catch (error) {
  console.error('VMAP compatibility self-test FAILED.');
  console.error(error?.stack || error);
  process.exit(1);
}
