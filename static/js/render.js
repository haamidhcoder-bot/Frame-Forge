'use strict';
/* FrameForge – DOM rendering, viewport, overlay (selection, guides), rulers, minimap. */

const viewport = $('#viewport'), world = $('#world'), overlay = $('#overlay');
const NODES = new Map();
const nodeOf = id => NODES.get(id);
let hover = null, snapGuides = [], dropHint = null, indicator = null, marquee = null, editing = null;

const curPage = () => S.pages.find(p => p.id === S.page) || S.pages[0];

/* ---------------------------------------------------------------- nodes */
function paint(n, e) {
  const parent = e.parent ? RMAP.get(e.parent) : null;
  n.style.cssText = cssText(declsFor(e, parent));
  const t = e.type;
  if (t === 'text' || t === 'button') {
    if (!n.isContentEditable && n.textContent !== e.text) n.textContent = e.text;
  } else if (t === 'input') {
    const sig = 'ph|' + e.placeholder;
    if (n._sig !== sig) { n._sig = sig; n.innerHTML = '<span class="ph"></span>'; n.firstChild.textContent = e.placeholder; }
  } else if (t === 'checkbox') {
    const sig = 'cb|' + e.text + '|' + e.checked;
    if (n._sig !== sig) { n._sig = sig; n.innerHTML = `<span class="cbx${e.checked ? ' on' : ''}"></span><span class="lbl"></span>`; n.lastChild.textContent = e.text; }
  } else if (t === 'select') {
    const first = (String(e.text).split('\n').map(s => s.trim()).filter(Boolean)[0]) || 'Select';
    const sig = 'sel|' + first;
    if (n._sig !== sig) { n._sig = sig; n.innerHTML = '<span class="v"></span><span class="chev">▾</span>'; n.firstChild.textContent = first; }
  } else if (t === 'icon') {
    const sig = 'ic|' + e.icon;
    if (n._sig !== sig) { n._sig = sig; n.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[e.icon] || ICONS.star}</svg>`; }
  } else if (t === 'image') {
    const sig = 'img|' + (e.url ? 1 : 0);
    if (n._sig !== sig) {
      n._sig = sig; n.innerHTML = '';
      if (e.url) { const im = document.createElement('img'); im.draggable = false; n.appendChild(im); }
    }
    n.classList.toggle('empty', !e.url);
    const im = n.firstChild;
    if (im) {
      if (im.getAttribute('src') !== e.url) im.setAttribute('src', e.url);
      im.style.objectFit = ['cover', 'contain', 'fill'].includes(e.fit) ? e.fit : 'cover';
    }
  }
  n.classList.toggle('has-link', !!(e.link && e.link.kind));
}
function buildNode(e, reg = NODES) {
  const d = document.createElement('div');
  d.className = 'el t-' + e.type; d.dataset.id = e.id;
  reg.set(e.id, d);
  paint(d, e);
  (RKIDS.get(e.id) || []).forEach(c => d.appendChild(buildNode(c, reg)));
  return d;
}
function render() {
  resolveAll(); NODES.clear();
  world.replaceChildren(...(RKIDS.get(null) || []).map(e => buildNode(e)));
  renderPages(); renderLayers(); renderProps(); measure(); renderOverlay(); drawRulers(); drawMinimap();
}
/* Repaint one node after a cheap change (drag, resize). */
function repaint(id) {
  const e = get(id), n = nodeOf(id); if (!e || !n) return;
  let r;
  if (e.type === 'instance') {
    r = RMAP.get(id); if (!r) return;
    Object.assign(r, { x: e.x, y: e.y, w: e.w, h: e.h, sizeW: e.sizeW, sizeH: e.sizeH, visible: e.visible });
  } else { r = effective(e); RMAP.set(id, r); }
  paint(n, r);
}
/* Repaint everything after a property edit. */
function refresh() {
  resolveAll();
  RES.forEach(e => { const n = nodeOf(e.id); if (n) paint(n, e); });
  measure(); renderOverlay(); drawMinimap();
}
/* Hug/fill sizes come from the browser: copy them back into the model so W/H show real numbers. */
function measure() {
  const list = pageEls().filter(e => e.visible && !isInside(e.id, '\u0000') && (e.sizeW !== 'fixed' || e.sizeH !== 'fixed' || isAuto(parentOf(e))));
  const reads = list.map(e => { const n = nodeOf(e.id); return n ? [e, n.offsetWidth, n.offsetHeight] : null; }).filter(Boolean);
  reads.forEach(([e, w, h]) => {
    if (!w && !h) return;
    if (Math.abs(e.w - w) > 0.5) e.w = w;
    if (Math.abs(e.h - h) > 0.5) e.h = h;
  });
}

/* ----------------------------------------------------------------- view */
function applyView() {
  const v = S.view;
  world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
  let step = 8; while (step * v.z < 8) step *= 8;
  if (S.ui.grid) {
    viewport.style.backgroundImage = 'linear-gradient(var(--gridline) 1px, transparent 1px), linear-gradient(90deg, var(--gridline) 1px, transparent 1px)';
    viewport.style.backgroundSize = `${step * v.z}px ${step * v.z}px`;
  } else {
    viewport.style.backgroundImage = 'radial-gradient(var(--dot) 1px, transparent 1px)';
    viewport.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
  }
  viewport.style.backgroundPosition = `${v.x}px ${v.y}px`;
  $('#zoomLabel').textContent = Math.round(v.z * 100) + '%';
  S.views[S.page] = { x: v.x, y: v.y, z: v.z };
  renderOverlay(); drawRulers(); drawMinimap();
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
function worldBounds(ids) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  ids.forEach(id => { const e = get(id); if (!e) return; const a = absPos(e); x1 = Math.min(x1, a.x); y1 = Math.min(y1, a.y); x2 = Math.max(x2, a.x + e.w); y2 = Math.max(y2, a.y + e.h); });
  return x1 === Infinity ? null : { x1, y1, x2, y2 };
}
function fit(ids) {
  const list = ids && ids.length ? ids : pageEls().filter(e => !e.parent).map(e => e.id);
  const b = worldBounds(list), r = viewport.getBoundingClientRect(), pad = 80;
  if (!b) { S.view = { x: 200, y: 100, z: 1 }; return applyView(); }
  const z = Math.min(2, Math.max(0.05, Math.min((r.width - pad * 2) / (b.x2 - b.x1), (r.height - pad * 2) / (b.y2 - b.y1))));
  S.view.z = z; S.view.x = (r.width - (b.x2 - b.x1) * z) / 2 - b.x1 * z; S.view.y = (r.height - (b.y2 - b.y1) * z) / 2 - b.y1 * z;
  applyView();
}
function centerOn(wx, wy) {
  const r = viewport.getBoundingClientRect();
  S.view.x = r.width / 2 - wx * S.view.z; S.view.y = r.height / 2 - wy * S.view.z; applyView();
}

/* -------------------------------------------------------------- overlay */
const HANDLES = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };
const screenRect = n => { const vr = viewport.getBoundingClientRect(), r = n.getBoundingClientRect(); return { l: r.left - vr.left, t: r.top - vr.top, w: r.width, h: r.height }; };

/* ------------------------------------------------------------ flow arrows (links shown as a flowchart) */
function flowGo(id) {
  const t = get(id); if (!t) return;
  if (t.page !== S.page) setPage(t.page);
  setSel([id]); fit([id]);
}
function rootOf(e) { while (e.parent && get(e.parent)) e = get(e.parent); return e; }
function inside(e, anc) { for (let p = e; p; p = p.parent && get(p.parent)) if (p.id === anc.id) return true; return false; }
function drawFlow() {
  if (!S.ui.flow) return;
  let list = pageEls().filter(e => e.link && e.link.kind && e.visible && nodeOf(e.id));
  if (S.ui.flowSel) list = list.filter(e => S.sel.includes(e.id));
  if (!list.length) return;
  const vr = viewport.getBoundingClientRect(), NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'flowsvg'); svg.setAttribute('width', vr.width); svg.setAttribute('height', vr.height);
  svg.innerHTML = '<defs><marker id="ffArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--flow)"/></marker></defs>';
  overlay.appendChild(svg);
  const div = (cls, css, txt) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, css); if (txt != null) d.textContent = txt; overlay.appendChild(d); return d; };
  const path = (d, dashed) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('class', 'flowpath' + (dashed ? ' dashed' : '')); p.setAttribute('marker-end', 'url(#ffArrow)'); svg.appendChild(p); };
  const dot = (x, y) => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 4); c.setAttribute('class', 'flowdot'); svg.appendChild(c); };
  const slot = new Map();
  const maxRight = Math.max(...pageEls().filter(f => f.type === 'frame' && !f.parent && nodeOf(f.id)).map(f => { const q = screenRect(nodeOf(f.id)); return q.l + q.w; }), 0);
  list.forEach(e => {
    const r = screenRect(nodeOf(e.id));
    div('flowsrc', { left: r.l - 2 + 'px', top: r.t - 2 + 'px', width: r.w + 4 + 'px', height: r.h + 4 + 'px' });
    const sx = r.l + r.w / 2, sy = r.t + r.h;
    const lk = e.link, target = lk.kind === 'frame' ? get(lk.value) : null;
    const pill = (txt, cls, go) => {
      const i = slot.get('all') || 0; slot.set('all', i + 1);
      const py = Math.max(60, r.t) + i * 38;
      const p = div('flowpill' + (cls ? ' ' + cls : ''), { left: '0px', top: py + 'px' }, txt);
      const px = Math.max(sx + 20, Math.min(maxRight + 70, vr.width - p.offsetWidth - 14)); p.style.left = px + 'px';
      if (go) p.dataset.flowgo = go;
      dot(sx, sy);
      const d = Math.max(40, Math.abs(px - sx) / 2);
      path(`M${sx} ${sy} C${sx} ${sy + 50} ${px - d} ${py + 12} ${px - 2} ${py + 12}`, true);
    };
    if (lk.kind === 'url') { if (lk.value) pill('🌐 ' + (lk.value.length > 34 ? lk.value.slice(0, 33) + '…' : lk.value)); return; }
    if (!target) { div('flowchip warn', { left: sx + 'px', top: sy + 16 + 'px' }, '⚠ no target'); return; }
    if (target.page !== S.page || !nodeOf(target.id)) { const pg = S.pages.find(p => p.id === target.page); pill('↗ ' + target.name + (pg ? ' (' + pg.name + ')' : ''), '', target.id); return; }
    if (inside(e, target) && target.id === rootOf(e).id) { div('flowchip', { left: sx + 'px', top: sy + 16 + 'px' }, '↻ ' + target.name).dataset.flowgo = target.id; return; }
    const t = screenRect(nodeOf(target.id));
    const cands = [
      { x: t.l, y: t.t + t.h / 2, ox: -1, oy: 0 }, { x: t.l + t.w, y: t.t + t.h / 2, ox: 1, oy: 0 },
      { x: t.l + t.w / 2, y: t.t, ox: 0, oy: -1 }, { x: t.l + t.w / 2, y: t.t + t.h, ox: 0, oy: 1 }];
    cands.sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy));
    const c = cands[0], dist = Math.hypot(c.x - sx, c.y - sy), k = Math.max(40, dist / 2.2);
    const x0 = sx, y0 = sy, x1 = sx, y1 = sy + k, x2 = c.x + c.ox * k, y2 = c.y + c.oy * k, x3 = c.x + c.ox * 2, y3 = c.y + c.oy * 2;
    dot(sx, sy); path(`M${x0} ${y0} C${x1} ${y1} ${x2} ${y2} ${x3} ${y3}`, false);
    const mx = (x0 + 3 * x1 + 3 * x2 + x3) / 8, my = (y0 + 3 * y1 + 3 * y2 + y3) / 8;
    const label = (e.type === 'button' || e.type === 'text') && e.text ? e.text : e.name;
    div('flowchip', { left: mx + 'px', top: my + 'px' }, `${label.length > 18 ? label.slice(0, 17) + '…' : label} → ${target.name}`).dataset.flowgo = target.id;
  });
}

function renderOverlay() {
  overlay.innerHTML = '';
  const add = (cls, css, parent = overlay) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, css); parent.appendChild(d); return d; };
  const v = S.view;

  pageEls().filter(e => e.type === 'frame' && !e.parent && e.visible).forEach(e => {
    const n = nodeOf(e.id); if (!n) return;
    const r = screenRect(n);
    const l = add('flabel' + (S.sel.includes(e.id) ? ' sel' : ''), { left: r.l + 'px', top: r.t - 20 + 'px', maxWidth: Math.max(40, r.w) + 'px' });
    l.textContent = (e.isComp ? '◆ ' : '') + e.name; l.dataset.label = e.id;
  });
  if (hover && !S.sel.includes(hover) && !drag) {
    const n = nodeOf(hover);
    if (n) { const r = screenRect(n); add('hoverbox', { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', height: r.h + 'px' }); }
  }
  if (dropHint) {
    const n = nodeOf(dropHint);
    if (n) { const r = screenRect(n); add('drophint', { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', height: r.h + 'px' }); }
  }
  drawFlow();
  S.sel.forEach(id => {
    const n = nodeOf(id), e = get(id); if (!n || !e || !e.visible) return;
    const r = screenRect(n);
    const b = add('selbox' + (e.type === 'instance' || e.isComp ? ' comp' : ''), { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', height: r.h + 'px' });
    if (S.sel.length === 1 && !e.locked) {
      Object.entries(HANDLES).forEach(([k, [hx, hy]]) => { const h = add('h', { left: hx + '%', top: hy + '%' }, b); h.dataset.h = k; });
      add('dim', {}, b).textContent = `${Math.round(e.w)} × ${Math.round(e.h)}`;
    }
  });
  if (S.sel.length > 1) {
    const b = worldBounds(topmost(S.sel));
    if (b) add('selbox multi', { left: b.x1 * v.z + v.x + 'px', top: b.y1 * v.z + v.y + 'px', width: (b.x2 - b.x1) * v.z + 'px', height: (b.y2 - b.y1) * v.z + 'px' });
  }
  if (indicator) add('insert-line', { left: indicator.x * v.z + v.x + 'px', top: indicator.y * v.z + v.y + 'px', width: Math.max(2, indicator.w * v.z) + 'px', height: Math.max(2, indicator.h * v.z) + 'px' });
  if (marquee) add('marquee', { left: Math.min(marquee.x1, marquee.x2) * v.z + v.x + 'px', top: Math.min(marquee.y1, marquee.y2) * v.z + v.y + 'px', width: Math.abs(marquee.x2 - marquee.x1) * v.z + 'px', height: Math.abs(marquee.y2 - marquee.y1) * v.z + 'px' });

  snapGuides.forEach(g => {
    if (g.v) add('guide', { left: g.pos * v.z + v.x + 'px', top: g.a * v.z + v.y + 'px', width: '1px', height: (g.b - g.a) * v.z + 'px' });
    else add('guide', { top: g.pos * v.z + v.y + 'px', left: g.a * v.z + v.x + 'px', height: '1px', width: (g.b - g.a) * v.z + 'px' });
  });
  if (S.ui.rulers) {
    const vr = viewport.getBoundingClientRect();
    (curPage().guides || []).forEach((g, i) => {
      const x = g.axis === 'x';
      const l = add('gline ' + (x ? 'gv' : 'gh'), x ? { left: g.pos * v.z + v.x - 3 + 'px', top: 0, height: vr.height + 'px' } : { top: g.pos * v.z + v.y - 3 + 'px', left: 0, width: vr.width + 'px' });
      l.dataset.gi = i;
    });
  }
}

/* --------------------------------------------------------------- rulers */
const rulerTop = $('#rulerTop'), rulerLeft = $('#rulerLeft');
function drawRulers() {
  const on = S.ui.rulers;
  $('#rulerCorner').hidden = rulerTop.hidden = rulerLeft.hidden = !on;
  if (!on) return;
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--ruler-bg').trim(), fg = cs.getPropertyValue('--ruler-fg').trim(), acc = cs.getPropertyValue('--accent').trim();
  const dpr = window.devicePixelRatio || 1, vr = viewport.getBoundingClientRect(), v = S.view, T = 20;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const major = nice.find(s => s * v.z >= 60) || 5000, minor = major / 5;
  const sb = worldBounds(topmost(S.sel));
  [['x', rulerTop, vr.width - T, T], ['y', rulerLeft, T, vr.height - T]].forEach(([axis, cv, w, h]) => {
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    const off = axis === 'x' ? v.x - T : v.y - T, len = axis === 'x' ? w : h;
    if (sb) { c.fillStyle = acc + '33'; const a = (axis === 'x' ? sb.x1 : sb.y1) * v.z + off, b = (axis === 'x' ? sb.x2 : sb.y2) * v.z + off; if (axis === 'x') c.fillRect(a, 0, b - a, h); else c.fillRect(0, a, w, b - a); }
    c.strokeStyle = fg; c.fillStyle = fg; c.font = '9px system-ui'; c.lineWidth = 1;
    const from = Math.floor((-off) / v.z / minor) * minor, to = (len - off) / v.z;
    for (let p = from; p <= to; p += minor) {
      const s = Math.round(p * v.z + off) + 0.5, isMajor = Math.abs(p / major - Math.round(p / major)) < 1e-6, size = isMajor ? 12 : 5;
      c.beginPath();
      if (axis === 'x') { c.moveTo(s, h); c.lineTo(s, h - size); } else { c.moveTo(w, s); c.lineTo(w - size, s); }
      c.stroke();
      if (isMajor) {
        if (axis === 'x') c.fillText(String(Math.round(p)), s + 3, 9);
        else { c.save(); c.translate(9, s - 3); c.rotate(-Math.PI / 2); c.fillText(String(Math.round(p)), 0, 0); c.restore(); }
      }
    }
  });
}

/* -------------------------------------------------------------- minimap */
const mini = $('#minimap');
let miniMap = null;
function drawMinimap() {
  mini.hidden = !S.ui.minimap;
  if (!S.ui.minimap) return;
  const W = 160, H = 104, dpr = window.devicePixelRatio || 1, vr = viewport.getBoundingClientRect(), v = S.view;
  mini.width = W * dpr; mini.height = H * dpr;
  const c = mini.getContext('2d'); c.scale(dpr, dpr);
  const cs = getComputedStyle(document.documentElement);
  c.fillStyle = cs.getPropertyValue('--panel').trim(); c.fillRect(0, 0, W, H);
  const roots = pageEls().filter(e => !e.parent && e.visible);
  const vw = { x1: -v.x / v.z, y1: -v.y / v.z, x2: (vr.width - v.x) / v.z, y2: (vr.height - v.y) / v.z };
  let b = worldBounds(roots.map(e => e.id)) || vw;
  b = { x1: Math.min(b.x1, vw.x1), y1: Math.min(b.y1, vw.y1), x2: Math.max(b.x2, vw.x2), y2: Math.max(b.y2, vw.y2) };
  const pad = 6, k = Math.min((W - pad * 2) / (b.x2 - b.x1), (H - pad * 2) / (b.y2 - b.y1));
  const ox = (W - (b.x2 - b.x1) * k) / 2 - b.x1 * k, oy = (H - (b.y2 - b.y1) * k) / 2 - b.y1 * k;
  miniMap = { k, ox, oy };
  roots.forEach(e => {
    const f = e.fills[0]; c.fillStyle = f && f.color && f.color.startsWith('#') ? f.color : '#9ca3af';
    c.globalAlpha = .85; c.fillRect(e.x * k + ox, e.y * k + oy, Math.max(1, e.w * k), Math.max(1, e.h * k)); c.globalAlpha = 1;
  });
  c.strokeStyle = cs.getPropertyValue('--accent').trim(); c.lineWidth = 1.5;
  c.strokeRect(vw.x1 * k + ox, vw.y1 * k + oy, (vw.x2 - vw.x1) * k, (vw.y2 - vw.y1) * k);
}
