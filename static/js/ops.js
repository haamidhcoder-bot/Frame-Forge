'use strict';
/* FrameForge – editing operations: ordering, clipboard, group, auto-layout, align, components, snapping. */

function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2400);
}
function setSel(ids) { S.sel = ids; renderLayers(); renderProps(); renderOverlay(); drawRulers(); }
const selEls = () => S.sel.map(get).filter(Boolean);

/* --------------------------------------------------------------- z-order */
function reorder(mode) {
  S.sel.forEach(id => {
    const e = get(id); if (!e) return;
    const sibs = S.els.filter(o => o.parent === e.parent && o.page === e.page), i = sibs.indexOf(e);
    let ref, after;
    if (mode === 'front') { ref = sibs[sibs.length - 1]; after = true; }
    else if (mode === 'back') { ref = sibs[0]; after = false; }
    else if (mode === 'forward') { ref = sibs[i + 1]; after = true; }
    else { ref = sibs[i - 1]; after = false; }
    if (!ref || ref === e) return;
    S.els.splice(S.els.indexOf(e), 1);
    const ri = S.els.indexOf(ref); S.els.splice(after ? ri + 1 : ri, 0, e);
  });
  reindex(); commit(); render();
}
function removeSel() {
  if (!S.sel.length) return;
  const rm = new Set();
  S.sel.forEach(id => { rm.add(id); descendants(id).forEach(d => rm.add(d)); });
  S.els = S.els.filter(e => !rm.has(e.id)); S.sel = []; reindex();
  commit(); render();
}
function collectTree(ids) {
  const nodes = [];
  topmost(ids).forEach(id => { nodes.push(get(id), ...descendants(id).map(get)); });
  return clone(nodes);
}
function pasteNodes(nodes, offset = 20) {
  const map = {}; nodes.forEach(n => map[n.id] = uid());
  const tops = [];
  nodes.forEach(n => {
    const c = clone(n), top = !(n.parent in map);
    c.id = map[n.id]; c.page = S.page;
    if (top) {
      c.parent = n.parent && get(n.parent) && get(n.parent).page === S.page ? n.parent : null;
      if (!isAuto(get(c.parent))) { c.x += offset; c.y += offset; }
      tops.push(c.id);
    } else c.parent = map[n.parent];
    S.els.push(c);
  });
  reindex(); S.sel = tops; commit(); render();
}
function duplicate() { if (S.sel.length) pasteNodes(collectTree(S.sel)); }

/* --------------------------------------------------- DOM-relative position */
function relPos(e, container) {
  const n = nodeOf(e.id), c = nodeOf(container.id);
  if (!n || !c) return { x: e.x, y: e.y };
  const r = n.getBoundingClientRect(), cr = c.getBoundingClientRect();
  return { x: Math.round((r.left - cr.left) / S.view.z), y: Math.round((r.top - cr.top) / S.view.z) };
}
function placeIn(e, parentId, anchorId) {
  S.els.splice(S.els.indexOf(e), 1);
  e.parent = parentId;
  let at;
  if (anchorId) at = S.els.findIndex(o => o.id === anchorId);
  else {
    const sibs = S.els.filter(o => o.parent === parentId);
    at = sibs.length ? S.els.indexOf(sibs[sibs.length - 1]) + 1 : S.els.length;
  }
  S.els.splice(at < 0 ? S.els.length : at, 0, e);
}

/* ----------------------------------------------------------------- group */
function groupSel() {
  const ids = topmost(S.sel).filter(id => !get(id).locked);
  if (!ids.length) return;
  const els = ids.map(get), par = els[0].parent;
  if (!els.every(e => e.parent === par)) return toast('Select layers that share the same parent', true);
  if (isAuto(get(par))) return toast('Inside an auto-layout frame, use "Add auto layout" instead', true);
  const x1 = Math.min(...els.map(e => e.x)), y1 = Math.min(...els.map(e => e.y));
  const x2 = Math.max(...els.map(e => e.x + e.w)), y2 = Math.max(...els.map(e => e.y + e.h));
  const g = mk('group', { parent: par, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  const order = els.map(e => S.els.indexOf(e)), at = Math.max(...order);
  const sorted = els.slice().sort((a, b) => S.els.indexOf(a) - S.els.indexOf(b));
  const arr = [];
  S.els.forEach((e, i) => { if (!ids.includes(e.id)) arr.push(e); if (i === at) arr.push(g, ...sorted); });
  els.forEach(e => { e.parent = g.id; e.x -= x1; e.y -= y1; });
  S.els = arr; reindex(); S.sel = [g.id]; commit(); render();
}
function ungroupSel() {
  const conts = topmost(S.sel).map(get).filter(isContainer);
  if (!conts.length) return toast('Select a group or frame to ungroup', true);
  const out = [];
  conts.forEach(c => {
    const par = c.parent, flow = isAuto(c), ch = kids(c.id);
    const pos = ch.map(k => flow ? relPos(k, c) : { x: k.x, y: k.y });
    const at = S.els.indexOf(c);
    ch.forEach((k, i) => { k.x = pos[i].x + (isAuto(get(par)) ? 0 : c.x); k.y = pos[i].y + (isAuto(get(par)) ? 0 : c.y); k.parent = par; k.sizeW = k.sizeW; });
    S.els.splice(at, 1);
    out.push(...ch.map(k => k.id));
  });
  reindex(); S.sel = out; commit(); render();
}

/* ----------------------------------------------------------- auto layout */
function arrange(els) {
  const x1 = Math.min(...els.map(e => e.x)), x2 = Math.max(...els.map(e => e.x + e.w));
  const y1 = Math.min(...els.map(e => e.y)), y2 = Math.max(...els.map(e => e.y + e.h));
  const dir = (x2 - x1) >= (y2 - y1) ? 'row' : 'column';
  const sorted = els.slice().sort((a, b) => dir === 'row' ? a.x - b.x : a.y - b.y);
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) gaps += Math.max(0, dir === 'row' ? sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w) : sorted[i].y - (sorted[i - 1].y + sorted[i - 1].h));
  return { dir, sorted, gap: sorted.length > 1 ? Math.round(gaps / (sorted.length - 1)) : 0, x1, y1, x2, y2 };
}
function reslot(sorted) {
  const slots = sorted.map(e => S.els.indexOf(e)).sort((a, b) => a - b);
  sorted.forEach((e, i) => { S.els[slots[i]] = e; });
}
function toggleAuto() {
  const ids = topmost(S.sel).filter(id => !get(id).locked);
  if (!ids.length) return;
  const els = ids.map(get);
  if (els.length === 1 && isContainer(els[0])) {
    const c = els[0];
    if (isAuto(c)) {              // remove auto layout, keep what is on screen
      const ch = kids(c.id), pos = ch.map(k => relPos(k, c));
      ch.forEach((k, i) => { k.x = pos[i].x; k.y = pos[i].y; k.sizeW = k.sizeW === 'fill' ? 'fixed' : k.sizeW; k.sizeH = k.sizeH === 'fill' ? 'fixed' : k.sizeH; });
      c.layout = 'none'; c.sizeW = c.sizeW === 'hug' ? 'fixed' : c.sizeW; c.sizeH = c.sizeH === 'hug' ? 'fixed' : c.sizeH;
    } else {
      const ch = kids(c.id);
      if (ch.length) {
        const a = arrange(ch); reslot(a.sorted);
        c.layout = a.dir; c.gap = a.gap; c.padX = Math.max(0, Math.round(a.x1)); c.padY = Math.max(0, Math.round(a.y1));
      } else { c.layout = 'column'; c.gap = 12; c.padX = c.padY = 16; }
      c.sizeW = c.sizeW === 'fixed' && ch.length ? 'hug' : c.sizeW; c.sizeH = ch.length ? 'hug' : c.sizeH;
    }
    commit(); render(); return;
  }
  const par = els[0].parent;
  if (!els.every(e => e.parent === par)) return toast('Select layers that share the same parent', true);
  const flow = isAuto(get(par));
  const pos = els.map(e => flow ? relPos(e, get(par)) : { x: e.x, y: e.y });
  els.forEach((e, i) => { e.x = pos[i].x; e.y = pos[i].y; });
  const a = arrange(els);
  const f = mk('frame', { name: 'Auto layout', parent: par, x: a.x1, y: a.y1, w: a.x2 - a.x1, h: a.y2 - a.y1, fills: [], clip: false, layout: a.dir, gap: a.gap, sizeW: 'hug', sizeH: 'hug' });
  const at = Math.max(...els.map(e => S.els.indexOf(e)));
  const arr = [];
  S.els.forEach((e, i) => { if (!ids.includes(e.id)) arr.push(e); if (i === at) arr.push(f, ...a.sorted); });
  els.forEach(e => { e.parent = f.id; });
  S.els = arr; reindex(); S.sel = [f.id]; commit(); render();
}

/* -------------------------------------------------------- align / spread */
function alignSel(dir) {
  const els = topmost(S.sel).map(get).filter(e => !e.locked);
  if (!els.length) return;
  if (els.length === 1) {
    const e = els[0], p = parentOf(e); if (!p || isAuto(p)) return;
    if (dir === 'left') e.x = 0; if (dir === 'right') e.x = p.w - e.w; if (dir === 'hc') e.x = Math.round((p.w - e.w) / 2);
    if (dir === 'top') e.y = 0; if (dir === 'bottom') e.y = p.h - e.h; if (dir === 'vc') e.y = Math.round((p.h - e.h) / 2);
  } else {
    if (!els.every(e => e.parent === els[0].parent) || isAuto(parentOf(els[0]))) return toast('Select layers with the same, non-auto-layout parent', true);
    const x1 = Math.min(...els.map(e => e.x)), x2 = Math.max(...els.map(e => e.x + e.w));
    const y1 = Math.min(...els.map(e => e.y)), y2 = Math.max(...els.map(e => e.y + e.h));
    els.forEach(e => {
      if (dir === 'left') e.x = x1; if (dir === 'right') e.x = x2 - e.w; if (dir === 'hc') e.x = Math.round((x1 + x2) / 2 - e.w / 2);
      if (dir === 'top') e.y = y1; if (dir === 'bottom') e.y = y2 - e.h; if (dir === 'vc') e.y = Math.round((y1 + y2) / 2 - e.h / 2);
    });
  }
  commit(); refresh(); syncProps();
}
function distribute(axis) {
  const els = topmost(S.sel).map(get).filter(e => !e.locked);
  if (els.length < 3 || !els.every(e => e.parent === els[0].parent) || isAuto(parentOf(els[0]))) return toast('Select 3+ layers with the same, non-auto-layout parent', true);
  const k = axis === 'h' ? 'x' : 'y', s = axis === 'h' ? 'w' : 'h';
  els.sort((a, b) => a[k] - b[k]);
  const first = els[0][k], last = els[els.length - 1][k] + els[els.length - 1][s];
  const total = els.reduce((t, e) => t + e[s], 0), gap = (last - first - total) / (els.length - 1);
  let pos = first;
  els.forEach(e => { e[k] = Math.round(pos); pos += e[s] + gap; });
  commit(); refresh(); syncProps();
}

/* ------------------------------------------------------------ components */
function createComponent() {
  let els = topmost(S.sel).map(get);
  if (!els.length) return;
  if (els.length > 1 || !isContainer(els[0])) { groupSel(); els = topmost(S.sel).map(get); if (!isContainer(els[0])) return; }
  const c = els[0];
  c.isComp = true; if (/^(Group|Frame|Auto layout) /.test(c.name) || c.name === 'Auto layout') c.name = 'Component ' + (S.els.filter(e => e.isComp).length);
  commit(); render(); toast('Component created. Insert copies from Library ▸ Components');
}
function components() { return S.els.filter(e => e.isComp && isContainer(e)); }
function createInstance(masterId, parentId = null, at = null) {
  const m = get(masterId); if (!m) return;
  if (parentId && (parentId === masterId || isInside(parentId, masterId))) return toast("Can't put a component inside itself", true);
  const par = parentId ? get(parentId) : null;
  const c = viewport.getBoundingClientRect();
  const wp = at || { x: (c.width / 2 - S.view.x) / S.view.z - m.w / 2, y: (c.height / 2 - S.view.y) / S.view.z - m.h / 2 };
  const pa = par ? absPos(par) : { x: 0, y: 0 };
  const inst = mk('instance', { name: m.name, ref: m.id, parent: par ? par.id : null, x: Math.round(wp.x - pa.x), y: Math.round(wp.y - pa.y), w: m.w, h: m.h, sizeW: m.sizeW === 'fill' ? 'fixed' : m.sizeW, sizeH: m.sizeH === 'fill' ? 'fixed' : m.sizeH, overrides: {} });
  S.els.push(inst); reindex(); S.sel = [inst.id]; commit(); render();
}
function detachInstance() {
  const insts = topmost(S.sel).map(get).filter(e => e && e.type === 'instance');
  if (!insts.length) return;
  const sel = [];
  insts.forEach(inst => {
    const byId = new Map(S.els.map(e => [e.id, e])), kidsOf = new Map();
    S.els.forEach(e => { const k = e.parent || null; if (!kidsOf.has(k)) kidsOf.set(k, []); kidsOf.get(k).push(e); });
    const parts = expandOne(inst, byId, kidsOf), map = {};
    parts.forEach(p => { map[p.id] = p.id === inst.id ? inst.id : uid(); });
    parts.forEach(p => { p.id = map[p.id]; if (p.parent in map) p.parent = map[p.parent]; });
    const at = S.els.indexOf(inst);
    S.els.splice(at, 1, ...parts.map(migrate));
    sel.push(inst.id);
  });
  reindex(); S.sel = sel; commit(); render();
}
function setOverride(instId, childId, key, value) {
  const inst = get(instId); if (!inst) return;
  inst.overrides = inst.overrides || {};
  inst.overrides[childId] = Object.assign(inst.overrides[childId] || {}, { [key]: value });
  refresh();
}
/* Elements inside a component that can be customised per instance. */
function overridable(masterId) {
  return descendants(masterId).map(get).filter(e => ['text', 'button', 'input', 'checkbox', 'select', 'icon', 'rect', 'ellipse', 'polygon', 'frame', 'group'].includes(e.type));
}

/* ----------------------------------------------------------------- text */
function startEdit(id) {
  const e = get(id), n = nodeOf(id);
  if (!n || !e || (e.type !== 'text' && e.type !== 'button')) return;
  editing = id; n.contentEditable = 'true'; n.classList.add('editing'); n.focus();
  document.getSelection().selectAllChildren(n);
  const done = () => {
    n.removeEventListener('blur', done);
    n.contentEditable = 'false'; n.classList.remove('editing'); editing = null;
    e.text = n.innerText.replace(/\n$/, '');
    if (e.type === 'text' && e.sizeH === 'fixed') e.h = Math.max(e.h, Math.ceil(n.scrollHeight));
    commit(); render();
  };
  n.addEventListener('blur', done);
  n.addEventListener('keydown', k => { if (k.key === 'Escape' || (k.key === 'Enter' && (k.ctrlKey || k.metaKey))) { k.preventDefault(); n.blur(); } k.stopPropagation(); });
}

/* ---------------------------------------------------------- image upload */
function readImageFile(file, maxDim = 1600) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('Not an image'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read file'));
    fr.onload = () => {
      const src = fr.result;
      if (/svg|gif/.test(file.type)) { const im = new Image(); im.onload = () => resolve({ url: src, w: im.naturalWidth || 240, h: im.naturalHeight || 160 }); im.onerror = () => resolve({ url: src, w: 240, h: 160 }); im.src = src; return; }
      const im = new Image();
      im.onerror = () => reject(new Error('Could not decode image'));
      im.onload = () => {
        const k = Math.min(1, maxDim / Math.max(im.naturalWidth, im.naturalHeight));
        const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(im, 0, 0, w, h);
        resolve({ url: file.type === 'image/png' ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.88), w: im.naturalWidth, h: im.naturalHeight });
      };
      im.src = src;
    };
    fr.readAsDataURL(file);
  });
}
function pickImageFile() {
  return new Promise(res => {
    const inp = $('#imageFile'); inp.value = '';
    inp.onchange = () => res(inp.files[0] || null);
    inp.click();
  });
}
async function setImageFor(id, file) {
  try {
    const img = await readImageFile(file), e = get(id); if (!e) return;
    e.url = img.url; e.fills = e.fills.length ? e.fills : []; commit(); render();
  } catch (err) { toast(err.message, true); }
}
async function dropImage(file, wp) {
  try {
    const img = await readImageFile(file), par = frameAt(wp), pa = par ? absPos(par) : { x: 0, y: 0 };
    const k = Math.min(1, 480 / img.w), w = Math.round(img.w * k), h = Math.round(img.h * k);
    const e = mk('image', { name: file.name.replace(/\.[^.]+$/, '') || 'Image', parent: par ? par.id : null, x: Math.round(wp.x - pa.x), y: Math.round(wp.y - pa.y), w, h, url: img.url, fills: [] });
    S.els.push(e); reindex(); S.sel = [e.id]; commit(); render();
  } catch (err) { toast(err.message, true); }
}

/* --------------------------------------------------------------- snapping */
function snap(e, nx, ny) {
  if (!S.ui.snap) return { x: nx, y: ny, guides: [] };
  const par = parentOf(e), pa = par ? absPos(par) : { x: 0, y: 0 };
  const th = 6 / S.view.z, rects = [];
  pageEls().forEach(o => { if (o.id !== e.id && o.parent === e.parent && o.visible) { const a = absPos(o); rects.push({ x: a.x, y: a.y, w: o.w, h: o.h }); } });
  if (par) rects.push({ x: pa.x, y: pa.y, w: par.w, h: par.h });
  const ax = pa.x + nx, ay = pa.y + ny, mx = [ax, ax + e.w / 2, ax + e.w], my = [ay, ay + e.h / 2, ay + e.h];
  let bx = null, by = null;
  rects.forEach(r => {
    [r.x, r.x + r.w / 2, r.x + r.w].forEach(t => mx.forEach(m => { const d = t - m; if (Math.abs(d) < th && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, t, r }; }));
    [r.y, r.y + r.h / 2, r.y + r.h].forEach(t => my.forEach(m => { const d = t - m; if (Math.abs(d) < th && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, t, r }; }));
  });
  (curPage().guides || []).forEach(g => {
    if (g.axis === 'x') mx.forEach(m => { const d = g.pos - m; if (Math.abs(d) < th && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, t: g.pos, r: null }; });
    else my.forEach(m => { const d = g.pos - m; if (Math.abs(d) < th && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, t: g.pos, r: null }; });
  });
  const fx = bx ? nx + bx.d : nx, fy = by ? ny + by.d : ny, g = [];
  const fax = pa.x + fx, fay = pa.y + fy, far = 4000;
  if (bx) g.push({ v: true, pos: bx.t, a: bx.r ? Math.min(fay, bx.r.y) : fay - far, b: bx.r ? Math.max(fay + e.h, bx.r.y + bx.r.h) : fay + far });
  if (by) g.push({ v: false, pos: by.t, a: by.r ? Math.min(fax, by.r.x) : fax - far, b: by.r ? Math.max(fax + e.w, by.r.x + by.r.w) : fax + far });
  return { x: fx, y: fy, guides: g };
}

/* --------------------------------------------------- auto-layout drop point */
function flowDrop(cont, wp, exclude) {
  const ch = kids(cont.id).filter(k => k.visible && !exclude.has(k.id) && nodeOf(k.id));
  const vr = viewport.getBoundingClientRect(), z = S.view.z;
  const rects = ch.map(k => { const r = nodeOf(k.id).getBoundingClientRect(); return { k, x: (r.left - vr.left - S.view.x) / z, y: (r.top - vr.top - S.view.y) / z, w: r.width / z, h: r.height / z }; });
  const ca = absPos(cont), row = cont.layout === 'row' && !cont.wrap, col = cont.layout === 'column';
  if (!rects.length) return { anchor: null, ind: { x: ca.x + cont.padX, y: ca.y + cont.padY, w: col ? cont.w - 2 * cont.padX : 3, h: col ? 3 : cont.h - 2 * cont.padY } };
  let idx = rects.length;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (col) { if (wp.y < r.y + r.h / 2) { idx = i; break; } }
    else if (row) { if (wp.x < r.x + r.w / 2) { idx = i; break; } }
    else { if (wp.y < r.y) { idx = i; break; } if (wp.y <= r.y + r.h && wp.x < r.x + r.w / 2) { idx = i; break; } }
  }
  let ind;
  if (idx < rects.length) { const r = rects[idx]; ind = col ? { x: r.x, y: r.y - 3, w: r.w, h: 3 } : { x: r.x - 3, y: r.y, w: 3, h: r.h }; }
  else { const r = rects[rects.length - 1]; ind = col ? { x: r.x, y: r.y + r.h, w: r.w, h: 3 } : { x: r.x + r.w, y: r.y, w: 3, h: r.h }; }
  return { anchor: idx < rects.length ? rects[idx].k.id : null, ind };
}
