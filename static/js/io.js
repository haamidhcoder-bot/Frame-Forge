'use strict';
/* FrameForge – persistence, export (server + image/PDF), menus, theme, shortcuts, start-up. */

/* ------------------------------------------------------------------ status */
function setStatus(txt, ok) { const s = $('#status'); s.textContent = txt; s.classList.toggle('ok', !!ok); }
let saveTimer = null;
function markDirty() {
  S.dirty = true; setStatus('Unsaved');
  if (S.id) { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(true), 1500); }
}
async function api(path, opts = {}) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch (_) {} throw new Error(m); }
  return r;
}
const docData = () => ({ els: S.els, pages: S.pages, tokens: S.tokens, textStyles: S.textStyles, version: 2 });
const payload = () => JSON.stringify({ name: S.name, data: docData() });

/* --------------------------------------------------------------- save/load */
async function save(auto) {
  clearTimeout(saveTimer); setStatus('Saving…');
  try {
    if (S.id) await api(`/api/projects/${S.id}`, { method: 'PUT', body: payload() });
    else { const j = await (await api('/api/projects', { method: 'POST', body: payload() })).json(); S.id = j.id; }
    try { localStorage.setItem('ff:last', S.id); } catch (_) {}
    S.dirty = false; setStatus('Saved', true); if (!auto) toast('Project saved');
    return true;
  } catch (e) { setStatus('Save failed'); toast('Save failed: ' + e.message, true); return false; }
}
function loadDoc(name, data, id = null) {
  S.id = id; S.name = name;
  S.els = (data.els || []).map(migrate);
  S.pages = Array.isArray(data.pages) && data.pages.length ? data.pages.map(p => ({ id: p.id, name: p.name, guides: p.guides || [] })) : [{ id: 'p1', name: 'Page 1', guides: [] }];
  S.tokens = data.tokens || {}; S.textStyles = data.textStyles || {};
  S.page = S.pages[0].id; S.views = {}; S.sel = []; S.hist = []; S.hi = -1; S.dirty = false;
  reindex(); $('#projectName').value = name; commit(); S.dirty = false;
  setStatus(id ? 'Saved' : 'Unsaved', !!id); render(); fit();
}
async function openProject(id) {
  try {
    const p = await (await api(`/api/projects/${id}`)).json();
    loadDoc(p.name, p.data, p.id); try { localStorage.setItem('ff:last', p.id); } catch (_) {} $('#modal').hidden = true;
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
function newDoc() {
  if (S.dirty && S.els.length && !confirm('Discard unsaved changes?')) return;
  try { localStorage.removeItem('ff:last'); } catch (_) {}
  loadDoc('Untitled design', { els: [] });
}
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
const fileBase = () => S.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'design';
function exportJSON() { download(URL.createObjectURL(new Blob([JSON.stringify({ name: S.name, data: docData() }, null, 2)], { type: 'application/json' })), fileBase() + '.json'); }
$('#importFile').addEventListener('change', async ev => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()), data = j.data || j;
    if (!Array.isArray(data.els) || data.els.some(e => !e || !e.id || !e.type)) throw new Error('Not a FrameForge file');
    loadDoc(j.name || f.name.replace(/\.json$/, ''), data); markDirty(); toast('Imported');
  } catch (e) { toast('Import failed: ' + e.message, true); }
});

/* ------------------------------------------------------------ export (server) */
const startFrameId = () => { const e = S.sel.length ? rootOf(get(S.sel[0])) : null; return e && e.type === 'frame' ? e.id : null; };
async function serverExport(fmt, extra = {}) {
  const body = JSON.stringify(Object.assign(JSON.parse(payload()), { format: fmt, mode: S.ui.mode, breakpoints: S.ui.breakpoints, page: S.page, start: startFrameId() }, extra));
  const r = await api('/api/export', { method: 'POST', body });
  return { blob: await r.blob(), name: r.headers.get('X-Export-Filename') || fileBase() + '.html', text: () => r.clone().text() };
}
async function doExport(fmt) {
  try {
    if (fmt === 'preview') { const w = window.open('', '_blank'); const r = await serverExport('html'); const t = await r.blob.text(); w.document.open(); w.document.write(t); w.document.close(); return; }
    const r = await serverExport(fmt);
    download(URL.createObjectURL(r.blob), r.name); toast('Exported ' + r.name);
  } catch (e) { toast('Export failed: ' + e.message, true); }
}
async function publish() {
  if (!(await save(true))) return;
  const url = location.origin + '/p/' + S.id;
  try { await navigator.clipboard.writeText(url); } catch (_) {}
  toast('Published: ' + url + ' (link copied)'); window.open(url, '_blank');
}

/* ----------------------------------------------------- export (PNG/SVG/PDF) */
function targetFrame() {
  let e = S.sel.length ? rootOf(get(S.sel[0])) : null;
  if (!e || e.type !== 'frame') { const roots = pageEls().filter(r => !r.parent && r.type === 'frame'); if (roots.length === 1) e = roots[0]; }
  if (!e || e.type !== 'frame') { toast('Select a frame to export', true); return null; }
  return e;
}
let fontCssCache = {};
async function fontCss(fonts) {
  let out = '';
  for (const f of fonts) {
    if (!GFONT[f]) continue;
    if (fontCssCache[f] === undefined) {
      fontCssCache[f] = '';
      try {
        let css = await (await fetch(`https://fonts.googleapis.com/css2?family=${GFONT[f]}&display=swap`)).text();
        const blocks = css.split(/\/\*\s*/).slice(1).filter(b => /^latin\s*\*\//.test(b)).map(b => b.replace(/^latin\s*\*\//, ''));
        const parts = [];
        for (const b of blocks) {
          const m = /url\((https:[^)]+)\)/.exec(b); if (!m) continue;
          const buf = await (await fetch(m[1])).blob();
          const data = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(buf); });
          parts.push(b.replace(m[1], data).trim());
        }
        fontCssCache[f] = parts.join('\n');
      } catch (_) { fontCssCache[f] = ''; }
    }
    out += fontCssCache[f];
  }
  return out;
}
function editorCss() {
  let css = '';
  [...document.styleSheets].forEach(sh => { try { [...sh.cssRules].forEach(r => { if (r.selectorText && /^(\.el|\.t-|\.ph|\.cbx|\.lbl|\.chev|\.pwrap)/.test(r.selectorText)) css += r.cssText + '\n'; }); } catch (_) {} });
  return css;
}
async function frameSvg(f, scale = 1) {
  resolveAll();
  const reg = new Map(), node = buildNode(RMAP.get(f.id), reg);
  node.style.left = '0px'; node.style.top = '0px';
  const fontsUsed = [...new Set(RES.filter(e => e.id === f.id || isInside(baseId(e.id), f.id) || String(e.id).startsWith(f.id + '::')).map(e => e.font))];
  const imgs = [...node.querySelectorAll('img')];
  for (const im of imgs) {
    const src = im.getAttribute('src') || '';
    if (src.startsWith('data:')) continue;
    try {
      const blob = await (await fetch(src, { mode: 'cors' })).blob();
      im.setAttribute('src', await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); }));
    } catch (_) { im.removeAttribute('src'); im.dataset.blocked = '1'; }
  }
  const w = Math.round(f.w), h = Math.round(f.h), inner = new XMLSerializer().serializeToString(node);
  const css = (await fontCss(fontsUsed)) + editorCss();
  return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}"><foreignObject width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${w}px;height:${h}px"><style>${css.replace(/</g, '\\3c ')}</style>${inner}</div></foreignObject></svg>` };
}
async function exportImage(kind, scale = 1) {
  const f = targetFrame(); if (!f) return;
  try {
    toast('Rendering…');
    const { w, h, svg } = await frameSvg(f, scale);
    if (kind === 'svg') { download(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), `${fileBase()}-${f.name.replace(/[^\w-]+/g, '-')}.svg`); return toast('SVG exported'); }
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not render the frame')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const cv = document.createElement('canvas'); cv.width = w * scale; cv.height = h * scale;
    cv.getContext('2d').drawImage(img, 0, 0, w * scale, h * scale);
    cv.toBlob(b => { if (!b) return toast('Could not create PNG', true); download(URL.createObjectURL(b), `${fileBase()}-${f.name.replace(/[^\w-]+/g, '-')}@${scale}x.png`); toast('PNG exported'); }, 'image/png');
  } catch (e) { toast('Image export failed: ' + e.message, true); }
}
async function exportPdf() {
  const f = targetFrame(); if (!f) return;
  const win = window.open('', '_blank'); if (!win) return toast('Allow pop-ups to export PDF', true);
  try {
    const r = await serverExport('html', { mode: 'absolute', breakpoints: false, frame: f.id });
    let html = await r.blob.text();
    const extra = `<style>@page{size:${Math.round(f.w)}px ${Math.round(f.h)}px;margin:0}html,body{background:#fff!important;padding:0!important;margin:0!important}body>*{margin:0!important}</style>`;
    html = html.replace('</head>', extra + '</head>').replace('</body>', `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},500)})<\/script></body>`);
    win.document.open(); win.document.write(html); win.document.close();
    toast('In the print dialog choose “Save as PDF”');
  } catch (e) { win.close(); toast('PDF export failed: ' + e.message, true); }
}

/* ------------------------------------------------------------------- menus */
function closeMenus() { $$('.menu').forEach(m => { m.hidden = true; }); }
function toggleMenu(id, anchor) {
  const m = $(id), was = !m.hidden; closeMenus();
  if (was) return;
  const r = anchor.getBoundingClientRect();
  m.hidden = false; m.style.top = r.bottom + 4 + 'px'; m.style.left = Math.max(6, Math.min(r.left, window.innerWidth - m.offsetWidth - 6)) + 'px';
}
function persistUi() { try { localStorage.setItem('ff:ui', JSON.stringify(S.ui)); } catch (_) {} }
function syncMenus() {
  $$('#viewMenu input[data-ui]').forEach(i => { i.checked = !!S.ui[i.dataset.ui]; });
  $('#expMode').value = S.ui.mode; $('#expBp').checked = !!S.ui.breakpoints;
}
function toggleUi(k) {
  S.ui[k] = !S.ui[k]; persistUi(); syncMenus();
  if (k === 'grid') applyView(); else { renderOverlay(); drawRulers(); drawMinimap(); }
}
$('#viewMenu').addEventListener('change', ev => { const k = ev.target.dataset.ui; if (k) { S.ui[k] = ev.target.checked; persistUi(); applyView(); } });
$('#expMode').addEventListener('change', ev => { S.ui.mode = ev.target.value; persistUi(); });
$('#expBp').addEventListener('change', ev => { S.ui.breakpoints = ev.target.checked; persistUi(); });
$('#exportMenu').addEventListener('click', ev => {
  const b = ev.target.closest('[data-exp]'); if (!b) return;
  closeMenus();
  const k = b.dataset.exp;
  if (k === 'png1') exportImage('png', 1); else if (k === 'png2') exportImage('png', 2);
  else if (k === 'svg') exportImage('svg', 1); else if (k === 'pdf') exportPdf();
  else if (k === 'json') exportJSON(); else doExport(k);
});

/* ------------------------------------------------------- theme & shortcuts */
function setTheme(t) {
  document.documentElement.dataset.theme = t; try { localStorage.setItem('ff:theme', t); } catch (_) {}
  $('#themeBtn').textContent = t === 'light' ? '☾' : '☀'; drawRulers(); drawMinimap();
}
function openShortcuts() { $('#shortcutsModal').hidden = false; }
$('#shortcutsModal').addEventListener('pointerdown', ev => { if (ev.target.id === 'shortcutsModal' || ev.target.id === 'shortcutsClose') ev.currentTarget.hidden = true; });

/* ----------------------------------------------------------- top-bar wiring */
document.querySelector('.topbar').addEventListener('click', ev => {
  const el = ev.target.closest('[data-cmd]'); if (!el) return;
  const c = el.dataset.cmd;
  if (c === 'viewmenu') return toggleMenu('#viewMenu', el);
  if (c === 'exportmenu') return toggleMenu('#exportMenu', el);
  closeMenus();
  ({ undo, redo, new: newDoc, open: showOpen, save: () => save(), import: () => $('#importFile').click(),
     present: startPresent, publish, library: () => openLibrary(), styles: openStyles, shortcuts: openShortcuts,
     theme: () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'),
     left: () => document.body.classList.toggle('show-left'), right: () => document.body.classList.toggle('show-right') })[c]();
});
window.addEventListener('pointerdown', ev => { if (!ev.target.closest('.menu') && !ev.target.closest('[data-cmd$=menu]')) closeMenus(); }, true);
$('#projectName').addEventListener('input', ev => { S.name = ev.target.value || 'Untitled design'; markDirty(); });
$('#modalClose').addEventListener('click', () => $('#modal').hidden = true);
$('#modal').addEventListener('pointerdown', ev => { if (ev.target.id === 'modal') $('#modal').hidden = true; });

/* ---------------------------------------------------------------- demo doc */
function demo() {
  const a = build(PAGES.landing(), null); a.x = 0; a.y = 0; a.name = 'Landing – Desktop';
  const m = build(PAGES.mobile(), null); m.x = 1540; m.y = 0; m.name = 'Landing – Mobile';
  return [a, m];
}

/* ------------------------------------------------------------------- start */
(async function init() {
  try { Object.assign(S.ui, JSON.parse(localStorage.getItem('ff:ui') || '{}')); } catch (_) {}
  S.ui.mode = S.ui.mode || 'responsive'; if (S.ui.breakpoints === undefined) S.ui.breakpoints = true;
  let theme = 'dark'; try { theme = localStorage.getItem('ff:theme') || 'dark'; } catch (_) {}
  setTheme(theme); syncMenus(); setTool('move'); updateUndoButtons();
  let last = null; try { last = localStorage.getItem('ff:last'); } catch (_) {}
  if (last) { try { const p = await (await api(`/api/projects/${last}`)).json(); loadDoc(p.name, p.data, p.id); return; } catch (_) { try { localStorage.removeItem('ff:last'); } catch (__) {} } }
  S.els = []; S.pages = [{ id: 'p1', name: 'Page 1', guides: [] }]; S.page = 'p1'; reindex();
  demo(); loadDoc('Untitled design', docData());
  S.dirty = true; setStatus('Unsaved');
})();
