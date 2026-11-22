import {
  PDFDocument, PDFName, PDFDict, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState,
  concatTransformationMatrix, BlendMode, LineCapStyle,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjsLib from 'pdfjs-dist';
import { state } from './state.js';
import { getPageProxy, getWidgets } from './pdfload.js';
import { hexToRgb01, arrowHead, widgetFontSize } from './util.js';

// Unicode fallback (Latin, Latin Extended, Vietnamese: covers Yoruba, Igbo, Hausa, etc.)
import latin4 from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url';
import latin7 from '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff?url';
import ext4 from '@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff?url';
import ext7 from '@fontsource/noto-sans/files/noto-sans-latin-ext-700-normal.woff?url';
import vi4 from '@fontsource/noto-sans/files/noto-sans-vietnamese-400-normal.woff?url';
import vi7 from '@fontsource/noto-sans/files/noto-sans-vietnamese-700-normal.woff?url';

const UNI = { 400: [latin4, ext4, vi4], 700: [latin7, ext7, vi7] };
const col = (hex) => rgb(...hexToRgb01(hex));

export const needsFlatten = (p) =>
  p.src >= 0 && (state.sources[p.src]?.encrypted || p.items.some((i) => i.type === 'redact'));

function stdName(it) {
  const b = it.bold, i = it.italic;
  if (it.font === 'serif') return b && i ? 'TimesRomanBoldItalic' : b ? 'TimesRomanBold' : i ? 'TimesRomanItalic' : 'TimesRoman';
  if (it.font === 'mono') return b && i ? 'CourierBoldOblique' : b ? 'CourierBold' : i ? 'CourierOblique' : 'Courier';
  return b && i ? 'HelveticaBoldOblique' : b ? 'HelveticaBold' : i ? 'HelveticaOblique' : 'Helvetica';
}

function matrixFor(rot, uw, uh, ox, oy) {
  switch (rot) {
    case 90: return [0, 1, -1, 0, ox + uw, oy];
    case 180: return [-1, 0, 0, -1, ox + uw, oy + uh];
    case 270: return [0, -1, 1, 0, ox, oy + uh];
    default: return [1, 0, 0, 1, ox, oy];
  }
}

async function dataUrlBytes(url) {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

class Ctx {
  constructor(out) {
    this.out = out;
    this.std = {};
    this.uni = {};
    this.charsets = new Map();
    this.imgs = new Map();
    this.srcDocs = new Map();
  }
  async stdFont(name) {
    return (this.std[name] ||= await this.out.embedFont(StandardFonts[name]));
  }
  async uniFonts(weight) {
    if (!this.uni[weight]) {
      this.uni[weight] = [];
      for (const u of UNI[weight]) {
        const f = await this.out.embedFont(await dataUrlBytes(u), { subset: true });
        this.charsets.set(f, new Set(f.getCharacterSet()));
        this.uni[weight].push(f);
      }
    }
    return this.uni[weight];
  }
  async image(id) {
    if (!this.imgs.has(id)) {
      const a = state.images.get(id);
      const bytes = await dataUrlBytes(a.dataUrl);
      const img = a.dataUrl.startsWith('data:image/png') ? await this.out.embedPng(bytes) : await this.out.embedJpg(bytes);
      this.imgs.set(id, img);
    }
    return this.imgs.get(id);
  }
  async srcDoc(i) {
    if (!this.srcDocs.has(i)) {
      this.srcDocs.set(i, await PDFDocument.load(state.sources[i].bytes, { ignoreEncryption: true }));
    }
    return this.srcDocs.get(i);
  }
}

const canEncode = (font, s) => {
  try { font.encodeText(s); return true; } catch { return false; }
};

// Draw a text item (possibly multi-line, rotated, with unicode fallback). Coordinates are
// in the transformed "display" space: origin top-left of the base-oriented page, y down.
async function drawText(cx, page, H, it) {
  const lines = (it.text || '').split('\n');
  const size = it.size;
  const theta = ((it.angle || 0) * Math.PI) / 180;
  const c = Math.cos(theta), sn = Math.sin(theta);
  const std = await cx.stdFont(stdName(it));
  const color = col(it.color || '#000000');
  const opacity = it.opacity ?? 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const off = 0.95 * size + i * 1.2 * size;
    // baseline-left point in display coords (y down), then to PDF coords (y up)
    const bx = it.x + off * sn;
    const by = it.y + off * c;
    let px = bx, py = H - by;
    if (canEncode(std, line)) {
      page.drawText(line, { x: px, y: py, size, font: std, color, opacity, rotate: degrees(it.angle || 0) });
      continue;
    }
    const fonts = await cx.uniFonts(it.bold ? 700 : 400);
    let seg = '', segFont = null;
    const flush = () => {
      if (!seg) return;
      page.drawText(seg, { x: px, y: py, size, font: segFont, color, opacity, rotate: degrees(it.angle || 0) });
      const w = segFont.widthOfTextAtSize(seg, size);
      px += w * c;
      py += w * sn;
      seg = '';
    };
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      const f = fonts.find((ff) => cx.charsets.get(ff).has(cp)) || fonts[0];
      const chOk = cx.charsets.get(f).has(cp) ? ch : '?';
      if (f !== segFont) { flush(); segFont = f; }
      seg += chOk;
    }
    flush();
  }
}

async function drawItem(cx, page, H, it) {
  const o = it.opacity ?? 1;
  switch (it.type) {
    case 'text':
      return drawText(cx, page, H, it);
    case 'image': {
      const img = await cx.image(it.imageId);
      return page.drawImage(img, { x: it.x, y: H - it.y - it.h, width: it.w, height: it.h, opacity: o });
    }
    case 'rect':
      return page.drawRectangle({
        x: it.x, y: H - it.y - it.h, width: it.w, height: it.h,
        color: it.fill ? col(it.fill) : undefined,
        borderColor: it.stroke && it.sw ? col(it.stroke) : undefined,
        borderWidth: it.stroke ? it.sw : 0, opacity: o, borderOpacity: o,
      });
    case 'highlight':
      return page.drawRectangle({
        x: it.x, y: H - it.y - it.h, width: it.w, height: it.h,
        color: col(it.fill), opacity: 0.45, blendMode: BlendMode.Multiply,
      });
    case 'ellipse':
      return page.drawEllipse({
        x: it.x + it.w / 2, y: H - it.y - it.h / 2, xScale: it.w / 2, yScale: it.h / 2,
        color: it.fill ? col(it.fill) : undefined,
        borderColor: it.stroke ? col(it.stroke) : undefined,
        borderWidth: it.stroke ? it.sw : 0, opacity: o, borderOpacity: o,
      });
    case 'pen': case 'line': case 'arrow': {
      const pts = it.pts;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
      page.drawSvgPath(d, {
        x: 0, y: H, borderColor: col(it.stroke), borderWidth: it.sw,
        borderLineCap: LineCapStyle.Round, borderOpacity: o,
      });
      if (it.type === 'arrow' && pts.length >= 2) {
        const [t, l, r] = arrowHead(pts[0], pts[pts.length - 1], it.sw);
        page.drawSvgPath(`M ${t[0]} ${t[1]} L ${l[0]} ${l[1]} L ${r[0]} ${r[1]} Z`, {
          x: 0, y: H, color: col(it.stroke), opacity: o,
        });
      }
      return;
    }
    default:
  }
}

async function drawWidgetValues(cx, page, H, p) {
  const widgets = await getWidgets(p);
  for (const w of widgets) {
    const val = w.key in state.fields ? state.fields[w.key] : w.initial;
    if (w.kind === 'text' || w.kind === 'choice') {
      let txt = String(val ?? '');
      if (w.kind === 'choice') txt = w.options.find((o) => o.value === val)?.label ?? txt;
      if (!txt) continue;
      const size = widgetFontSize(w);
      const font = await cx.stdFont('Helvetica');
      let lines = txt.split('\n');
      if (w.multiline) {
        const wrapped = [];
        for (const ln of lines) {
          let cur = '';
          for (const word of ln.split(' ')) {
            const t = cur ? cur + ' ' + word : word;
            let width = size * t.length * 0.5;
            try { width = font.widthOfTextAtSize(t, size); } catch { /* keep estimate */ }
            if (width > w.w - 4 && cur) { wrapped.push(cur); cur = word; } else cur = t;
          }
          wrapped.push(cur);
        }
        lines = wrapped;
      }
      const textH = lines.length * size * 1.2;
      const top = w.multiline ? w.y + 2 : w.y + (w.h - textH) / 2;
      await drawText(cx, page, H, { type: 'text', text: lines.join('\n'), x: w.x + 2, y: top, size, color: '#000000', font: 'sans' });
    } else if ((w.kind === 'check' && val) || (w.kind === 'radio' && val === w.buttonValue)) {
      const u = Math.min(w.w, w.h);
      const x0 = w.x + (w.w - u) / 2, y0 = w.y + (w.h - u) / 2;
      if (w.kind === 'check') {
        const pts = [[0.2, 0.55], [0.42, 0.78], [0.8, 0.25]].map(([a, b]) => [x0 + a * u, H - (y0 + b * u)]);
        for (let i = 0; i < 2; i++) {
          page.drawLine({ start: { x: pts[i][0], y: pts[i][1] }, end: { x: pts[i + 1][0], y: pts[i + 1][1] }, thickness: Math.max(1, u * 0.12), color: rgb(0, 0, 0), lineCap: LineCapStyle.Round });
        }
      } else {
        page.drawEllipse({ x: x0 + u / 2, y: H - (y0 + u / 2), xScale: u * 0.25, yScale: u * 0.25, color: rgb(0, 0, 0) });
      }
    }
  }
}

function stripWidgets(page) {
  const annots = page.node.Annots();
  if (!annots) return;
  for (let i = annots.size() - 1; i >= 0; i--) {
    const a = annots.lookup(i);
    if (a instanceof PDFDict && String(a.get(PDFName.of('Subtype'))) === '/Widget') annots.remove(i);
  }
}

async function rasterize(p) {
  const pg = await getPageProxy(p);
  const k = 2.5;
  const vp = pg.getViewport({ scale: k, rotation: p.base });
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(vp.width);
  cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d');
  await pg.render({ canvasContext: ctx, viewport: vp, background: '#ffffff', annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
  ctx.fillStyle = '#000';
  for (const it of p.items) if (it.type === 'redact') ctx.fillRect(it.x * k, it.y * k, it.w * k, it.h * k);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Build the output PDF.
 * @param {number[]} [indices] page indices to include (default: all)
 */
export async function exportPdf(indices, onProgress) {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const cx = new Ctx(out);
  const list = (indices || state.pages.map((_, i) => i)).map((i) => state.pages[i]).filter(Boolean);
  let n = 0;
  for (const p of list) {
    onProgress?.(++n, list.length);
    let page, uw, uh, ox = 0, oy = 0;
    let finalRot = (p.base + p.rot) % 360;
    let drawRot = p.base; // orientation of base space relative to the unrotated page
    let widgetsFlatten = false;
    if (p.src < 0) {
      page = out.addPage([p.bw, p.bh]);
      uw = p.bw; uh = p.bh;
      drawRot = 0; finalRot = p.rot % 360;
    } else if (needsFlatten(p)) {
      const jpg = await rasterize(p);
      const img = await out.embedJpg(jpg);
      page = out.addPage([p.bw, p.bh]);
      page.drawImage(img, { x: 0, y: 0, width: p.bw, height: p.bh });
      uw = p.bw; uh = p.bh;
      drawRot = 0; finalRot = p.rot % 360;
      widgetsFlatten = true;
    } else {
      const sd = await cx.srcDoc(p.src);
      const [cp] = await out.copyPages(sd, [p.idx]);
      let cb;
      try { cb = cp.getCropBox(); } catch { cb = cp.getMediaBox(); }
      cp.setMediaBox(cb.x, cb.y, cb.width, cb.height);
      cp.setCropBox(cb.x, cb.y, cb.width, cb.height);
      page = out.addPage(cp);
      uw = cb.width; uh = cb.height; ox = cb.x; oy = cb.y;
      widgetsFlatten = Object.keys(state.fields).some((k) => k.startsWith(p.src + '|'));
    }
    page.setRotation(degrees(finalRot));
    const H = p.bh; // base-space height
    const items = p.items.filter((i) => i.type !== 'redact');
    const hasWidgets = p.src >= 0 && widgetsFlatten;
    if (items.length || hasWidgets) {
      const M = matrixFor(drawRot, uw, uh, ox, oy);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...M));
      if (hasWidgets) await drawWidgetValues(cx, page, H, p);
      for (const it of items) await drawItem(cx, page, H, it);
      page.pushOperators(popGraphicsState());
    }
    if (hasWidgets && !needsFlatten(p)) stripWidgets(page);
  }
  out.setProducer('PDF Editor');
  out.setTitle(state.name.replace(/\.pdf$/i, ''));
  return out.save();
}

