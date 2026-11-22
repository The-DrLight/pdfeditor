// Real font files for common typefaces (open-licensed, metric-compatible where possible).
//
// - Arimo / Tinos / Cousine have the same letter widths as Arial / Times New Roman / Courier New,
//   Carlito matches Calibri, Caladea matches Cambria, Gelasio matches Georgia.
// - Files are bundled as assets but only downloaded when a document actually uses the font.
import { emit } from './state.js';

const FILES = import.meta.glob(
  '/node_modules/@fontsource/{arimo,tinos,cousine,carlito,caladea,gelasio,eb-garamond,open-sans,roboto,lato,montserrat,source-sans-3,noto-sans,noto-serif}/files/*-{latin,latin-ext,vietnamese}-{400,700}-{normal,italic}.woff',
  { query: '?url', import: 'default', eager: true }
);

export const SUBSETS = ['latin', 'latin-ext', 'vietnamese'];
const RANGES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  vietnamese: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB',
};

// generic = which built-in PDF font family to fall back to if the file can't be loaded
export const CATALOG = {
  arimo: { label: 'Arial / Helvetica (Arimo)', generic: 'sans' },
  tinos: { label: 'Times New Roman (Tinos)', generic: 'serif' },
  cousine: { label: 'Courier New (Cousine)', generic: 'mono' },
  carlito: { label: 'Calibri (Carlito)', generic: 'sans' },
  caladea: { label: 'Cambria (Caladea)', generic: 'serif' },
  gelasio: { label: 'Georgia (Gelasio)', generic: 'serif' },
  'eb-garamond': { label: 'Garamond (EB Garamond)', generic: 'serif' },
  'open-sans': { label: 'Open Sans', generic: 'sans' },
  roboto: { label: 'Roboto', generic: 'sans' },
  lato: { label: 'Lato', generic: 'sans' },
  montserrat: { label: 'Montserrat', generic: 'sans' },
  'source-sans-3': { label: 'Source Sans 3', generic: 'sans' },
  'noto-sans': { label: 'Noto Sans', generic: 'sans' },
  'noto-serif': { label: 'Noto Serif', generic: 'serif' },
};
export const BUILTIN = {
  sans: { label: 'Helvetica (built-in)', css: 'Helvetica, Arial, sans-serif' },
  serif: { label: 'Times (built-in)', css: '"Times New Roman", Times, serif' },
  mono: { label: 'Courier (built-in)', css: '"Courier New", Courier, monospace' },
};
const GENERIC_CSS = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' };

export const isCatalog = (k) => k in CATALOG;
export const genericOf = (k) => (isCatalog(k) ? CATALOG[k].generic : k in BUILTIN ? k : 'sans');
export const fontLabel = (k) => CATALOG[k]?.label || BUILTIN[k]?.label || k;
const famName = (k) => `PE ${k}`;

export function fontCss(key) {
  if (isCatalog(key)) return `"${famName(key)}", ${GENERIC_CSS[CATALOG[key].generic]}`;
  return (BUILTIN[key] || BUILTIN.sans).css;
}

// PDF font name (e.g. "Calibri-Bold", "TimesNewRomanPS-BoldMT") -> catalog key
const RULES = [
  [/courier|cousine|liberation ?mono|nimbus ?mono|lucida ?console|consolas|menlo|monaco|typewriter|mono/, 'cousine'],
  [/calibri|carlito/, 'carlito'],
  [/cambria|caladea/, 'caladea'],
  [/georgia|gelasio/, 'gelasio'],
  [/garamond/, 'eb-garamond'],
  [/open ?sans/, 'open-sans'],
  [/roboto/, 'roboto'],
  [/lato/, 'lato'],
  [/montserrat/, 'montserrat'],
  [/source ?sans/, 'source-sans-3'],
  [/noto ?serif/, 'noto-serif'],
  [/noto ?sans/, 'noto-sans'],
  [/segoe|verdana|tahoma|trebuchet|frutiger|myriad|gill ?sans|candara|corbel/, 'open-sans'],
  [/times|tinos|liberation ?serif|nimbus ?rom|palatino|book ?antiqua|minion|baskerville|bodoni|century|didot|constantia/, 'tinos'],
  [/arial|helvetica|arimo|liberation ?sans|nimbus ?sans|swiss/, 'arimo'],
];
const GENERIC_DEFAULT = { sans: 'arimo', serif: 'tinos', mono: 'cousine' };

export function matchFont(fontName, family = 'sans') {
  const n = (fontName || '').toLowerCase();
  for (const [re, key] of RULES) if (re.test(n)) return key;
  if (/serif/.test(n) && !/sans/.test(n)) return 'tinos';
  return GENERIC_DEFAULT[family] || 'arimo';
}

// Files for one variant. Falls back from italic to upright when a font has no italic.
export function variantFiles(key, bold, italic) {
  const w = bold ? 700 : 400;
  const pick = (style) =>
    SUBSETS.map((s) => ({ subset: s, url: FILES[`/node_modules/@fontsource/${key}/files/${key}-${s}-${w}-${style}.woff`] })).filter((f) => f.url);
  let r = italic ? pick('italic') : [];
  if (!r.length) r = pick('normal');
  return r;
}

export const allFontUrls = () => Object.values(FILES);

const bytesCache = new Map();
export function fontBytes(url) {
  if (!bytesCache.has(url)) {
    bytesCache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`font ${r.status}`);
        return r.arrayBuffer();
      }).catch((e) => { bytesCache.delete(url); throw e; })
    );
  }
  return bytesCache.get(url);
}

// Make a variant available to the page so text in the editor renders with it.
const state = new Map();
export function ensureFont(key, bold, italic) {
  if (!isCatalog(key)) return;
  const id = `${key}|${+!!bold}|${+!!italic}`;
  if (state.has(id)) return;
  state.set(id, 'loading');
  Promise.all(
    variantFiles(key, !!bold, !!italic).map(async (f) => {
      const bytes = await fontBytes(f.url);
      const face = new FontFace(famName(key), bytes.slice(0), {
        weight: bold ? '700' : '400',
        style: italic ? 'italic' : 'normal',
        unicodeRange: RANGES[f.subset],
      });
      await face.load();
      document.fonts.add(face);
    })
  )
    .then(() => {
      state.set(id, 'done');
      emit('fonts');
    })
    .catch((e) => {
      state.set(id, 'failed');
      console.warn('Could not load font', key, e);
    });
}
