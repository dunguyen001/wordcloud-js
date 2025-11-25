import { Canvas } from "@napi-rs/canvas";
import RNG from "./random";
type MaskBuffer = Uint8Array | Uint8ClampedArray | number[];
interface MaskData {
    data: MaskBuffer;
    width: number;
    height: number;
}
export type Orientation = "horizontal" | "vertical";
export interface Position {
    x: number;
    y: number;
}
export type ColorFunction = (word: string, fontSize: number, position: Position, orientation: Orientation, random: RNG, meta?: {
    fontFamily?: string;
}) => string;
export interface LayoutItem {
    word: string;
    freq: number;
    fontSize: number;
    x: number;
    y: number;
    w: number;
    h: number;
    ascent: number;
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
    fillGaps?: boolean;
    fontFamily?: string;
    fontPath?: string;
    stopwords?: Iterable<string>;
    colormap?: string;
    colorFunc?: ColorFunction | ColormapColorFunc;
}
export declare function defaultColorFunc(_word: string, _fontSize: number, _position: Position, _orientation: Orientation, random?: RNG): string;
declare class ColormapColorFunc {
    private name;
    private viridisStops;
    constructor(colormap?: string);
    private interpColor;
    call(random?: RNG): string;
    __call__(_word: string, _fontSize: number, _position: Position, _orientation: Orientation, random?: RNG, _meta?: {
        fontFamily?: string;
    }): string;
}
export declare class WordCloud {
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
    dimensions?: {
        width: number;
        height: number;
    };
    constructor(options?: WordCloudOptions);
    private normalizeMask;
    processText(text: string): Map<string, number>;
    private measure;
    generateFromFrequencies(frequencies: ReadonlyMap<string, number> | Record<string, number>, maxFontSize?: number | null, bootstrap?: boolean): this;
    private padFrequencies;
    generateFromText(text: string): this;
    generate(text: string): this;
    toCanvas(canvas?: Canvas): Canvas;
    toBuffer(format?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif'): Buffer;
}
export { ColormapColorFunc };
