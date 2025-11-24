const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const IntegralOccupancyMap = require('./integralOccupancyMap');
const { unigramsAndBigrams, processTokens } = require('./tokenization');
const RNG = require('./random');

const FILE_DIR = path.join(__dirname, '..', 'wordcloud');
const DEFAULT_FONT_PATH = path.join(FILE_DIR, 'DroidSansMono.ttf');
const DEFAULT_FONT_FAMILY = 'DroidSansMono';
const STOPWORDS_PATH = path.join(FILE_DIR, 'stopwords');

let cachedStopwords = null;
function loadDefaultStopwords() {
  if (cachedStopwords) return cachedStopwords;
  const text = fs.readFileSync(STOPWORDS_PATH, 'utf8');
  cachedStopwords = new Set(
    text
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter(Boolean)
  );
  return cachedStopwords;
}

function ensureFont(fontPath, family) {
  if (fontPath && fs.existsSync(fontPath)) {
    GlobalFonts.registerFromPath(fontPath, family);
  }
}

function defaultColorFunc(word, fontSize, position, orientation, random) {
  const r = random || new RNG();
  return `hsl(${r.randint(0, 255)}, 80%, 50%)`;
}

class WordCloud {
  constructor(options = {}) {
    this.width = options.width || 400;
    this.height = options.height || 200;
    this.margin = options.margin || 2;
    this.preferHorizontal = options.preferHorizontal ?? 0.9;
    this.mask = options.mask || null;
    this.scale = options.scale || 1;
    this.maxWords = options.maxWords || 200;
    this.minFontSize = options.minFontSize || 4;
    this.fontStep = options.fontStep || 1;
    this.random = options.randomSeed !== undefined ? new RNG(options.randomSeed) : new RNG();
    this.backgroundColor = options.backgroundColor ?? 'black';
    this.maxFontSize = options.maxFontSize || null;
    this.regexp = options.regexp || null;
    this.collocations = options.collocations !== undefined ? options.collocations : true;
    this.normalizePlurals = options.normalizePlurals !== undefined ? options.normalizePlurals : true;
    this.repeat = options.repeat || false;
    this.relativeScaling = options.relativeScaling === undefined ? (this.repeat ? 0 : 0.5) : options.relativeScaling;
    this.includeNumbers = options.includeNumbers || false;
    this.minWordLength = options.minWordLength || 0;
    this.collocationThreshold = options.collocationThreshold || 30;
    this.fontFamily = options.fontFamily || DEFAULT_FONT_FAMILY;
    this.fontPath = options.fontPath || DEFAULT_FONT_PATH;
    this.stopwords = options.stopwords || loadDefaultStopwords();
    this.colorFunc = options.colorFunc || defaultColorFunc;

    ensureFont(this.fontPath, this.fontFamily);
  }

  _normalizeMask(mask) {
    if (!mask) return null;
    if (mask.data && mask.width && mask.height) {
      // ImageData-like input.
      const arr = new Uint8Array(mask.width * mask.height);
      for (let i = 0; i < mask.height; i++) {
        for (let j = 0; j < mask.width; j++) {
          const idx = (i * mask.width + j) * 4;
          const r = mask.data[idx];
          const g = mask.data[idx + 1];
          const b = mask.data[idx + 2];
          arr[i * mask.width + j] = r === 255 && g === 255 && b === 255 ? 1 : 0;
        }
      }
      return { data: arr, width: mask.width, height: mask.height };
    }
    if (mask.length) {
      if (mask.length !== this.width * this.height) {
        throw new Error(`Mask length ${mask.length} does not match expected ${this.width * this.height}`);
      }
      return { data: mask, width: this.width, height: this.height };
    }
    throw new Error('Unsupported mask format');
  }

  processText(text) {
    const basePattern = this.minWordLength <= 1 ? /\w[\w']*/g : /\w[\w']+/g;
    let regex = basePattern;
    if (this.regexp) {
      if (this.regexp instanceof RegExp) {
        const flags = this.regexp.flags.includes('g') ? this.regexp.flags : `${this.regexp.flags}g`;
        regex = new RegExp(this.regexp.source, flags);
      } else {
        regex = new RegExp(this.regexp, 'g');
      }
    }
    const matches = text.match(regex) || [];
    let words = matches.map((w) => (w.toLowerCase().endsWith("'s") ? w.slice(0, -2) : w));
    if (!this.includeNumbers) {
      words = words.filter((w) => !/^\d+$/.test(w));
    }
    if (this.minWordLength) {
      words = words.filter((w) => w.length >= this.minWordLength);
    }
    const stopwords = new Set(Array.from(this.stopwords || []).map((w) => w.toLowerCase()));
    let counts;
    if (this.collocations) {
      counts = unigramsAndBigrams(words, stopwords, this.normalizePlurals, this.collocationThreshold);
    } else {
      const filtered = words.filter((w) => !stopwords.has(w.toLowerCase()));
      counts = processTokens(filtered, this.normalizePlurals).counts;
    }
    return counts;
  }

  _measure(ctx, word, fontSize, orientation) {
    ctx.font = `${fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = 'top'; 
    const metrics = ctx.measureText(word);
    
    // Tối ưu hóa padding: Giảm bớt padding thừa để chữ sát nhau hơn
    // Chỉ thêm 1 chút xíu để tránh clipping
    const width = metrics.width;
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    
    // Tính bounding box chặt chẽ hơn (chỉ cộng 1-2px an toàn thay vì % font)
    const safePad = 1; 
    const measured = { 
        width: width + safePad, 
        height: height + safePad,
        // Lưu offset để vẽ cho chính xác tâm
        offsetY: metrics.actualBoundingBoxAscent 
    };

    if (orientation === 'vertical') {
      return { width: measured.height, height: measured.width, offsetY: measured.offsetY, isVertical: true };
    }
    return measured;
  }


  generateFromFrequencies(frequencies, maxFontSize) {
    let freqEntries;
    if (frequencies instanceof Map) {
      freqEntries = Array.from(frequencies.entries());
    } else {
      freqEntries = Object.entries(frequencies);
    }
    freqEntries = freqEntries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!freqEntries.length) {
      throw new Error('Need at least 1 word to plot');
    }
    freqEntries = freqEntries.slice(0, this.maxWords);
    const maxFrequency = freqEntries[0][1];
    const normalized = freqEntries.map(([w, f]) => [w, f / maxFrequency]);

    const mask = this._normalizeMask(this.mask);
    const width = mask ? mask.width : this.width;
    const height = mask ? mask.height : this.height;
    const occupancy = new IntegralOccupancyMap(height, width, mask ? mask.data : null);

    const measureCanvas = createCanvas(width, height);
    const measureCtx = measureCanvas.getContext('2d');

    const fontSizes = [];
    const positions = [];
    const orientations = [];
    const colors = [];
    const boxSizes = [];

    const rs = this.relativeScaling;
    const margin = this.margin;
    let lastFreq = 1;
    let fontSize = maxFontSize || this.maxFontSize || this.height;

    this.words_ = new Map(normalized);

    const entries = this.repeat && normalized.length < this.maxWords ? this._padFrequencies(normalized) : normalized;

    for (const [word, freq] of entries) {
      if (freq === 0) continue;
      if (rs !== 0) {
        fontSize = Math.round((rs * (freq / lastFreq) + (1 - rs)) * fontSize);
      }

      let orientation = this.random.next() < this.preferHorizontal ? 'horizontal' : 'vertical';
      let triedOther = false;
      let placement = null;
      let measured = null;

      while (true) {
        if (fontSize < this.minFontSize) break;
        measured = this._measure(measureCtx, word, fontSize, orientation);
        const h = Math.ceil(measured.height + margin);
        const w = Math.ceil(measured.width + margin);
        placement = occupancy.samplePosition(h, w, this.random);
        if (placement) break;
        if (!triedOther && this.preferHorizontal < 1) {
          orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
          triedOther = true;
        } else {
          fontSize -= this.fontStep;
          orientation = 'horizontal';
        }
      }

      if (!placement || fontSize < this.minFontSize) {
        break;
      }

      const [x, y] = placement;
      const drawX = x + Math.floor(margin / 2);
      const drawY = y + Math.floor(margin / 2);

      positions.push({ x: drawX, y: drawY });
      orientations.push(orientation);
      fontSizes.push(fontSize);
      boxSizes.push(measured);
      colors.push(
        this.colorFunc(word, fontSize, { x: drawX, y: drawY }, orientation, this.random, {
          fontFamily: this.fontFamily,
        })
      );

      occupancy.occupyRect(x, y, Math.ceil(measured.height + margin), Math.ceil(measured.width + margin));
      lastFreq = freq;
    }

    this.layout = entries.slice(0, fontSizes.length).map(([word, freq], idx) => ({
      word,
      freq,
      fontSize: fontSizes[idx],
      position: positions[idx],
      orientation: orientations[idx],
      color: colors[idx],
      box: boxSizes[idx],
    }));
    this.dimensions = { width, height };
    return this;
  }

    _padFrequencies(frequencies) {
    if (!this.repeat || frequencies.length === 0) return frequencies;
    
    let padded = [...frequencies];
    // Nếu số lượng từ ít hơn maxWords, ta lặp lại
    // Logic cũ của bạn làm giảm size quá nhanh khiến chữ bé tí
    let currentList = frequencies;
    
    while (padded.length < this.maxWords) {
        // Giảm frequency đi 30% mỗi lần lặp lại để phân cấp
        // Nhưng không giảm dựa trên minFreq của list cũ
        const nextPass = currentList.map(([w, f]) => [w, f * 0.7]);
        padded = padded.concat(nextPass);
        currentList = nextPass;
        
        // Stop if freq too small
        if (currentList[0][1] < 0.01) break; 
    }
    
    // Sort lại từ lớn đến bé
    return padded.sort((a, b) => b[1] - a[1]).slice(0, this.maxWords);
  }

  generateFromText(text) {
    const counts = this.processText(text);
    return this.generateFromFrequencies(counts);
  }

  generate(text) {
    return this.generateFromText(text);
  }

  toCanvas(canvas) {
    if (!this.layout) {
      throw new Error('Call generate() first');
    }
    const width = (this.dimensions?.width || this.width) * this.scale;
    const height = (this.dimensions?.height || this.height) * this.scale;
    const target = canvas || createCanvas(width, height);
    const ctx = target.getContext('2d');
    ctx.scale(this.scale, this.scale);
    ctx.textBaseline = 'top';

    if (this.backgroundColor !== null) {
      ctx.fillStyle = this.backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }

    for (const item of this.layout) {
      ctx.save();
      ctx.fillStyle = item.color;
      ctx.font = `${item.fontSize}px ${this.fontFamily}`;
      if (item.orientation === 'vertical') {
        const h = item.box.height;
        ctx.translate(item.position.y + h, item.position.x);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(item.word, 0, 0);
      } else {
        ctx.fillText(item.word, item.position.y, item.position.x);
      }
      ctx.restore();
    }
    return target;
  }

  toBuffer(format = 'image/png') {
    const canvas = this.toCanvas();
    return canvas.toBuffer(format);
  }
}

module.exports = { WordCloud, defaultColorFunc };
