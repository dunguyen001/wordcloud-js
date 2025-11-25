import fs from "fs";
import path from "path";
import { Canvas, createCanvas, GlobalFonts } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { unigramsAndBigrams, processTokens } from "./tokenization";
import RNG from "./random";

const DEFAULT_FONT_PATH = path.join(__dirname, "VNbrique.ttf");
const DEFAULT_FONT_FAMILY = "VNbrique";
const DEFAULT_BACKGROUND = "black";
const STOPWORDS_PATH = path.join(__dirname, "stopwords");

type MaskBuffer = Uint8Array | Uint8ClampedArray | number[];

interface MaskData {
  data: MaskBuffer;
  width: number;
  height: number;
}

interface NormalizedMask {
  data: Uint8Array;
  width: number;
  height: number;
}

export type Orientation = "horizontal" | "vertical";

export interface Position {
  x: number;
  y: number;
}

export type ColorFunction = (
  word: string,
  fontSize: number,
  position: Position,
  orientation: Orientation,
  random: RNG,
  meta?: { fontFamily?: string }
) => string;

export interface LayoutItem {
  word: string;
  freq: number;
  fontSize: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ascent: number; // <--- THÊM DÒNG NÀY
  orientation: Orientation;
  color: string;
}

export interface WordCloudOptions {
  width?: number;
  height?: number;
  margin?: number;
  preferHorizontal?: number;
  mask?: MaskBuffer | MaskData | null;
  scale?: number;
  maxWords?: number;
  minFontSize?: number;
  fontStep?: number;
  randomSeed?: number;
  backgroundColor?: string | null;
  maxFontSize?: number | null;
  regexp?: RegExp | string | null;
  collocations?: boolean;
  normalizePlurals?: boolean;
  repeat?: boolean;
  relativeScaling?: number;
  includeNumbers?: boolean;
  minWordLength?: number;
  collocationThreshold?: number;
  fillGaps?: boolean; // kept for API parity
  fontFamily?: string;
  fontPath?: string;
  stopwords?: Iterable<string>;
  colormap?: string;
  colorFunc?: ColorFunction | ColormapColorFunc;
}

let cachedStopwords: Set<string> | null = null;
function loadDefaultStopwords(): Set<string> {
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

function ensureFont(fontPath?: string, family?: string): void {
  if (!fontPath || !family) return;
  if (GlobalFonts.has(family)) return;
  if (fs.existsSync(fontPath)) {
    GlobalFonts.registerFromPath(fontPath, family);
  }
}

export function defaultColorFunc(
  _word: string,
  _fontSize: number,
  _position: Position,
  _orientation: Orientation,
  random?: RNG
): string {
  const r = random || new RNG();
  return `hsl(${r.randint(0, 255)}, 80%, 50%)`;
}

class ColormapColorFunc {
  private name: string;
  private viridisStops: Array<[number, [number, number, number]]>;

  constructor(colormap: string = "viridis") {
    this.name = colormap;
    // Key points sampled from matplotlib's viridis (approximate)
    this.viridisStops = [
      [0.0, [68, 1, 84]],
      [0.13, [71, 44, 122]],
      [0.25, [59, 81, 139]],
      [0.38, [44, 113, 142]],
      [0.5, [33, 144, 141]],
      [0.63, [39, 173, 129]],
      [0.75, [92, 200, 99]],
      [0.88, [170, 220, 50]],
      [1.0, [253, 231, 37]],
    ];
  }

  private interpColor(t: number): string {
    const stops = this.viridisStops;
    let i = 0;
    while (i < stops.length - 1 && t > stops[i + 1][0]) {
      i += 1;
    }
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[Math.min(i + 1, stops.length - 1)];
    const localT = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    const lerp = (a: number, b: number) => a + (b - a) * localT;
    const [r, g, b] = [
      lerp(c0[0], c1[0]),
      lerp(c0[1], c1[1]),
      lerp(c0[2], c1[2]),
    ];
    return `rgb(${r.toFixed(0)}, ${g.toFixed(0)}, ${b.toFixed(0)})`;
  }

  call(random?: RNG): string {
    const t = (random || new RNG()).next();
    if (this.name === "hsv") {
      const hue = Math.floor(t * 255);
      return `hsl(${hue}, 80%, 50%)`;
    }
    return this.interpColor(t);
  }

  __call__(
    _word: string,
    _fontSize: number,
    _position: Position,
    _orientation: Orientation,
    random?: RNG,
    _meta?: { fontFamily?: string }
  ): string {
    return this.call(random);
  }
}

class IntegralOccupancyMap {
  private height: number;
  private width: number;
  private data: Uint8Array;
  private integral: Uint32Array;

  constructor(
    height: number,
    width: number,
    maskData: Uint8Array | null = null
  ) {
    this.height = height;
    this.width = width;
    const size = width * height;
    this.data = new Uint8Array(size);
    if (maskData && maskData.length === size) {
      for (let i = 0; i < size; i++) {
        this.data[i] = maskData[i] ? 255 : 0;
      }
    }
    this.integral = new Uint32Array(size);
    this.rebuildIntegral();
  }

  private rebuildIntegral(): void {
    const { width, height, data, integral } = this;
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        rowSum += data[idx];
        const above = y > 0 ? integral[(y - 1) * width + x] : 0;
        integral[idx] = rowSum + above;
      }
    }
  }

  samplePosition(
    sizeX: number,
    sizeY: number,
    rng: RNG
  ): [number, number] | null {
    const { width, height, integral } = this;
    if (sizeX > height || sizeY > width) return null;
    let hits = 0;
    for (let i = 0; i < height - sizeX; i++) {
      for (let j = 0; j < width - sizeY; j++) {
        const area =
          integral[i * width + j] +
          integral[(i + sizeX) * width + (j + sizeY)] -
          integral[(i + sizeX) * width + j] -
          integral[i * width + (j + sizeY)];
        if (area === 0) hits += 1;
      }
    }
    if (!hits) return null;
    const goal = rng.randint(0, hits);
    hits = 0;
    for (let i = 0; i < height - sizeX; i++) {
      for (let j = 0; j < width - sizeY; j++) {
        const area =
          integral[i * width + j] +
          integral[(i + sizeX) * width + (j + sizeY)] -
          integral[(i + sizeX) * width + j] -
          integral[i * width + (j + sizeY)];
        if (area === 0) {
          hits += 1;
          if (hits === goal) {
            return [i, j];
          }
        }
      }
    }
    return null;
  }

  occupyPixels(
    y: number,
    x: number,
    imageData: Uint8ClampedArray,
    bmpW: number,
    bmpH: number
  ): void {
    const { width, height, data } = this;
    for (let py = 0; py < bmpH; py++) {
      const gy = y + py;
      if (gy < 0 || gy >= height) continue;
      for (let px = 0; px < bmpW; px++) {
        const gx = x + px;
        if (gx < 0 || gx >= width) continue;
        const alpha = imageData[(py * bmpW + px) * 4 + 3];
        if (alpha > 0) {
          data[gy * width + gx] = 255;
        }
      }
    }
    this.rebuildIntegral();
  }
}

function isMaskData(mask: unknown): mask is MaskData {
  return (
    typeof mask === "object" &&
    mask !== null &&
    "data" in (mask as MaskData) &&
    "width" in (mask as MaskData) &&
    "height" in (mask as MaskData)
  );
}

export class WordCloud {
  width: number;
  height: number;
  margin: number;
  preferHorizontal: number;
  mask: MaskBuffer | MaskData | null;
  scale: number;
  maxWords: number;
  minFontSize: number;
  fontStep: number;
  random: RNG;
  backgroundColor: string | null;
  maxFontSize: number | null | undefined;
  regexp: RegExp | null;
  collocations: boolean;
  normalizePlurals: boolean;
  repeat: boolean;
  relativeScaling: number;
  includeNumbers: boolean;
  minWordLength: number;
  collocationThreshold: number;
  fillGaps: boolean;
  fontFamily: string;
  fontPath: string;
  stopwords: Iterable<string>;
  colormap: string;
  colorFunc: ColorFunction;
  words?: Map<string, number>;
  layout?: LayoutItem[];
  dimensions?: { width: number; height: number };

  constructor(options: WordCloudOptions = {}) {
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
    this.backgroundColor =
      options.backgroundColor === undefined
        ? DEFAULT_BACKGROUND
        : options.backgroundColor;
    this.maxFontSize = options.maxFontSize ?? null;
    this.regexp = options.regexp
      ? options.regexp instanceof RegExp
        ? options.regexp
        : new RegExp(options.regexp)
      : null;
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
    this.colormap = options.colormap || "viridis";

    if (this.relativeScaling < 0 || this.relativeScaling > 1) {
      throw new Error(
        `relativeScaling must be between 0 and 1, got ${this.relativeScaling}`
      );
    }

    const chosenColorFunc =
      options.colorFunc ||
      new ColormapColorFunc(
        this.colormap || (options.colorFunc ? "viridis" : "viridis")
      );
    this.colorFunc =
      typeof chosenColorFunc === "function"
        ? chosenColorFunc
        : (...args) => chosenColorFunc.__call__(...args);

    ensureFont(this.fontPath, this.fontFamily);
  }

  private normalizeMask(
    mask: MaskBuffer | MaskData | null
  ): NormalizedMask | null {
    if (!mask) return null;
    if (isMaskData(mask)) {
      const arr = new Uint8Array(mask.width * mask.height);
      for (let i = 0; i < mask.height; i++) {
        for (let j = 0; j < mask.width; j++) {
          const idx = (i * mask.width + j) * 4;
          const r = (mask.data as Uint8Array | Uint8ClampedArray)[idx];
          const g = (mask.data as Uint8Array | Uint8ClampedArray)[idx + 1];
          const b = (mask.data as Uint8Array | Uint8ClampedArray)[idx + 2];
          arr[i * mask.width + j] =
            r === 255 && g === 255 && b === 255 ? 255 : 0;
        }
      }
      return { data: arr, width: mask.width, height: mask.height };
    }
    if (
      Array.isArray(mask) ||
      mask instanceof Uint8Array ||
      mask instanceof Uint8ClampedArray
    ) {
      const length = (mask as MaskBuffer).length;
      if (length !== this.width * this.height) {
        throw new Error(
          `Mask length ${length} does not match expected ${
            this.width * this.height
          }`
        );
      }
      const arr = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        arr[i] = (mask as MaskBuffer)[i] ? 255 : 0;
      }
      return { data: arr, width: this.width, height: this.height };
    }
    throw new Error("Unsupported mask format");
  }

  processText(text: string): Map<string, number> {
    const basePattern = this.minWordLength <= 1 ? /\w[\w']*/g : /\w[\w']+/g;
    let regex: RegExp = basePattern;
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
    let counts: Map<string, number>;
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

  private measure(
    ctx: SKRSContext2D,
    word: string,
    fontSize: number
  ): { width: number; height: number; ascent: number } {
    ctx.font = `${fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText(word);

    const buffer = 2;

    const width = Math.ceil(metrics.width + buffer);
    // const height = Math.ceil(
    //   metrics.actualBoundingBoxAscent +
    //     metrics.actualBoundingBoxDescent +
    //     buffer
    // );
    const hasDescender = /[gjpqy]/.test(word);
    const descent = hasDescender ? metrics.actualBoundingBoxDescent : 2; // 2px an toàn cho dấu nặng
    
    const height = Math.floor(metrics.actualBoundingBoxAscent + descent);

    return {
      width,
      height,
      ascent: metrics.actualBoundingBoxAscent,
    };
  }

  generateFromFrequencies(
    frequencies: ReadonlyMap<string, number> | Record<string, number>,
    maxFontSize?: number | null,
    bootstrap = false
  ): this {
    let freqEntries: Array<[string, number]>;
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
    const normalized = freqEntries.map(
      ([w, f]) => [w, f / maxFrequency] as [string, number]
    );

    const mask = this.normalizeMask(this.mask || null);
    const width = mask ? mask.width : this.width;
    const height = mask ? mask.height : this.height;

    // Pixel-level occupancy + integral image
    const occupancy = new IntegralOccupancyMap(
      height,
      width,
      mask ? mask.data : null
    );

    const measureCanvas = createCanvas(width, height);
    const measureCtx = measureCanvas.getContext("2d");

    const layoutItems: LayoutItem[] = [];
    const rs = this.relativeScaling;
    let lastFreq = 1;
    let fontSize: number;

    const entries =
      this.repeat && normalized.length < this.maxWords
        ? this.padFrequencies(normalized)
        : normalized;

    if (maxFontSize !== undefined && maxFontSize !== null) {
      fontSize = maxFontSize;
    } else if (this.maxFontSize !== null && this.maxFontSize !== undefined) {
      fontSize = this.maxFontSize;
    } else if (entries.length === 1) {
      fontSize = height;
    } else if (entries.length > 1) {
      // Mirror Python heuristic: run a bootstrap on the first two words.
      if (!bootstrap) {
        this.generateFromFrequencies(
          new Map(entries.slice(0, 2)),
          height,
          true
        );
        const sizes = (this.layout || []).map((item) => item.fontSize);
        if (sizes.length >= 2) {
          fontSize = Math.floor(
            (2 * sizes[0] * sizes[1]) / (sizes[0] + sizes[1])
          );
        } else if (sizes.length === 1) {
          fontSize = sizes[0];
        } else {
          throw new Error(
            "Couldn't find space to draw. Canvas too small or masked out."
          );
        }
      } else {
        fontSize = height;
      }
    } else {
      fontSize = height;
    }
    this.words = new Map(normalized);

    for (const [word, freq] of entries) {
      if (freq === 0) continue;

      if (rs !== 0) {
        fontSize = Math.round((rs * (freq / lastFreq) + (1 - rs)) * fontSize);
      }

      let orientation: Orientation = "horizontal";
      if (this.random.next() < this.preferHorizontal) {
        orientation = "horizontal";
      } else {
        orientation = "vertical";
      }

      let triedOther = false;
      let result: { x: number; y: number } | null = null;
      let box: { width: number; height: number; ascent: number } | null = null;
      let searchW: number;
      let searchH: number;

      while (true) {
        if (fontSize < this.minFontSize) break;
        const measured = this.measure(measureCtx, word, fontSize);

        if (orientation === "horizontal") {
          searchW = measured.width + this.margin;
          searchH = measured.height + this.margin;
        } else {
          // when rotated 90°, width/height are swapped
          searchW = measured.height + this.margin;
          searchH = measured.width + this.margin;
        }

        const pos = occupancy.samplePosition(searchH, searchW, this.random);

        if (pos) {
          const [y, x] = pos;
          result = { x, y };
          box = measured;
          break;
        }

        if (!triedOther && this.preferHorizontal < 1) {
          orientation =
            orientation === "horizontal" ? "vertical" : "horizontal";
          triedOther = true;
        } else {
          fontSize -= this.fontStep;
          orientation = "horizontal";
          triedOther = false;
        }
      }

      if (fontSize < this.minFontSize || !result || !box) {
        break;
      }

      const drawX = result.x + Math.floor(this.margin / 2);
      const drawY = result.y + Math.floor(this.margin / 2);

      let tmpW: number;
      let tmpH: number;
      if (orientation === 'horizontal') {
        tmpW = box.width;
        tmpH = box.height;
      } else {
        tmpW = box.height;
        tmpH = box.width;
      }

      const tmpCanvas = createCanvas(tmpW, tmpH);
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.font = `${fontSize}px ${this.fontFamily}`;
      
      // THAY ĐỔI 3: Thiết lập baseline chuẩn
      tmpCtx.textBaseline = 'alphabetic';
      tmpCtx.fillStyle = '#000';

      if (orientation === 'horizontal') {
        // Vẽ tại y = box.ascent (đẩy chữ xuống để đỉnh chữ chạm mép trên canvas)
        tmpCtx.fillText(word, 0, box.ascent);
      } else {
        tmpCtx.save();
        tmpCtx.translate(0, box.width);
        tmpCtx.rotate(-Math.PI / 2);
        // Tương tự, vẽ tại ascent sau khi xoay
        tmpCtx.fillText(word, 0, box.ascent);
        tmpCtx.restore();
      }

      const imgData = tmpCtx.getImageData(0, 0, tmpW, tmpH);

      occupancy.occupyPixels(
        drawY,
        drawX,
        imgData.data,
        tmpW,
        tmpH
      );

      layoutItems.push({
        word,
        freq,
        fontSize,
        x: drawX,
        y: drawY,
        w: box.width,
        h: box.height,
        ascent: box.ascent, // <--- THAY ĐỔI 4: Lưu ascent vào layout
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

  private padFrequencies(
    frequencies: Array<[string, number]>
  ): Array<[string, number]> {
    if (!this.repeat || frequencies.length === 0) return frequencies;

    let padded = [...frequencies];
    const timesExtend = Math.ceil(this.maxWords / frequencies.length) - 1;
    const downweight = frequencies[frequencies.length - 1][1];
    const original = [...frequencies];
    for (let i = 0; i < timesExtend; i++) {
      padded = padded.concat(
        original.map(
          ([w, f]) => [w, f * downweight ** (i + 1)] as [string, number]
        )
      );
    }
    return padded.slice(0, this.maxWords);
  }

  generateFromText(text: string): this {
    const counts = this.processText(text);
    return this.generateFromFrequencies(counts);
  }

  generate(text: string): this {
    return this.generateFromText(text);
  }

  toCanvas(canvas?: Canvas): Canvas {
    if (!this.layout) {
      throw new Error("Call generate() first");
    }
    const width = (this.dimensions?.width || this.width) * this.scale;
    const height = (this.dimensions?.height || this.height) * this.scale;
    const target = canvas || createCanvas(width, height);
    const ctx = target.getContext("2d");

    ctx.scale(this.scale, this.scale);

    // THAY ĐỔI 5: Dùng alphabetic cho render cuối cùng
    ctx.textBaseline = "alphabetic";
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
        // THAY ĐỔI 6: Cộng thêm item.ascent vào toạ độ Y
        ctx.fillText(item.word, item.x, item.y + item.ascent);
      } else {
        ctx.translate(item.x, item.y + item.w);
        ctx.rotate(-Math.PI / 2);
        // THAY ĐỔI 7: Vẽ tại vị trí ascent trục đã xoay
        ctx.fillText(item.word, 0, item.ascent);
      }

      ctx.restore();
    }
    return target;
  }

  toBuffer(format: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif' = 'image/png'): Buffer {
    const canvas = this.toCanvas();
    // Canvas typings are overloaded; cast keeps the API surface aligned with @napi-rs/canvas.
    return canvas.toBuffer(format as any);
  }
}

export { ColormapColorFunc };
