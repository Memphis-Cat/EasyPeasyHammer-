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

function exposeViewportRuntime(sourceText) {
  const matches = [...sourceText.matchAll(/^import\s+.*?;\s*$/gm)];
  const last = matches.at(-1);
  if (!last) throw new Error('viewport3d.js has no imports to anchor the shared Three runtime.');
  const at = last.index + last[0].length;
  const expose = [
    'window.EPH_THREE = THREE;',
    'window.THREE = THREE;',
    'window.EPH_THREE_HELPERS = { cloneSkeleton };',
  ].join('\n');
  return `${sourceText.slice(0, at)}\n${expose}\n${sourceText.slice(at)}`;
}

function useSharedViewportThree(sourceText, sourceName) {
  let output = sourceText
    .replace(/^import\s+\*\s+as\s+THREE\s+from\s+['"]three['"];\s*$/gm, 'const THREE = window.EPH_THREE || window.THREE;')
    .replace(/^import\s+\{\s*clone\s+as\s+cloneSkeleton\s*\}\s+from\s+['"]three\/addons\/utils\/SkeletonUtils\.js['"];\s*$/gm, 'const cloneSkeleton = window.EPH_THREE_HELPERS?.cloneSkeleton;');

  const remainingThreeImports = [...output.matchAll(/^import\s+.*?from\s+['"]three(?:\/[^'"]*)?['"];\s*$/gm)];
  if (remainingThreeImports.length) {
    throw new Error(`${sourceName} still imports a private Three.js module: ${remainingThreeImports.map(match => match[0].trim()).join(', ')}`);
  }
  return output;
}

async function bundleOne(sourceName, outputName, isViewport) {
  const source = path.join(sourceRoot, sourceName);
  const outfile = path.join(outputRoot, outputName);
  const rawSource = fs.readFileSync(source, 'utf8');
  const contents = isViewport ? exposeViewportRuntime(rawSource) : useSharedViewportThree(rawSource, sourceName);

  await esbuild.build({
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    banner: { js: isViewport ? '// byanca\nif (!window.EPH3D) {' : '// byanca' },
    footer: { js: isViewport ? '}' : '' },
    logLevel: 'silent',
    stdin: {
      contents,
      resolveDir: sourceRoot,
      sourcefile: sourceName,
      loader: 'js'
    }
  });

  const built = fs.readFileSync(outfile, 'utf8');
  if (!isViewport && /Multiple instances of Three\.js|REVISION\s*=/.test(built)) {
    throw new Error(`${outputName} appears to contain a private Three.js runtime.`);
  }
  const stat = fs.statSync(outfile);
  console.log(`Bundled ${sourceName} -> ${path.relative(root, outfile)} (${Math.round(stat.size / 1024)} KB)`);
}

async function main() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const entry of entries) await bundleOne(...entry);
  const missing = entries.map(([, outputName]) => path.join(outputRoot, outputName)).filter(file => !fs.existsSync(file));
  if (missing.length) throw new Error(`Renderer bundle output missing: ${missing.join(', ')}`);
  console.log('EasyPeasyHammer renderer bundles ready (single shared Three.js runtime).');
}

main().catch(error => {
  console.error('Renderer bundling failed:', error?.stack || error);
  process.exit(1);
});
