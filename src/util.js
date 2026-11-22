import { fontCss } from './fonts.js';

export const PX = 96 / 72; // css px per PDF point at 100% zoom

// Size of the page as displayed (user rotation applied)
export const dims = (p) => (p.rot % 180 ? [p.bh, p.bw] : [p.bw, p.bh]);

export function hexToRgb01(hex) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

let _ctx;
export function textMetrics(it) {
  _ctx ||= document.createElement('canvas').getContext('2d');
  _ctx.font = `${it.italic ? 'italic ' : ''}${it.bold ? '700 ' : '400 '}${it.size}px ${fontCss(it.font)}`;
  const lines = (it.text || '').split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, _ctx.measureText(l).width);
  return { w: Math.max(w, it.size * 0.5), h: lines.length * it.size * 1.2 };
}

export function bboxOf(it) {
  if (it.type === 'text') {
    const m = textMetrics(it);
    return { x: it.x, y: it.y, w: m.w, h: m.h };
  }
  if (it.pts) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of it.pts) {
      x1 = Math.min(x1, x); y1 = Math.min(y1, y);
      x2 = Math.max(x2, x); y2 = Math.max(y2, y);
    }
    return { x: x1, y: y1, w: Math.max(x2 - x1, 1), h: Math.max(y2 - y1, 1) };
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

// Triangle (tip, left, right) for an arrow head at point b pointing away from a
export function arrowHead(a, b, sw) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const L = Math.max(9, sw * 4.5);
  const sp = 0.45;
  return [
    b,
    [b[0] - L * Math.cos(ang - sp), b[1] - L * Math.sin(ang - sp)],
    [b[0] - L * Math.cos(ang + sp), b[1] - L * Math.sin(ang + sp)],
  ];
}

// base space -> displayed space (user rotation), and back
export function rotFwd(p, x, y) {
  switch (p.rot) {
    case 90: return [p.bh - y, x];
    case 180: return [p.bw - x, p.bh - y];
    case 270: return [y, p.bw - x];
    default: return [x, y];
  }
}
export function rotInv(p, dx, dy) {
  switch (p.rot) {
    case 90: return [dy, p.bh - dx];
    case 180: return [p.bw - dx, p.bh - dy];
    case 270: return [p.bw - dy, dx];
    default: return [dx, dy];
  }
}
export function overlayTransform(p, s) {
  switch (p.rot) {
    case 90: return `translate(${p.bh * s}px,0) rotate(90deg)`;
    case 180: return `translate(${p.bw * s}px,${p.bh * s}px) rotate(180deg)`;
    case 270: return `translate(0,${p.bw * s}px) rotate(270deg)`;
    default: return 'none';
  }
}

export function widgetFontSize(w) {
  return w.multiline ? 11 : Math.max(6, Math.min(12, w.h * 0.72));
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

// "1-3, 5" -> [0, 1, 2, 4] (zero-based page indices)
export function parseRange(str, total) {
  const set = new Set();
  for (const part of str.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= total) set.add(i - 1);
  }
  return [...set].sort((a, b) => a - b);
}

export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
