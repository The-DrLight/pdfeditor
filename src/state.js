// Central app state, tiny event bus and undo/redo history.
//
// Coordinate model: every item (text, image, shape...) lives in the page's
// "base space": the page as pdf.js shows it at its own /Rotate, origin top-left,
// unit = PDF point. The user rotation (page.rot) is applied only when
// displaying / exporting, so items follow the page when it is rotated.

export const state = {
  sources: [], // { name, bytes, doc (pdfjs), encrypted, runCache }
  pages: [], // { id, src, idx, base, rot, bw, bh, items: [] }  (src -1 = blank page)
  images: new Map(), // imageId -> { dataUrl, w, h }
  fields: {}, // `${src}|${fieldName}` -> value (only user-modified form fields)
  cur: 0,
  zoom: 1,
  tool: 'select',
  sel: null, // { pageId, itemId }
  editing: null, // item id whose text is being edited
  pending: null, // asset waiting to be placed with a click
  name: 'document.pdf',
  find: { hits: [], idx: -1 },
  style: {
    color: '#111111',
    size: 18,
    font: 'sans',
    bold: false,
    italic: false,
    stroke: '#e11d48',
    fill: '',
    sw: 2,
    hl: '#ffe600',
    opacity: 1,
  },
};

let n = 0;
export const uid = (p = 'i') => p + ++n + Math.random().toString(36).slice(2, 6);

const L = {};
export const on = (ev, fn) => (L[ev] ||= []).push(fn);
export const emit = (ev, d) => (L[ev] || []).forEach((f) => f(d));

const undoS = [];
const redoS = [];
const snap = () => JSON.stringify({ pages: state.pages, fields: state.fields });

export function checkpoint() {
  undoS.push(snap());
  if (undoS.length > 150) undoS.shift();
  redoS.length = 0;
  emit('history');
}
export function popCheckpoint() {
  undoS.pop();
  emit('history');
}
export function resetHistory() {
  undoS.length = 0;
  redoS.length = 0;
  emit('history');
}
function restore(s) {
  const o = JSON.parse(s);
  state.pages = o.pages;
  state.fields = o.fields;
  state.editing = null;
  if (state.sel && !state.pages.some((p) => p.id === state.sel.pageId)) state.sel = null;
  state.cur = Math.max(0, Math.min(state.cur, state.pages.length - 1));
  emit('structure');
  emit('select');
  emit('history');
}
export function undo() {
  if (!undoS.length) return;
  redoS.push(snap());
  restore(undoS.pop());
}
export function redo() {
  if (!redoS.length) return;
  undoS.push(snap());
  restore(redoS.pop());
}
export const canUndo = () => undoS.length > 0;
export const canRedo = () => redoS.length > 0;
export const isDirty = () => undoS.length > 0;

export const pageById = (id) => state.pages.find((p) => p.id === id);

export function registerImage(dataUrl, w, h) {
  const id = uid('img');
  state.images.set(id, { dataUrl, w, h });
  return id;
}
