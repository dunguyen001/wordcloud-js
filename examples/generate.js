const fs = require('fs');
const path = require('path');
const { loadImage, createCanvas } = require('@napi-rs/canvas');
const { WordCloud } = require('../src/wordcloud');

const sampleText = `Mom brave kind loving best protective patient caring inspiring`;

async function createFromMask(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
  const img = await loadImage(resolved);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const raw = ctx.getImageData(0, 0, img.width, img.height);
  const data = raw.data;

  // Normalize: white (or fully transparent) blocks placement; anything else is free.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const isWhite = r === 255 && g === 255 && b === 255;
    const isTransparent = a === 0;
    if (isWhite || isTransparent) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }

  return raw;
}

async function main() {
  // const mask = createHeartMask(700);
  const cloud = new WordCloud({
    mask: await createFromMask('/Users/apple/Downloads/pngegg.png'),
    // null => transparent background, only the colored words are drawn.
    backgroundColor: null,
    randomSeed: 13,
    preferHorizontal: 0.85,
    repeat: true,
    // maxWords: 1000,
    margin: 2,
    fillGaps: true,
    // Define your own palette inline; this keeps the package lean.
    colorFunc: (() => {
      const palette = ['#ff69b4', '#ff1493', '#db7093']; // customize here
      return () => palette[Math.floor(Math.random() * palette.length)];
    })(),
    // minFontSize: 4,
    // maxFontSize: 12,
  });

  cloud.generate(sampleText.repeat(2));
  const canvas = cloud.toCanvas();
  const output = path.join(__dirname, 'example.png');
  fs.writeFileSync(output, canvas.toBuffer('image/png'));
  console.log(`Saved ${output}`);
}

main();
