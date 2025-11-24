const { log } = Math;

const tiny = 1e-10;

function l(k: number, n: number, x: number): number {
  // Dunning's likelihood ratio
  return log(Math.max(x, tiny)) * k + log(Math.max(1 - x, tiny)) * (n - k);
}

function score(countBigram: number, count1: number, count2: number, nWords: number): number {
  if (nWords <= count1 || nWords <= count2) return 0;
  const N = nWords;
  const c12 = countBigram;
  const c1 = count1;
  const c2 = count2;
  const p = c2 / N;
  const p1 = c12 / c1;
  const p2 = (c2 - c12) / (N - c1);
  return -2 * (l(c12, c1, p) + l(c2 - c12, N - c1, p) - l(c12, c1, p1) - l(c2 - c12, N - c1, p2));
}

function pairwise<T>(iterable: T[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let i = 0; i < iterable.length - 1; i++) {
    pairs.push([iterable[i], iterable[i + 1]]);
  }
  return pairs;
}

export interface ProcessedTokens {
  counts: Map<string, number>;
  standardForms: Map<string, string>;
}

export function processTokens(words: string[], normalizePlurals = true): ProcessedTokens {
  // Track capitalization counts for each lowercase token.
  const caseCounts = new Map<string, Map<string, number>>();
  for (const word of words) {
    const lower = word.toLowerCase();
    const perCase = caseCounts.get(lower) || new Map<string, number>();
    perCase.set(word, (perCase.get(word) || 0) + 1);
    caseCounts.set(lower, perCase);
  }

  const mergedPlurals = new Map<string, string>();
  if (normalizePlurals) {
    for (const key of Array.from(caseCounts.keys())) {
      if (key.endsWith('s') && !key.endsWith('ss')) {
        const singular = key.slice(0, -1);
        if (caseCounts.has(singular)) {
          const pluralDict = caseCounts.get(key)!;
          const singularDict = caseCounts.get(singular)!;
          for (const [word, count] of pluralDict.entries()) {
            const singularCase = word.slice(0, -1);
            singularDict.set(singularCase, (singularDict.get(singularCase) || 0) + count);
          }
          mergedPlurals.set(key, singular);
          caseCounts.delete(key);
        }
      }
    }
  }

  const fusedCases = new Map<string, number>();
  const standardForms = new Map<string, string>();

  for (const [lower, perCase] of caseCounts.entries()) {
    let mostCommon: string | null = null;
    let highest = -1;
    for (const [form, count] of perCase.entries()) {
      if (count > highest) {
        mostCommon = form;
        highest = count;
      }
    }
    const representative = mostCommon ?? Array.from(perCase.keys())[0];
    const total = Array.from(perCase.values()).reduce((a, b) => a + b, 0);
    fusedCases.set(representative, total);
    standardForms.set(lower, representative);
  }

  if (normalizePlurals) {
    for (const [plural, singular] of mergedPlurals.entries()) {
      const canonical = standardForms.get(singular.toLowerCase());
      if (canonical) {
        standardForms.set(plural, canonical);
      }
    }
  }

  return { counts: fusedCases, standardForms };
}

export function unigramsAndBigrams(
  words: string[],
  stopwords: Iterable<string>,
  normalizePlurals = true,
  collocationThreshold = 30
): Map<string, number> {
  const stop = new Set(Array.from(stopwords || []).map((w) => w.toLowerCase()));
  const bigrams = pairwise(words).filter((pair) => !pair.some((w) => stop.has(w.toLowerCase())));
  const unigrams = words.filter((w) => !stop.has(w.toLowerCase()));
  const nWords = unigrams.length;

  const { counts: countsUnigrams, standardForms } = processTokens(unigrams, normalizePlurals);
  const { counts: countsBigrams } = processTokens(
    bigrams.map((b) => b.join(' ')),
    normalizePlurals
  );

  const originalCounts = new Map(countsUnigrams);

  for (const [bigramString, count] of countsBigrams.entries()) {
    const [w1Raw, w2Raw] = bigramString.split(' ');
    const word1 = standardForms.get(w1Raw.toLowerCase()) || w1Raw;
    const word2 = standardForms.get(w2Raw.toLowerCase()) || w2Raw;
    const collocationScore = score(count, originalCounts.get(word1) || 0, originalCounts.get(word2) || 0, nWords);
    if (collocationScore > collocationThreshold) {
      countsUnigrams.set(word1, (countsUnigrams.get(word1) || 0) - count);
      countsUnigrams.set(word2, (countsUnigrams.get(word2) || 0) - count);
      countsUnigrams.set(bigramString, count);
    }
  }

  for (const [word, count] of Array.from(countsUnigrams.entries())) {
    if (count <= 0) {
      countsUnigrams.delete(word);
    }
  }

  return countsUnigrams;
}
