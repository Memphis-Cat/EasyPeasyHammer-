// byanca
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'assets', 'app.ico.b64');
const target = path.join(__dirname, 'assets', 'app.ico');

if (!fs.existsSync(source)) {
  console.error('Missing assets/app.ico.b64');
  process.exit(1);
}

const base64 = fs.readFileSync(source, 'utf8').replace(/\s+/g, '');
const bytes = Buffer.from(base64, 'base64');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, bytes);
console.log(`Application icon ready: ${target}`);
