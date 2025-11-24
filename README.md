# wordcloud-js

JavaScript port of the Python `wordcloud` layout algorithm. It mirrors the core placement heuristics (integral-image sampler, font-size bootstrap, repeat downweighting, defaults) so outputs closely match the reference library.

## Installation

```bash
npm install
```

The project depends on `@napi-rs/canvas`, which bundles native binaries. No extra system-level installs are required on most platforms.

## Basic usage

```js
const { WordCloud } = require("./src/wordcloud");
const fs = require("fs");

const wc = new WordCloud({
  width: 400,
  height: 200,
  // options align with the Python API: mask, preferHorizontal, relativeScaling, repeat, etc.
});

wc.generate("hello world hello coders");
const buffer = wc.toBuffer("image/png");
fs.writeFileSync("cloud.png", buffer);
```

See `examples/generate.js` for a runnable example that writes `examples/output.png`.

## Options (parity with Python)

- `width`, `height`, `margin`, `scale`
- `fontPath`, `fontFamily`
- `backgroundColor` (default `"black"`)
- `maxWords`, `maxFontSize`, `minFontSize`, `fontStep`
- `preferHorizontal` (0–1), `relativeScaling` (0–1, default 0.5 or 0 if `repeat` is true)
- `mask` (Uint8Array of 0/255 or `{ data, width, height }` RGBA), `contourWidth/contourColor` are not implemented
- `colorFunc` or `colormap` (`"viridis"` default, `"hsv"` available)
- `stopwords`, `regexp`, `collocations`, `normalizePlurals`, `repeat`, `includeNumbers`, `minWordLength`, `collocationThreshold`
- `randomSeed` for deterministic layouts

## Notes on fidelity

- Placement uses an integral image like `query_integral_image` in the Python version; masks treat white pixels as blocked.
- The initial font size is derived using the two-word bootstrap heuristic from the reference implementation.
- Repeat padding follows the reference downweighting (`min_freq ** (i+1)`).
- Defaults (black background, viridis colormap) match the Python library.

## Development

- `npm run example` – generate `examples/output.png` with the sample text.

