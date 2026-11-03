'use strict';
/* FrameForge – Device preview (Chrome DevTools-style responsive viewer).
   Renders a frame inside a device bezel using the editor's own buildNode/paint pipeline.
   It is isolated from the editor: it works on a snapshot of the document, builds nodes into a
   private registry, never touches S / selection / view / history, and restores the editor's
   RES/RMAP/RKIDS globals after every build. */

/* ------------------------------------------------------------------ data */
/* bezel = [top, right, bottom, left] in CSS px, outer = body corner radius, screen = screen corner radius */
const DV_KINDS = {
  notch:  { bezel: [14, 14, 14, 14], outer: 58, screen: 44 },
  island: { bezel: [12, 12, 12, 12], outer: 64, screen: 52 },
  punch:  { bezel: [10, 10, 10, 10], outer: 42, screen: 32 },
  home:   { bezel: [72, 16, 80, 16], outer: 46, screen: 4 },
  tablet: { bezel: [20, 20, 20, 20], outer: 36, screen: 16 },
  desk:   { bezel: [14, 14, 14, 14], outer: 18, screen: 6 },
  plain:  { bezel: [10, 10, 10, 10], outer: 22, screen: 12 },
};
const DV_DEVICES = [
  { id: 'iphone-se',     group: 'iPhone',  name: 'iPhone SE',          w: 375,  h: 667,  kind: 'home' },
  { id: 'iphone-xr',     group: 'iPhone',  name: 'iPhone XR',          w: 414,  h: 896,  kind: 'notch' },
  { id: 'iphone-12-pro', group: 'iPhone',  name: 'iPhone 12 Pro',      w: 390,  h: 844,  kind: 'notch' },
  { id: 'iphone-15-pro', group: 'iPhone',  name: 'iPhone 15 Pro',      w: 393,  h: 852,  kind: 'island' },
  { id: 'iphone-14-pm',  group: 'iPhone',  name: 'iPhone 14 Pro Max',  w: 430,  h: 932,  kind: 'island' },
  { id: 'galaxy-s8p',    group: 'Samsung', name: 'Galaxy S8+',         w: 360,  h: 740,  kind: 'punch' },
  { id: 'galaxy-s20u',   group: 'Samsung', name: 'Galaxy S20 Ultra',   w: 412,  h: 915,  kind: 'punch' },
  { id: 'galaxy-a51',    group: 'Samsung', name: 'Galaxy A51/71',      w: 412,  h: 914,  kind: 'punch' },
  { id: 'galaxy-fold5',  group: 'Samsung', name: 'Galaxy Z Fold 5',    w: 344,  h: 882,  kind: 'punch' },
  { id: 'pixel-5',       group: 'Pixel',   name: 'Pixel 5',            w: 393,  h: 851,  kind: 'punch' },
  { id: 'pixel-7',       group: 'Pixel',   name: 'Pixel 7',            w: 412,  h: 915,  kind: 'punch' },
  { id: 'ipad-mini',     group: 'iPad',    name: 'iPad Mini',          w: 768,  h: 1024, kind: 'tablet' },
  { id: 'ipad-air',      group: 'iPad',    name: 'iPad Air',           w: 820,  h: 1180, kind: 'tablet' },
  { id: 'ipad-pro',      group: 'iPad',    name: 'iPad Pro 12.9"',     w: 1024, h: 1366, kind: 'tablet' },
  { id: 'desktop',       group: 'Other',   name: 'Desktop',            w: 1440, h: 900,  kind: 'desk' },
  { id: 'custom',        group: 'Other',   name: 'Custom (responsive)', w: 390, h: 844,  kind: 'plain' },
];
const DV_MIN = 120, DV_MAX = 4000;
const DV_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3];
const DV_ZOOMS = [['fit', 'Fit to window'], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']];

const DV = {
  open: false, ctx: null, hist: [], hi: -1, cur: null, node: null, frame: null, opener: null,
  id: 'iphone-15-pro', cw: 390, ch: 844, land: false, zoom: 'fit', content: 'fit', hot: false,
  z: 1, G: null, suppress: false,
};

/* ----------------------------------------------------------------- utils */
const dvClamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dvSlug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
const dvDeviceDef = () => DV_DEVICES.find(d => d.id === DV.id) || DV_DEVICES[0];
const dvPct = z => Math.round(z * 100) + '%';

/* Run fn with the preview's snapshot installed in the editor's resolve globals, then restore them. */
function dvWith(fn) {
  const saved = [RES, RMAP, RKIDS];
  RES = DV.ctx.RES; RMAP = DV.ctx.RMAP; RKIDS = DV.ctx.RKIDS;
  try { return fn(); } finally { [RES, RMAP, RKIDS] = saved; }
}

/* Same resolve steps as resolveAll() (instances, tokens, text styles) but for every page, so links
   between frames on different pages work, and without touching the editor's own RES/RMAP/RKIDS. */
function dvSnapshot() {
  const RESx = expandInstances(S.els).map(effective);
  const RMAPx = new Map(RESx.map(e => [e.id, e]));
  const RKIDSx = new Map();
  RESx.forEach(e => { const k = e.parent && RMAPx.has(e.parent) ? e.parent : null; if (!RKIDSx.has(k)) RKIDSx.set(k, []); RKIDSx.get(k).push(e); });
  const frames = RESx.filter(e => e.type === 'frame' && !e.parent && !e.isComp && e.visible !== false);
  const used = new Set(), slugs = new Map();
  frames.forEach(f => {
    const base = dvSlug(f.name); let s = base, i = 2;
    while (used.has(s)) s = base + '-' + i++;
    used.add(s); slugs.set(f.id, s);
  });
  return { RES: RESx, RMAP: RMAPx, RKIDS: RKIDSx, frames, frameIds: new Set(frames.map(f => f.id)), slugs, project: dvSlug(S.name) };
}

/* ------------------------------------------------------------- preferences */
function dvLoadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('ff:devprev') || 'null'); if (!p || typeof p !== 'object') return false;
    if (DV_DEVICES.some(d => d.id === p.id)) DV.id = p.id;
    if (Number.isFinite(+p.cw) && +p.cw >= DV_MIN && +p.cw <= DV_MAX) DV.cw = Math.round(+p.cw);
    if (Number.isFinite(+p.ch) && +p.ch >= DV_MIN && +p.ch <= DV_MAX) DV.ch = Math.round(+p.ch);
    DV.land = !!p.land;
    DV.zoom = p.zoom === 'fit' || (Number.isFinite(+p.zoom) && +p.zoom >= 0.1 && +p.zoom <= 4) ? (p.zoom === 'fit' ? 'fit' : +p.zoom) : 'fit';
    DV.content = p.content === '1' ? '1' : 'fit';
    return true;
  } catch (_) { return false; }
}
function dvSavePrefs() {
  try { localStorage.setItem('ff:devprev', JSON.stringify({ id: DV.id, cw: DV.cw, ch: DV.ch, land: DV.land, zoom: DV.zoom, content: DV.content })); } catch (_) {}
}

/* ---------------------------------------------------------------- geometry */
function dvGeom() {
  const d = dvDeviceDef(), k = DV_KINDS[d.kind] || DV_KINDS.plain;
  const base = d.id === 'custom' ? { w: DV.cw, h: DV.ch } : { w: d.w, h: d.h };
  const [bt, br, bb, bl] = k.bezel;
  const pW = base.w + bl + br, pH = base.h + bt + bb;               // outer box in portrait
  return DV.land
    ? { d, k, pW, pH, vw: base.h, vh: base.w, W: pH, H: pW, pad: [bl, bt, br, bb], bez: k.bezel }
    : { d, k, pW, pH, vw: base.w, vh: base.h, W: pW, H: pH, pad: [bt, br, bb, bl], bez: k.bezel };
}
/* Camera cut-outs, speaker, home button and side buttons, in portrait coordinates of the outer box. */
function dvDecor(G) {
  const { d, pW: W, pH: H, bez: [bt] } = G, out = [];
  const add = (cls, x, y, w, h, r = 0) => out.push({ cls, x, y, w, h, r });
  if (d.kind === 'notch') add('cut', (W - 150) / 2, bt, 150, 28, [0, 0, 18, 18]);
  if (d.kind === 'island') add('cut', (W - 104) / 2, bt + 10, 104, 30, 15);
  if (d.kind === 'punch') add('cut', (W - 14) / 2, bt + 12, 14, 14, 7);
  if (d.kind === 'home') {
    add('grille', (W - 64) / 2, bt / 2 - 3, 64, 6, 3); add('grille', (W - 64) / 2 - 26, bt / 2 - 4, 8, 8, 4);
    add('ring', (W - 48) / 2, H - G.bez[2] / 2 - 24, 48, 48, 24);
  }
  if (d.kind === 'tablet') add('grille', (W - 8) / 2, bt / 2 - 4, 8, 8, 4);
  if (['notch', 'island', 'punch', 'home'].includes(d.kind)) {
    add('btn', -3, H * 0.16, 3, 38, [3, 0, 0, 3]); add('btn', -3, H * 0.16 + 50, 3, 38, [3, 0, 0, 3]);
    add('btn', W, H * 0.22, 3, 70, [0, 3, 3, 0]);
  }
  if (d.kind === 'tablet') add('btn', W * 0.78, -3, 50, 3, [3, 3, 0, 0]);
  return out;
}
const dvRot4 = r => Array.isArray(r) ? [r[3], r[0], r[1], r[2]] : r;     // rotate corner radii 90° clockwise

/* ---------------------------------------------------------------- layout */
function dvFitZoom(G) {
  const st = $('#dvStage'), w = st.clientWidth - 48, h = st.clientHeight - 48;
  if (!(w > 0 && h > 0)) return 1;
  return dvClamp(Math.min(w / G.W, h / G.H, 1), 0.1, 1);
}
function dvLayout() {
  if (!DV.open) return;
  const G = DV.G = dvGeom(), z = DV.z = DV.zoom === 'fit' ? dvFitZoom(G) : dvClamp(+DV.zoom || 1, 0.1, 4);
  const dev = $('#dvDevice'), scr = $('#dvScreen'), sizer = $('#dvSizer');
  $('#dvScaler').style.cssText = `width:${G.W * z}px;height:${G.H * z}px`;
  dev.style.cssText = `width:${G.W}px;height:${G.H}px;border-radius:${G.k.outer}px;transform:scale(${z})`;
  scr.style.cssText = `left:${G.pad[3]}px;top:${G.pad[0]}px;width:${G.vw}px;height:${G.vh}px;border-radius:${G.k.screen}px`;
  dev.dataset.kind = G.d.kind;
  dev.querySelectorAll('.dvp-decor').forEach(n => n.remove());
  dvDecor(G).forEach(r => {
    let { x, y, w, h } = r, rad = r.r;
    if (DV.land) { [x, y, w, h] = [G.pH - y - h, x, h, w]; rad = dvRot4(rad); }
    const n = document.createElement('div'); n.className = 'dvp-decor ' + r.cls;
    n.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Array.isArray(rad) ? rad.map(v => v + 'px').join(' ') : rad + 'px'}`;
    dev.appendChild(n);
  });
  const f = DV.frame, node = DV.node;
  if (f && node) {
    const fw = +f.w > 0 ? +f.w : 360, fh = node.offsetHeight > 0 ? node.offsetHeight : (+f.h > 0 ? +f.h : 640);
    // Fit width: scale to the viewport width; but never blow a small design up past 125% (it is centred instead).
    let cs = DV.content === '1' ? 1 : G.vw / fw;
    if (DV.content !== '1' && cs > 1.25) cs = 1;
    sizer.style.cssText = `width:${fw * cs}px;height:${fh * cs}px`;
    node.style.transform = `scale(${cs})`;
    DV.cs = cs;
  }
  dvSync();
}
function dvSync() {
  const G = DV.G; if (!G) return;
  const root = $('#dvp');
  root.classList.toggle('custom', G.d.id === 'custom');
  $('#dvDeviceSel').value = G.d.id;
  const w = $('#dvW'), h = $('#dvH');
  if (document.activeElement !== w) w.value = G.vw;
  if (document.activeElement !== h) h.value = G.vh;
  w.classList.remove('bad'); h.classList.remove('bad');
  $('#dvRotate').setAttribute('aria-pressed', String(DV.land));
  $('#dvContent').value = DV.content;
  const zs = $('#dvZoom');
  zs.querySelectorAll('option[data-dyn]').forEach(o => o.remove());
  const fitOpt = zs.querySelector('option[value=fit]');
  fitOpt.textContent = DV.zoom === 'fit' ? `Fit (${dvPct(DV.z)})` : 'Fit to window';
  if (DV.zoom === 'fit') zs.value = 'fit';
  else {
    const key = String(DV.z);
    if (![...zs.options].some(o => o.value === key)) { const o = document.createElement('option'); o.value = key; o.textContent = dvPct(DV.z); o.dataset.dyn = '1'; zs.appendChild(o); }
    zs.value = key;
  }
  $('#dvBack').disabled = DV.hi <= 0;
  $('#dvFwd').disabled = DV.hi >= DV.hist.length - 1;
  $('#dvHot').setAttribute('aria-pressed', String(DV.hot));
  $('#dvp').classList.toggle('hot', DV.hot);
  $('#dvStatus').textContent = `${G.d.id === 'custom' ? 'Custom' : G.d.name} · ${G.vw} × ${G.vh} · ${DV.land ? 'Landscape' : 'Portrait'} · ${dvPct(DV.z)} · content ${DV.content === '1' ? '100%' : dvPct(DV.cs || 1)}`;
}

/* --------------------------------------------------------------- content */
function dvMount(keepScroll) {
  const f = DV.ctx && DV.ctx.RMAP.get(DV.cur);
  const scr = $('#dvScreen'), sizer = $('#dvSizer');
  sizer.replaceChildren(); DV.node = null; DV.frame = null;
  if (!f) { dvSetAddr(); dvLayout(); return false; }
  const top = keepScroll ? scr.scrollTop : 0, left = keepScroll ? scr.scrollLeft : 0;
  const node = dvWith(() => buildNode(f, new Map()));       // private registry: the editor's NODES map is untouched
  node.style.left = '0px'; node.style.top = '0px'; node.style.transformOrigin = '0 0';
  sizer.appendChild(node); DV.node = node; DV.frame = f;
  dvSetAddr(); dvLayout();
  scr.scrollTop = top; scr.scrollLeft = left;
  return true;
}
function dvSetAddr() {
  const c = DV.ctx, f = DV.frame;
  $('#dvAddr').value = c && f ? `frameforge://preview/${c.project}/${c.slugs.get(f.id) || dvSlug(f.name)}` : 'frameforge://preview/';
  const sel = $('#dvFrame'); if (f && sel.value !== f.id) sel.value = f.id;
}
function dvBuildFrameSelect() {
  const sel = $('#dvFrame'); sel.replaceChildren();
  const multi = S.pages.length > 1;
  const groups = new Map();
  DV.ctx.frames.forEach(f => {
    const pg = (S.pages.find(p => p.id === f.page) || {}).name || 'Page';
    if (!groups.has(pg)) groups.set(pg, []); groups.get(pg).push(f);
  });
  groups.forEach((fs, pg) => {
    const parent = multi ? Object.assign(document.createElement('optgroup'), { label: pg }) : sel;
    fs.forEach(f => { const o = document.createElement('option'); o.value = f.id; o.textContent = `${f.name} (${Math.round(f.w)}×${Math.round(f.h)})`; parent.appendChild(o); });
    if (multi) sel.appendChild(parent);
  });
}
function dvBuildDeviceSelect() {
  const sel = $('#dvDeviceSel'); if (sel.options.length) return;
  const gs = new Map();
  DV_DEVICES.forEach(d => { if (!gs.has(d.group)) gs.set(d.group, Object.assign(document.createElement('optgroup'), { label: d.group })); const o = document.createElement('option'); o.value = d.id; o.textContent = d.id === 'custom' ? d.name : `${d.name} (${d.w}×${d.h})`; gs.get(d.group).appendChild(o); });
  gs.forEach(g => sel.appendChild(g));
  const zs = $('#dvZoom'); DV_ZOOMS.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; zs.appendChild(o); });
}

/* ------------------------------------------------------------- navigation */
function dvGo(id, push = true) {
  const c = DV.ctx;
  if (!c || !c.frameIds.has(id)) { toast('That frame no longer exists', true); dvSetAddr(); return false; }
  if (push) { DV.hist = DV.hist.slice(0, DV.hi + 1); if (DV.hist[DV.hist.length - 1] !== id) DV.hist.push(id); DV.hi = DV.hist.length - 1; }
  DV.cur = id; dvMount(false); return true;
}
function dvStep(dir) {
  const i = DV.hi + dir; if (i < 0 || i >= DV.hist.length) return;
  const id = DV.hist[i];
  if (!DV.ctx.frameIds.has(id)) { toast('That frame no longer exists', true); return; }
  DV.hi = i; DV.cur = id; dvMount(false);
}
function dvReload() {
  DV.ctx = dvSnapshot(); dvBuildFrameSelect();
  DV.hist = DV.hist.filter(id => DV.ctx.frameIds.has(id)); DV.hi = Math.min(DV.hi, DV.hist.length - 1);
  if (!DV.ctx.frameIds.has(DV.cur)) {
    if (!DV.ctx.frames.length) { toast('No frames to preview', true); return dvClose(); }
    toast('The frame was removed – showing the first frame', true); DV.cur = DV.ctx.frames[0].id; DV.hist = [DV.cur]; DV.hi = 0; return dvMount(false);
  }
  dvMount(true); toast('Reloaded');
}
function dvGoAddress(text) {
  const c = DV.ctx, raw = String(text || '').trim();
  const seg = raw.replace(/^[a-z]+:\/\//i, '').replace(/[?#].*$/, '').split('/').filter(Boolean).pop() || '';
  const want = dvSlug(seg), low = seg.toLowerCase();
  const f = c.frames.find(x => c.slugs.get(x.id) === want) || c.frames.find(x => x.name.toLowerCase() === low || x.id === seg);
  if (f) return dvGo(f.id, f.id !== DV.cur);
  toast(`No frame matches "${seg || raw}"`, true); dvSetAddr();
}

/* ------------------------------------------------------------ device state */
function dvSetViewport(vw, vh) {
  vw = Math.round(+vw); vh = Math.round(+vh);
  if (![vw, vh].every(v => Number.isFinite(v) && v >= DV_MIN && v <= DV_MAX)) return false;
  DV.id = 'custom';
  if (DV.land) { DV.cw = vh; DV.ch = vw; } else { DV.cw = vw; DV.ch = vh; }
  return true;
}
function dvPickDevice(f) {                       // sensible default for the frame's width
  const w = +f.w || 0;
  if (w > 0 && w <= 480) { DV.id = 'iphone-15-pro'; DV.land = false; }
  else if (w <= 900) { DV.id = 'ipad-mini'; DV.land = false; }
  else if (w <= 1200) { DV.id = 'ipad-air'; DV.land = true; }
  else { DV.id = 'desktop'; DV.land = false; }
}

/* -------------------------------------------------------------- open/close */
function openDevicePreview() {
  if (DV.open) return;
  let ctx;
  try { ctx = dvSnapshot(); } catch (err) { return toast('Could not prepare the preview: ' + err.message, true); }
  if (!ctx.frames.length) return toast('Add a frame first', true);
  const se = S.sel.length ? get(S.sel[0]) : null, sr = se ? rootOf(se) : null;
  const start = sr && ctx.frameIds.has(sr.id) ? sr : (ctx.frames.find(f => f.page === S.page) || ctx.frames[0]);
  DV.ctx = ctx; DV.opener = document.activeElement;
  if (!dvLoadPrefs()) dvPickDevice(start);
  dvBuildDeviceSelect(); dvBuildFrameSelect();
  DV.open = true; DV.hist = [start.id]; DV.hi = 0; DV.cur = start.id; DV.hot = false;
  document.querySelectorAll('.topbar, .workspace').forEach(n => { n.inert = true; });
  const root = $('#dvp'); root.hidden = false; root.focus({ preventScroll: true });
  $('#dvFrame').value = start.id;
  dvMount(false);
  requestAnimationFrame(() => dvLayout());
}
function dvClose() {
  if (!DV.open) return;
  dvSavePrefs();
  DV.open = false; DV.ctx = null; DV.node = null; DV.frame = null; DV.cur = null; DV.hist = []; DV.hi = -1;
  $('#dvSizer').replaceChildren(); $('#dvp').hidden = true;
  document.querySelectorAll('.topbar, .workspace').forEach(n => { n.inert = false; });
  try { if (DV.opener && DV.opener.focus) DV.opener.focus({ preventScroll: true }); } catch (_) {}
  DV.opener = null;
}

/* ---------------------------------------------------------------- controls */
function dvStepZoom(dir) {
  const z = DV.z;
  DV.zoom = dir > 0 ? (DV_STEPS.find(s => s > z + 0.005) || 3) : ([...DV_STEPS].reverse().find(s => s < z - 0.005) || 0.25);
  dvLayout(); dvSavePrefs();
}
$('#dvp').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b || !DV.open) return;
  switch (b.id) {
    case 'dvClose': return dvClose();
    case 'dvBack': return dvStep(-1);
    case 'dvFwd': return dvStep(1);
    case 'dvReload': return dvReload();
    case 'dvHot': DV.hot = !DV.hot; return dvSync();
    case 'dvRotate': DV.land = !DV.land; dvLayout(); return dvSavePrefs();
    case 'dvZoomIn': return dvStepZoom(1);
    case 'dvZoomOut': return dvStepZoom(-1);
    case 'dvFit': DV.zoom = 'fit'; dvLayout(); return dvSavePrefs();
  }
});
$('#dvp').addEventListener('change', ev => {
  const t = ev.target; if (!DV.open) return;
  if (t.id === 'dvFrame') return void dvGo(t.value, true);
  if (t.id === 'dvDeviceSel') {
    if (t.value === 'custom' && DV.id !== 'custom') { const G = DV.G; DV.cw = DV.land ? G.vh : G.vw; DV.ch = DV.land ? G.vw : G.vh; }
    DV.id = t.value; dvLayout(); return dvSavePrefs();
  }
  if (t.id === 'dvContent') { DV.content = t.value === '1' ? '1' : 'fit'; dvLayout(); return dvSavePrefs(); }
  if (t.id === 'dvZoom') { DV.zoom = t.value === 'fit' ? 'fit' : (+t.value || 1); dvLayout(); return dvSavePrefs(); }
  if (t.id === 'dvW' || t.id === 'dvH') {
    if (!dvSetViewport($('#dvW').value, $('#dvH').value)) {
      t.classList.add('bad'); toast(`Width and height must be whole numbers between ${DV_MIN} and ${DV_MAX}`, true);
      $('#dvW').value = DV.G.vw; $('#dvH').value = DV.G.vh; return;
    }
    dvLayout(); dvSavePrefs();
  }
});
$('#dvAddr').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); dvGoAddress(ev.target.value); ev.target.blur(); } });
$('#dvAddr').addEventListener('focus', ev => ev.target.select());

/* Ctrl/⌘ + wheel zooms the device; plain wheel scrolls inside the device viewport only. */
$('#dvStage').addEventListener('wheel', ev => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  ev.preventDefault();
  DV.zoom = dvClamp(DV.z * Math.exp(-ev.deltaY * 0.002), 0.1, 4); dvLayout();
}, { passive: false });
new ResizeObserver(() => { if (DV.open) dvLayout(); }).observe($('#dvStage'));
window.addEventListener('resize', () => { if (DV.open) dvLayout(); });

/* Prototype links inside the device: frame links navigate, URL links open in a new tab. */
$('#dvScreen').addEventListener('click', ev => {
  if (DV.suppress) { ev.preventDefault(); ev.stopPropagation(); return; }
  let n = ev.target.closest('.el');
  while (n) {
    const e = DV.ctx && DV.ctx.RMAP.get(n.dataset.id), lk = e && e.link;
    if (lk && lk.kind === 'frame' && lk.value) { if (DV.ctx.frameIds.has(lk.value)) dvGo(lk.value, true); else toast('The linked frame no longer exists', true); return; }
    if (lk && lk.kind === 'url' && lk.value) {
      if (/^https?:\/\//i.test(lk.value)) window.open(lk.value, '_blank', 'noopener');
      else if (/^(#|javascript:)/i.test(lk.value)) { /* in-page anchor: nothing to do */ }
      else {                                              // "/teachers" or "teachers.html": open the frame with that name, if any
        const seg = dvSlug(lk.value.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() || '').replace(/-html?$/, '');
        const hit = DV.ctx.frames.find(f => DV.ctx.slugs.get(f.id) === seg || dvSlug(f.name) === seg);
        if (hit) dvGo(hit.id, true); else toast(`"${lk.value}" does not match any frame`, true);
      }
      return;
    }
    n = n.parentElement && n.parentElement.closest('.el');
  }
}, true);

/* Mouse drag-to-scroll inside the viewport (touch devices scroll natively). */
let dvDrag = null;
$('#dvScreen').addEventListener('pointerdown', ev => {
  if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
  const s = $('#dvScreen'); dvDrag = { x: ev.clientX, y: ev.clientY, sl: s.scrollLeft, st: s.scrollTop, moved: false };
});
window.addEventListener('pointermove', ev => {
  if (!dvDrag) return;
  const dx = (ev.clientX - dvDrag.x) / DV.z, dy = (ev.clientY - dvDrag.y) / DV.z;
  if (!dvDrag.moved && Math.hypot(dx, dy) < 5) return;
  dvDrag.moved = true; const s = $('#dvScreen'); s.classList.add('drag'); s.scrollLeft = dvDrag.sl - dx; s.scrollTop = dvDrag.st - dy;
});
window.addEventListener('pointerup', () => {
  if (!dvDrag) return;
  DV.suppress = dvDrag.moved; dvDrag = null; $('#dvScreen').classList.remove('drag');
  setTimeout(() => { DV.suppress = false; }, 0);
});

/* Drag the edges of a "Custom" device to resize it like DevTools' responsive mode. */
$$('#dvp .dvp-h').forEach(h => {
  h.addEventListener('pointerdown', ev => {
    if (!DV.open) return; ev.preventDefault(); h.setPointerCapture(ev.pointerId);
    const G = DV.G, sx = ev.clientX, sy = ev.clientY, w0 = G.vw, h0 = G.vh, dir = h.dataset.dir;
    const move = e2 => {
      const nw = dir.includes('r') ? w0 + (e2.clientX - sx) / DV.z : w0, nh = dir.includes('b') ? h0 + (e2.clientY - sy) / DV.z : h0;
      if (dvSetViewport(dvClamp(nw, DV_MIN, DV_MAX), dvClamp(nh, DV_MIN, DV_MAX))) dvLayout();
    };
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); dvSavePrefs(); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
});

/* Keyboard: the preview owns the keyboard while open so editor shortcuts (Delete, Ctrl+S, Space…) cannot fire. */
window.addEventListener('keydown', ev => {
  if (!DV.open) return;
  const t = ev.target, field = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.closest && t.closest('#dvp');
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); ev.stopPropagation(); return; }
  if (ev.key === 'Escape') { ev.stopPropagation(); if (field) { if (t.id === 'dvAddr') dvSetAddr(); t.blur(); } else dvClose(); return; }
  if (field) return;                                   // typing in a preview field: the editor ignores it
  ev.stopPropagation();
  if ((ev.altKey && ev.key === 'ArrowLeft') || ev.key === 'Backspace') { ev.preventDefault(); dvStep(-1); }
  else if (ev.altKey && ev.key === 'ArrowRight') { ev.preventDefault(); dvStep(1); }
}, true);
window.addEventListener('keyup', ev => {
  if (!DV.open) return;
  const t = ev.target; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.closest && t.closest('#dvp')) return;
  ev.stopPropagation();
}, true);
