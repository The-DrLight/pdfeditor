import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { state, uid, checkpoint, resetHistory, emit } from './state.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

async function openDoc(bytes) {
  const task = pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
  let encrypted = false;
  task.onPassword = (update, reason) => {
    encrypted = true;
    const pw = window.prompt(
      reason === 2 ? 'Wrong password. Try again:' : 'This PDF is password protected. Enter the password:'
    );
    if (pw == null) task.destroy();
    else update(pw);
  };
  const doc = await task.promise;
  return { doc, encrypted };
}

export async function openPdf(file, { append = false } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { doc, encrypted } = await openDoc(bytes);

  if (!append) {
    state.sources.forEach((s) => s.doc.destroy());
    state.sources = [];
    state.pages = [];
    state.fields = {};
    state.sel = null;
    state.editing = null;
    state.name = file.name;
    resetHistory();
  } else {
    checkpoint();
  }

  const src = state.sources.push({ name: file.name, bytes, doc, encrypted, runCache: new Map() }) - 1;
  const added = [];
  for (let i = 0; i < doc.numPages; i++) {
    const pg = await doc.getPage(i + 1);
    const vp = pg.getViewport({ scale: 1, rotation: pg.rotate });
    added.push({
      id: uid('p'), src, idx: i, base: pg.rotate % 360, rot: 0,
      bw: vp.width, bh: vp.height, items: [],
    });
  }
  state.pages.push(...added);
  if (!append) state.cur = 0;
  emit('structure');
  return added.length;
}

export const getPageProxy = (p) => state.sources[p.src].doc.getPage(p.idx + 1);

// Text runs (words/lines as laid out by the PDF), in base space.
export async function getRuns(p) {
  const src = state.sources[p.src];
  if (!src) return [];
  if (src.runCache.has(p.idx)) return src.runCache.get(p.idx);
  const pg = await src.doc.getPage(p.idx + 1);
  const vp = pg.getViewport({ scale: 1, rotation: p.base });
  await pg.getOperatorList(); // makes pdf.js load the page's fonts so their real names/flags are available
  const tc = await pg.getTextContent();
  const out = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
    const size = Math.abs(tx[3]); // vertical scale = the font size in points
    if (!size || Math.abs(tx[1]) > 0.02 * size) continue; // rotated text: skip
    const skewed = Math.abs(tx[2]) > 0.08 * size; // synthetic italic
    const st = tc.styles[it.fontName] || {};
    let fobj = null;
    try { fobj = pg.commonObjs.get(it.fontName); } catch { /* font unavailable */ }
    const rawName = fobj?.name || '';
    const name = rawName.replace(/^[A-Z]{6}\+/, ''); // drop the subset prefix, e.g. ABCDEF+Calibri-Bold
    const lower = name.toLowerCase();
    const fallback = fobj?.fallbackName || st.fontFamily || 'sans-serif';
    const family = /courier|mono|consolas|menlo|typewriter|lucida console|source code/.test(lower) || fallback === 'monospace' ? 'mono'
      : (/times|georgia|garamond|palatino|cambria|minion|baskerville|bodoni|century|didot|book antiqua|serif/.test(lower) && !/sans/.test(lower)) || fallback === 'serif' ? 'serif'
      : 'sans';
    const bold = !!(fobj?.bold || fobj?.black) || /bold|black|heavy|semibold|demi|extrabold/.test(lower);
    const italic = !!fobj?.italic || skewed || /italic|oblique|slanted|kursiv/.test(lower);
    const asc = Number.isFinite(st.ascent) ? Math.min(1.1, Math.max(0.6, st.ascent)) : 0.88;
    const desc = Number.isFinite(st.descent) ? Math.min(0.4, Math.max(0.1, -st.descent)) : 0.22;
    out.push({
      str: it.str,
      x: tx[4],
      base: tx[5],
      size,
      w: it.width * vp.scale,
      cy: tx[5] - size * asc,
      ch: size * (asc + desc),
      font: family,
      bold,
      italic,
      fontName: name,
    });
  }
  src.runCache.set(p.idx, out);
  return out;
}

// Interactive form fields (AcroForm widgets), in base space.
export async function getWidgets(p) {
  const src = state.sources[p.src];
  if (!src) return [];
  const pg = await src.doc.getPage(p.idx + 1);
  const vp = pg.getViewport({ scale: 1, rotation: p.base });
  const anns = await pg.getAnnotations();
  const res = [];
  for (const a of anns) {
    if (a.subtype !== 'Widget' || !a.fieldName || a.pushButton) continue;
    let kind;
    if (a.fieldType === 'Tx') kind = 'text';
    else if (a.fieldType === 'Btn') kind = a.radioButton ? 'radio' : a.checkBox ? 'check' : null;
    else if (a.fieldType === 'Ch') kind = 'choice';
    if (!kind) continue;
    const r = vp.convertToViewportRectangle(a.rect);
    const x = Math.min(r[0], r[2]);
    const y = Math.min(r[1], r[3]);
    const w = Math.abs(r[2] - r[0]);
    const h = Math.abs(r[3] - r[1]);
    let initial;
    if (kind === 'check') initial = !!a.fieldValue && a.fieldValue !== 'Off';
    else if (kind === 'radio') initial = a.fieldValue || '';
    else if (kind === 'choice') initial = Array.isArray(a.fieldValue) ? a.fieldValue[0] ?? '' : a.fieldValue ?? '';
    else initial = a.fieldValue ?? '';
    res.push({
      key: `${p.src}|${a.fieldName}`,
      name: a.fieldName, kind, x, y, w, h, initial,
      multiline: !!a.multiLine,
      readOnly: !!a.readOnly,
      buttonValue: a.buttonValue,
      options: (a.options || []).map((o) => ({ value: o.exportValue, label: o.displayValue })),
      combo: !!a.combo,
      maxLen: a.maxLen || undefined,
    });
  }
  return res;
}
