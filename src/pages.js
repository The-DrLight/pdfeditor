// Page-level operations and the thumbnail sidebar.
import { state, on, emit, uid, checkpoint, pageById } from './state.js';
import { getPageProxy } from './pdfload.js';
import { dims, toast } from './util.js';
import { scrollToPage } from './view.js';

const box = document.getElementById('thumbs');
const thumbs = new Map();

/* -------------------------------------------------------------- operations */

export function rotatePage(deg) {
  const p = state.pages[state.cur];
  if (!p) return;
  checkpoint();
  p.rot = (p.rot + deg + 360) % 360;
  emit('structure');
}

export function deletePage() {
  if (state.pages.length <= 1) return toast('A document needs at least one page.');
  checkpoint();
  state.pages.splice(state.cur, 1);
  state.cur = Math.min(state.cur, state.pages.length - 1);
  state.sel = null;
  emit('structure');
  emit('select');
  emit('cur');
}

export function duplicatePage() {
  const p = state.pages[state.cur];
  if (!p) return;
  checkpoint();
  const c = JSON.parse(JSON.stringify(p));
  c.id = uid('p');
  c.items.forEach((i) => (i.id = uid('i')));
  state.pages.splice(state.cur + 1, 0, c);
  state.cur++;
  emit('structure');
  emit('cur');
}

export function insertBlank() {
  const p = state.pages[state.cur];
  if (!p) return;
  checkpoint();
  const [W, H] = dims(p);
  state.pages.splice(state.cur + 1, 0, { id: uid('p'), src: -1, idx: 0, base: 0, rot: 0, bw: W, bh: H, items: [] });
  state.cur++;
  emit('structure');
  emit('cur');
}

export function movePage(from, to) {
  if (from === to || from < 0 || to < 0 || to >= state.pages.length) return;
  checkpoint();
  const [p] = state.pages.splice(from, 1);
  state.pages.splice(to, 0, p);
  state.cur = to;
  emit('structure');
  emit('cur');
}

/* ----------------------------------------------------------------- thumbs */

const io = new IntersectionObserver(
  (entries) => {
    for (const en of entries) if (en.isIntersecting) drawThumb(en.target._t);
  },
  { root: box, rootMargin: '300px 0px' }
);

async function drawThumb(t) {
  const p = pageById(t.id);
  if (!p) return;
  const key = `${p.src}:${p.idx}:${p.rot}`;
  if (t.key === key) return;
  t.key = key;
  const [W, H] = dims(p);
  const k = 132 / W;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = t.canvas;
  const w = Math.ceil(W * k * dpr), h = Math.ceil(H * k * dpr);
  if (p.src < 0) {
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, h);
    return;
  }
  try {
    const pg = await getPageProxy(p);
    const vp = pg.getViewport({ scale: k * dpr, rotation: (p.base + p.rot) % 360 });
    const off = document.createElement('canvas');
    off.width = Math.ceil(vp.width); off.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: off.getContext('2d'), viewport: vp, background: '#fff' }).promise;
    if (t.key !== key) return;
    cv.width = off.width; cv.height = off.height;
    cv.getContext('2d').drawImage(off, 0, 0);
  } catch { t.key = ''; }
}

function makeThumb(p) {
  const el = document.createElement('div');
  el.className = 'thumb';
  el.draggable = true;
  el.dataset.id = p.id;
  const canvas = document.createElement('canvas');
  const num = document.createElement('span');
  el.append(canvas, num);
  const t = { id: p.id, el, canvas, num, key: '' };
  el._t = t;
  el.addEventListener('click', () => scrollToPage(state.pages.findIndex((x) => x.id === t.id)));
  el.addEventListener('dragstart', (ev) => {
    ev.dataTransfer.setData('text/x-page', t.id);
    ev.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', (ev) => {
    if (![...ev.dataTransfer.types].includes('text/x-page')) return;
    ev.preventDefault();
    const r = el.getBoundingClientRect();
    el.classList.toggle('over-top', ev.clientY < r.top + r.height / 2);
    el.classList.toggle('over-bot', ev.clientY >= r.top + r.height / 2);
  });
  el.addEventListener('dragleave', () => el.classList.remove('over-top', 'over-bot'));
  el.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const after = el.classList.contains('over-bot');
    el.classList.remove('over-top', 'over-bot');
    const from = state.pages.findIndex((x) => x.id === ev.dataTransfer.getData('text/x-page'));
    let to = state.pages.findIndex((x) => x.id === t.id) + (after ? 1 : 0);
    if (from < to) to--;
    movePage(from, to);
  });
  io.observe(el);
  return t;
}

export function syncThumbs() {
  const ids = new Set(state.pages.map((p) => p.id));
  for (const [id, t] of thumbs) {
    if (!ids.has(id)) {
      io.unobserve(t.el);
      t.el.remove();
      thumbs.delete(id);
    }
  }
  state.pages.forEach((p, i) => {
    let t = thumbs.get(p.id);
    if (!t) {
      t = makeThumb(p);
      thumbs.set(p.id, t);
    }
    if (box.children[i] !== t.el) box.insertBefore(t.el, box.children[i] || null);
    t.num.textContent = i + 1;
    const [W, H] = dims(p);
    t.canvas.style.aspectRatio = `${W} / ${H}`;
    if (t.key) {
      const key = `${p.src}:${p.idx}:${p.rot}`;
      if (key !== t.key) drawThumb(t);
    }
  });
  markCurrent();
}

export function markCurrent() {
  const cur = state.pages[state.cur];
  thumbs.forEach((t, id) => t.el.classList.toggle('active', cur?.id === id));
  const t = cur && thumbs.get(cur.id);
  t?.el.scrollIntoView({ block: 'nearest' });
}

export function initThumbs() {
  on('structure', syncThumbs);
  on('cur', markCurrent);
}
