const fs = require('fs');
const path = require('path');

const assets = ['DroidSansMono.ttf', 'VNbrique.ttf', 'stopwords'];
const sourceDir = path.join(__dirname, '..', 'src');
const targetDir = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

for (const file of assets) {
  const from = path.join(sourceDir, file);
  const to = path.join(targetDir, file);
  if (!fs.existsSync(from)) {
    console.warn(`[copy-assets] skip missing ${from}`);
    continue;
  }
  fs.copyFileSync(from, to);
  console.log(`[copy-assets] copied ${file}`);
}
