// byanca
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = __dirname;
const sourceRoot = path.join(root, 'src');
const outputRoot = path.join(sourceRoot, 'bundled');

const entries = [
  ['viewport3d.js', 'viewport3d.bundle.js', true],
  ['advanced-viewport.js', 'advanced-viewport.bundle.js', false],
  ['hammer-fidelity.js', 'hammer-fidelity.bundle.js', false],
  ['fidelity-v2.js', 'fidelity-v2.bundle.js', false],
  ['texture-projection-v4.js', 'texture-projection-v4.bundle.js', false],
  ['editor-tools-v6.js', 'editor-tools-v6.bundle.js', false],
  ['editor-ux-v7.js', 'editor-ux-v7.bundle.js', false],
  ['audit-fixes-v8.js', 'audit-fixes-v8.bundle.js', false],
  ['collab-visuals.js', 'collab-visuals.bundle.js', false]
];

async function bundleOne(sourceName, outputName, guardViewport) {
  const source = path.join(sourceRoot, sourceName);
  const outfile = path.join(outputRoot, outputName);
  const banner = guardViewport
    ? '// byanca\nif (!window.EPH3D) {'
    : '// byanca';
  const footer = guardViewport ? '}' : '';

  await esbuild.build({
    entryPoints: [source],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    banner: { js: banner },
    footer: footer ? { js: footer } : undefined,
    logLevel: 'silent'
  });

  const stat = fs.statSync(outfile);
  console.log(`Bundled ${sourceName} -> ${path.relative(root, outfile)} (${Math.round(stat.size / 1024)} KB)`);
}

async function main() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  for (const entry of entries) await bundleOne(...entry);

  const missing = entries
    .map(([, outputName]) => path.join(outputRoot, outputName))
    .filter(file => !fs.existsSync(file));
  if (missing.length) throw new Error(`Renderer bundle output missing: ${missing.join(', ')}`);

  console.log('EasyPeasyHammer renderer bundles ready.');
}

main().catch(error => {
  console.error('Renderer bundling failed:', error?.stack || error);
  process.exit(1);
});
