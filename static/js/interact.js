'use strict';
/* FrameForge – pointer/touch interaction, keyboard shortcuts, context menu, drag & drop, minimap. */

let drag = null, spaceDown = false, pinch = null;
const pointers = new Map();

function setTool(t) {
  S.tool = t;
  $$('#toolbar button[data-tool], #navtools button[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  viewport.classList.toggle('hand', t === 'hand');
  viewport.classList.toggle('create', CREATE_TOOLS.includes(t));
}
['#toolbar', '#navtools'].forEach(sel => $(sel).addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.cmd === 'iconpicker') { toggleIconPicker(); return; }
  closeMenus();
  if (b.dataset.tool) setTool(b.dataset.tool);
}));

/* ---- icon picker: choose an icon, then click / drag on the canvas to place it ---- */
function renderIconGrid() {
  const q = $('#iconSearch').value.trim().toLowerCase(), grid = $('#iconGrid'); grid.innerHTML = '';
  const names = Object.keys(ICONS).filter(n => !q || n.includes(q));
  names.forEach(n => {
    const b = document.createElement('button'); b.title = n; b.type = 'button';
    if (n === S.pendingIcon && S.tool === 'icon') b.classList.add('on');
    b.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg><span>${n}</span>`;
    b.addEventListener('click', () => { S.pendingIcon = n; closeMenus(); setTool('icon'); toast && toast(`Click or drag on the canvas to place “${n}”`); });
    grid.appendChild(b);
  });
  if (!names.length) grid.innerHTML = '<p class="libnote">No icons match.</p>';
}
function toggleIconPicker() {
  const p = $('#iconPicker'), was = !p.hidden; closeMenus();
  if (was) return;
  p.hidden = false; $('#iconSearch').value = ''; renderIconGrid(); $('#iconSearch').focus();
}
$('#iconSearch').addEventListener('input', renderIconGrid);
$('#iconSearch').addEventListener('keydown', ev => { if (ev.key === 'Escape') closeMenus(); });
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

/* ---- helpers for the flow / reparent logic ---- */
function abortDrag() {
  if (!drag) return;
  drag = null; snapGuides = []; indicator = null; dropHint = null; marquee = null;
  viewport.classList.remove('panning');
  restore();
}
function startGuide(axis, ev, idx = null) {
  const wp = toWorld(ev), pg = curPage();
  pg.guides = pg.guides || [];
  if (idx === null) { pg.guides.push({ axis, pos: Math.round(axis === 'x' ? wp.x : wp.y) }); idx = pg.guides.length - 1; }
  drag = { type: 'guide', i: idx };
  renderOverlay();
}
rulerTop.addEventListener('pointerdown', ev => { ev.preventDefault(); startGuide('y', ev); });
rulerLeft.addEventListener('pointerdown', ev => { ev.preventDefault(); startGuide('x', ev); });

/* ------------------------------------------------------------ pointer down */
viewport.addEventListener('pointerdown', ev => {
  const fg = ev.target.closest && ev.target.closest('[data-flowgo]');
  if (fg) { ev.preventDefault(); flowGo(fg.dataset.flowgo); return; }
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) { startPinch(); return; }
  if (pointers.size > 2) return;
  if (editing) {
    const hit = ev.target.closest('.el');
    if (hit && hit.dataset.id === editing) return;
    document.activeElement.blur();
  }
  if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) document.activeElement.blur();
  hideContextMenu(); closeMenus();
  if (ev.button === 1 || (ev.button === 0 && (spaceDown || S.tool === 'hand'))) {
    ev.preventDefault();
    drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y };
    viewport.classList.add('panning'); return;
  }
  if (ev.button !== 0) return;
  ev.preventDefault();
  const wp = toWorld(ev), t = ev.target;

  if (t.dataset && t.dataset.gi !== undefined) return startGuide(null, ev, +t.dataset.gi);
  if (t.dataset && t.dataset.h) {
    const e = get(S.sel[0]);
    drag = { type: 'resize', hd: t.dataset.h, sx: wp.x, sy: wp.y, id: e.id, o: { x: e.x, y: e.y, w: e.w, h: e.h } }; return;
  }
  if (CREATE_TOOLS.includes(S.tool)) {
    const par = frameAt(wp), pa = par ? absPos(par) : { x: 0, y: 0 };
    const extra = S.tool === 'icon' ? { icon: S.pendingIcon || 'star', name: 'Icon ' + (S.pendingIcon || 'star') } : {};
    const e = mk(S.tool, { parent: par ? par.id : null, x: Math.round(wp.x - pa.x), y: Math.round(wp.y - pa.y), w: 1, h: S.tool === 'line' ? 2 : 1, ...extra });
    S.els.push(e); reindex(); S.sel = [e.id]; render();
    drag = { type: 'create', id: e.id, sx: wp.x, sy: wp.y, pa }; return;
  }
  let id = null;
  if (t.dataset && t.dataset.label) id = t.dataset.label;
  else { const n = t.closest('.el'); if (n) id = pickable(n.dataset.id); }
  if (id) {
    if (ev.shiftKey) setSel(S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel, id]);
    else if (!S.sel.includes(id)) setSel([id]);
    const items = topmost(S.sel).filter(i => !get(i).locked).map(i => {
      const e = get(i), n = nodeOf(i), r = n ? n.getBoundingClientRect() : null, vr = viewport.getBoundingClientRect();
      return { id: i, x: e.x, y: e.y, flow: isAuto(parentOf(e)), ax: r ? (r.left - vr.left - S.view.x) / S.view.z : 0, ay: r ? (r.top - vr.top - S.view.y) / S.view.z : 0 };
    });
    drag = { type: 'move', sx: wp.x, sy: wp.y, items, moved: false, drop: null };
  } else if (ev.pointerType === 'touch') {
    drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y };
  } else {
    if (!ev.shiftKey) setSel([]);
    drag = { type: 'marquee', base: ev.shiftKey ? S.sel.slice() : [], sx: wp.x, sy: wp.y };
    marquee = { x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y };
  }
});

/* ------------------------------------------------------------ pointer move */
window.addEventListener('pointermove', ev => {
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch && pointers.size >= 2) return updatePinch();
  if (!drag) {
    if (ev.target.closest && ev.target.closest('#viewport')) {
      const n = ev.target.closest('.el'); const id = n ? pickable(n.dataset.id) : null;
      if (id !== hover) { hover = id; renderOverlay(); }
    }
    return;
  }
  if (drag.type === 'pan') { S.view.x = drag.vx + ev.clientX - drag.sx; S.view.y = drag.vy + ev.clientY - drag.sy; applyView(); return; }
  const wp = toWorld(ev);

  if (drag.type === 'guide') {
    const g = curPage().guides[drag.i]; if (!g) return;
    g.pos = Math.round(g.axis === 'x' ? wp.x : wp.y); renderOverlay(); return;
  }
  if (drag.type === 'marquee') {
    marquee.x2 = wp.x; marquee.y2 = wp.y;
    const x1 = Math.min(marquee.x1, marquee.x2), x2 = Math.max(marquee.x1, marquee.x2), y1 = Math.min(marquee.y1, marquee.y2), y2 = Math.max(marquee.y1, marquee.y2);
    const hit = pageEls().filter(e => !e.parent && e.visible && !e.locked && e.x < x2 && e.x + e.w > x1 && e.y < y2 && e.y + e.h > y1).map(e => e.id);
    S.sel = [...new Set([...drag.base, ...hit])]; renderOverlay(); return;
  }
  if (drag.type === 'move') {
    let dx = wp.x - drag.sx, dy = wp.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) * S.view.z < 3) return;
    drag.moved = true;
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    snapGuides = []; indicator = null; dropHint = null;
    drag.dx = dx; drag.dy = dy;
    drag.items.forEach(it => {
      const e = get(it.id), n = nodeOf(it.id); if (!n) return;
      if (it.flow) {
        n.style.transform = `translate(${dx}px,${dy}px)`; n.style.opacity = '.7'; n.style.zIndex = '1000'; n.style.pointerEvents = 'none';
      } else {
        let nx = it.x + dx, ny = it.y + dy;
        if (drag.items.length === 1 && !ev.altKey) { const r = snap(e, nx, ny); nx = r.x; ny = r.y; snapGuides = r.guides; }
        e.x = Math.round(nx); e.y = Math.round(ny); repaint(e.id);
      }
    });
    const ex = new Set(); drag.items.forEach(it => { ex.add(it.id); descendants(it.id).forEach(d => ex.add(d)); });
    const first = get(drag.items[0].id), canReparent = !(first.type === 'frame' && !first.parent);
    let tgt = canReparent ? frameAt(wp, ex) : (first.parent ? get(first.parent) : null);
    /* Hovering a sibling reorders within the same auto-layout parent; hold Ctrl to drop *into* the sibling. */
    const par0 = parentOf(first);
    if (tgt && par0 && isAuto(par0) && !(ev.ctrlKey || ev.metaKey)) {
      let a = tgt; while (a && a.parent !== par0.id && a.id !== par0.id) a = parentOf(a);
      if (a && a.parent === par0.id) tgt = par0;
    }
    if (tgt && !(tgt.id === first.parent && !isAuto(tgt))) dropHint = tgt.id;
    drag.drop = { target: tgt ? tgt.id : null };
    if (tgt && isAuto(tgt)) { const fd = flowDrop(tgt, wp, ex); indicator = fd.ind; drag.drop.anchor = fd.anchor; }
    measure(); renderOverlay(); syncProps(); return;
  }
  if (drag.type === 'resize') {
    const e = get(drag.id), o = drag.o, hd = drag.hd, flow = isAuto(parentOf(e));
    const dx = wp.x - drag.sx, dy = wp.y - drag.sy;
    let { x, y, w, h } = o;
    if (hd.includes('e')) w = o.w + dx;
    if (hd.includes('s')) h = o.h + dy;
    if (hd.includes('w')) { x = o.x + dx; w = o.w - dx; }
    if (hd.includes('n')) { y = o.y + dy; h = o.h - dy; }
    if (ev.shiftKey && hd.length === 2) { const nh = w / (o.w / o.h); if (hd.includes('n')) y = o.y + o.h - nh; h = nh; }
    if (w < 1) { if (hd.includes('w')) x -= 1 - w; w = 1; }
    if (h < 1) { if (hd.includes('n')) y -= 1 - h; h = 1; }
    if (hd.includes('e') || hd.includes('w')) e.sizeW = 'fixed';
    if (hd.includes('n') || hd.includes('s')) e.sizeH = 'fixed';
    if (flow) Object.assign(e, { w: Math.round(w), h: Math.round(h) });
    else Object.assign(e, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    repaint(e.id); measure(); renderOverlay(); syncProps(); return;
  }
  if (drag.type === 'create') {
    const e = get(drag.id), pa = drag.pa;
    e.x = Math.round(Math.min(drag.sx, wp.x) - pa.x); e.y = Math.round(Math.min(drag.sy, wp.y) - pa.y);
    const w = Math.max(1, Math.round(Math.abs(wp.x - drag.sx))), h = Math.max(1, Math.round(Math.abs(wp.y - drag.sy)));
    if (e.type === 'line') { if (Math.abs(wp.y - drag.sy) > Math.abs(wp.x - drag.sx)) { e.w = 2; e.h = h; e.x = Math.round(drag.sx - pa.x); e.y = Math.round(Math.min(drag.sy, wp.y) - pa.y); } else { e.w = w; e.h = 2; e.y = Math.round(drag.sy - pa.y); } }
    else if (e.type === 'icon') { const s = Math.max(w, h); e.w = s; e.h = s; e.x = Math.round((wp.x < drag.sx ? drag.sx - s : drag.sx) - pa.x); e.y = Math.round((wp.y < drag.sy ? drag.sy - s : drag.sy) - pa.y); }
    else { e.w = w; e.h = h; }
    repaint(e.id); measure(); renderOverlay(); syncProps();
  }
});

/* -------------------------------------------------------------- pointer up */
function endPointer(ev) {
  pointers.delete(ev.pointerId);
  if (pinch && pointers.size < 2) pinch = null;
  if (!drag) return;
  const d = drag; drag = null; snapGuides = []; indicator = null; dropHint = null;
  viewport.classList.remove('panning');
  if (d.type === 'guide') {
    const pg = curPage(), g = pg.guides[d.i], vr = viewport.getBoundingClientRect();
    if (g && (ev.clientX < vr.left + 20 || ev.clientY < vr.top + 20 || ev.clientX > vr.right || ev.clientY > vr.bottom)) pg.guides.splice(d.i, 1);
    commit(); renderOverlay(); return;
  }
  if (d.type === 'marquee') { marquee = null; setSel(S.sel); return; }
  if (d.type === 'move' && d.moved) {
    const drop = d.drop || { target: undefined }, ex = new Set();
    d.items.forEach(it => { ex.add(it.id); descendants(it.id).forEach(x => ex.add(x)); });
    const vr = viewport.getBoundingClientRect();
    let structural = false;
    d.items.forEach(it => {
      const e = get(it.id); if (!e) return;
      const canReparent = !(e.type === 'frame' && !e.parent);
      const tgt = canReparent && drop.target !== undefined ? (drop.target ? get(drop.target) : null) : parentOf(e);
      const absNow = it.flow ? { x: it.ax + (d.dx || 0), y: it.ay + (d.dy || 0) } : absPos(e);
      if (tgt && isAuto(tgt)) {
        placeIn(e, tgt.id, drop.anchor && !ex.has(drop.anchor) ? drop.anchor : null);
        e.x = 0; e.y = 0; structural = true;
      } else if (it.flow || (tgt ? tgt.id : null) !== (e.parent || null)) {
        const pa = tgt ? absPos(tgt) : { x: 0, y: 0 };
        placeIn(e, tgt ? tgt.id : null, null);
        e.x = Math.round(absNow.x - pa.x); e.y = Math.round(absNow.y - pa.y); structural = true;
      }
    });
    reindex(); commit(); render();
    return;
  }
  if (d.type === 'resize') { commit(); renderOverlay(); renderProps(); return; }
  if (d.type === 'create') {
    const e = get(d.id), df = TYPE_DEF[e.type];
    if (e.w < 4 && e.h < (e.type === 'line' ? 4 : 4)) { e.w = df.w; e.h = df.h; }
    if (e.type === 'text' && e.h < 24) e.h = 32;
    setTool('move'); commit(); render();
    if (e.type === 'text') startEdit(e.id);
    return;
  }
  renderOverlay();
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
viewport.addEventListener('pointerleave', () => { if (hover) { hover = null; renderOverlay(); } });

/* --------------------------------------------------------------- pinch zoom */
function pinchState() { const p = [...pointers.values()].slice(0, 2); return { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 }; }
function startPinch() { if (drag && drag.type !== 'pan') abortDrag(); drag = null; pinch = pinchState(); }
function updatePinch() {
  const n = pinchState(), r = viewport.getBoundingClientRect();
  S.view.x += n.cx - pinch.cx; S.view.y += n.cy - pinch.cy;
  zoomAt(n.d / pinch.d, n.cx - r.left, n.cy - r.top);
  pinch = n;
}

/* --------------------------------------------------------------- dblclick */
viewport.addEventListener('dblclick', ev => {
  const n = ev.target.closest('.el'); if (!n) return;
  const deep = get(baseId(n.dataset.id)); if (!deep) return;
  if (S.sel.length === 1 && S.sel[0] !== deep.id && isInside(deep.id, S.sel[0]) && get(S.sel[0]).type === 'group') { setSel([deep.id]); return; }
  const e = get(pickable(n.dataset.id)); if (!e || e.locked) return;
  if (e.type === 'text' || e.type === 'button') startEdit(e.id);
  else if (e.type === 'image') pickImageFile().then(f => f && setImageFor(e.id, f));
});

/* --------------------------------------------------- drag & drop, paste */
viewport.addEventListener('dragover', ev => { if ([...ev.dataTransfer.types].includes('Files')) ev.preventDefault(); });
viewport.addEventListener('drop', ev => {
  const f = [...ev.dataTransfer.files].find(x => /^image\//.test(x.type)); if (!f) return;
  ev.preventDefault();
  const wp = toWorld(ev), n = ev.target.closest('.el'), t = n && get(pickable(n.dataset.id));
  if (t && t.type === 'image') setImageFor(t.id, f); else dropImage(f, wp);
});
window.addEventListener('paste', ev => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
  const f = [...(ev.clipboardData?.files || [])].find(x => /^image\//.test(x.type));
  if (f) { ev.preventDefault(); const r = viewport.getBoundingClientRect(); dropImage(f, { x: (r.width / 2 - S.view.x) / S.view.z - 120, y: (r.height / 2 - S.view.y) / S.view.z - 80 }); return; }
  if (S.clip) { ev.preventDefault(); pasteNodes(S.clip); }
});

/* ---------------------------------------------------------------- minimap */
let miniDown = false;
function miniGo(ev) {
  if (!miniMap) return; const r = mini.getBoundingClientRect();
  centerOn((ev.clientX - r.left - miniMap.ox) / miniMap.k, (ev.clientY - r.top - miniMap.oy) / miniMap.k);
}
mini.addEventListener('pointerdown', ev => { miniDown = true; mini.setPointerCapture(ev.pointerId); miniGo(ev); });
mini.addEventListener('pointermove', ev => { if (miniDown) miniGo(ev); });
mini.addEventListener('pointerup', () => { miniDown = false; });

/* ---------------------------------------------------------------- keyboard */
window.addEventListener('keydown', ev => {
  const t = ev.target, typing = t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName);
  const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
  if (mod && k === 's') { ev.preventDefault(); save(); return; }
  if (typing) return;
  if (k === 'escape') {
    if (drag) return abortDrag();
    if (!$('#modal').hidden) { $('#modal').hidden = true; return; }
    hideContextMenu(); closeMenus();
    if (S.tool !== 'move') setTool('move'); else setSel([]); return;
  }
  if (ev.code === 'Space') { if (!spaceDown) { spaceDown = true; viewport.classList.add('space'); } ev.preventDefault(); return; }
  if (mod && ev.altKey && k === 'k') { ev.preventDefault(); return createComponent(); }
  if (mod && ev.altKey && k === 'b') { ev.preventDefault(); return detachInstance(); }
  if (mod && k === 'g') { ev.preventDefault(); return ev.shiftKey ? ungroupSel() : groupSel(); }
  if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { ev.preventDefault(); redo(); return; }
  if (mod && k === 'd') { ev.preventDefault(); duplicate(); return; }
  if (mod && k === 'c') { if (S.sel.length) S.clip = collectTree(S.sel); return; }
  if (mod && k === 'x') { if (S.sel.length) { S.clip = collectTree(S.sel); removeSel(); } return; }
  if (mod && k === 'a') { ev.preventDefault(); setSel(pageEls().filter(e => !e.parent).map(e => e.id)); return; }
  if (mod && (k === ']' || k === '[')) { ev.preventDefault(); reorder(k === ']' ? 'front' : 'back'); return; }
  if (mod && k === '0') { ev.preventDefault(); S.view.z = 1; applyView(); return; }
  if (mod && k === "'") { ev.preventDefault(); toggleUi('grid'); return; }
  if (mod) return;
  if (ev.key === '?') { openShortcuts(); return; }
  if (ev.shiftKey && k === 'a') { ev.preventDefault(); return toggleAuto(); }
  if (ev.shiftKey && k === 'r') { ev.preventDefault(); return toggleUi('rulers'); }
  if (k === ']') return reorder('forward');
  if (k === '[') return reorder('backward');
  if (ev.shiftKey && ev.key === '!') return fit();
  if (ev.shiftKey && ev.key === '@') return fit(S.sel);
  if (k === 'delete' || k === 'backspace') { ev.preventDefault(); return removeSel(); }
  if (k === 'enter' && S.sel.length === 1) {
    const e = get(S.sel[0]);
    if (e && (e.type === 'text' || e.type === 'button')) { ev.preventDefault(); startEdit(e.id); }
    else if (e && isContainer(e) && kids(e.id).length) { ev.preventDefault(); setSel([kids(e.id)[0].id]); }
    return;
  }
  if (k.startsWith('arrow') && S.sel.length) {
    ev.preventDefault();
    const step = ev.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
    topmost(S.sel).forEach(id => { const e = get(id); if (e.locked || isAuto(parentOf(e))) return; e.x += dx; e.y += dy; repaint(id); });
    clearTimeout(S._nudge); S._nudge = setTimeout(commit, 300);
    renderOverlay(); syncProps(); return;
  }
  if (ev.altKey) return;
  if (k === 'k') { ev.preventDefault(); toggleIconPicker(); return; }
  const tools = { v: 'move', h: 'hand', f: 'frame', r: 'rect', o: 'ellipse', l: 'line', p: 'polygon', t: 'text', b: 'button', i: 'image', n: 'input', c: 'checkbox', d: 'select' };
  if (tools[k]) setTool(tools[k]);
});
window.addEventListener('keyup', ev => { if (ev.code === 'Space') { spaceDown = false; viewport.classList.remove('space'); } });
window.addEventListener('resize', () => { renderOverlay(); drawRulers(); drawMinimap(); });

/* ----------------------------------------------------------- context menu */
const ctx = $('#ctx');
function hideContextMenu() { ctx.hidden = true; }
function showContextMenu(x, y) {
  const els = selEls(), one = els.length === 1 ? els[0] : null, many = els.length > 0;
  const items = [];
  const add = (label, fn, key = '', dis = false) => items.push({ label, fn, key, dis });
  const sep = () => items.push({ sep: true });
  add('Copy', () => { S.clip = collectTree(S.sel); }, 'Ctrl+C', !many);
  add('Paste', () => S.clip && pasteNodes(S.clip), 'Ctrl+V', !S.clip);
  add('Duplicate', duplicate, 'Ctrl+D', !many);
  add('Delete', removeSel, 'Del', !many); sep();
  add('Group', groupSel, 'Ctrl+G', !many);
  add('Ungroup', ungroupSel, 'Ctrl+Shift+G', !els.some(isContainer));
  add(one && isAuto(one) ? 'Remove auto layout' : 'Add auto layout', toggleAuto, 'Shift+A', !many);
  add('Create component', createComponent, 'Ctrl+Alt+K', !many || els.some(e => e.type === 'instance'));
  if (one && one.type === 'instance') { add('Go to main component', () => { const m = get(one.ref); if (m) { if (m.page !== S.page) setPage(m.page); setSel([m.id]); fit([m.id]); } }); add('Detach instance', detachInstance, 'Ctrl+Alt+B'); }
  sep();
  add('Bring to front', () => reorder('front'), 'Ctrl+]', !many);
  add('Send to back', () => reorder('back'), 'Ctrl+[', !many); sep();
  add(one && one.locked ? 'Unlock' : 'Lock', () => { els.forEach(e => { e.locked = !e.locked; }); commit(); renderLayers(); renderOverlay(); }, '', !many);
  add(one && !one.visible ? 'Show' : 'Hide', () => { els.forEach(e => { e.visible = !e.visible; }); commit(); render(); }, '', !many);
  ctx.innerHTML = '';
  items.forEach(it => {
    if (it.sep) { ctx.appendChild(Object.assign(document.createElement('div'), { className: 'csep' })); return; }
    const b = document.createElement('button'); b.className = 'citem'; b.disabled = !!it.dis;
    b.innerHTML = `<span>${esc(it.label)}</span><em>${esc(it.key)}</em>`;
    b.addEventListener('click', () => { hideContextMenu(); it.fn(); });
    ctx.appendChild(b);
  });
  ctx.hidden = false;
  const w = ctx.offsetWidth, h = ctx.offsetHeight;
  ctx.style.left = Math.min(x, window.innerWidth - w - 6) + 'px'; ctx.style.top = Math.min(y, window.innerHeight - h - 6) + 'px';
}
viewport.addEventListener('contextmenu', ev => {
  ev.preventDefault();
  const n = ev.target.closest('.el'), id = n ? pickable(n.dataset.id) : (ev.target.dataset && ev.target.dataset.label);
  if (id && !S.sel.includes(id)) setSel([id]); else if (!id) setSel([]);
  showContextMenu(ev.clientX, ev.clientY);
});
window.addEventListener('pointerdown', ev => { if (!ctx.hidden && !ev.target.closest('#ctx')) hideContextMenu(); }, true);
