export interface ProcessedTokens {
    counts: Map<string, number>;
    standardForms: Map<string, string>;
}
export declare function processTokens(words: string[], normalizePlurals?: boolean): ProcessedTokens;
export declare function unigramsAndBigrams(words: string[], stopwords: Iterable<string>, normalizePlurals?: boolean, collocationThreshold?: number): Map<string, number>;
