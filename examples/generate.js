const fs = require('fs');
const path = require('path');
const { loadImage, createCanvas } = require('@napi-rs/canvas');
const { WordCloud } = require('..');

const sampleText = `One Two Three`;

async function createFromMask(filePath, maxDimension = null) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
  const img = await loadImage(resolved);
  const scale =
    maxDimension && Math.max(img.width, img.height) > maxDimension
      ? maxDimension / Math.max(img.width, img.height)
      : 1;
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));

  const canvas = createCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, targetW, targetH);
  const raw = ctx.getImageData(0, 0, targetW, targetH);
  const data = raw.data;

  // Normalize: white (or fully transparent) blocks placement; anything else is free.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const isWhite = r === 255 && g === 255 && b === 255;
    const isTransparent = a === 0;
    if (isTransparent) {
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
  // Place a `mask.png` next to this script to constrain the cloud shape.
  const maskPath = '/Users/apple/Downloads/pngegg.png';
  const hasMask = fs.existsSync(maskPath);
  const previewMask = hasMask ? await createFromMask(maskPath, 512) : null;
  const fullMask = hasMask ? await createFromMask(maskPath, 1024) : null;

  const baseOptions = {
    // null => transparent background, only the colored words are drawn.
    backgroundColor: null,
    randomSeed: 13,
    preferHorizontal: 0.85,
    repeat: true,
    // maxWords: 1000,
    margin: 4,
    fillGaps: true,
    // Define your own palette inline; this keeps the package lean.
    colorFunc: (() => {
      const palette = ['#ff69b4', '#ff1493', '#db7093']; // customize here
      return () => palette[Math.floor(Math.random() * palette.length)];
    })(),
    // minFontSize: 4,
    // maxFontSize: 12,
  };

  const previewCloud = new WordCloud({ ...baseOptions, mask: previewMask || undefined });
  previewCloud.generate(sampleText.repeat(2));
  const previewCanvas = previewCloud.toCanvas();
  const previewOutput = path.join(__dirname, 'example.preview.png');
  fs.writeFileSync(previewOutput, previewCanvas.toBuffer('image/png'));
  console.log(`Saved preview ${previewOutput}`);

  // const fullCloud = new WordCloud({ ...baseOptions, mask: fullMask || undefined });
  // fullCloud.generate(sampleText.repeat(2));
  // const fullCanvas = fullCloud.toCanvas();
  // const fullOutput = path.join(__dirname, 'example.full.png');
  // fs.writeFileSync(fullOutput, fullCanvas.toBuffer('image/png'));
  // console.log(`Saved full ${fullOutput}`);
}

main();
