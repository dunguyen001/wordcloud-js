const fs = require("fs");
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const IntegralOccupancyMap = require("./integralOccupancyMap");
const { unigramsAndBigrams, processTokens } = require("./tokenization");
const RNG = require("./random");

const FILE_DIR = path.join(__dirname, "..", "wordcloud");
const DEFAULT_FONT_PATH = path.join(FILE_DIR, "DroidSansMono.ttf");
const DEFAULT_FONT_FAMILY = "DroidSansMono";
const STOPWORDS_PATH = path.join(FILE_DIR, "stopwords");

let cachedStopwords = null;
function loadDefaultStopwords() {
  if (cachedStopwords) return cachedStopwords;
  const text = fs.readFileSync(STOPWORDS_PATH, "utf8");
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
    this.random =
      options.randomSeed !== undefined
        ? new RNG(options.randomSeed)
        : new RNG();
    this.backgroundColor = options.backgroundColor ?? "black";
    this.maxFontSize = options.maxFontSize || null;
    this.regexp = options.regexp || null;
    this.collocations =
      options.collocations !== undefined ? options.collocations : true;
    this.normalizePlurals =
      options.normalizePlurals !== undefined ? options.normalizePlurals : true;
    this.repeat = options.repeat || false;
    this.relativeScaling =
      options.relativeScaling === undefined
        ? this.repeat
          ? 0
          : 0.5
        : options.relativeScaling;
    this.includeNumbers = options.includeNumbers || false;
    this.minWordLength = options.minWordLength || 0;
    this.collocationThreshold = options.collocationThreshold || 30;
    this.fillGaps = options.fillGaps || false;
    this.fontFamily = options.fontFamily || DEFAULT_FONT_FAMILY;
    this.fontPath = options.fontPath || DEFAULT_FONT_PATH;
    this.stopwords = options.stopwords || loadDefaultStopwords();
    this.colorFunc = options.colorFunc || defaultColorFunc;

    ensureFont(this.fontPath, this.fontFamily);
  }

  _normalizeMask(mask) {
    if (!mask) return null;
    if (mask.data && mask.width && mask.height) {
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
        throw new Error(
          `Mask length ${mask.length} does not match expected ${
            this.width * this.height
          }`
        );
      }
      return { data: mask, width: this.width, height: this.height };
    }
    throw new Error("Unsupported mask format");
  }

  processText(text) {
    const basePattern = this.minWordLength <= 1 ? /\w[\w']*/g : /\w[\w']+/g;
    let regex = basePattern;
    if (this.regexp) {
      if (this.regexp instanceof RegExp) {
        const flags = this.regexp.flags.includes("g")
          ? this.regexp.flags
          : `${this.regexp.flags}g`;
        regex = new RegExp(this.regexp.source, flags);
      } else {
        regex = new RegExp(this.regexp, "g");
      }
    }
    const matches = text.match(regex) || [];
    let words = matches.map((w) =>
      w.toLowerCase().endsWith("'s") ? w.slice(0, -2) : w
    );
    if (!this.includeNumbers) {
      words = words.filter((w) => !/^\d+$/.test(w));
    }
    if (this.minWordLength) {
      words = words.filter((w) => w.length >= this.minWordLength);
    }
    const stopwords = new Set(
      Array.from(this.stopwords || []).map((w) => w.toLowerCase())
    );
    let counts;
    if (this.collocations) {
      counts = unigramsAndBigrams(
        words,
        stopwords,
        this.normalizePlurals,
        this.collocationThreshold
      );
    } else {
      const filtered = words.filter((w) => !stopwords.has(w.toLowerCase()));
      counts = processTokens(filtered, this.normalizePlurals).counts;
    }
    return counts;
  }

  _measure(ctx, word, fontSize) {
    ctx.font = `${fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = "top"; 
    const metrics = ctx.measureText(word);

    const buffer = 2; 

    const width = Math.ceil(metrics.width + buffer);
    const height = Math.ceil(
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + buffer
    );

    return {
      width,
      height,
      ascent: metrics.actualBoundingBoxAscent,
    };
  }

  generateFromFrequencies(frequencies, maxFontSize) {
    let freqEntries;
    if (frequencies instanceof Map) {
      freqEntries = Array.from(frequencies.entries());
    } else {
      freqEntries = Object.entries(frequencies);
    }
    freqEntries = freqEntries
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

    if (!freqEntries.length) {
      throw new Error("Need at least 1 word to plot");
    }
    freqEntries = freqEntries.slice(0, this.maxWords);
    const maxFrequency = freqEntries[0][1];
    
    // Normalize frequencies
    const normalized = freqEntries.map(([w, f]) => [w, f / maxFrequency]);

    const mask = this._normalizeMask(this.mask);
    const width = mask ? mask.width : this.width;
    const height = mask ? mask.height : this.height;
    
    // Integral Image để tính toán va chạm nhanh (O(1))
    const occupancy = new IntegralOccupancyMap(
      height,
      width,
      mask ? mask.data : null
    );

    const measureCanvas = createCanvas(width, height);
    const measureCtx = measureCanvas.getContext("2d");

    const layoutItems = [];
    const rs = this.relativeScaling;
    let lastFreq = 1;
    let fontSize = maxFontSize || this.maxFontSize || this.height;

    const entries =
      this.repeat && normalized.length < this.maxWords
        ? this._padFrequencies(normalized)
        : normalized;

    for (const [word, freq] of entries) {
      if (freq === 0) continue;
      
      if (rs !== 0) {
        fontSize = Math.round((rs * (freq / lastFreq) + (1 - rs)) * fontSize);
      }

      let orientation = null;
      if (this.random.next() < this.preferHorizontal) {
        orientation = "horizontal";
      } else {
        orientation = "vertical";
      }

      let triedOther = false;
      let result = null;
      let box = null;

      while (true) {
        if (fontSize < this.minFontSize) break;
        const measured = this._measure(measureCtx, word, fontSize);
        
        let searchW, searchH;

        if (orientation === "horizontal") {
          searchW = measured.width + this.margin;
          searchH = measured.height + this.margin;
        } else {
          searchW = measured.height + this.margin;
          searchH = measured.width + this.margin;
        }

        const pos = occupancy.samplePosition(searchH, searchW, this.random);

        if (pos) {
          const [y, x] = pos;
          result = { x, y };
          box = measured;
          
          occupancy.occupyRect(y, x, searchH, searchW);
          break;
        }

        if (!triedOther && this.preferHorizontal < 1) {
          orientation = orientation === "horizontal" ? "vertical" : "horizontal";
          triedOther = true;
        } else {
          fontSize -= this.fontStep;
          orientation = null;
          if (this.preferHorizontal > 0.5) orientation = "horizontal";
          else orientation = "vertical";
          
          triedOther = false; 
        }
      }

      if (fontSize < this.minFontSize || !result) {
         continue;
      }
      const drawX = result.x + Math.floor(this.margin / 2);
      const drawY = result.y + Math.floor(this.margin / 2);

      layoutItems.push({
        word,
        freq,
        fontSize,
        x: drawX,
        y: drawY,
        w: box.width,
        h: box.height,
        orientation,
        color: this.colorFunc(
          word,
          fontSize,
          { x: drawX, y: drawY },
          orientation,
          this.random,
          { fontFamily: this.fontFamily }
        ),
      });

      lastFreq = freq;
    }

    this.layout = layoutItems;
    this.dimensions = { width, height };
    return this;
  }

  _padFrequencies(frequencies) {
    if (!this.repeat || frequencies.length === 0) return frequencies;

    let padded = [...frequencies];
    let currentList = frequencies;

    while (padded.length < this.maxWords) {
      const nextPass = currentList.map(([w, f]) => [w, f * 0.7]);
      padded = padded.concat(nextPass);
      currentList = nextPass;
      if (currentList[0][1] < 0.01) break;
    }
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
      throw new Error("Call generate() first");
    }
    const width = (this.dimensions?.width || this.width) * this.scale;
    const height = (this.dimensions?.height || this.height) * this.scale;
    const target = canvas || createCanvas(width, height);
    const ctx = target.getContext("2d");
    
    ctx.scale(this.scale, this.scale);
    
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    if (this.backgroundColor !== null) {
      ctx.fillStyle = this.backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }

    for (const item of this.layout) {
      ctx.save();
      ctx.fillStyle = item.color;
      ctx.font = `${item.fontSize}px ${this.fontFamily}`;

      if (item.orientation === "horizontal") {
        ctx.fillText(item.word, item.x, item.y);
      } else {
        ctx.translate(item.x, item.y + item.w);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(item.word, 0, 0);
      }

      ctx.restore();
    }
    return target;
  }

  toBuffer(format = "image/png") {
    const canvas = this.toCanvas();
    return canvas.toBuffer(format);
  }
}

module.exports = { WordCloud, defaultColorFunc };