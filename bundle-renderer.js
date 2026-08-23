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

function exposeViewportThree(sourceText) {
  const matches = [...sourceText.matchAll(/^import\s+.*?;\s*$/gm)];
  const last = matches.at(-1);
  if (!last) return sourceText;
  const at = last.index + last[0].length;
  // Runtime compatibility passes must use the *same* Three.js module instance as
  // the viewport. Bundling another copy causes THREE's multiple-instances warning
  // and can make helpers/streaming fail their dependency check.
  return `${sourceText.slice(0, at)}\nwindow.THREE = THREE;\n${sourceText.slice(at)}`;
}

async function bundleOne(sourceName, outputName, guardViewport) {
  const source = path.join(sourceRoot, sourceName);
  const outfile = path.join(outputRoot, outputName);
  const banner = guardViewport ? '// byanca\nif (!window.EPH3D) {' : '// byanca';
  const footer = guardViewport ? '}' : '';

  const options = {
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
  };

  if (guardViewport) {
    options.stdin = {
      contents: exposeViewportThree(fs.readFileSync(source, 'utf8')),
      resolveDir: sourceRoot,
      sourcefile: sourceName,
      loader: 'js'
    };
  } else {
    options.entryPoints = [source];
  }

  await esbuild.build(options);

  const stat = fs.statSync(outfile);
  console.log(`Bundled ${sourceName} -> ${path.relative(root, outfile)} (${Math.round(stat.size / 1024)} KB)`);
}

async function main() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  for (const entry of entries) await bundleOne(...entry);

  const missing = entries.map(([, outputName]) => path.join(outputRoot, outputName)).filter(file => !fs.existsSync(file));
  if (missing.length) throw new Error(`Renderer bundle output missing: ${missing.join(', ')}`);

  console.log('EasyPeasyHammer renderer bundles ready.');
}

main().catch(error => {
  console.error('Renderer bundling failed:', error?.stack || error);
  process.exit(1);
});
