// byanca
'use strict';

globalThis.window = globalThis;

const { validateVmapText } = require('./vmap-text-preflight');

function loadBrowserVmapLayer(file) {
  try {
    require(file);
  } catch (error) {
    throw new Error(`${file} failed to load: ${error?.stack || error}`);
  }
}

loadBrowserVmapLayer('./src/vmap.js');
loadBrowserVmapLayer('./src/vmap-compat-v9.js');
loadBrowserVmapLayer('./src/vmap-helper-compat-v9.js');
loadBrowserVmapLayer('./src/vmap-finalize-v10.js');

const VMAP = globalThis.EPH_VMAP;
if (!VMAP) throw new Error('EPH_VMAP did not initialize.');
if (typeof VMAP.selfTest !== 'function') throw new Error('EPH_VMAP.selfTest is missing.');

const runtime = VMAP.selfTest();
if (!runtime?.ok) throw new Error(`VMAP runtime self-test failed: ${(runtime?.failures || ['unknown failure']).join(' ')}`);

const doc = VMAP.createEmptyDocument();
const part = VMAP.addPart(doc, {
  size: [128, 128, 128],
  material: 'materials/dev/dev_measuregeneric01b.vmat',
  collision: true
});
part.name = 'Part_001';
part.ephProjectionMode = 'tile16';
part.faceTextureSizes = part.faces.map(() => [512, 512]);
part.blockPlayers = true;
part.blockGrenades = true;
part.blockBullets = true;

const prepared = VMAP.prepareForSave(doc, [part]);
const structural = VMAP.validate(prepared);
if (!structural.ok) throw new Error(`Prepared VMAP failed structural validation: ${structural.errors.join(' ')}`);

const text = VMAP.stringify(prepared);
const serialized = validateVmapText(text);
if (!serialized.ok) throw new Error(`Serialized VMAP failed text preflight: ${serialized.errors.join(' ')}`);

const parsedAgain = VMAP.parse(text);
const roundTrip = VMAP.validate(parsedAgain);
if (!roundTrip.ok) throw new Error(`Serialized VMAP failed parser round-trip: ${roundTrip.errors.join(' ')}`);

console.log('VMAP compatibility self-test passed.');
console.log(`Header: ${prepared.header}`);
console.log(`Serialized bytes: ${Buffer.byteLength(text, 'utf8')}`);
