// Properties panel: edits the selected item, or the defaults for the next one.
import { state, on, checkpoint } from './state.js';
import { selItem, refreshPage } from './view.js';

const panel = document.getElementById('props');

const CTRL = {
  color: { label: 'Text colour', type: 'color' },
  font: { label: 'Font', type: 'select', options: [['sans', 'Sans (Helvetica)'], ['serif', 'Serif (Times)'], ['mono', 'Mono (Courier)']] },
  size: { label: 'Size (pt)', type: 'number', min: 4, max: 400, step: 1 },
  bold: { label: 'Bold', type: 'check' },
  italic: { label: 'Italic', type: 'check' },
  stroke: { label: 'Line colour', type: 'color' },
  fill: { label: 'Fill', type: 'fill' },
  sw: { label: 'Line width', type: 'range', min: 0.5, max: 16, step: 0.5 },
  opacity: { label: 'Opacity', type: 'range', min: 0.1, max: 1, step: 0.05 },
  hl: { label: 'Highlight colour', type: 'color' },
};

function context() {
  const it = selItem();
  const t = it ? it.type : state.tool;
  switch (t) {
    case 'text': case 'edittext': return { title: 'Text', props: ['color', 'font', 'size', 'bold', 'italic', 'opacity'] };
    case 'rect': return it?.whiteout ? { title: 'Cover', props: ['fill'] } : { title: 'Rectangle', props: ['stroke', 'fill', 'sw', 'opacity'] };
    case 'ellipse': return { title: 'Ellipse', props: ['stroke', 'fill', 'sw', 'opacity'] };
    case 'line': case 'arrow': case 'pen': return { title: t === 'pen' ? 'Pen' : t === 'line' ? 'Line' : 'Arrow', props: ['stroke', 'sw', 'opacity'] };
    case 'highlight': return { title: 'Highlight', props: ['hl'] };
    case 'image': return { title: 'Image / signature', props: ['opacity'] };
    case 'whiteout': return { title: 'Whiteout', props: [] };
    case 'redact': return { title: 'Redact', props: [] };
    default: return null;
  }
}

const itemKey = (it, prop) => (prop === 'hl' ? 'fill' : prop);

function valueOf(prop, it) {
  if (it) {
    const v = it[itemKey(it, prop)];
    if (v !== undefined) return v;
  }
  return state.style[prop];
}

function render() {
  const ctx = context();
  if (!ctx) {
    panel.innerHTML = '<div class="muted pad">Select an object or pick a tool to see its options.<br><br>Tip: double-click text to edit it. Use <b>Edit text</b> to change the text that is already in the PDF.</div>';
    return;
  }
  const it = selItem();
  let html = `<h4>${ctx.title}</h4>`;
  if (state.tool === 'redact' && !it) html += '<p class="muted pad0">Drag over content to black it out. On save, the page is flattened so the hidden text is truly removed.</p>';
  if (state.tool === 'edittext' && !it) html += '<p class="muted pad0">Click any text on the page to replace it.</p>';
  for (const prop of ctx.props) {
    const c = CTRL[prop];
    const v = valueOf(prop, it);
    html += `<label class="prow"><span>${c.label}</span>`;
    if (c.type === 'color') html += `<input type="color" data-prop="${prop}" value="${v || '#000000'}">`;
    else if (c.type === 'number') html += `<input type="number" data-prop="${prop}" min="${c.min}" max="${c.max}" step="${c.step}" value="${Math.round(v * 10) / 10}">`;
    else if (c.type === 'range') html += `<input type="range" data-prop="${prop}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}">`;
    else if (c.type === 'check') html += `<input type="checkbox" data-prop="${prop}" ${v ? 'checked' : ''}>`;
    else if (c.type === 'select') html += `<select data-prop="${prop}">${c.options.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    else if (c.type === 'fill') html += `<span class="fillrow"><input type="color" data-prop="fill" value="${v || '#ffffff'}"><label><input type="checkbox" data-prop="fillnone" ${v ? '' : 'checked'}> none</label></span>`;
    html += '</label>';
  }
  if (it) html += '<div class="prow acts"><button data-act="dup">Duplicate</button><button data-act="del" class="danger">Delete</button></div>';
  panel.innerHTML = html;
}

let open = false;
function apply(prop, val) {
  const it = selItem();
  if (!open) {
    if (it) checkpoint();
    open = true;
  }
  state.style[prop] = val;
  if (it) {
    it[itemKey(it, prop)] = val;
    if (prop === 'size' && it.type !== 'text') delete it.size;
    refreshPage(state.sel.pageId);
  }
}

panel.addEventListener('input', (ev) => {
  const t = ev.target;
  const prop = t.dataset.prop;
  if (!prop) return;
  if (prop === 'fillnone') {
    const colorEl = panel.querySelector('[data-prop=fill]');
    apply('fill', t.checked ? '' : colorEl.value);
    return;
  }
  let v = t.type === 'checkbox' ? t.checked : t.type === 'number' || t.type === 'range' ? parseFloat(t.value) : t.value;
  if (Number.isNaN(v)) return;
  if (prop === 'fill') panel.querySelector('[data-prop=fillnone]').checked = false;
  apply(prop, v);
});
panel.addEventListener('change', () => (open = false));
panel.addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-act]');
  if (!a) return;
  import('./view.js').then((m) => (a.dataset.act === 'del' ? m.deleteSel() : m.duplicateSel()));
});

export function initProps() {
  on('select', render);
  on('tool', render);
  render();
}
