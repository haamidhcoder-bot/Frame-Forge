'use strict';
/* FrameForge – Figma-style layout editor (vanilla JS front end) */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => 'e' + Math.random().toString(36).slice(2, 9);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round(n * 100) / 100;

const viewport = $('#viewport'), world = $('#world'), overlay = $('#overlay');
const propsEl = $('#props'), layersEl = $('#layers');

const S = {
  id: null, name: 'Untitled design', els: [], sel: [], tool: 'move',
  view: { x: 120, y: 90, z: 0.5 }, hist: [], hi: -1, dirty: false, clip: null,
};
let drag = null, guides = [], hover = null, editing = null, spaceDown = false, saveTimer = null;

/* ------------------------------------------------------------------ model */
const DEFAULTS = {
  frame:  { w: 1440, h: 900, fill: '#ffffff', clip: true, name: 'Frame' },
  rect:   { w: 160, h: 100, fill: '#d9d9d9', name: 'Rectangle' },
  ellipse:{ w: 120, h: 120, fill: '#d9d9d9', name: 'Ellipse' },
  text:   { w: 200, h: 32, fill: 'transparent', text: 'Text', fontSize: 20, color: '#111111', name: 'Text' },
  button: { w: 160, h: 48, fill: '#2563eb', color: '#ffffff', radius: 8, text: 'Button', fontSize: 16, fontWeight: 600, align: 'center', name: 'Button' },
  image:  { w: 240, h: 160, fill: '#e5e7eb', name: 'Image' },
};
const ICON = { frame: '#', rect: '▭', ellipse: '◯', text: 'T', button: '▣', image: '▨' };
const FONT_OPTS = ['Inter', 'Georgia', 'Mono'];
const NUMERIC = new Set(['x', 'y', 'w', 'h', 'radius', 'strokeW', 'fontSize', 'fontWeight', 'opacity']);

function mk(type, over = {}) {
  const d = DEFAULTS[type];
  const n = S.els.filter(e => e.type === type).length + 1;
  return Object.assign({
    id: uid(), type, name: `${d.name} ${n}`, x: 0, y: 0, w: d.w, h: d.h, parent: null,
    fill: d.fill || 'transparent', stroke: '#000000', strokeW: 0, radius: d.radius || 0,
    opacity: 1, shadow: false, clip: !!d.clip, visible: true, locked: false,
    text: d.text || '', fontSize: d.fontSize || 16, fontWeight: d.fontWeight || 400,
    color: d.color || '#111111', align: d.align || 'left', font: 'Inter', url: '',
  }, over);
}
const get = id => S.els.find(e => e.id === id);
const kids = id => S.els.filter(e => e.parent === id);
const nodeOf = id => world.querySelector(`[data-id="${id}"]`);
function descendants(id) { const out = []; kids(id).forEach(k => { out.push(k.id, ...descendants(k.id)); }); return out; }
function absPos(e) {
  let x = e.x, y = e.y, p = e.parent && get(e.parent);
  while (p) { x += p.x; y += p.y; p = p.parent && get(p.parent); }
  return { x, y };
}
function depth(e) { let d = 0, p = e.parent && get(e.parent); while (p) { d++; p = p.parent && get(p.parent); } return d; }
function frameAt(pt, exclude = new Set()) {
  let best = null, bd = -1;
  S.els.forEach(f => {
    if (f.type !== 'frame' || exclude.has(f.id) || !f.visible) return;
    const a = absPos(f);
    if (pt.x >= a.x && pt.x <= a.x + f.w && pt.y >= a.y && pt.y <= a.y + f.h) {
      const d = depth(f); if (d >= bd) { best = f; bd = d; }
    }
  });
  return best;
}
function topmost(ids) {
  return ids.filter(id => { let p = get(id).parent; while (p) { if (ids.includes(p)) return false; p = get(p).parent; } return true; });
}
function pickable(id) { let e = get(id); while (e && e.locked) e = e.parent ? get(e.parent) : null; return e ? e.id : null; }

/* ---------------------------------------------------------------- history */
function commit() {
  const s = JSON.stringify(S.els);
  if (S.hist[S.hi] === s) return;
  S.hist = S.hist.slice(0, S.hi + 1); S.hist.push(s);
  if (S.hist.length > 100) S.hist.shift();
  S.hi = S.hist.length - 1;
  markDirty(); updateUndoButtons();
}
function undo() { if (S.hi > 0) { S.hi--; restore(); } }
function redo() { if (S.hi < S.hist.length - 1) { S.hi++; restore(); } }
function restore() {
  S.els = JSON.parse(S.hist[S.hi]); S.sel = S.sel.filter(id => get(id));
  render(); markDirty(); updateUndoButtons();
}
function updateUndoButtons() {
  $('[data-cmd=undo]').disabled = S.hi <= 0;
  $('[data-cmd=redo]').disabled = S.hi >= S.hist.length - 1;
}

/* --------------------------------------------------------------- rendering */
function applyStyle(d, e) {
  const s = d.style;
  s.left = e.x + 'px'; s.top = e.y + 'px'; s.width = e.w + 'px'; s.height = e.h + 'px';
  s.backgroundColor = e.type === 'text' ? 'transparent' : e.fill;
  s.border = e.strokeW > 0 ? `${e.strokeW}px solid ${e.stroke}` : 'none';
  s.borderRadius = e.type === 'ellipse' ? '50%' : e.radius + 'px';
  s.opacity = e.opacity;
  s.boxShadow = e.shadow ? '0 8px 24px rgba(0,0,0,.25)' : 'none';
  s.display = e.visible ? '' : 'none';
  s.overflow = e.type === 'frame' && e.clip ? 'hidden' : 'visible';
  if (e.type === 'text' || e.type === 'button') {
    s.fontFamily = { Inter: "Inter, system-ui, sans-serif", Georgia: "Georgia, serif", Mono: "ui-monospace, Menlo, monospace" }[e.font] || 'Inter, sans-serif';
    s.fontSize = e.fontSize + 'px'; s.fontWeight = e.fontWeight; s.color = e.color;
    if (e.type === 'text') s.textAlign = e.align;
    else s.justifyContent = { left: 'flex-start', center: 'center', right: 'flex-end' }[e.align] || 'center';
    if (!d.isContentEditable && d.textContent !== e.text) d.textContent = e.text;
  }
  if (e.type === 'image') {
    s.backgroundImage = e.url ? `url("${e.url.replace(/"/g, '%22')}")` : '';
    s.backgroundSize = 'cover'; s.backgroundPosition = 'center';
    d.classList.toggle('empty', !e.url);
  }
}
function buildNode(e) {
  const d = document.createElement('div');
  d.className = 'el t-' + e.type; d.dataset.id = e.id;
  applyStyle(d, e);
  kids(e.id).forEach(c => d.appendChild(buildNode(c)));
  return d;
}
function render() {
  world.replaceChildren(...S.els.filter(e => !e.parent).map(buildNode));
  renderLayers(); renderProps(); renderOverlay();
}
function setSel(ids) { S.sel = ids; renderLayers(); renderProps(); renderOverlay(); }

function applyView() {
  const v = S.view;
  world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
  viewport.style.setProperty('--inv', 1 / v.z);
  viewport.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
  viewport.style.backgroundPosition = `${v.x}px ${v.y}px`;
  $('#zoomLabel').textContent = Math.round(v.z * 100) + '%';
  renderOverlay();
}
const toWorld = ev => {
  const r = viewport.getBoundingClientRect();
  return { x: (ev.clientX - r.left - S.view.x) / S.view.z, y: (ev.clientY - r.top - S.view.y) / S.view.z };
};
function zoomAt(factor, cx, cy) {
  const v = S.view, nz = Math.min(4, Math.max(0.05, v.z * factor));
  v.x = cx - (cx - v.x) * nz / v.z; v.y = cy - (cy - v.y) * nz / v.z; v.z = nz; applyView();
}
function zoomCenter(f) { const r = viewport.getBoundingClientRect(); zoomAt(f, r.width / 2, r.height / 2); }
function fit() {
  const roots = S.els.filter(e => !e.parent);
  if (!roots.length) { S.view = { x: 200, y: 100, z: 1 }; return applyView(); }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  roots.forEach(e => { x1 = Math.min(x1, e.x); y1 = Math.min(y1, e.y); x2 = Math.max(x2, e.x + e.w); y2 = Math.max(y2, e.y + e.h); });
  const r = viewport.getBoundingClientRect(), pad = 80;
  const z = Math.min(2, Math.max(0.05, Math.min((r.width - pad * 2) / (x2 - x1), (r.height - pad * 2) / (y2 - y1))));
  S.view.z = z; S.view.x = (r.width - (x2 - x1) * z) / 2 - x1 * z; S.view.y = (r.height - (y2 - y1) * z) / 2 - y1 * z;
  applyView();
}

/* ---------------------------------------------------------------- overlay */
const HANDLES = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };
function renderOverlay() {
  overlay.innerHTML = '';
  const vr = viewport.getBoundingClientRect();
  const add = (cls, css, parent = overlay) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, css); parent.appendChild(d); return d; };

  S.els.filter(e => e.type === 'frame' && !e.parent && e.visible).forEach(e => {
    const n = nodeOf(e.id); if (!n) return;
    const r = n.getBoundingClientRect();
    const l = add('flabel' + (S.sel.includes(e.id) ? ' sel' : ''), { left: (r.left - vr.left) + 'px', top: (r.top - vr.top - 20) + 'px', maxWidth: Math.max(40, r.width) + 'px' });
    l.textContent = e.name; l.dataset.label = e.id;
  });

  if (hover && !S.sel.includes(hover) && !drag) {
    const n = nodeOf(hover);
    if (n) { const r = n.getBoundingClientRect(); add('hoverbox', { left: r.left - vr.left + 'px', top: r.top - vr.top + 'px', width: r.width + 'px', height: r.height + 'px' }); }
  }

  S.sel.forEach(id => {
    const n = nodeOf(id), e = get(id); if (!n || !e || !e.visible) return;
    const r = n.getBoundingClientRect();
    const b = add('selbox', { left: r.left - vr.left + 'px', top: r.top - vr.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    if (S.sel.length === 1 && !e.locked) {
      Object.entries(HANDLES).forEach(([k, [px, py]]) => { const h = add('h', { left: px + '%', top: py + '%' }, b); h.dataset.h = k; });
      add('dim', {}, b).textContent = `${Math.round(e.w)} × ${Math.round(e.h)}`;
    }
  });

  guides.forEach(g => {
    const z = S.view.z, v = S.view;
    if (g.v) add('guide', { left: g.pos * z + v.x + 'px', top: g.a * z + v.y + 'px', width: '1px', height: (g.b - g.a) * z + 'px' });
    else add('guide', { top: g.pos * z + v.y + 'px', left: g.a * z + v.x + 'px', height: '1px', width: (g.b - g.a) * z + 'px' });
  });
}

/* ----------------------------------------------------------------- layers */
function renderLayers() {
  layersEl.innerHTML = '';
  if (!S.els.length) { layersEl.innerHTML = '<div class="empty">No layers yet.<br>Pick the <b>Frame</b> tool (<kbd>F</kbd>) and drag on the canvas.</div>'; return; }
  const walk = (parent, dep) => {
    S.els.filter(e => e.parent === parent).reverse().forEach(e => {
      const row = document.createElement('div');
      row.className = 'lrow' + (S.sel.includes(e.id) ? ' sel' : '') + (e.visible ? '' : ' off');
      row.style.paddingLeft = 8 + dep * 14 + 'px'; row.dataset.id = e.id;
      row.innerHTML = `<span class="ico">${ICON[e.type]}</span><span class="lname"></span>` +
        `<button class="lbtn ${e.locked ? 'on' : ''}" data-act="lock" title="Lock">${e.locked ? '🔒' : '🔓'}</button>` +
        `<button class="lbtn ${e.visible ? '' : 'on'}" data-act="vis" title="Show/hide">${e.visible ? '👁' : '—'}</button>`;
      $('.lname', row).textContent = e.name;
      layersEl.appendChild(row);
      walk(e.id, dep + 1);
    });
  };
  walk(null, 0);
}
layersEl.addEventListener('click', ev => {
  const row = ev.target.closest('.lrow'); if (!row) return;
  const id = row.dataset.id, act = ev.target.dataset.act, e = get(id);
  if (act === 'lock') { e.locked = !e.locked; commit(); return renderLayers(), renderOverlay(); }
  if (act === 'vis') { e.visible = !e.visible; commit(); return render(); }
  if (ev.shiftKey) setSel(S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel, id]); else setSel([id]);
});
layersEl.addEventListener('dblclick', ev => {
  const row = ev.target.closest('.lrow'); if (!row || !ev.target.classList.contains('lname')) return;
  const e = get(row.dataset.id), inp = document.createElement('input');
  inp.className = 'rename'; inp.value = e.name; ev.target.replaceWith(inp); inp.focus(); inp.select();
  const done = ok => { if (ok && inp.value.trim()) { e.name = inp.value.trim(); commit(); } renderLayers(); renderOverlay(); syncProps(); };
  inp.addEventListener('keydown', k => { if (k.key === 'Enter') done(true); if (k.key === 'Escape') done(false); });
  inp.addEventListener('blur', () => done(true));
});

/* ------------------------------------------------------------- properties */
const field = (label, k, o = {}) => `<label class="f"><span>${label}</span><input type="number" data-k="${k}" step="${o.step || 1}"${o.min !== undefined ? ` min="${o.min}"` : ''}></label>`;
const colorRow = (label, k) => `<div class="crow"><span>${label}</span><input type="color" data-k="${k}"><input type="text" data-k="${k}" spellcheck="false"></div>`;

function renderProps() {
  if (!S.sel.length) {
    propsEl.innerHTML = `<div class="empty"><b>Nothing selected</b><br><br>
      <kbd>F</kbd> Frame &nbsp; <kbd>R</kbd> Rectangle &nbsp; <kbd>O</kbd> Ellipse<br>
      <kbd>T</kbd> Text &nbsp; <kbd>B</kbd> Button &nbsp; <kbd>I</kbd> Image<br><br>
      <kbd>Space</kbd>+drag to pan · <kbd>Ctrl</kbd>+scroll to zoom<br>
      <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>Del</kbd> delete<br>
      Arrow keys nudge (<kbd>Shift</kbd> = 10px)</div>`;
    return;
  }
  const e = get(S.sel[0]), t = e.type, multi = S.sel.length > 1;
  const isText = t === 'text', hasTextual = isText || t === 'button';
  let h = '';
  h += `<div class="sec"><h4>${multi ? S.sel.length + ' layers' : esc(e.name)}</h4><div class="btnrow">
    <button class="mini" data-act="front" title="Bring to front (Ctrl+])">⤒</button>
    <button class="mini" data-act="forward" title="Forward (])">↑</button>
    <button class="mini" data-act="backward" title="Backward ([)">↓</button>
    <button class="mini" data-act="back" title="Send to back (Ctrl+[)">⤓</button>
    <button class="mini" data-act="dup" title="Duplicate (Ctrl+D)">⧉</button>
    <button class="mini" data-act="del" title="Delete">🗑</button></div></div>`;
  h += `<div class="sec"><h4>Position</h4><div class="grid2">${field('X', 'x')}${field('Y', 'y')}${field('W', 'w', { min: 1 })}${field('H', 'h', { min: 1 })}</div>`;
  if (t === 'frame' && !multi) h += `<div style="margin-top:8px"><label class="f"><span style="width:42px">Size</span><select id="preset">
      <option value="">Preset…</option><option value="1440x900">Desktop 1440×900</option>
      <option value="1024x768">Laptop 1024×768</option><option value="768x1024">Tablet 768×1024</option>
      <option value="375x812">Mobile 375×812</option></select></label></div>`;
  if (e.parent) h += `<div class="btnrow" style="margin-top:8px">
    <button class="mini" data-act="al-left" title="Align left">⇤</button><button class="mini" data-act="al-hc" title="Center horizontally">↔</button>
    <button class="mini" data-act="al-right" title="Align right">⇥</button><button class="mini" data-act="al-top" title="Align top">⤒</button>
    <button class="mini" data-act="al-vc" title="Center vertically">↕</button><button class="mini" data-act="al-bottom" title="Align bottom">⤓</button></div>`;
  h += `</div>`;

  if (hasTextual) {
    h += `<div class="sec"><h4>Text</h4><textarea class="ta" data-k="text" spellcheck="false"></textarea>
      <div class="grid2" style="margin-top:6px">${field('Sz', 'fontSize', { min: 1 })}
      <label class="f"><span>Wt</span><select data-k="fontWeight"><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option></select></label></div>
      <div class="grid2" style="margin-top:6px">
      <label class="f"><span>Aa</span><select data-k="font">${FONT_OPTS.map(f => `<option>${f}</option>`).join('')}</select></label>
      <label class="f"><span>⇔</span><select data-k="align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></div>
      <div style="margin-top:8px">${colorRow('Color', 'color')}</div></div>`;
  }
  if (t === 'image') h += `<div class="sec"><h4>Image</h4><input class="url" data-k="url" placeholder="https://… image URL" spellcheck="false"></div>`;

  h += `<div class="sec"><h4>Appearance</h4>`;
  if (!isText) h += colorRow('Fill', 'fill') + `<div class="btnrow" style="margin-bottom:8px"><button class="mini" data-act="nofill">No fill</button></div>`;
  h += `<div class="grid2">${t === 'ellipse' ? '' : field('◜', 'radius', { min: 0 })}</div>
    <div style="margin-top:8px"><div style="color:var(--muted);margin-bottom:2px">Opacity</div><input type="range" data-k="opacity" min="0" max="100"></div>
    <label class="chk"><input type="checkbox" data-k="shadow"> Drop shadow</label>`;
  if (t === 'frame') h += `<label class="chk"><input type="checkbox" data-k="clip"> Clip content</label>`;
  h += `</div>`;
  if (!isText) h += `<div class="sec"><h4>Stroke</h4>${colorRow('Color', 'stroke')}<div class="grid2">${field('W', 'strokeW', { min: 0, step: 1 })}</div></div>`;
  propsEl.innerHTML = h;
  syncProps();
}

function syncProps() {
  if (!S.sel.length) return;
  const e = get(S.sel[0]); if (!e) return;
  $$('[data-k]', propsEl).forEach(n => {
    if (n === document.activeElement) return;
    const k = n.dataset.k; let v = e[k];
    if (k === 'opacity') v = Math.round(e.opacity * 100);
    if (n.type === 'checkbox') n.checked = !!v;
    else if (n.type === 'color') n.value = /^#[0-9a-f]{6}$/i.test(v) ? v : '#ffffff';
    else n.value = typeof v === 'number' ? r2(v) : (v ?? '');
  });
}
function applyProp(k, v) {
  S.sel.forEach(id => {
    const e = get(id); if (!e) return;
    if (k === 'opacity') e.opacity = Math.min(1, Math.max(0, v / 100));
    else if (k === 'w' || k === 'h') e[k] = Math.max(1, v);
    else e[k] = v;
    const n = nodeOf(id); if (n) applyStyle(n, e);
  });
  renderOverlay();
}
propsEl.addEventListener('input', ev => {
  const t = ev.target, k = t.dataset.k; if (!k) return;
  let v;
  if (t.type === 'checkbox') v = t.checked;
  else if (NUMERIC.has(k)) { v = parseFloat(t.value); if (isNaN(v)) return; }
  else v = t.value;
  if ((k === 'fill' || k === 'stroke' || k === 'color') && t.type === 'text' && !/^(#[0-9a-f]{3}|#[0-9a-f]{6}|transparent)$/i.test(v.trim())) return;
  applyProp(k, typeof v === 'string' ? v.trim() === v ? v : v.trim() : v);
  if (t.type === 'color') { const txt = $(`input[type=text][data-k="${k}"]`, propsEl); if (txt) txt.value = v; }
});
propsEl.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'preset') {
    if (!t.value) return;
    const [w, h] = t.value.split('x').map(Number);
    applyProp('w', w); applyProp('h', h); t.value = '';
  }
  commit(); syncProps();
});
propsEl.addEventListener('click', ev => {
  const act = ev.target.closest('[data-act]')?.dataset.act; if (!act) return;
  if (act === 'nofill') { applyProp('fill', 'transparent'); commit(); syncProps(); }
  else if (['front', 'forward', 'backward', 'back'].includes(act)) reorder(act);
  else if (act === 'dup') duplicate();
  else if (act === 'del') removeSel();
  else if (act.startsWith('al-')) align(act.slice(3));
});
function align(dir) {
  S.sel.forEach(id => {
    const e = get(id), p = e.parent && get(e.parent); if (!p) return;
    if (dir === 'left') e.x = 0; if (dir === 'right') e.x = p.w - e.w; if (dir === 'hc') e.x = Math.round((p.w - e.w) / 2);
    if (dir === 'top') e.y = 0; if (dir === 'bottom') e.y = p.h - e.h; if (dir === 'vc') e.y = Math.round((p.h - e.h) / 2);
    const n = nodeOf(id); if (n) applyStyle(n, e);
  });
  commit(); renderOverlay(); syncProps();
}

/* ------------------------------------------------------------ editing ops */
function reorder(mode) {
  S.sel.forEach(id => {
    const e = get(id), sibs = S.els.filter(o => o.parent === e.parent), i = sibs.indexOf(e);
    let ref, after;
    if (mode === 'front') { ref = sibs[sibs.length - 1]; after = true; }
    else if (mode === 'back') { ref = sibs[0]; after = false; }
    else if (mode === 'forward') { ref = sibs[i + 1]; after = true; }
    else { ref = sibs[i - 1]; after = false; }
    if (!ref || ref === e) return;
    S.els.splice(S.els.indexOf(e), 1);
    const ri = S.els.indexOf(ref); S.els.splice(after ? ri + 1 : ri, 0, e);
  });
  commit(); render();
}
function removeSel() {
  if (!S.sel.length) return;
  const rm = new Set();
  S.sel.forEach(id => { rm.add(id); descendants(id).forEach(d => rm.add(d)); });
  S.els = S.els.filter(e => !rm.has(e.id)); S.sel = [];
  commit(); render();
}
function collectTree(ids) {
  const nodes = [];
  topmost(ids).forEach(id => { nodes.push(get(id), ...descendants(id).map(get)); });
  return JSON.parse(JSON.stringify(nodes));
}
function pasteNodes(nodes, offset = 20) {
  const map = {}; nodes.forEach(n => map[n.id] = uid());
  const tops = [];
  nodes.forEach(n => {
    const c = JSON.parse(JSON.stringify(n)), top = !(n.parent in map);
    c.id = map[n.id];
    if (top) { c.parent = get(n.parent) ? n.parent : null; c.x += offset; c.y += offset; tops.push(c.id); }
    else c.parent = map[n.parent];
    S.els.push(c);
  });
  S.sel = tops; commit(); render();
}
function duplicate() { if (S.sel.length) pasteNodes(collectTree(S.sel)); }

/* ------------------------------------------------------------ text editing */
function startEdit(id) {
  const e = get(id), n = nodeOf(id);
  if (!n || !e || (e.type !== 'text' && e.type !== 'button')) return;
  editing = id; n.contentEditable = 'true'; n.classList.add('editing'); n.focus();
  document.getSelection().selectAllChildren(n);
  const done = () => {
    n.removeEventListener('blur', done);
    n.contentEditable = 'false'; n.classList.remove('editing'); editing = null;
    e.text = n.innerText.replace(/\n$/, '');
    if (e.type === 'text') e.h = Math.max(e.h, Math.ceil(n.scrollHeight));
    commit(); render();
  };
  n.addEventListener('blur', done);
  n.addEventListener('keydown', k => { if (k.key === 'Escape' || (k.key === 'Enter' && (k.ctrlKey || k.metaKey))) { k.preventDefault(); n.blur(); } k.stopPropagation(); });
}

/* ---------------------------------------------------------------- snapping */
function snap(e, nx, ny) {
  const par = e.parent ? get(e.parent) : null, pa = par ? absPos(par) : { x: 0, y: 0 };
  const th = 6 / S.view.z, rects = [];
  S.els.forEach(o => { if (o.id !== e.id && o.parent === e.parent && o.visible) { const a = absPos(o); rects.push({ x: a.x, y: a.y, w: o.w, h: o.h }); } });
  if (par) rects.push({ x: pa.x, y: pa.y, w: par.w, h: par.h });
  const ax = pa.x + nx, ay = pa.y + ny;
  const mx = [ax, ax + e.w / 2, ax + e.w], my = [ay, ay + e.h / 2, ay + e.h];
  let bx = null, by = null;
  rects.forEach(r => {
    [r.x, r.x + r.w / 2, r.x + r.w].forEach(t => mx.forEach(m => { const d = t - m; if (Math.abs(d) < th && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, t, r }; }));
    [r.y, r.y + r.h / 2, r.y + r.h].forEach(t => my.forEach(m => { const d = t - m; if (Math.abs(d) < th && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, t, r }; }));
  });
  const fx = bx ? nx + bx.d : nx, fy = by ? ny + by.d : ny, g = [];
  const fax = pa.x + fx, fay = pa.y + fy;
  if (bx) g.push({ v: true, pos: bx.t, a: Math.min(fay, bx.r.y), b: Math.max(fay + e.h, bx.r.y + bx.r.h) });
  if (by) g.push({ v: false, pos: by.t, a: Math.min(fax, by.r.x), b: Math.max(fax + e.w, by.r.x + by.r.w) });
  return { x: fx, y: fy, guides: g };
}

/* ------------------------------------------------------------- interaction */
const CREATE_TOOLS = ['frame', 'rect', 'ellipse', 'text', 'button', 'image'];
function setTool(t) {
  S.tool = t;
  $$('#toolbar button').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  viewport.classList.toggle('hand', t === 'hand');
  viewport.classList.toggle('create', CREATE_TOOLS.includes(t));
}
$('#toolbar').addEventListener('click', ev => { const b = ev.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
$('.zoombar').addEventListener('click', ev => {
  const z = ev.target.closest('[data-zoom]')?.dataset.zoom;
  if (z === 'in') zoomCenter(1.25); else if (z === 'out') zoomCenter(0.8); else if (z === 'fit') fit();
});

viewport.addEventListener('wheel', ev => {
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey) {
    const r = viewport.getBoundingClientRect();
    zoomAt(Math.exp(-ev.deltaY * 0.01), ev.clientX - r.left, ev.clientY - r.top);
  } else { S.view.x -= ev.deltaX; S.view.y -= ev.deltaY; applyView(); }
}, { passive: false });

viewport.addEventListener('mousedown', ev => {
  if (editing) {
    const hit = ev.target.closest('.el');
    if (hit && hit.dataset.id === editing) return;
    document.activeElement.blur();
  }
  if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) document.activeElement.blur();
  if (ev.button === 1 || (ev.button === 0 && (spaceDown || S.tool === 'hand'))) {
    ev.preventDefault();
    drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y };
    viewport.classList.add('panning'); return;
  }
  if (ev.button !== 0) return;
  ev.preventDefault();
  const wp = toWorld(ev), hd = ev.target.dataset && ev.target.dataset.h;

  if (hd) {
    const e = get(S.sel[0]);
    drag = { type: 'resize', hd, sx: wp.x, sy: wp.y, id: e.id, o: { x: e.x, y: e.y, w: e.w, h: e.h } }; return;
  }
  if (CREATE_TOOLS.includes(S.tool)) {
    const par = frameAt(wp), pa = par ? absPos(par) : { x: 0, y: 0 };
    const e = mk(S.tool, { parent: par ? par.id : null, x: Math.round(wp.x - pa.x), y: Math.round(wp.y - pa.y), w: 1, h: 1 });
    S.els.push(e); S.sel = [e.id]; render();
    drag = { type: 'create', id: e.id, sx: wp.x, sy: wp.y, pa }; return;
  }
  let id = null;
  if (ev.target.dataset && ev.target.dataset.label) id = ev.target.dataset.label;
  else { const n = ev.target.closest('.el'); if (n) id = pickable(n.dataset.id); }
  if (id) {
    if (ev.shiftKey) { setSel(S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel, id]); }
    else if (!S.sel.includes(id)) setSel([id]);
    const items = topmost(S.sel).filter(i => !get(i).locked).map(i => ({ id: i, x: get(i).x, y: get(i).y }));
    drag = { type: 'move', sx: wp.x, sy: wp.y, items, moved: false };
  } else if (!ev.shiftKey) setSel([]);
});

window.addEventListener('mousemove', ev => {
  if (!drag) {
    if (ev.target.closest && ev.target.closest('#viewport')) {
      const n = ev.target.closest('.el'); const id = n ? pickable(n.dataset.id) : null;
      if (id !== hover) { hover = id; renderOverlay(); }
    }
    return;
  }
  if (drag.type === 'pan') {
    S.view.x = drag.vx + ev.clientX - drag.sx; S.view.y = drag.vy + ev.clientY - drag.sy; applyView(); return;
  }
  const wp = toWorld(ev);
  if (drag.type === 'move') {
    let dx = wp.x - drag.sx, dy = wp.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) * S.view.z < 3) return;
    drag.moved = true;
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    guides = [];
    drag.items.forEach(it => {
      const e = get(it.id); let nx = it.x + dx, ny = it.y + dy;
      if (drag.items.length === 1 && !ev.altKey) { const r = snap(e, nx, ny); nx = r.x; ny = r.y; guides = r.guides; }
      e.x = Math.round(nx); e.y = Math.round(ny);
      const n = nodeOf(e.id); if (n) applyStyle(n, e);
    });
    renderOverlay(); syncProps();
  } else if (drag.type === 'resize') {
    const e = get(drag.id), o = drag.o, hd = drag.hd;
    const dx = wp.x - drag.sx, dy = wp.y - drag.sy;
    let { x, y, w, h } = o;
    if (hd.includes('e')) w = o.w + dx;
    if (hd.includes('s')) h = o.h + dy;
    if (hd.includes('w')) { x = o.x + dx; w = o.w - dx; }
    if (hd.includes('n')) { y = o.y + dy; h = o.h - dy; }
    if (ev.shiftKey && hd.length === 2) {
      const ratio = o.w / o.h; const nh = w / ratio;
      if (hd.includes('n')) y = o.y + o.h - nh; h = nh;
    }
    if (w < 1) { if (hd.includes('w')) x -= 1 - w; w = 1; }
    if (h < 1) { if (hd.includes('n')) y -= 1 - h; h = 1; }
    Object.assign(e, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    const n = nodeOf(e.id); if (n) applyStyle(n, e);
    renderOverlay(); syncProps();
  } else if (drag.type === 'create') {
    const e = get(drag.id), pa = drag.pa;
    e.x = Math.round(Math.min(drag.sx, wp.x) - pa.x); e.y = Math.round(Math.min(drag.sy, wp.y) - pa.y);
    e.w = Math.max(1, Math.round(Math.abs(wp.x - drag.sx))); e.h = Math.max(1, Math.round(Math.abs(wp.y - drag.sy)));
    const n = nodeOf(e.id); if (n) applyStyle(n, e);
    renderOverlay(); syncProps();
  }
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  const d = drag; drag = null; guides = [];
  viewport.classList.remove('panning');
  if (d.type === 'move' && d.moved) {
    let reparented = false;
    d.items.forEach(it => {
      const e = get(it.id); if (e.type === 'frame') return;
      const a = absPos(e), cx = a.x + e.w / 2, cy = a.y + e.h / 2;
      const ex = new Set([e.id, ...descendants(e.id)]), f = frameAt({ x: cx, y: cy }, ex), np = f ? f.id : null;
      if (np !== e.parent) {
        const pa = f ? absPos(f) : { x: 0, y: 0 };
        e.x = Math.round(a.x - pa.x); e.y = Math.round(a.y - pa.y); e.parent = np;
        S.els.splice(S.els.indexOf(e), 1); S.els.push(e); reparented = true;
      }
    });
    commit(); if (reparented) render(); else { renderOverlay(); renderLayers(); }
    syncProps();
  } else if (d.type === 'resize') { commit(); renderOverlay(); }
  else if (d.type === 'create') {
    const e = get(d.id), df = DEFAULTS[e.type];
    if (e.w < 4 && e.h < 4) { e.w = df.w; e.h = df.h; }
    S.tool === 'text' && e.h < 24 && (e.h = 32);
    setTool('move'); commit(); render();
    if (e.type === 'text') startEdit(e.id);
  } else renderOverlay();
});
viewport.addEventListener('mouseleave', () => { if (hover) { hover = null; renderOverlay(); } });
viewport.addEventListener('dblclick', ev => {
  const n = ev.target.closest('.el'); if (!n) return;
  const e = get(n.dataset.id); if (e && !e.locked && (e.type === 'text' || e.type === 'button')) startEdit(e.id);
});

/* ---------------------------------------------------------------- keyboard */
window.addEventListener('keydown', ev => {
  const t = ev.target, typing = t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName);
  const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
  if (mod && k === 's') { ev.preventDefault(); save(); return; }
  if (typing) return;
  if (ev.code === 'Space') { if (!spaceDown) { spaceDown = true; viewport.classList.add('space'); } ev.preventDefault(); return; }
  if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { ev.preventDefault(); redo(); return; }
  if (mod && k === 'd') { ev.preventDefault(); duplicate(); return; }
  if (mod && k === 'c') { if (S.sel.length) S.clip = collectTree(S.sel); return; }
  if (mod && k === 'v') { if (S.clip) { ev.preventDefault(); pasteNodes(S.clip); } return; }
  if (mod && k === 'a') { ev.preventDefault(); setSel(S.els.filter(e => !e.parent).map(e => e.id)); return; }
  if (mod && (k === ']' || k === '[')) { ev.preventDefault(); reorder(k === ']' ? 'front' : 'back'); return; }
  if (mod && k === '0') { ev.preventDefault(); S.view.z = 1; applyView(); return; }
  if (mod) return;
  if (k === ']') return reorder('forward');
  if (k === '[') return reorder('backward');
  if (ev.shiftKey && ev.key === '!') return fit();
  if (k === 'delete' || k === 'backspace') { ev.preventDefault(); return removeSel(); }
  if (k === 'escape') { if (S.tool !== 'move') setTool('move'); else setSel([]); return; }
  if (k === 'enter' && S.sel.length === 1) { const e = get(S.sel[0]); if (e && (e.type === 'text' || e.type === 'button')) { ev.preventDefault(); startEdit(e.id); } return; }
  if (k.startsWith('arrow') && S.sel.length) {
    ev.preventDefault();
    const step = ev.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
    topmost(S.sel).forEach(id => { const e = get(id); if (e.locked) return; e.x += dx; e.y += dy; const n = nodeOf(id); if (n) applyStyle(n, e); });
    clearTimeout(S._nudge); S._nudge = setTimeout(commit, 300);
    renderOverlay(); syncProps(); return;
  }
  const tools = { v: 'move', h: 'hand', f: 'frame', r: 'rect', o: 'ellipse', t: 'text', b: 'button', i: 'image' };
  if (tools[k]) setTool(tools[k]);
});
window.addEventListener('keyup', ev => { if (ev.code === 'Space') { spaceDown = false; viewport.classList.remove('space'); } });
window.addEventListener('resize', renderOverlay);

/* ------------------------------------------------- persistence & export */
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2200);
}
function setStatus(txt, ok) { const s = $('#status'); s.textContent = txt; s.classList.toggle('ok', !!ok); }
function markDirty() {
  S.dirty = true; setStatus('Unsaved');
  if (S.id) { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(true), 1500); }
}
async function api(path, opts = {}) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch (_) {} throw new Error(m); }
  return r;
}
const payload = () => JSON.stringify({ name: S.name, data: { els: S.els } });
async function save(auto) {
  clearTimeout(saveTimer); setStatus('Saving…');
  try {
    if (S.id) await api(`/api/projects/${S.id}`, { method: 'PUT', body: payload() });
    else { const j = await (await api('/api/projects', { method: 'POST', body: payload() })).json(); S.id = j.id; }
    localStorage.setItem('ff:last', S.id);
    S.dirty = false; setStatus('Saved', true); if (!auto) toast('Project saved');
  } catch (e) { setStatus('Save failed'); toast('Save failed: ' + e.message, true); }
}
function loadDoc(name, els, id = null) {
  S.id = id; S.name = name; S.els = els; S.sel = []; S.hist = []; S.hi = -1; S.dirty = false;
  $('#projectName').value = name; commit(); S.dirty = false;
  setStatus(id ? 'Saved' : 'Unsaved', !!id); render(); fit();
}
async function openProject(id) {
  try {
    const p = await (await api(`/api/projects/${id}`)).json();
    loadDoc(p.name, p.data.els, p.id); localStorage.setItem('ff:last', p.id); $('#modal').hidden = true;
  } catch (e) { toast('Could not open: ' + e.message, true); }
}
async function showOpen() {
  const box = $('#projectList'); box.innerHTML = '<div class="empty">Loading…</div>'; $('#modal').hidden = false;
  try {
    const list = await (await api('/api/projects')).json();
    if (!list.length) { box.innerHTML = '<div class="empty">No saved projects yet. Press Save to create one.</div>'; return; }
    box.innerHTML = '';
    list.forEach(p => {
      const row = document.createElement('div'); row.className = 'prow';
      row.innerHTML = '<span class="pn"></span><span class="pd"></span><button class="tbtn" title="Delete">🗑</button>';
      $('.pn', row).textContent = p.name; $('.pd', row).textContent = new Date(p.updated * 1000).toLocaleString();
      row.addEventListener('click', ev => {
        if (ev.target.closest('button')) {
          if (!confirm(`Delete "${p.name}"?`)) return;
          api(`/api/projects/${p.id}`, { method: 'DELETE' }).then(() => { if (S.id === p.id) S.id = null; showOpen(); }).catch(e => toast(e.message, true));
        } else openProject(p.id);
      });
      box.appendChild(row);
    });
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function exportHTML(preview) {
  try {
    const html = await (await api('/api/export', { method: 'POST', body: payload() })).text();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    if (preview) window.open(url, '_blank');
    else download(url, (S.name.replace(/[^\w-]+/g, '-') || 'design') + '.html');
  } catch (e) { toast('Export failed: ' + e.message, true); }
}
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
function exportJSON() {
  download(URL.createObjectURL(new Blob([JSON.stringify({ name: S.name, data: { els: S.els } }, null, 2)], { type: 'application/json' })),
    (S.name.replace(/[^\w-]+/g, '-') || 'design') + '.json');
}
$('#importFile').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()), els = (j.data && j.data.els) || j.els;
    if (!Array.isArray(els) || els.some(e => !e || !e.id || !e.type || !DEFAULTS[e.type])) throw new Error('Not a FrameForge file');
    loadDoc(j.name || f.name.replace(/\.json$/, ''), els.map(e => Object.assign(mk(e.type), e)));
    markDirty(); toast('Imported');
  } catch (e) { toast('Import failed: ' + e.message, true); }
});
function newDoc() {
  if (S.dirty && S.els.length && !confirm('Discard unsaved changes?')) return;
  localStorage.removeItem('ff:last'); loadDoc('Untitled design', []);
}
document.querySelector('.topbar').addEventListener('click', ev => {
  const c = ev.target.closest('[data-cmd]')?.dataset.cmd; if (!c) return;
  ({ undo, redo, new: newDoc, open: showOpen, save: () => save(), import: () => $('#importFile').click(),
     exportjson: exportJSON, preview: () => exportHTML(true), exporthtml: () => exportHTML(false) })[c]();
});
$('#projectName').addEventListener('input', ev => { S.name = ev.target.value || 'Untitled design'; markDirty(); });
$('#modalClose').addEventListener('click', () => $('#modal').hidden = true);
$('#modal').addEventListener('mousedown', ev => { if (ev.target.id === 'modal') $('#modal').hidden = true; });

/* -------------------------------------------------------------- demo doc */
function demo() {
  const els = [], add = (type, over) => { const e = mk(type, over); els.push(e); S.els = els; return e; };
  const D = add('frame', { name: 'Landing – Desktop', x: 0, y: 0, w: 1440, h: 900, fill: '#f8fafc' });
  const p = D.id;
  add('rect', { name: 'Navbar', parent: p, x: 0, y: 0, w: 1440, h: 72, fill: '#ffffff', stroke: '#e2e8f0', strokeW: 1 });
  add('text', { name: 'Logo', parent: p, x: 48, y: 18, w: 160, h: 36, text: 'Acme', fontSize: 26, fontWeight: 700, color: '#0f172a' });
  ['Product', 'Pricing', 'Docs'].forEach((t, i) => add('text', { name: 'Nav ' + t, parent: p, x: 880 + i * 100, y: 25, w: 90, h: 24, text: t, fontSize: 16, color: '#475569' }));
  add('button', { name: 'Sign up', parent: p, x: 1240, y: 12, w: 148, h: 48, text: 'Sign up' });
  add('text', { name: 'Headline', parent: p, x: 120, y: 190, w: 640, h: 170, text: 'Design layouts\nfaster than ever', fontSize: 64, fontWeight: 700, color: '#0f172a' });
  add('text', { name: 'Subtitle', parent: p, x: 120, y: 390, w: 560, h: 60, text: 'Drag, drop and export clean HTML & CSS from your browser.', fontSize: 20, color: '#475569' });
  add('button', { name: 'CTA primary', parent: p, x: 120, y: 480, w: 180, h: 56, text: 'Get started', fontSize: 18, radius: 10 });
  add('button', { name: 'CTA secondary', parent: p, x: 320, y: 480, w: 180, h: 56, text: 'Learn more', fontSize: 18, radius: 10, fill: 'transparent', stroke: '#2563eb', strokeW: 2, color: '#2563eb' });
  add('image', { name: 'Hero image', parent: p, x: 820, y: 170, w: 520, h: 440, radius: 24, fill: '#dbeafe' });
  [['Fast', 'Snap, align and resize with live guides.'], ['Structured', 'Frames, layers and nesting like Figma.'], ['Exportable', 'One click to standalone HTML & CSS.']].forEach(([t, d], i) => {
    const x = 120 + i * 410;
    add('rect', { name: 'Card ' + t, parent: p, x, y: 680, w: 380, h: 160, fill: '#ffffff', stroke: '#e2e8f0', strokeW: 1, radius: 16, shadow: true });
    add('text', { name: 'Card title', parent: p, x: x + 24, y: 704, w: 330, h: 30, text: t, fontSize: 22, fontWeight: 600, color: '#0f172a' });
    add('text', { name: 'Card text', parent: p, x: x + 24, y: 746, w: 330, h: 60, text: d, fontSize: 16, color: '#475569' });
  });
  const M = add('frame', { name: 'Landing – Mobile', x: 1540, y: 0, w: 375, h: 812, fill: '#f8fafc' }), m = M.id;
  add('rect', { name: 'Navbar', parent: m, x: 0, y: 0, w: 375, h: 64, fill: '#ffffff', stroke: '#e2e8f0', strokeW: 1 });
  add('text', { name: 'Logo', parent: m, x: 20, y: 14, w: 120, h: 36, text: 'Acme', fontSize: 24, fontWeight: 700, color: '#0f172a' });
  add('text', { name: 'Headline', parent: m, x: 24, y: 110, w: 327, h: 140, text: 'Design layouts faster than ever', fontSize: 38, fontWeight: 700, color: '#0f172a' });
  add('button', { name: 'CTA', parent: m, x: 24, y: 280, w: 327, h: 52, text: 'Get started', radius: 10 });
  add('image', { name: 'Hero image', parent: m, x: 24, y: 360, w: 327, h: 260, radius: 20, fill: '#dbeafe' });
  return els;
}

/* ------------------------------------------------------------------ init */
(async function init() {
  setTool('move'); updateUndoButtons();
  const last = localStorage.getItem('ff:last');
  if (last) { try { const p = await (await api(`/api/projects/${last}`)).json(); loadDoc(p.name, p.data.els, p.id); return; } catch (_) { localStorage.removeItem('ff:last'); } }
  loadDoc('Untitled design', demo());
  markDirty(); S.dirty = true; setStatus('Unsaved');
})();
