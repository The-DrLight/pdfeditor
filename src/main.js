import './style.css';
import '@fontsource/dancing-script/400.css';
import '@fontsource/caveat/400.css';
import '@fontsource/great-vibes/400.css';

import { state, on, undo, redo, canUndo, canRedo, isDirty, checkpoint, uid, registerImage } from './state.js';
import { openPdf } from './pdfload.js';
import {
  initView, setTool, setZoom, fitWidth, select, selItem, deleteSel, duplicateSel, nudge,
  beginPlacement, addTextAtCenter, addStamp, runFind, findStep, refreshAll, scrollToPage,
} from './view.js';
import { initThumbs, rotatePage, deletePage, duplicatePage, insertBlank } from './pages.js';
import { initProps } from './props.js';
import { openSignatureDialog } from './signature.js';
import { toast, parseRange } from './util.js';

// pdf-lib, fontkit and the Unicode fonts are only needed when saving: load them on demand.
const loadExporter = () => import('./export.js');

const $ = (id) => document.getElementById(id);

initView();
initThumbs();
initProps();

/* ---------------------------------------------------------------- files */

async function openFiles(files, append) {
  const list = [...files].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (!list.length) return toast('Please choose a PDF file.');
  try {
    toast('Opening…', 8000);
    for (let i = 0; i < list.length; i++) await openPdf(list[i], { append: append || i > 0 });
    toast(`${state.pages.length} pages loaded`);
  } catch (err) {
    console.error(err);
    toast('Could not open that PDF: ' + (err?.message || err), 5000);
  }
}
$('btnOpen').onclick = $('btnOpen2').onclick = () => $('fileOpen').click();
$('fileOpen').onchange = (e) => { openFiles(e.target.files, false); e.target.value = ''; };
$('btnMerge').onclick = () => (state.pages.length ? $('fileMerge').click() : $('fileOpen').click());
$('fileMerge').onchange = (e) => { openFiles(e.target.files, true); e.target.value = ''; };

window.addEventListener('dragover', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  document.body.classList.add('dragover');
});
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragover'); });
window.addEventListener('drop', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  document.body.classList.remove('dragover');
  openFiles(e.dataTransfer.files, state.pages.length > 0 && e.shiftKey);
});

/* ----------------------------------------------------------------- save */

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const outName = (suffix = '-edited') => state.name.replace(/\.pdf$/i, '') + suffix + '.pdf';

async function save(indices, suffix) {
  if (!state.pages.length) return toast('Open a PDF first.');
  try {
    toast('Preparing PDF…', 60000);
    const { exportPdf } = await loadExporter();
    const bytes = await exportPdf(indices, (n, t) => { if (t > 8) toast(`Writing page ${n} of ${t}…`, 60000); });
    download(bytes, outName(suffix));
    toast(`Saved ${(bytes.length / 1024).toFixed(0)} KB`);
    return bytes;
  } catch (err) {
    console.error(err);
    toast('Save failed: ' + (err?.message || err), 6000);
  }
}
$('btnSave').onclick = () => save();

/* ------------------------------------------------------------- menus */

$('btnMore').onclick = (e) => { e.stopPropagation(); $('menuMore').hidden = !$('menuMore').hidden; };
document.addEventListener('click', () => ($('menuMore').hidden = true));
$('menuMore').addEventListener('click', (e) => {
  const m = e.target.dataset.m;
  if (!m || !state.pages.length) return;
  if (m === 'range') {
    const s = prompt(`Pages to save (e.g. 1-3, 5). Document has ${state.pages.length} pages:`, `1-${state.pages.length}`);
    if (!s) return;
    const idx = parseRange(s, state.pages.length);
    if (!idx.length) return toast('No valid pages in that range.');
    save(idx, '-pages');
  } else if (m === 'watermark') {
    const text = prompt('Watermark text:', 'CONFIDENTIAL');
    if (!text) return;
    checkpoint();
    for (const p of state.pages) {
      const size = Math.min(p.bw / (text.length * 0.55), 110);
      const w = text.length * size * 0.55;
      const ang = 45;
      const rad = (ang * Math.PI) / 180;
      p.items.push({
        id: uid('i'), type: 'text', text, size, color: '#9aa0ab', font: 'sans', bold: true, italic: false,
        opacity: 0.35, angle: ang,
        x: p.bw / 2 - (w / 2) * Math.cos(rad) - (size * 0.6) * Math.sin(rad),
        y: p.bh / 2 + (w / 2) * Math.sin(rad) - (size * 0.6) * Math.cos(rad),
      });
    }
    refreshAll();
    toast('Watermark added to every page');
  } else if (m === 'numbers') {
    checkpoint();
    const total = state.pages.length;
    state.pages.forEach((p, i) => {
      const text = `Page ${i + 1} of ${total}`;
      p.items.push({ id: uid('i'), type: 'text', text, size: 10, color: '#444444', font: 'sans', bold: false, italic: false, x: p.bw / 2 - text.length * 2.6, y: p.bh - 30 });
    });
    refreshAll();
    toast('Page numbers added');
  }
  $('menuMore').hidden = true;
});

/* ------------------------------------------------------------- toolbar */

document.querySelectorAll('[data-tool]').forEach((b) => {
  b.onclick = () => {
    if (!state.pages.length) return;
    setTool(b.dataset.tool === state.tool && b.dataset.tool !== 'select' ? 'select' : b.dataset.tool);
  };
});
on('tool', () => {
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === state.tool));
});

$('btnImage').onclick = () => state.pages.length && $('fileImage').click();
$('fileImage').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const a = await imageAsset(f);
    beginPlacement(a);
    toast('Click on the page where the image should go');
  } catch {
    toast('Could not read that image.');
  }
};

function imageAsset(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const keepAlpha = /png|gif|webp|svg/i.test(file.type);
      const c = cv.getContext('2d');
      if (!keepAlpha) { c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); }
      c.drawImage(img, 0, 0);
      const dataUrl = keepAlpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.92);
      URL.revokeObjectURL(url);
      resolve({ imageId: registerImage(dataUrl, cv.width, cv.height), w: cv.width * 0.75, h: cv.height * 0.75, maxW: 300 });
    };
    img.onerror = reject;
    img.src = url;
  });
}

$('btnSign').onclick = async () => {
  if (!state.pages.length) return;
  const a = await openSignatureDialog();
  if (a) {
    beginPlacement(a);
    toast('Click on the page where the signature should go');
  }
};
$('btnCheck').onclick = () => state.pages.length && addStamp('check');
$('btnCross').onclick = () => state.pages.length && addStamp('cross');
$('btnDate').onclick = () => state.pages.length && addTextAtCenter(new Date().toLocaleDateString('en-GB'));

/* undo / zoom / pages / find */
$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
$('zoomIn').onclick = () => setZoom(state.zoom * 1.15);
$('zoomOut').onclick = () => setZoom(state.zoom / 1.15);
$('zoomFit').onclick = fitWidth;
$('pgLeft').onclick = () => rotatePage(-90);
$('pgRight').onclick = () => rotatePage(90);
$('pgDup').onclick = duplicatePage;
$('pgBlank').onclick = insertBlank;
$('pgDel').onclick = deletePage;

let ft;
$('findInput').addEventListener('input', (e) => {
  clearTimeout(ft);
  ft = setTimeout(() => runFind(e.target.value), 250);
});
$('findInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') findStep(e.shiftKey ? -1 : 1);
});
$('findNext').onclick = () => findStep(1);
$('findPrev').onclick = () => findStep(-1);
on('find', () => {
  const f = state.find;
  $('findCount').textContent = f.hits.length ? `${f.idx + 1}/${f.hits.length}` : $('findInput').value ? '0' : '';
});

function updateInfo() {
  $('pgNum').textContent = state.pages.length ? state.cur + 1 : 0;
  $('pgTotal').textContent = state.pages.length;
  $('zoomLbl').textContent = Math.round(state.zoom * 100) + '%';
  $('btnUndo').disabled = !canUndo();
  $('btnRedo').disabled = !canRedo();
}
['structure', 'cur', 'zoom', 'history'].forEach((ev) => on(ev, updateInfo));
updateInfo();

/* ------------------------------------------------------------ keyboard */

window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('fileOpen').click(); return; }
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('findInput').focus(); $('findInput').select(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (e.key === 'Escape') {
    if (state.tool !== 'select') setTool('select');
    else select(null);
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selItem()) { e.preventDefault(); deleteSel(); return; }
  const step = e.shiftKey ? 10 : 1;
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[e.key] && selItem()) { e.preventDefault(); nudge(...arrows[e.key]); return; }
  if (e.key === 'PageDown') scrollToPage(Math.min(state.pages.length - 1, state.cur + 1));
  if (e.key === 'PageUp') scrollToPage(Math.max(0, state.cur - 1));
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// Never leave unexpected failures silent
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast('Something went wrong: ' + (e.reason?.message || e.reason), 5000);
});

// Mobile: show / hide the page thumbnails drawer
$('btnPages').onclick = () => document.body.classList.toggle('show-pages');
on('cur', () => document.body.classList.remove('show-pages'));

// Dev-only hook for manual testing; not shipped in production builds
if (import.meta.env.DEV) {
  window.__app = { state, openPdf, exportPdf: async (...a) => (await loadExporter()).exportPdf(...a) };
}
