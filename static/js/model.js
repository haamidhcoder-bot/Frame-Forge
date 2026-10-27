'use strict';
/* FrameForge – data model, tree helpers, resolve (instances/tokens/styles) and CSS generation.
   The CSS rules here mirror exporter.py (css_decls) so the canvas matches the exported page. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => 'e' + Math.random().toString(36).slice(2, 9);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round(n * 100) / 100;
const fmt = n => { n = Math.round(n * 1000) / 1000; return String(n); };
const px = n => fmt(+n || 0) + 'px';
const clone = o => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------------ state */
const S = {
  id: null, name: 'Untitled design',
  els: [], pages: [{ id: 'p1', name: 'Page 1', guides: [] }], page: 'p1',
  tokens: {}, textStyles: {},
  sel: [], tool: 'move', views: {}, view: { x: 120, y: 90, z: 0.5 },
  hist: [], hi: -1, dirty: false, clip: null,
  ui: { rulers: true, grid: false, minimap: true, snap: true, flow: true, flowSel: false },
};

/* --------------------------------------------------------------- defaults */
const FONT_LIST = ['Inter', 'Poppins', 'Roboto', 'Montserrat', 'Playfair Display', 'Lato', 'Open Sans', 'Space Grotesk', 'Georgia', 'Mono'];
const FONT_STACK = {
  'Inter': "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif", 'Poppins': 'Poppins, system-ui, sans-serif',
  'Roboto': 'Roboto, system-ui, sans-serif', 'Montserrat': 'Montserrat, system-ui, sans-serif',
  'Playfair Display': "'Playfair Display', Georgia, serif", 'Lato': 'Lato, system-ui, sans-serif',
  'Open Sans': "'Open Sans', system-ui, sans-serif", 'Space Grotesk': "'Space Grotesk', system-ui, sans-serif",
  'Georgia': "Georgia, 'Times New Roman', serif", 'Mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};
const GFONT = {
  'Inter': 'Inter:wght@400;500;600;700', 'Poppins': 'Poppins:wght@400;500;600;700', 'Roboto': 'Roboto:wght@400;500;700',
  'Montserrat': 'Montserrat:wght@400;500;600;700', 'Playfair Display': 'Playfair+Display:wght@400;600;700',
  'Lato': 'Lato:wght@400;700', 'Open Sans': 'Open+Sans:wght@400;600;700', 'Space Grotesk': 'Space+Grotesk:wght@400;500;700',
};
const BASE = {
  x: 0, y: 0, w: 100, h: 100, parent: null, page: 'p1', visible: true, locked: false,
  fills: [], strokes: [], effects: [], radius: 0, opacity: 1, clip: false,
  text: '', font: 'Inter', fontSize: 16, fontWeight: 400, color: '#111111', align: 'left', lineHeight: 1.3,
  letterSpacing: 0, italic: false, underline: false, strike: false, tstyle: '',
  layout: 'none', gap: 0, padX: 0, padY: 0, wrap: false, alignItems: 'start', justify: 'start', cols: 2,
  sizeW: 'fixed', sizeH: 'fixed', url: '', fit: 'cover', sides: 5, star: false, icon: 'star',
  placeholder: '', checked: false, ref: '', overrides: null, link: null, isComp: false,
};
const solid = (c, o = 1) => ({ type: 'solid', color: c, color2: '#ffffff', angle: 90, opacity: o });
const stroke = (c, w = 1) => ({ color: c, width: w });
const TYPE_DEF = {
  frame:    { name: 'Frame', w: 1440, h: 900, fills: [solid('#ffffff')], clip: true },
  group:    { name: 'Group', w: 100, h: 100 },
  rect:     { name: 'Rectangle', w: 160, h: 100, fills: [solid('#d9d9d9')] },
  ellipse:  { name: 'Ellipse', w: 120, h: 120, fills: [solid('#d9d9d9')] },
  line:     { name: 'Line', w: 200, h: 2, fills: [solid('#111111')] },
  polygon:  { name: 'Polygon', w: 120, h: 120, fills: [solid('#d9d9d9')] },
  text:     { name: 'Text', w: 200, h: 32, text: 'Text', fontSize: 20 },
  button:   { name: 'Button', w: 160, h: 48, fills: [solid('#2563eb')], color: '#ffffff', radius: 8, text: 'Button', fontSize: 16, fontWeight: 600, align: 'center' },
  image:    { name: 'Image', w: 240, h: 160, fills: [solid('#e5e7eb')] },
  icon:     { name: 'Icon', w: 32, h: 32 },
  input:    { name: 'Input', w: 240, h: 44, fills: [solid('#ffffff')], strokes: [stroke('#d1d5db')], radius: 8, placeholder: 'Email address', fontSize: 15 },
  checkbox: { name: 'Checkbox', w: 160, h: 24, text: 'Checkbox', fontSize: 15 },
  select:   { name: 'Dropdown', w: 200, h: 44, fills: [solid('#ffffff')], strokes: [stroke('#d1d5db')], radius: 8, text: 'Option 1\nOption 2\nOption 3', fontSize: 15 },
  instance: { name: 'Instance' },
};
const ICON = { frame: '#', group: '▢', rect: '▭', ellipse: '◯', line: '╱', polygon: '⬠', text: 'T', button: '▣', image: '▨', icon: '★', input: '⌨', checkbox: '☑', select: '▾', instance: '◇' };
const CREATE_TOOLS = ['frame', 'rect', 'ellipse', 'line', 'polygon', 'text', 'button', 'image', 'input', 'checkbox', 'select', 'icon'];

function mk(type, over = {}) {
  const d = TYPE_DEF[type] || {};
  const n = S.els.filter(e => e.type === type).length + 1;
  return Object.assign(clone(BASE), clone(d), { id: uid(), type, name: `${d.name || type} ${n}`, page: S.page }, over);
}
/* Fill defaults and migrate documents saved by older versions. */
function migrate(e) {
  const o = Object.assign(clone(BASE), e);
  if (!Array.isArray(e.fills)) {
    o.fills = (e.type === 'text' || !e.fill || e.fill === 'transparent') ? [] : [solid(e.fill)];
  }
  if (!Array.isArray(e.strokes)) o.strokes = +e.strokeW > 0 ? [stroke(e.stroke || '#000000', +e.strokeW)] : [];
  if (!Array.isArray(e.effects)) o.effects = e.shadow ? [{ type: 'drop', x: 0, y: 8, blur: 24, spread: 0, color: 'rgba(0,0,0,.25)' }] : [];
  o.fills = o.fills.map(f => Object.assign(solid('#d9d9d9'), f));
  delete o.fill; delete o.stroke; delete o.strokeW; delete o.shadow;
  if (!o.page) o.page = 'p1';
  return o;
}

/* ------------------------------------------------------------------ tree */
let IDX = new Map(), IDXLEN = -1;
function reindex() { IDX = new Map(S.els.map(e => [e.id, e])); IDXLEN = S.els.length; }
function get(id) {
  let e = IDX.get(id);
  if (e && IDXLEN === S.els.length) return e;
  reindex();
  return IDX.get(id);
}
const baseId = id => String(id).split('::')[0];
const pageEls = () => S.els.filter(e => e.page === S.page);
const kids = id => S.els.filter(e => e.parent === id);
const isAuto = e => !!e && ['row', 'column', 'grid'].includes(e.layout) && (e.type === 'frame' || e.type === 'group');
const isContainer = e => !!e && (e.type === 'frame' || e.type === 'group');
const parentOf = e => (e && e.parent ? get(e.parent) : null);
function descendants(id) { const out = []; kids(id).forEach(k => { out.push(k.id, ...descendants(k.id)); }); return out; }
function isInside(id, ancestorId) { let p = get(id); while (p) { if (p.id === ancestorId) return true; p = parentOf(p); } return false; }
function absPos(e) {
  /* Prefer the real on-screen position: children of auto-layout frames have no meaningful x/y. */
  const n = typeof nodeOf === 'function' ? nodeOf(e.id) : null;
  if (n && n.isConnected && e.page === S.page && (n.offsetWidth || n.offsetHeight)) {
    const r = n.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
    return { x: (r.left - vr.left - S.view.x) / S.view.z, y: (r.top - vr.top - S.view.y) / S.view.z };
  }
  let x = e.x, y = e.y, p = parentOf(e);
  while (p) { x += p.x; y += p.y; p = parentOf(p); }
  return { x, y };
}
function depth(e) { let d = 0, p = parentOf(e); while (p) { d++; p = parentOf(p); } return d; }
function rootOf(e) { while (e && e.parent) e = get(e.parent); return e; }
function topmost(ids) {
  return ids.filter(id => { let p = get(id).parent; while (p) { if (ids.includes(p)) return false; p = get(p).parent; } return true; });
}
function frameAt(pt, exclude = new Set()) {
  let best = null, bd = -1;
  pageEls().forEach(f => {
    if (!isContainer(f) || exclude.has(f.id) || !f.visible) return;
    const a = absPos(f);
    if (pt.x >= a.x && pt.x <= a.x + f.w && pt.y >= a.y && pt.y <= a.y + f.h) {
      const d = depth(f); if (d >= bd) { best = f; bd = d; }
    }
  });
  return best;
}
/* Which element does a click on `id` select? Groups are selected as a whole until entered. */
function pickable(id) {
  let e = get(baseId(id));
  while (e && e.locked) e = parentOf(e);
  if (!e) return null;
  let outer = null, p = e;
  while (p) { if (p.type === 'group' && !S.sel.some(s => isInside(s, p.id))) outer = p; p = parentOf(p); }
  return (outer || e).id;
}

/* -------------------------------------------------- resolve for rendering */
const COLOR_FIELDS_TEXT = ['text', 'icon', 'input', 'checkbox', 'select'];
function expandInstances(els) {
  for (let pass = 0; pass < 4; pass++) {
    if (!els.some(e => e.type === 'instance')) break;
    const byId = new Map(els.map(e => [e.id, e])), kidsOf = new Map();
    els.forEach(e => { const k = e.parent || null; if (!kidsOf.has(k)) kidsOf.set(k, []); kidsOf.get(k).push(e); });
    const out = [];
    els.forEach(e => { if (e.type !== 'instance') out.push(e); else out.push(...expandOne(e, byId, kidsOf)); });
    els = out;
  }
  return els.filter(e => e.type !== 'instance');
}
function expandOne(inst, byId, kidsOf) {
  const m = byId.get(inst.ref);
  if (!m || !isContainer(m)) {
    return [Object.assign(clone(BASE), { id: inst.id, type: 'rect', x: inst.x, y: inst.y, w: inst.w, h: inst.h, parent: inst.parent, page: inst.page, name: inst.name, fills: [solid('#e5e7eb')] })];
  }
  const ov = inst.overrides || {}, out = [];
  (function walk(node, isRoot, newParent) {
    const c = Object.assign({}, node, { fills: clone(node.fills), strokes: clone(node.strokes), effects: clone(node.effects) });
    if (isRoot) {
      Object.assign(c, { id: inst.id, parent: inst.parent, x: inst.x, y: inst.y, w: inst.w, h: inst.h, name: inst.name || node.name, page: inst.page, visible: inst.visible, locked: inst.locked, sizeW: inst.sizeW, sizeH: inst.sizeH, isComp: false, link: inst.link || node.link });
    } else {
      Object.assign(c, { id: inst.id + '::' + node.id, parent: newParent, page: inst.page, isComp: false });
      const o = ov[node.id];
      if (o) {
        if ('text' in o) c.text = String(o.text);
        if (o.color) {
          if (COLOR_FIELDS_TEXT.includes(c.type)) c.color = o.color;
          else if (c.fills.length) c.fills[0] = Object.assign({}, c.fills[0], { color: o.color });
          else c.fills = [solid(o.color)];
        }
      }
    }
    out.push(c);
    (kidsOf.get(node.id) || []).forEach(k => walk(k, false, c.id));
  })(m, true, null);
  return out;
}
const tokenOf = v => (typeof v === 'string' && v.startsWith('token:')) ? (S.tokens[v.slice(6)] || '#888888') : v;
function effective(e) {
  const c = Object.assign({}, e);
  c.color = tokenOf(e.color);
  c.fills = e.fills.map(f => Object.assign({}, f, { color: tokenOf(f.color), color2: tokenOf(f.color2) }));
  c.strokes = e.strokes.map(s => Object.assign({}, s, { color: tokenOf(s.color) }));
  c.effects = e.effects.map(f => Object.assign({}, f, { color: tokenOf(f.color) }));
  const ts = e.tstyle && S.textStyles[e.tstyle];
  if (ts) ['font', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'].forEach(k => { if (ts[k] !== undefined && ts[k] !== '') c[k] = ts[k]; });
  return c;
}
let RES = [], RMAP = new Map(), RKIDS = new Map();
function resolveAll() {
  RES = expandInstances(S.els).filter(e => e.page === S.page).map(effective);
  RMAP = new Map(RES.map(e => [e.id, e]));
  RKIDS = new Map();
  RES.forEach(e => { const k = e.parent && RMAP.has(e.parent) ? e.parent : null; if (!RKIDS.has(k)) RKIDS.set(k, []); RKIDS.get(k).push(e); });
}

/* ------------------------------------------------------- CSS generation */
function withAlpha(c, a) {
  if (a >= 1) return c;
  let m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let h = m[1]; if (h.length <= 4) h = [...h].map(x => x + x).join('');
    if (h.length === 6) h += 'ff';
    if (h.length === 8) return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${fmt(parseInt(h.slice(6, 8), 16) / 255 * a)})`;
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${fmt((m[4] === undefined ? 1 : +m[4]) * a)})`;
  return c;
}
const okColor = (c, d) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|transparent|rgba?\(\s*[\d.\s,%]+\))$/i.test(c.trim())) ? c.trim() : d;
function fillCss(f) {
  const a = Math.min(1, Math.max(0, f.opacity === undefined ? 1 : +f.opacity));
  const c1 = withAlpha(okColor(f.color, '#d9d9d9'), a);
  if (f.type === 'linear' || f.type === 'radial') {
    const c2 = withAlpha(okColor(f.color2, '#ffffff'), a);
    const ang = f.angle === undefined ? 90 : +f.angle;
    return f.type === 'linear' ? `linear-gradient(${fmt(ang)}deg,${c1},${c2})` : `radial-gradient(circle,${c1},${c2})`;
  }
  return `linear-gradient(${c1},${c1})`;
}
function polygonPoints(sides, star) {
  const n = star ? sides * 2 : sides, pts = [];
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + i * 2 * Math.PI / n, r = (!star || i % 2 === 0) ? 50 : 22.5;
    pts.push(`${fmt(50 + r * Math.cos(ang))}% ${fmt(50 + r * Math.sin(ang))}%`);
  }
  return `polygon(${pts.join(',')})`;
}
const FLEX_ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
const GRID_ALIGN = { start: 'start', center: 'center', end: 'end', stretch: 'stretch' };
const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' };
const TEXT_FLEX = { left: 'flex-start', center: 'center', right: 'flex-end' };

function sizeDecls(e, parent, d) {
  const pk = parent && isAuto(parent) ? parent.layout : null;
  let sw = e.sizeW, sh = e.sizeH;
  if (sw === 'fill' && !pk) sw = 'fixed';
  if (sh === 'fill' && !pk) sh = 'fixed';
  const canHug = isAuto(e) || e.type === 'text' || e.type === 'button';
  if (sw === 'hug' && !canHug) sw = 'fixed';
  if (sh === 'hug' && !canHug) sh = 'fixed';
  if (sw === 'fixed') d.push(['width', px(e.w)]);
  else if (sw === 'hug') d.push(['width', 'fit-content']);
  else if (pk === 'row') d.push(['flex', '1 1 0%'], ['min-width', '0']);
  else if (pk === 'column') d.push(['align-self', 'stretch']);
  else d.push(['width', '100%']);
  if (sh === 'fixed') d.push(['height', px(e.h)]);
  else if (sh === 'hug') d.push(['height', 'fit-content']);
  else if (pk === 'column') d.push(['flex', '1 1 0%'], ['min-height', '0']);
  else if (pk === 'row') d.push(['align-self', 'stretch']);
  else d.push(['height', '100%']);
  if (pk === 'row' && sw === 'fixed') d.push(['flex-shrink', '0']);
  if (pk === 'column' && sh === 'fixed') d.push(['flex-shrink', '0']);
}

function declsFor(e, parent) {
  const t = e.type, d = [], pk = parent && isAuto(parent) ? parent.layout : null;
  if (!parent) d.push(['position', 'absolute'], ['left', px(e.x)], ['top', px(e.y)]);
  else if (pk) d.push(['position', 'relative']);
  else d.push(['position', 'absolute'], ['left', px(e.x)], ['top', px(e.y)]);
  sizeDecls(e, parent, d);
  d.push(['box-sizing', 'border-box']);

  if (t !== 'text') {
    const L = e.fills;
    if (L.length === 1 && (L[0].type || 'solid') === 'solid') d.push(['background-color', withAlpha(okColor(L[0].color, '#d9d9d9'), Math.min(1, Math.max(0, L[0].opacity === undefined ? 1 : +L[0].opacity)))]);
    else if (L.length) d.push(['background', L.map(fillCss).join(',')]);
  }
  const sts = e.strokes.filter(s => +s.width > 0), shadows = [];
  let filt = null, bg = null;
  if (sts.length && t !== 'text') {
    d.push(['border', `${px(sts[0].width)} solid ${okColor(sts[0].color, '#000000')}`]);
    let cum = 0;
    sts.slice(1).forEach(s => { cum += +s.width; shadows.push(`inset 0 0 0 ${px(cum)} ${okColor(s.color, '#000000')}`); });
  } else if (t === 'button' || t === 'input' || t === 'select') d.push(['border', 'none']);
  const inner = [], drop = [];
  e.effects.forEach(f => {
    const c = okColor(f.color, 'rgba(0,0,0,.25)'), geo = `${px(f.x)} ${px(f.y)} ${px(f.blur)} ${px(f.spread)}`;
    if (f.type === 'drop') drop.push(`${geo} ${c}`);
    else if (f.type === 'inner') inner.push(`inset ${geo} ${c}`);
    else if (f.type === 'blur') filt = `blur(${px(f.blur)})`;
    else if (f.type === 'bgblur') bg = `blur(${px(f.blur)})`;
  });
  const all = shadows.concat(inner, drop);
  if (all.length) d.push(['box-shadow', all.join(',')]);
  if (filt) d.push(['filter', filt]);
  if (bg) d.push(['-webkit-backdrop-filter', bg], ['backdrop-filter', bg]);

  if (t === 'polygon') d.push(['clip-path', polygonPoints(Math.max(3, Math.min(12, +e.sides || 5)), !!e.star)]);
  else if (t === 'ellipse') d.push(['border-radius', '50%']);
  else if (e.radius > 0) d.push(['border-radius', px(e.radius)]);
  if (e.opacity < 1) d.push(['opacity', fmt(e.opacity)]);
  if (t === 'frame' && e.clip) d.push(['overflow', 'hidden']);
  if (t === 'image') d.push(['overflow', 'hidden']);

  if (isAuto(e)) {
    const pad = (e.padX || e.padY) ? `${px(e.padY)} ${px(e.padX)}` : '';
    if (e.layout === 'row' || e.layout === 'column') {
      d.push(['display', 'flex'], ['flex-direction', e.layout], ['gap', px(e.gap)]);
      if (pad) d.push(['padding', pad]);
      d.push(['align-items', FLEX_ALIGN[e.alignItems] || 'flex-start'], ['justify-content', JUSTIFY[e.justify] || 'flex-start']);
      if (e.wrap) d.push(['flex-wrap', 'wrap']);
    } else {
      d.push(['display', 'grid'], ['grid-template-columns', `repeat(${Math.max(1, +e.cols || 2)},1fr)`], ['gap', px(e.gap)]);
      if (pad) d.push(['padding', pad]);
      d.push(['align-items', GRID_ALIGN[e.alignItems] || 'start']);
    }
  }
  if (['text', 'button', 'input', 'checkbox', 'select'].includes(t)) {
    d.push(['font-family', FONT_STACK[e.font] || FONT_STACK.Inter], ['font-size', px(e.fontSize)], ['font-weight', String(Math.round(e.fontWeight))], ['line-height', fmt(+e.lineHeight || 1.3)]);
    if (+e.letterSpacing) d.push(['letter-spacing', px(e.letterSpacing)]);
    d.push(['color', okColor(e.color, '#111111')]);
    if (e.italic) d.push(['font-style', 'italic']);
    const deco = [e.underline && 'underline', e.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) d.push(['text-decoration', deco]);
  }
  if (t === 'text') d.push(['text-align', TEXT_FLEX[e.align] ? e.align : 'left'], ['white-space', 'pre-wrap'], ['word-wrap', 'break-word']);
  else if (t === 'button') {
    const al = TEXT_FLEX[e.align] ? e.align : 'center';
    d.push(['display', 'flex'], ['align-items', 'center'], ['justify-content', TEXT_FLEX[al]], ['text-align', al], ['white-space', 'pre-wrap'], ['padding', '0 12px'], ['cursor', 'pointer']);
  } else if (t === 'input') d.push(['display', 'flex'], ['align-items', 'center'], ['padding', '0 12px']);
  else if (t === 'select') d.push(['display', 'flex'], ['align-items', 'center'], ['justify-content', 'space-between'], ['padding', '0 12px']);
  else if (t === 'checkbox') d.push(['display', 'flex'], ['align-items', 'center'], ['gap', '8px']);
  else if (t === 'icon') d.push(['display', 'block'], ['color', okColor(e.color, '#111111')]);
  if (e.visible === false) d.push(['display', 'none']);
  return d;
}
const cssText = d => d.map(([p, v]) => `${p}:${v}`).join(';');

/* ---------------------------------------------------------------- history */
function docSnapshot() { return JSON.stringify({ els: S.els, pages: S.pages, tokens: S.tokens, textStyles: S.textStyles }); }
function commit() {
  const s = docSnapshot();
  if (S.hist[S.hi] === s) return;
  S.hist = S.hist.slice(0, S.hi + 1); S.hist.push(s);
  if (S.hist.length > 100) S.hist.shift();
  S.hi = S.hist.length - 1;
  markDirty(); updateUndoButtons();
}
function undo() { if (S.hi > 0) { S.hi--; restore(); } }
function redo() { if (S.hi < S.hist.length - 1) { S.hi++; restore(); } }
function restore() {
  const d = JSON.parse(S.hist[S.hi]);
  S.els = d.els; S.pages = d.pages; S.tokens = d.tokens; S.textStyles = d.textStyles;
  if (!S.pages.some(p => p.id === S.page)) S.page = S.pages[0].id;
  reindex(); S.sel = S.sel.filter(id => get(id));
  render(); markDirty(); updateUndoButtons();
}
function updateUndoButtons() {
  const u = $('[data-cmd=undo]'), r = $('[data-cmd=redo]');
  if (u) u.disabled = S.hi <= 0;
  if (r) r.disabled = S.hi >= S.hist.length - 1;
}
