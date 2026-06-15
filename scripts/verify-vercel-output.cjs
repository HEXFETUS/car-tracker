const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.resolve(__dirname, '..', 'dist');
const indexHtml = path.join(outputDir, 'index.html');

if (!fs.existsSync(indexHtml)) {
  console.error('Vercel output check failed: dist/index.html was not created.');
  process.exit(1);
}

const html = fs.readFileSync(indexHtml, 'utf8');

if (!html.includes('<div id="root"></div>')) {
  console.error('Vercel output check failed: dist/index.html is not the React app shell.');
  process.exit(1);
}

console.log('Vercel output check passed: dist/index.html is ready.');
