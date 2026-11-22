import * as pdfjsLib from 'pdfjs-dist';
import { state, on, emit, uid, checkpoint, popCheckpoint, pageById } from './state.js';
import { getPageProxy, getRuns, getWidgets } from './pdfload.js';
import {
  PX, dims, bboxOf, textMetrics, FONT_CSS, arrowHead, rotFwd, rotInv, overlayTransform,
  widgetFontSize, clamp,
} from './util.js';

const viewer = document.getElementById('viewer');
const container = document.getElementById('pages');
const NS = 'http://www.w3.org/2000/svg';
const els = new Map(); // pageId -> element record

export const scale = () => state.zoom * PX;

function svg(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent?.appendChild(n);
  return n;
}
function div(cls, parent) {
  const d = document.createElement('div');
  d.className = cls;
  parent?.appendChild(d);
  return d;
}

/* ------------------------------------------------------------------ pages */

const io = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      const e = en.target._e;
      if (!e) continue;
      e.visible = en.isIntersecting;
      if (e.visible) {
        renderPage(e);
        renderRuns(e);
      } else release(e);
    }
  },
  { root: viewer, rootMargin: '900px 0px' }
);

function createPageEl(p) {
  const root = div('page');
  root.dataset.id = p.id;
  const canvas = document.createElement('canvas');
  canvas.className = 'pcanvas';
  root.appendChild(canvas);
  const overlay = div('overlay', root);
  const L = {
    widgets: div('layer widgets', overlay),
    items: div('layer items', overlay),
    runs: div('layer runs', overlay),
    find: div('layer finds', overlay),
    sel: div('layer sel', overlay),
  };
  const e = {
    id: p.id, root, canvas, overlay, L, key: '', renderedKey: '', visible: false,
    rendered: false, draft: null, wlist: [], wkey: '', wTok: 0, runTok: 0, task: null,
  };
  root._e = e;
  io.observe(root);
  overlay.addEventListener('pointerdown', (ev) => onDown(ev, e));
  overlay.addEventListener('dblclick', (ev) => onDbl(ev, e));
  return e;
}

function release(e) {
  e.task?.cancel();
  e.task = null;
  e.canvas.width = 1;
  e.canvas.height = 1;
  e.rendered = false;
  e.renderedKey = '';
}

export function syncPages() {
  const ids = new Set(state.pages.map((p) => p.id));
  for (const [id, e] of els) {
    if (!ids.has(id)) {
      io.unobserve(e.root);
      e.task?.cancel();
      e.root.remove();
      els.delete(id);
    }
  }
  state.pages.forEach((p, i) => {
    let e = els.get(p.id);
    if (!e) {
      e = createPageEl(p);
      els.set(p.id, e);
    }
    if (container.children[i] !== e.root) container.insertBefore(e.root, container.children[i] || null);
    layoutPage(e, p);
    renderOverlay(e);
  });
  document.getElementById('empty').hidden = state.pages.length > 0;
}

function layoutPage(e, p) {
  const s = scale();
  const [W, H] = dims(p);
  e.root.style.width = W * s + 'px';
  e.root.style.height = H * s + 'px';
  e.canvas.style.width = W * s + 'px';
  e.canvas.style.height = H * s + 'px';
  Object.assign(e.overlay.style, {
    width: p.bw * s + 'px',
    height: p.bh * s + 'px',
    transform: overlayTransform(p, s),
  });
  const key = `${p.src}:${p.idx}:${p.rot}:${s.toFixed(4)}`;
  if (key !== e.key) {
    e.key = key;
    e.rendered = false;
    if (e.visible) renderPage(e);
  }
  const wkey = `${p.src}:${p.idx}`;
  if (wkey !== e.wkey) {
    e.wkey = wkey;
    loadWidgets(e, p);
  } else drawWidgets(e);
  renderRuns(e);
  drawFind(e);
}

async function renderPage(e) {
  const p = pageById(e.id);
  if (!p) return;
  if (e.rendered && e.renderedKey === e.key) return;
  e.task?.cancel();
  const key = e.key;
  const s = scale();
  const [W, H] = dims(p);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (p.src < 0) {
    e.canvas.width = Math.ceil(W * s * dpr);
    e.canvas.height = Math.ceil(H * s * dpr);
    const c = e.canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, e.canvas.width, e.canvas.height);
    e.rendered = true;
    e.renderedKey = key;
    return;
  }
  let pg;
  try { pg = await getPageProxy(p); } catch { return; }
  const vp = pg.getViewport({ scale: s * dpr, rotation: (p.base + p.rot) % 360 });
  const off = document.createElement('canvas');
  off.width = Math.ceil(vp.width);
  off.height = Math.ceil(vp.height);
  const task = pg.render({
    canvasContext: off.getContext('2d'),
    viewport: vp,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
    background: '#ffffff',
  });
  e.task = task;
  try {
    await task.promise;
  } catch (err) {
    if (err?.name !== 'RenderingCancelledException') console.error(err);
    return;
  }
  if (e.key !== key) return;
  e.canvas.width = off.width;
  e.canvas.height = off.height;
  e.canvas.getContext('2d').drawImage(off, 0, 0);
  e.rendered = true;
  e.renderedKey = key;
}

/* ------------------------------------------------------------ overlay items */

export function renderOverlay(e) {
  const p = pageById(e.id);
  if (!p) return;
  const s = scale();
  const nodes = p.items.map((it) => itemEl(it, s));
  if (e.draft) nodes.push(itemEl(e.draft, s, true));
  e.L.items.replaceChildren(...nodes);
  renderSel(e);
}
export function refreshPage(pageId) {
  const e = els.get(pageId);
  if (e) renderOverlay(e);
}
export function refreshAll() {
  els.forEach(renderOverlay);
}

function itemEl(it, s, draft) {
  const bb = bboxOf(it);
  const d = document.createElement('div');
  d.className = 'item t-' + it.type;
  d.dataset.id = it.id;
  Object.assign(d.style, {
    left: bb.x * s + 'px', top: bb.y * s + 'px', width: bb.w * s + 'px', height: bb.h * s + 'px',
  });
  if (draft) d.style.pointerEvents = 'none';
  if (it.angle) {
    d.style.transformOrigin = '0 0';
    d.style.transform = `rotate(${-it.angle}deg)`;
  }
  switch (it.type) {
    case 'text': textEl(it, s, d); break;
    case 'image': {
      const img = new Image();
      img.src = state.images.get(it.imageId)?.dataUrl || '';
      img.draggable = false;
      img.style.opacity = it.opacity ?? 1;
      d.appendChild(img);
      break;
    }
    case 'rect': case 'ellipse': case 'highlight': case 'redact': shapeEl(it, bb, d); break;
    case 'pen': case 'line': case 'arrow': pathEl(it, bb, d); break;
  }
  return d;
}

function textEl(it, s, d) {
  Object.assign(d.style, {
    fontSize: it.size * s + 'px', lineHeight: '1.2', fontFamily: FONT_CSS[it.font] || FONT_CSS.sans,
    fontWeight: it.bold ? 700 : 400, fontStyle: it.italic ? 'italic' : 'normal',
    color: it.color, whiteSpace: 'pre', width: 'auto', height: 'auto', opacity: it.opacity ?? 1,
  });
  if (state.editing === it.id) {
    const ta = document.createElement('textarea');
    ta.value = it.text;
    ta.wrap = 'off';
    ta.spellcheck = false;
    ta.className = 'textedit';
    const fit = () => {
      const m = textMetrics({ ...it, text: ta.value + ' ' });
      ta.style.width = m.w * s + 12 + 'px';
      ta.style.height = Math.max(m.h, it.size * 1.2) * s + 'px';
    };
    ta.addEventListener('input', fit);
    ta.addEventListener('blur', () => commitEdit(it.id, ta.value));
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) ta.blur();
    });
    d.appendChild(ta);
    fit();
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);
  } else d.textContent = it.text || ' ';
}

function commitEdit(id, value) {
  if (state.editing !== id) return;
  state.editing = null;
  let found = null;
  for (const p of state.pages) {
    const it = p.items.find((i) => i.id === id);
    if (it) found = { p, it };
  }
  if (!found) return;
  const { p, it } = found;
  if (!value.trim()) {
    if (!it.fresh) checkpoint();
    else popCheckpoint();
    p.items = p.items.filter((i) => i !== it);
    state.sel = null;
    emit('select');
  } else if (value !== it.text) {
    if (!it.fresh) checkpoint();
    it.text = value;
  } else if (it.fresh) popCheckpoint();
  delete it.fresh;
  refreshPage(p.id);
  emit('items');
}

const hitPad = (sw) => Math.max(10, (sw || 2) + 6);

function shapeEl(it, bb, d) {
  const w = Math.max(bb.w, 0.01), h = Math.max(bb.h, 0.01);
  const sv = svg('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' }, d);
  sv.style.cssText = 'width:100%;height:100%;overflow:visible;display:block';
  const common = {
    fill: it.fill || 'none',
    stroke: it.stroke || 'none',
    'stroke-width': it.sw || 0,
  };
  let style = `opacity:${it.opacity ?? 1}`;
  if (it.type === 'highlight') { common.fill = it.fill; style = 'mix-blend-mode:multiply;opacity:.4'; }
  if (it.type === 'redact') { common.fill = '#000'; style = 'opacity:.92'; }
  const mk = (extra, hit) => {
    const n = it.type === 'ellipse'
      ? svg('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, ...extra })
      : svg('rect', { x: 0, y: 0, width: w, height: h, ...extra });
    if (!hit) n.style.cssText = style;
    return n;
  };
  sv.appendChild(mk(common));
  if (it.stroke && !it.fill && it.type !== 'highlight') {
    const hit = mk({ fill: 'none', stroke: 'transparent', 'stroke-width': hitPad(it.sw) }, true);
    hit.style.pointerEvents = 'stroke';
    sv.appendChild(hit);
  }
  if (it.type === 'redact') {
    const t = svg('text', { x: w / 2, y: h / 2, fill: '#fff', 'font-size': Math.min(11, h * 0.6), 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, sv);
    t.textContent = 'REDACT';
    t.style.cssText = 'opacity:.6;pointer-events:none';
  }
}

function pathEl(it, bb, d) {
  const w = Math.max(bb.w, 0.01), h = Math.max(bb.h, 0.01);
  const sv = svg('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' }, d);
  sv.style.cssText = 'width:100%;height:100%;overflow:visible;display:block';
  const rel = it.pts.map(([x, y]) => [x - bb.x, y - bb.y]);
  const pts = rel.map((q) => q.join(',')).join(' ');
  const o = it.opacity ?? 1;
  svg('polyline', {
    points: pts, fill: 'none', stroke: it.stroke, 'stroke-width': it.sw,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: `opacity:${o};pointer-events:none`,
  }, sv);
  if (it.type === 'arrow' && rel.length >= 2) {
    const tri = arrowHead(rel[0], rel[rel.length - 1], it.sw);
    svg('polygon', { points: tri.map((q) => q.join(',')).join(' '), fill: it.stroke, style: `opacity:${o};pointer-events:none` }, sv);
  }
  const hit = svg('polyline', {
    points: pts, fill: 'none', stroke: 'transparent', 'stroke-width': hitPad(it.sw),
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, sv);
  hit.style.pointerEvents = 'stroke';
}

/* --------------------------------------------------------------- selection */

export const selItem = () => {
  if (!state.sel) return null;
  const p = pageById(state.sel.pageId);
  return p?.items.find((i) => i.id === state.sel.itemId) || null;
};

function renderSel(e) {
  const L = e.L.sel;
  L.replaceChildren();
  if (!state.sel || state.sel.pageId !== e.id || state.editing === state.sel.itemId) return;
  const p = pageById(e.id);
  const it = p?.items.find((i) => i.id === state.sel.itemId);
  if (!it) return;
  const s = scale();
  const bb = bboxOf(it);
  const box = div('selbox', L);
  Object.assign(box.style, { left: bb.x * s + 'px', top: bb.y * s + 'px', width: bb.w * s + 'px', height: bb.h * s + 'px' });
  if (it.angle) { box.style.transformOrigin = '0 0'; box.style.transform = `rotate(${-it.angle}deg)`; }
  const dirs = it.type === 'text' ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  for (const dir of dirs) {
    const hd = div('handle h-' + dir, box);
    hd.dataset.dir = dir;
  }
  const tools = div('seltools', box);
  tools.innerHTML = '<button data-act="dup" title="Duplicate (Ctrl+D)">⧉</button><button data-act="del" title="Delete (Del)">🗑</button>';
}

export function select(pageId, itemId) {
  state.sel = pageId ? { pageId, itemId } : null;
  emit('select');
  els.forEach(renderSel);
}

export function deleteSel() {
  const it = selItem();
  if (!it) return;
  const p = pageById(state.sel.pageId);
  checkpoint();
  p.items = p.items.filter((i) => i !== it);
  state.sel = null;
  refreshPage(p.id);
  emit('select');
  emit('items');
}

export function duplicateSel() {
  const it = selItem();
  if (!it) return;
  const p = pageById(state.sel.pageId);
  checkpoint();
  const c = JSON.parse(JSON.stringify(it));
  c.id = uid('i');
  if (c.pts) c.pts = c.pts.map(([x, y]) => [x + 14, y + 14]);
  else { c.x += 14; c.y += 14; }
  p.items.push(c);
  select(p.id, c.id);
  refreshPage(p.id);
  emit('items');
}

let nudgeTimer;
export function nudge(dx, dy) {
  const it = selItem();
  if (!it) return;
  if (!nudgeTimer) checkpoint();
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => (nudgeTimer = null), 600);
  moveItem(it, dx, dy);
  refreshPage(state.sel.pageId);
  emit('items');
}

function moveItem(it, dx, dy) {
  if (it.pts) it.pts = it.pts.map(([x, y]) => [x + dx, y + dy]);
  else { it.x += dx; it.y += dy; }
}

/* ------------------------------------------------------------ interactions */

function toPage(ev, e) {
  const p = pageById(e.id);
  const r = e.root.getBoundingClientRect();
  const s = scale();
  const [x, y] = rotInv(p, (ev.clientX - r.left) / s, (ev.clientY - r.top) / s);
  return { x, y };
}

function setCurrent(p) {
  const i = state.pages.indexOf(p);
  if (i >= 0 && i !== state.cur) {
    state.cur = i;
    emit('cur');
  }
}

function onDown(ev, e) {
  if (ev.button !== 0) return;
  const p = pageById(e.id);
  if (!p) return;
  setCurrent(p);
  if (ev.target.closest('.widget') || ev.target.tagName === 'TEXTAREA') return;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
  const tool = state.tool;
  const pt = toPage(ev, e);
  if (tool === 'select') {
    const act = ev.target.closest('[data-act]');
    if (act) {
      ev.preventDefault();
      act.dataset.act === 'del' ? deleteSel() : duplicateSel();
      return;
    }
    const hd = ev.target.closest('.handle');
    if (hd && selItem()) {
      ev.preventDefault();
      beginDrag(ev, e, p, selItem(), 'resize', hd.dataset.dir);
      return;
    }
    const el = ev.target.closest('.item');
    if (el) {
      const it = p.items.find((i) => i.id === el.dataset.id);
      if (it) {
        ev.preventDefault();
        select(p.id, it.id);
        beginDrag(ev, e, p, it, 'move');
        return;
      }
    }
    select(null);
    return;
  }
  ev.preventDefault();
  if (tool === 'text') return createText(e, p, pt);
  if (tool === 'place') return placePending(e, p, pt);
  if (tool === 'edittext') return;
  beginCreate(ev, e, p, tool, pt);
}

function onDbl(ev, e) {
  const el = ev.target.closest('.item.t-text');
  if (!el || state.tool !== 'select') return;
  state.editing = el.dataset.id;
  select(e.id, el.dataset.id);
  renderOverlay(e);
}

function beginDrag(ev, e, p, it, mode, dir) {
  const s = scale();
  const start = toPage(ev, e);
  const orig = JSON.parse(JSON.stringify(it));
  const ob = bboxOf(orig);
  let moved = false;
  const mv = (m) => {
    const c = toPage(m, e);
    const dx = c.x - start.x, dy = c.y - start.y;
    if (!moved) {
      if (Math.hypot(dx, dy) * s < 3) return;
      moved = true;
      checkpoint();
    }
    if (mode === 'move') {
      Object.assign(it, JSON.parse(JSON.stringify(orig)));
      moveItem(it, dx, dy);
    } else resizeItem(it, orig, ob, dir, dx, dy, m.shiftKey);
    renderOverlay(e);
  };
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    if (moved) emit('items');
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

function resizeItem(it, orig, ob, dir, dx, dy, shift) {
  let { x, y, w, h } = ob;
  if (dir.includes('e')) w = ob.w + dx;
  if (dir.includes('s')) h = ob.h + dy;
  if (dir.includes('w')) { x = ob.x + dx; w = ob.w - dx; }
  if (dir.includes('n')) { y = ob.y + dy; h = ob.h - dy; }
  const keep = it.type === 'text' || it.type === 'image' ? !shift : shift;
  if (keep && ob.w && ob.h && dir.length === 2) {
    const k = Math.max(w / ob.w, h / ob.h);
    w = ob.w * k; h = ob.h * k;
    if (dir.includes('w')) x = ob.x + ob.w - w;
    if (dir.includes('n')) y = ob.y + ob.h - h;
  }
  w = Math.max(w, 4);
  h = Math.max(h, 4);
  if (it.type === 'text') {
    it.size = clamp(orig.size * (w / ob.w), 4, 400);
    const m = textMetrics(it);
    it.x = dir.includes('w') ? ob.x + ob.w - m.w : ob.x;
    it.y = dir.includes('n') ? ob.y + ob.h - m.h : ob.y;
  } else if (it.pts) {
    it.pts = orig.pts.map(([px, py]) => [x + (px - ob.x) * (w / ob.w), y + (py - ob.y) * (h / ob.h)]);
  } else Object.assign(it, { x, y, w, h });
}

function addItem(p, it) {
  checkpoint();
  p.items.push(it);
  select(p.id, it.id);
  refreshPage(p.id);
  emit('items');
}

function createText(e, p, pt) {
  const st = state.style;
  const it = {
    id: uid('i'), type: 'text', x: pt.x, y: pt.y - st.size * 0.6, text: '',
    size: st.size, color: st.color, font: st.font, bold: st.bold, italic: st.italic, fresh: true,
  };
  checkpoint();
  p.items.push(it);
  state.editing = it.id;
  setTool('select');
  select(p.id, it.id);
  renderOverlay(e);
}

function placePending(e, p, pt) {
  const a = state.pending;
  if (!a) return setTool('select');
  const maxW = a.maxW || 220;
  let w = Math.min(a.w, maxW);
  let h = (a.h / a.w) * w;
  w = Math.min(w, p.bw * 0.9);
  h = (a.h / a.w) * w;
  const it = {
    id: uid('i'), type: 'image', imageId: a.imageId,
    x: clamp(pt.x - w / 2, 0, Math.max(0, p.bw - w)), y: clamp(pt.y - h / 2, 0, Math.max(0, p.bh - h)), w, h,
  };
  state.pending = null;
  setTool('select');
  addItem(p, it);
}

export function beginPlacement(asset) {
  state.pending = asset;
  setTool('place');
}

function beginCreate(ev, e, p, tool, pt) {
  const st = state.style;
  const s = scale();
  let d;
  if (tool === 'pen') d = { type: 'pen', pts: [[pt.x, pt.y]], stroke: st.stroke, sw: st.sw, opacity: st.opacity };
  else if (tool === 'line' || tool === 'arrow') d = { type: tool, pts: [[pt.x, pt.y], [pt.x, pt.y]], stroke: st.stroke, sw: st.sw, opacity: st.opacity };
  else if (tool === 'rect' || tool === 'ellipse') d = { type: tool, x: pt.x, y: pt.y, w: 0, h: 0, stroke: st.stroke, fill: st.fill || null, sw: st.sw, opacity: st.opacity };
  else if (tool === 'highlight') d = { type: 'highlight', x: pt.x, y: pt.y, w: 0, h: 0, fill: st.hl };
  else if (tool === 'whiteout') d = { type: 'rect', whiteout: true, x: pt.x, y: pt.y, w: 0, h: 0, fill: '#ffffff', stroke: null, sw: 0 };
  else if (tool === 'redact') d = { type: 'redact', x: pt.x, y: pt.y, w: 0, h: 0 };
  else return;
  d.id = uid('i');
  e.draft = d;
  const boxy = 'x' in d;
  const mv = (m) => {
    const c = toPage(m, e);
    if (tool === 'pen') d.pts.push([c.x, c.y]);
    else if (d.pts) d.pts[1] = m.shiftKey ? snap45(d.pts[0], [c.x, c.y]) : [c.x, c.y];
    else {
      d.x = Math.min(pt.x, c.x); d.y = Math.min(pt.y, c.y);
      d.w = Math.abs(c.x - pt.x); d.h = Math.abs(c.y - pt.y);
      if (m.shiftKey && (tool === 'rect' || tool === 'ellipse')) d.w = d.h = Math.max(d.w, d.h);
    }
    renderOverlay(e);
  };
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    e.draft = null;
    let ok = true;
    if (boxy) {
      if (d.w * s < 4 || d.h * s < 4) {
        if (tool === 'rect' || tool === 'ellipse') { d.x = pt.x; d.y = pt.y; d.w = 120; d.h = 70; }
        else ok = false;
      }
    } else if (tool === 'pen') {
      if (d.pts.length < 2) d.pts.push([pt.x + 0.1, pt.y]);
      else d.pts = simplify(d.pts, 0.6);
    } else if (Math.hypot(d.pts[1][0] - d.pts[0][0], d.pts[1][1] - d.pts[0][1]) * s < 6) ok = false;
    if (ok) {
      checkpoint();
      p.items.push(d);
      if (tool !== 'pen' && tool !== 'highlight') {
        setTool('select');
        select(p.id, d.id);
      }
      emit('items');
    }
    renderOverlay(e);
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

function snap45(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)];
}
function simplify(pts, tol) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    if (Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) >= tol) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/* ------------------------------------------------------------------ tools */

export function setTool(t) {
  if (state.tool === t) return;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
  state.tool = t;
  if (t !== 'place') state.pending = null;
  viewer.dataset.tool = t;
  els.forEach((e) => renderRuns(e));
  emit('tool');
}

// Insert helpers used by the toolbar (Date, stamps, watermark, page numbers)
export function currentPage() {
  return state.pages[state.cur];
}
export function addTextAtCenter(text) {
  const p = currentPage();
  if (!p) return;
  const st = state.style;
  const it = { id: uid('i'), type: 'text', x: 0, y: 0, text, size: st.size, color: st.color, font: st.font, bold: st.bold, italic: st.italic };
  const m = textMetrics(it);
  it.x = (p.bw - m.w) / 2;
  it.y = p.bh / 3;
  addItem(p, it);
}
export function addStamp(kind) {
  const p = currentPage();
  if (!p) return;
  const k = 22;
  const ox = p.bw / 2 - k / 2, oy = p.bh / 3;
  const color = kind === 'check' ? '#15803d' : '#b91c1c';
  const mk = (pts) => ({ id: uid('i'), type: 'pen', pts: pts.map(([x, y]) => [ox + x * k, oy + y * k]), stroke: color, sw: 3.2, opacity: 1 });
  checkpoint();
  const items = kind === 'check'
    ? [mk([[0, 0.55], [0.36, 0.92], [1, 0.05]])]
    : [mk([[0.05, 0.05], [0.95, 0.95]]), mk([[0.95, 0.05], [0.05, 0.95]])];
  p.items.push(...items);
  select(p.id, items[0].id);
  refreshPage(p.id);
  emit('items');
}

/* ------------------------------------------------------------- edit text */

async function renderRuns(e) {
  const L = e.L.runs;
  const p = pageById(e.id);
  const tok = ++e.runTok;
  if (state.tool !== 'edittext' || !p || p.src < 0 || !e.visible) {
    L.replaceChildren();
    return;
  }
  const runs = await getRuns(p);
  if (tok !== e.runTok) return;
  const s = scale();
  L.replaceChildren(
    ...runs.map((r) => {
      const d = div('run');
      Object.assign(d.style, { left: (r.x - 1) * s + 'px', top: r.cy * s + 'px', width: (r.w + 2) * s + 'px', height: r.ch * s + 'px' });
      d.title = 'Click to edit this text';
      d.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        convertRun(e, p, r);
      });
      return d;
    })
  );
}

function sampleColors(e, p, box) {
  const fallback = { bg: '#ffffff', fg: '#000000' };
  if (!e.rendered || e.canvas.width < 4) return fallback;
  const [ax, ay] = rotFwd(p, box.x, box.y);
  const [bx, by] = rotFwd(p, box.x + box.w, box.y + box.h);
  const [W] = dims(p);
  const k = e.canvas.width / W;
  const sx = Math.max(0, Math.floor(Math.min(ax, bx) * k));
  const sy = Math.max(0, Math.floor(Math.min(ay, by) * k));
  const sw = Math.max(1, Math.min(e.canvas.width - sx, Math.ceil(Math.abs(bx - ax) * k)));
  const sh = Math.max(1, Math.min(e.canvas.height - sy, Math.ceil(Math.abs(by - ay) * k)));
  let data;
  try { data = e.canvas.getContext('2d').getImageData(sx, sy, sw, sh).data; } catch { return fallback; }
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) || [0, 0, 0, 0];
    b[0] += data[i]; b[1] += data[i + 1]; b[2] += data[i + 2]; b[3]++;
    buckets.set(key, b);
  }
  let best = null;
  for (const b of buckets.values()) if (!best || b[3] > best[3]) best = b;
  const bg = [best[0] / best[3], best[1] / best[3], best[2] / best[3]];
  let far = null, fd = 0;
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    if (d > fd) { fd = d; far = [data[i], data[i + 1], data[i + 2]]; }
  }
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return { bg: hex(bg), fg: fd > 120 ? hex(far) : '#000000' };
}

function convertRun(e, p, r) {
  const { bg, fg } = sampleColors(e, p, { x: r.x, y: r.cy, w: r.w, h: r.ch });
  const cover = {
    id: uid('i'), type: 'rect', whiteout: true,
    x: r.x - 1.5, y: r.cy - 1, w: r.w + 3, h: r.ch + 2, fill: bg, stroke: null, sw: 0,
  };
  const text = {
    id: uid('i'), type: 'text', x: r.x, y: r.base - 0.95 * r.size, text: r.str,
    size: +r.size.toFixed(2), color: fg, font: r.font, bold: r.bold, italic: r.italic,
  };
  checkpoint();
  p.items.push(cover, text);
  state.editing = text.id;
  setTool('select');
  select(p.id, text.id);
  renderOverlay(e);
  emit('items');
}

/* ----------------------------------------------------------------- search */

export async function runFind(q) {
  state.find = { hits: [], idx: -1 };
  q = q.trim().toLowerCase();
  if (q) {
    for (const p of state.pages) {
      if (p.src < 0) continue;
      const runs = await getRuns(p);
      for (const r of runs) if (r.str.toLowerCase().includes(q)) state.find.hits.push({ pageId: p.id, run: r });
    }
    if (state.find.hits.length) state.find.idx = 0;
  }
  els.forEach(drawFind);
  gotoHit();
  emit('find');
}
export function findStep(dir) {
  const f = state.find;
  if (!f.hits.length) return;
  f.idx = (f.idx + dir + f.hits.length) % f.hits.length;
  els.forEach(drawFind);
  gotoHit();
  emit('find');
}
function drawFind(e) {
  const s = scale();
  const f = state.find;
  e.L.find.replaceChildren(
    ...f.hits.map((h, i) => ({ h, i })).filter(({ h }) => h.pageId === e.id).map(({ h, i }) => {
      const d = div('hit' + (i === f.idx ? ' cur' : ''));
      Object.assign(d.style, { left: (h.run.x - 1) * s + 'px', top: h.run.cy * s + 'px', width: (h.run.w + 2) * s + 'px', height: h.run.ch * s + 'px' });
      return d;
    })
  );
}
function gotoHit() {
  const h = state.find.hits[state.find.idx];
  if (!h) return;
  els.get(h.pageId)?.L.find.querySelector('.hit.cur')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ------------------------------------------------------------ form fields */

async function loadWidgets(e, p) {
  const tok = ++e.wTok;
  let list = [];
  try { list = await getWidgets(p); } catch { /* ignore */ }
  if (tok !== e.wTok) return;
  e.wlist = list;
  drawWidgets(e);
}

let cpOpen = false;
function setField(key, val, fresh) {
  if (fresh || !cpOpen) {
    checkpoint();
    cpOpen = !fresh;
  }
  state.fields[key] = val;
  emit('items');
}

export function drawWidgets(e) {
  const s = scale();
  e.L.widgets.replaceChildren(
    ...e.wlist.map((w) => {
      const val = w.key in state.fields ? state.fields[w.key] : w.initial;
      const box = div('widget w-' + w.kind);
      Object.assign(box.style, { left: w.x * s + 'px', top: w.y * s + 'px', width: w.w * s + 'px', height: w.h * s + 'px' });
      let inp;
      if (w.kind === 'text') {
        inp = document.createElement(w.multiline ? 'textarea' : 'input');
        inp.value = val;
        if (w.maxLen) inp.maxLength = w.maxLen;
        inp.style.fontSize = widgetFontSize(w) * s + 'px';
        inp.addEventListener('input', () => setField(w.key, inp.value, false));
        inp.addEventListener('blur', () => (cpOpen = false));
      } else if (w.kind === 'check') {
        inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.checked = !!val;
        inp.addEventListener('change', () => setField(w.key, inp.checked, true));
      } else if (w.kind === 'radio') {
        inp = document.createElement('input');
        inp.type = 'radio';
        inp.checked = val === w.buttonValue;
        inp.addEventListener('change', () => {
          setField(w.key, w.buttonValue, true);
          els.forEach(drawWidgets);
        });
      } else {
        inp = document.createElement('select');
        for (const o of w.options) {
          const op = document.createElement('option');
          op.value = o.value;
          op.textContent = o.label;
          inp.appendChild(op);
        }
        inp.value = val;
        inp.style.fontSize = widgetFontSize(w) * s + 'px';
        inp.addEventListener('change', () => setField(w.key, inp.value, true));
      }
      inp.disabled = w.readOnly;
      box.appendChild(inp);
      return box;
    })
  );
}

/* ----------------------------------------------------------- scroll / zoom */

export function setZoom(z) {
  z = clamp(z, 0.25, 4);
  if (Math.abs(z - state.zoom) < 1e-4) return;
  const ratio = viewer.scrollHeight ? (viewer.scrollTop + viewer.clientHeight / 2) / viewer.scrollHeight : 0;
  state.zoom = z;
  syncPages();
  viewer.scrollTop = ratio * viewer.scrollHeight - viewer.clientHeight / 2;
  emit('zoom');
}
export function fitWidth() {
  const p = currentPage();
  if (!p) return;
  const [W] = dims(p);
  setZoom((viewer.clientWidth - 64) / (W * PX));
}
export function scrollToPage(i) {
  const p = state.pages[i];
  if (!p) return;
  els.get(p.id)?.root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  if (state.cur !== i) {
    state.cur = i;
    emit('cur');
  }
}

function updateCurrent() {
  const vr = viewer.getBoundingClientRect();
  const y = vr.top + vr.height * 0.35;
  let idx = 0;
  state.pages.forEach((p, i) => {
    const r = els.get(p.id)?.root.getBoundingClientRect();
    if (r && r.top <= y) idx = i;
  });
  if (idx !== state.cur) {
    state.cur = idx;
    emit('cur');
  }
}

export function initView() {
  let raf = 0;
  viewer.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(updateCurrent);
  });
  viewer.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      setZoom(state.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
    },
    { passive: false }
  );
  on('structure', syncPages);
  on('items', () => {});
}
