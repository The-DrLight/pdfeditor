import { registerImage } from './state.js';

const dlg = document.getElementById('sigDialog');
const pad = document.getElementById('sigPad');
const pctx = pad.getContext('2d');
const typeInput = document.getElementById('sigText');
const typeFont = document.getElementById('sigFont');
const typeCv = document.getElementById('sigPreview');
const upFile = document.getElementById('sigFile');
const upBg = document.getElementById('sigRemoveBg');
const upCv = document.getElementById('sigUpPreview');
const inkSel = document.getElementById('sigInk');
const saveChk = document.getElementById('sigSave');
const savedBox = document.getElementById('sigSaved');
const LS = 'pdfeditor.signatures';

let tab = 'draw';
let inked = false;
let uploaded = null;
let resolveFn = null;

const loadSaved = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } };
const storeSaved = (a) => { try { localStorage.setItem(LS, JSON.stringify(a.slice(0, 12))); } catch { /* quota */ } };

function showTab(t) {
  tab = t;
  dlg.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  dlg.querySelectorAll('.tabpane').forEach((p) => (p.hidden = p.dataset.pane !== t));
  if (t === 'type') drawTyped();
}

/* -------- draw -------- */
function clearPad() {
  pctx.clearRect(0, 0, pad.width, pad.height);
  inked = false;
}
function padPoint(ev) {
  const r = pad.getBoundingClientRect();
  return [((ev.clientX - r.left) / r.width) * pad.width, ((ev.clientY - r.top) / r.height) * pad.height];
}
pad.addEventListener('pointerdown', (ev) => {
  pad.setPointerCapture(ev.pointerId);
  let last = padPoint(ev);
  let from = last; // start of the next smoothed segment (previous midpoint)
  pctx.strokeStyle = inkSel.value;
  pctx.lineWidth = 5;
  pctx.lineCap = pctx.lineJoin = 'round';
  pctx.beginPath();
  pctx.moveTo(...last);
  pctx.lineTo(last[0] + 0.01, last[1]);
  pctx.stroke();
  inked = true;
  const mv = (m) => {
    const q = padPoint(m);
    const mid = [(last[0] + q[0]) / 2, (last[1] + q[1]) / 2];
    pctx.beginPath();
    pctx.moveTo(...from);
    pctx.quadraticCurveTo(last[0], last[1], mid[0], mid[1]);
    pctx.stroke();
    from = mid;
    last = q;
  };
  const up = () => {
    // finish the tail: previous midpoint -> final point
    pctx.beginPath();
    pctx.moveTo(...from);
    pctx.lineTo(...last);
    pctx.stroke();
    pad.removeEventListener('pointermove', mv);
    pad.removeEventListener('pointerup', up);
  };
  pad.addEventListener('pointermove', mv);
  pad.addEventListener('pointerup', up);
});

/* -------- type -------- */
async function drawTyped() {
  const font = typeFont.value;
  try { await document.fonts.load(`64px "${font}"`); } catch { /* ignore */ }
  const c = typeCv.getContext('2d');
  c.clearRect(0, 0, typeCv.width, typeCv.height);
  c.fillStyle = inkSel.value;
  c.font = `110px "${font}", cursive`;
  c.textBaseline = 'middle';
  c.textAlign = 'center';
  c.fillText(typeInput.value || 'Your name', typeCv.width / 2, typeCv.height / 2);
}

/* -------- upload -------- */
function drawUpload() {
  const c = upCv.getContext('2d');
  c.clearRect(0, 0, upCv.width, upCv.height);
  if (!uploaded) return;
  const k = Math.min(upCv.width / uploaded.width, upCv.height / uploaded.height);
  const w = uploaded.width * k, h = uploaded.height * k;
  const tmp = document.createElement('canvas');
  tmp.width = Math.ceil(w); tmp.height = Math.ceil(h);
  const t = tmp.getContext('2d');
  t.drawImage(uploaded, 0, 0, tmp.width, tmp.height);
  if (upBg.checked) {
    const img = t.getImageData(0, 0, tmp.width, tmp.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const dark = 255 - Math.min(d[i], d[i + 1], d[i + 2]);
      d[i + 3] = Math.min(255, Math.max(0, ((dark - 25) / 90) * 255)) * (d[i + 3] / 255);
    }
    t.putImageData(img, 0, 0);
  }
  c.drawImage(tmp, (upCv.width - w) / 2, (upCv.height - h) / 2);
}
upFile.addEventListener('change', async () => {
  const f = upFile.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => { uploaded = img; drawUpload(); URL.revokeObjectURL(url); };
  img.src = url;
});
upBg.addEventListener('change', drawUpload);

/* -------- result -------- */
function trim(src) {
  const ctx = src.getContext('2d');
  const { width: w, height: h } = src;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x1 = w, y1 = h, x2 = 0, y2 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 10) {
        if (x < x1) x1 = x; if (x > x2) x2 = x;
        if (y < y1) y1 = y; if (y > y2) y2 = y;
      }
    }
  }
  if (x2 <= x1 || y2 <= y1) return null;
  const pad8 = 6;
  x1 = Math.max(0, x1 - pad8); y1 = Math.max(0, y1 - pad8);
  x2 = Math.min(w - 1, x2 + pad8); y2 = Math.min(h - 1, y2 + pad8);
  const out = document.createElement('canvas');
  out.width = x2 - x1 + 1; out.height = y2 - y1 + 1;
  out.getContext('2d').drawImage(src, x1, y1, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function finish(asset) {
  const r = resolveFn;
  resolveFn = null;
  if (dlg.open) dlg.close();
  r?.(asset);
}
function assetFromDataUrl(dataUrl, w, h) {
  return { imageId: registerImage(dataUrl, w, h), w, h, maxW: 170 };
}

document.getElementById('sigUse').addEventListener('click', () => {
  const src = tab === 'draw' ? pad : tab === 'type' ? typeCv : upCv;
  if (tab === 'draw' && !inked) return alert('Draw your signature first.');
  const t = trim(src);
  if (!t) return alert('Nothing to use yet.');
  const dataUrl = t.toDataURL('image/png');
  if (saveChk.checked) storeSaved([{ dataUrl, w: t.width, h: t.height }, ...loadSaved()]);
  finish(assetFromDataUrl(dataUrl, t.width, t.height));
});
document.getElementById('sigClear').addEventListener('click', clearPad);
document.getElementById('sigClose').addEventListener('click', () => finish(null));
dlg.addEventListener('cancel', () => finish(null));
dlg.addEventListener('close', () => finish(null));
dlg.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
typeInput.addEventListener('input', drawTyped);
typeFont.addEventListener('change', drawTyped);
inkSel.addEventListener('change', () => { if (tab === 'type') drawTyped(); });

function renderSaved() {
  const list = loadSaved();
  savedBox.hidden = !list.length;
  savedBox.replaceChildren();
  if (!list.length) return;
  const label = document.createElement('div');
  label.className = 'muted';
  label.textContent = 'Saved on this device';
  savedBox.appendChild(label);
  const row = document.createElement('div');
  row.className = 'saved-row';
  list.forEach((s, i) => {
    const b = document.createElement('div');
    b.className = 'saved';
    const img = new Image();
    img.src = s.dataUrl;
    b.appendChild(img);
    b.addEventListener('click', () => finish(assetFromDataUrl(s.dataUrl, s.w, s.h)));
    const x = document.createElement('button');
    x.textContent = '×';
    x.title = 'Remove';
    x.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const l = loadSaved();
      l.splice(i, 1);
      storeSaved(l);
      renderSaved();
    });
    b.appendChild(x);
    row.appendChild(b);
  });
  savedBox.appendChild(row);
}

export function openSignatureDialog() {
  clearPad();
  uploaded = null;
  upFile.value = '';
  drawUpload();
  renderSaved();
  showTab('draw');
  dlg.showModal();
  return new Promise((res) => (resolveFn = res));
}
