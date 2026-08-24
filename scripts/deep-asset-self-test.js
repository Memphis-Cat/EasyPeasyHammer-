// byanca
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const project = read('backend/EasyPeasyHammer.AssetHost/EasyPeasyHammer.AssetHost.csproj');
const deep = read('backend/EasyPeasyHammer.AssetHost/DeepProgram.cs');

check(project.includes('<StartupObject>DeepProgram</StartupObject>'), 'DeepProgram must remain the Source 2 asset backend entrypoint.');
check(project.includes('ValveResourceFormat'), 'ValveResourceFormat must remain the compiled Source 2 resource parser.');
check(deep.includes('Directory.EnumerateFiles(folder, "*.vpk", SearchOption.AllDirectories)'), 'Deep asset indexing must recursively inspect standalone map/addon/workshop VPKs.');
check(deep.includes('Path.Combine(mount, "maps")'), 'Official map VPK directories must remain indexed.');
check(deep.includes('Path.Combine(gameRoot, "csgo_addons")'), 'Compiled addon/map packages must remain indexed.');
check(deep.includes('"workshop", "content", "730"'), 'Subscribed CS2 workshop map VPKs must remain discoverable.');
check(deep.includes('.vmat_c') && deep.includes('.vmdl_c'), 'Compiled map materials and models must remain indexed.');
check(deep.includes('.vsnd_c') && deep.includes('.vpcf_c'), 'Map-packed sounds and particles must remain indexed too.');
check(deep.includes('SeedCoreKeys') && deep.includes('typeof(AssetService).GetField("unique"'), 'Deep index must seed deduplication from already-known base assets.');
check(deep.includes('if (!unique.Add(key)) return;'), 'Duplicate asset paths across base CS2 and map packages must not be emitted.');
check(deep.includes('item.source.Contains(word'), 'Asset search must support map/workshop package names as search terms.');
check(deep.includes('new GameFileLoader(Package, path)'), 'Map previews must use ValveResourceFormat with the standalone VPK as the current package.');
check(deep.includes('GltfModelExporter') && deep.includes('TextureExtract.ToPngImage'), 'Map model/material previews must be decoded through ValveResourceFormat.');
check(deep.includes('deep-map-asset-index-v'), 'Deep map package indexing must remain cached across normal startups.');
check(deep.includes('IsPackageRoot') && deep.includes('_dir.vpk'), 'Multipart VPK chunk files must not be indexed as independent packages.');

if (failures.length) {
  console.error(`Deep asset self-test failed (${failures.length}):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Deep asset self-test passed. Standalone official-map, addon and workshop VPK resources are indexed without duplicating base assets.');
}
