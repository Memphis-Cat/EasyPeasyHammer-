// byanca
const fs = require('fs');
const path = require('path');

const root = __dirname;
const encodedSource = path.join(root, 'assets', 'app.ico.b64');
const fallbackDir = path.join(root, 'assets', 'app-icon');
const output = path.join(root, 'assets', 'app-icon.ico');

try {
  let encoded = '';
  if (fs.existsSync(encodedSource)) {
    encoded = fs.readFileSync(encodedSource, 'utf8').trim();
  } else if (fs.existsSync(fallbackDir)) {
    const parts = fs.readdirSync(fallbackDir)
      .filter(name => /^part\d+\.txt$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    encoded = parts.map(name => fs.readFileSync(path.join(fallbackDir, name), 'utf8').trim()).join('');
  }

  if (!encoded) throw new Error('Application icon source data was not found.');
  const data = Buffer.from(encoded, 'base64');
  if (data.length < 64 || data[0] !== 0 || data[1] !== 0 || data[2] !== 1 || data[3] !== 0) {
    throw new Error('Application icon source data is invalid.');
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, data);
  console.log(`Application icon ready: ${output}`);
} catch (error) {
  console.error(`Could not prepare application icon: ${error.message}`);
  process.exitCode = 1;
}
