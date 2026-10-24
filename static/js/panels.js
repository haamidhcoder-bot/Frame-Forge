'use strict';
/* FrameForge – pages list, layers panel and the properties (Design) panel. */

const layersEl = $('#layers'), propsEl = $('#props');

/* ------------------------------------------------------------------ pages */
function renderPages() {
  const box = $('#pages'); box.innerHTML = '';
  S.pages.forEach(p => {
    const row = document.createElement('div');
    row.className = 'pgrow' + (p.id === S.page ? ' on' : ''); row.dataset.id = p.id;
    row.innerHTML = '<span class="pn"></span>' + (S.pages.length > 1 ? '<button class="lbtn" data-act="delpage" title="Delete page">✕</button>' : '');
    $('.pn', row).textContent = p.name;
    box.appendChild(row);
  });
}
function setPage(id) {
  if (id === S.page) return;
  S.views[S.page] = Object.assign({}, S.view);
  S.page = id; S.sel = [];
  const v = S.views[id]; if (v) S.view = Object.assign({}, v);
  render();
  if (v) applyView(); else fit();
}
function addPage() {
  const p = { id: 'p' + uid().slice(1), name: 'Page ' + (S.pages.length + 1), guides: [] };
  S.pages.push(p); commit(); setPage(p.id);
}
function deletePage(id) {
  if (S.pages.length < 2) return;
  const p = S.pages.find(x => x.id === id);
  if (!confirm(`Delete "${p.name}" and everything on it?`)) return;
  S.els = S.els.filter(e => e.page !== id); S.pages = S.pages.filter(x => x.id !== id); reindex();
  if (S.page === id) { S.page = S.pages[0].id; S.sel = []; }
  commit(); render(); fit();
}
$('#pages').addEventListener('click', ev => {
  const row = ev.target.closest('.pgrow'); if (!row) return;
  if (ev.target.dataset.act === 'delpage') return deletePage(row.dataset.id);
  setPage(row.dataset.id);
});
$('#pages').addEventListener('dblclick', ev => {
  const row = ev.target.closest('.pgrow'); if (!row) return;
  const p = S.pages.find(x => x.id === row.dataset.id), n = $('.pn', row);
  const inp = document.createElement('input'); inp.className = 'rename'; inp.value = p.name; n.replaceWith(inp); inp.focus(); inp.select();
  const done = ok => { if (ok && inp.value.trim()) { p.name = inp.value.trim(); commit(); } renderPages(); };
  inp.addEventListener('keydown', k => { if (k.key === 'Enter') done(true); if (k.key === 'Escape') done(false); });
  inp.addEventListener('blur', () => done(true));
});
$('#addPage').addEventListener('click', addPage);

/* ----------------------------------------------------------------- layers */
function layerGlyph(e) {
  if (isAuto(e)) return e.layout === 'row' ? '⇉' : e.layout === 'column' ? '⇊' : '▦';
  return ICON[e.type] || '?';
}
function renderLayers() {
  const q = ($('#layerSearch').value || '').trim().toLowerCase();
  layersEl.innerHTML = '';
  const els = pageEls();
  if (!els.length) { layersEl.innerHTML = '<div class="empty">No layers yet.<br>Pick the <b>Frame</b> tool (<kbd>F</kbd>) and drag on the canvas, or open the <b>Library</b> for ready-made blocks.</div>'; return; }
  const match = new Set();
  if (q) els.forEach(e => { if (e.name.toLowerCase().includes(q) || e.type.includes(q)) { let p = e; while (p) { match.add(p.id); p = parentOf(p); } } });
  const walk = (parent, dep) => {
    els.filter(e => e.parent === parent).reverse().forEach(e => {
      if (q && !match.has(e.id)) return;
      const row = document.createElement('div');
      row.className = 'lrow' + (S.sel.includes(e.id) ? ' sel' : '') + (e.visible ? '' : ' off') + (e.isComp || e.type === 'instance' ? ' comp' : '');
      row.style.paddingLeft = 8 + dep * 14 + 'px'; row.dataset.id = e.id;
      row.innerHTML = `<span class="ico">${layerGlyph(e)}</span><span class="lname"></span>` +
        (e.link && e.link.kind ? '<span class="lnk" title="Has interaction">↪</span>' : '') +
        `<button class="lbtn ${e.locked ? 'on' : ''}" data-act="lock" title="Lock">${e.locked ? '🔒' : '🔓'}</button>` +
        `<button class="lbtn ${e.visible ? '' : 'on'}" data-act="vis" title="Show/hide">${e.visible ? '👁' : '—'}</button>`;
      $('.lname', row).textContent = (e.isComp ? '◆ ' : e.type === 'instance' ? '◇ ' : '') + e.name;
      layersEl.appendChild(row);
      walk(e.id, dep + 1);
    });
  };
  walk(null, 0);
}
$('#layerSearch').addEventListener('input', renderLayers);
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
layersEl.addEventListener('contextmenu', ev => {
  const row = ev.target.closest('.lrow'); if (!row) return;
  ev.preventDefault();
  if (!S.sel.includes(row.dataset.id)) setSel([row.dataset.id]);
  showContextMenu(ev.clientX, ev.clientY);
});

/* ---------------------------------------------------------- field helpers */
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.'); let a = o;
  for (let i = 0; i < ks.length - 1; i++) { a = a[ks[i]]; if (a == null) return false; }
  a[ks[ks.length - 1]] = v; return true;
}
const NUM_LEAF = /(^|\.)(x|y|w|h|radius|gap|padX|padY|cols|fontSize|fontWeight|lineHeight|letterSpacing|opacity|angle|sides|blur|spread|width)$/;
const num = (label, k, o = {}) => `<label class="f${o.cls ? ' ' + o.cls : ''}"><span>${label}</span><input type="number" data-k="${k}" step="${o.step || 1}"${o.min !== undefined ? ` min="${o.min}"` : ''}${o.max !== undefined ? ` max="${o.max}"` : ''}${o.pct ? ' data-pct="1"' : ''}${o.dis ? ' disabled' : ''}></label>`;
const sel = (label, k, opts, o = {}) => `<label class="f"><span>${label}</span><select data-k="${k}"${o.dis ? ' disabled' : ''}>${opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></label>`;
const tokenSelect = k => {
  const names = Object.keys(S.tokens);
  return names.length ? `<select class="tok" data-k="${k}" data-tok="1" title="Colour style"><option value="">◆</option>${names.map(n => `<option value="token:${esc(n)}">${esc(n)}</option>`).join('')}</select>` : '';
};
const colorRow = (label, k) => `<div class="crow"><span>${label}</span><input type="color" data-k="${k}"><input type="text" data-k="${k}" spellcheck="false" class="hex">${tokenSelect(k)}</div>`;
const btn = (act, label, title, extra = '') => `<button class="mini" data-act="${act}" title="${title}"${extra}>${label}</button>`;

/* ---------------------------------------------------------------- the panel */
function sizeOptions(e, par) {
  const o = [['fixed', 'Fixed']];
  const inAuto = isAuto(par);
  if (inAuto) o.push(['fill', 'Fill']);
  if (isAuto(e) || e.type === 'text' || e.type === 'button') o.push(['hug', 'Hug']);
  return o;
}
function renderProps() {
  if (!S.sel.length) {
    propsEl.innerHTML = `<div class="empty"><b>Nothing selected</b><br><br>
      <kbd>F</kbd> Frame · <kbd>R</kbd> Rect · <kbd>O</kbd> Ellipse · <kbd>L</kbd> Line<br>
      <kbd>P</kbd> Polygon · <kbd>T</kbd> Text · <kbd>B</kbd> Button · <kbd>I</kbd> Image<br>
      <kbd>N</kbd> Input · <kbd>C</kbd> Checkbox · <kbd>D</kbd> Dropdown<br><br>
      <kbd>Shift</kbd>+<kbd>A</kbd> auto layout · <kbd>Ctrl</kbd>+<kbd>G</kbd> group<br>
      Press <kbd>?</kbd> for all shortcuts</div>`;
    return;
  }
  const e = get(S.sel[0]); if (!e) { propsEl.innerHTML = ''; return; }
  const multi = S.sel.length > 1, t = e.type, par = parentOf(e), inAuto = isAuto(par), cont = isContainer(e), inst = t === 'instance';
  const textual = ['text', 'button', 'input', 'checkbox', 'select'].includes(t);
  let h = '';

  /* actions */
  h += `<div class="sec"><h4>${multi ? S.sel.length + ' layers' : esc(e.name)}${e.isComp ? ' <em class="badge">Component</em>' : ''}${inst ? ' <em class="badge">Instance</em>' : ''}</h4>
    <div class="btnrow">${btn('front', '⤒', 'Bring to front (Ctrl+])')}${btn('forward', '↑', 'Forward (])')}${btn('backward', '↓', 'Backward ([)')}${btn('back', '⤓', 'Send to back (Ctrl+[)')}${btn('dup', '⧉', 'Duplicate (Ctrl+D)')}${btn('del', '🗑', 'Delete')}</div>
    <div class="btnrow" style="margin-top:4px">${btn('group', 'Group', 'Group (Ctrl+G)')}${btn('ungroup', 'Ungroup', 'Ungroup (Ctrl+Shift+G)')}${btn('autolayout', '⇉ Auto', 'Add / remove auto layout (Shift+A)')}${btn('component', '◆', 'Create component (Ctrl+Alt+K)')}</div></div>`;

  /* position & size */
  h += `<div class="sec"><h4>Position &amp; size</h4><div class="grid2">${num('X', 'x', { dis: inAuto })}${num('Y', 'y', { dis: inAuto })}${num('W', 'w', { min: 1 })}${num('H', 'h', { min: 0 })}</div>
    <div class="grid2" style="margin-top:6px">${sel('W', 'sizeW', sizeOptions(e, par))}${sel('H', 'sizeH', sizeOptions(e, par))}</div>`;
  if (t === 'frame' && !multi) h += `<div style="margin-top:6px"><label class="f"><span style="width:42px">Size</span><select id="preset"><option value="">Preset…</option><option value="1440x900">Desktop 1440×900</option><option value="1024x768">Laptop 1024×768</option><option value="768x1024">Tablet 768×1024</option><option value="375x812">Mobile 375×812</option></select></label></div>`;
  if (!inAuto) h += `<div class="btnrow" style="margin-top:8px">${btn('al-left', '⇤', 'Align left')}${btn('al-hc', '↔', 'Align centre horizontally')}${btn('al-right', '⇥', 'Align right')}${btn('al-top', '⤒', 'Align top')}${btn('al-vc', '↕', 'Align centre vertically')}${btn('al-bottom', '⤓', 'Align bottom')}</div>`;
  if (multi && !inAuto) h += `<div class="btnrow" style="margin-top:4px">${btn('dist-h', '⇹ Spread horizontally', 'Distribute horizontally')}${btn('dist-v', '⇳ Spread vertically', 'Distribute vertically')}</div>`;
  h += '</div>';

  /* auto layout */
  if (cont) {
    h += `<div class="sec"><h4>Auto layout</h4>${sel('Mode', 'layout', [['none', 'None (free)'], ['row', 'Horizontal'], ['column', 'Vertical'], ['grid', 'Grid']])}`;
    if (e.layout !== 'none') {
      h += `<div class="grid2" style="margin-top:6px">${num('Gap', 'gap', { min: 0 })}${e.layout === 'grid' ? num('Col', 'cols', { min: 1, max: 12 }) : '<span></span>'}${num('PX', 'padX', { min: 0 })}${num('PY', 'padY', { min: 0 })}</div>
        <div class="grid2" style="margin-top:6px">${sel('Align', 'alignItems', [['start', 'Start'], ['center', 'Center'], ['end', 'End'], ['stretch', 'Stretch']])}${e.layout === 'grid' ? '<span></span>' : sel('Space', 'justify', [['start', 'Start'], ['center', 'Center'], ['end', 'End'], ['between', 'Between']])}</div>`;
      if (e.layout !== 'grid') h += '<label class="chk"><input type="checkbox" data-k="wrap"> Wrap</label>';
    }
    h += '</div>';
  }

  /* instance overrides */
  if (inst) {
    const m = get(e.ref);
    h += `<div class="sec"><h4>Instance of ${m ? esc(m.name) : '(missing)'}</h4><div class="btnrow">${btn('gotomain', 'Go to main', 'Select the main component')}${btn('detach', 'Detach', 'Turn into normal layers (Ctrl+Alt+B)')}</div>`;
    if (m) {
      const list = overridable(m.id);
      if (list.length) h += '<div class="ovlist">' + list.map(c => {
        const ov = (e.overrides || {})[c.id] || {}, textish = ['text', 'button', 'checkbox'].includes(c.type);
        const col = ov.color || (['text', 'icon', 'input', 'checkbox', 'select'].includes(c.type) ? c.color : (c.fills[0] && c.fills[0].color) || '#d9d9d9');
        return `<div class="ovrow"><span title="${esc(c.name)}">${esc(c.name)}</span>${textish ? `<input type="text" class="ovt" data-ov="${c.id}" data-ovk="text" value="${esc(ov.text !== undefined ? ov.text : c.text)}">` : '<span class="ovt"></span>'}<input type="color" data-ov="${c.id}" data-ovk="color" value="${/^#[0-9a-f]{6}$/i.test(tokenOf(col)) ? tokenOf(col) : '#888888'}"></div>`;
      }).join('') + '</div>';
    }
    h += '</div>';
  }

  /* text */
  if (textual) {
    h += '<div class="sec"><h4>Text</h4>';
    if (t === 'input') h += '<input class="url" data-k="placeholder" placeholder="Placeholder text" spellcheck="false">';
    else h += `<textarea class="ta" data-k="text" spellcheck="false"${t === 'select' ? ' placeholder="One option per line"' : ''}></textarea>`;
    h += `<div style="margin-top:6px">${sel('Style', 'tstyle', [['', '— none —'], ...Object.keys(S.textStyles).map(n => [n, n])])}</div>
      <div class="grid2" style="margin-top:6px">${sel('Aa', 'font', FONT_LIST.map(f => [f, f]))}${sel('Wt', 'fontWeight', [['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold']])}</div>
      <div class="grid2" style="margin-top:6px">${num('Sz', 'fontSize', { min: 1 })}${num('LH', 'lineHeight', { min: 0.5, step: 0.05 })}${num('LS', 'letterSpacing', { step: 0.1 })}${t === 'text' || t === 'button' ? sel('⇔', 'align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]) : '<span></span>'}</div>
      <div class="btnrow" style="margin-top:6px">${btn('t-italic', '<i>I</i>', 'Italic')}${btn('t-underline', '<u>U</u>', 'Underline')}${btn('t-strike', '<s>S</s>', 'Strikethrough')}${btn('mktstyle', '+ Style', 'Save these settings as a text style')}</div>
      <div style="margin-top:8px">${colorRow('Color', 'color')}</div>`;
    if (t === 'checkbox') h += '<label class="chk"><input type="checkbox" data-k="checked"> Checked</label>';
    h += '</div>';
  }
  if (t === 'icon') h += `<div class="sec"><h4>Icon</h4>${sel('Icon', 'icon', Object.keys(ICONS).map(n => [n, n]))}<div style="margin-top:8px">${colorRow('Color', 'color')}</div></div>`;
  if (t === 'image') h += `<div class="sec"><h4>Image</h4><input class="url" data-k="url" placeholder="https://… or upload" spellcheck="false" ${String(e.url).startsWith('data:') ? 'readonly' : ''}>
    <div class="btnrow" style="margin-top:6px">${btn('upload', '⬆ Upload image', 'Upload an image from your computer')}${e.url ? btn('clearimg', 'Remove', 'Remove image') : ''}</div>
    <div style="margin-top:6px">${sel('Fit', 'fit', [['cover', 'Cover'], ['contain', 'Contain'], ['fill', 'Stretch']])}</div></div>`;
  if (t === 'polygon') h += `<div class="sec"><h4>Polygon</h4><div class="grid2">${num('Sides', 'sides', { min: 3, max: 12 })}</div><label class="chk"><input type="checkbox" data-k="star"> Star shape</label></div>`;

  /* fills */
  if (t !== 'text') {
    h += '<div class="sec"><h4>Fill <button class="plus" data-act="addfill" title="Add fill">＋</button></h4>';
    e.fills.forEach((f, i) => {
      h += `<div class="fillrow"><input type="color" data-k="fills.${i}.color"><input type="text" class="hex" data-k="fills.${i}.color" spellcheck="false">${tokenSelect(`fills.${i}.color`)}
        <select data-k="fills.${i}.type"><option value="solid">Solid</option><option value="linear">Linear</option><option value="radial">Radial</option></select>
        <input type="number" class="pct" data-k="fills.${i}.opacity" data-pct="1" min="0" max="100" title="Opacity %"><button class="plus" data-act="rmfill" data-i="${i}" title="Remove">−</button></div>`;
      if (f.type === 'linear' || f.type === 'radial') h += `<div class="fillrow sub"><input type="color" data-k="fills.${i}.color2"><input type="text" class="hex" data-k="fills.${i}.color2" spellcheck="false">${f.type === 'linear' ? `<label class="f angle"><span>∠</span><input type="number" data-k="fills.${i}.angle" step="5"></label>` : ''}</div>`;
    });
    if (!e.fills.length) h += '<div class="muted">No fill</div>';
    h += '</div>';
  }
  /* strokes */
  if (t !== 'text') {
    h += '<div class="sec"><h4>Stroke <button class="plus" data-act="addstroke" title="Add stroke">＋</button></h4>';
    e.strokes.forEach((s, i) => { h += `<div class="fillrow"><input type="color" data-k="strokes.${i}.color"><input type="text" class="hex" data-k="strokes.${i}.color" spellcheck="false">${tokenSelect(`strokes.${i}.color`)}<label class="f angle"><span>W</span><input type="number" min="0" data-k="strokes.${i}.width"></label><button class="plus" data-act="rmstroke" data-i="${i}" title="Remove">−</button></div>`; });
    if (!e.strokes.length) h += '<div class="muted">No stroke</div>';
    h += '</div>';
  }
  /* effects */
  h += '<div class="sec"><h4>Effects <button class="plus" data-act="addeffect" title="Add effect">＋</button></h4>';
  e.effects.forEach((f, i) => {
    const shadow = f.type === 'drop' || f.type === 'inner';
    h += `<div class="fillrow"><select data-k="effects.${i}.type"><option value="drop">Drop shadow</option><option value="inner">Inner shadow</option><option value="blur">Layer blur</option><option value="bgblur">Background blur</option></select><button class="plus" data-act="rmeffect" data-i="${i}" title="Remove">−</button></div>
      <div class="fillrow sub">${shadow ? `${num('X', `effects.${i}.x`)}${num('Y', `effects.${i}.y`)}</div><div class="fillrow sub">${num('B', `effects.${i}.blur`, { min: 0 })}${num('S', `effects.${i}.spread`)}</div><div class="fillrow sub"><input type="color" data-k="effects.${i}.color"><input type="text" class="hex" data-k="effects.${i}.color" spellcheck="false">` : num('Blur', `effects.${i}.blur`, { min: 0 })}</div>`;
  });
  if (!e.effects.length) h += '<div class="muted">No effects</div>';
  h += '</div>';

  /* appearance */
  h += `<div class="sec"><h4>Appearance</h4>${['ellipse', 'polygon', 'line', 'icon'].includes(t) ? '' : `<div class="grid2">${num('◜', 'radius', { min: 0 })}</div>`}
    <div style="margin-top:8px"><div class="muted">Opacity</div><input type="range" data-k="opacity" data-pct="1" min="0" max="100"></div>
    ${t === 'frame' ? '<label class="chk"><input type="checkbox" data-k="clip"> Clip content</label>' : ''}</div>`;

  /* interaction */
  const frames = pageEls().filter(f => f.type === 'frame' && !f.parent && f.id !== e.id && !f.isComp);
  const lk = e.link || {};
  h += `<div class="sec"><h4>Interaction <span class="muted">(on click)</span></h4>
    <label class="f"><span>Do</span><select id="linkKind"><option value="">Nothing</option><option value="frame"${lk.kind === 'frame' ? ' selected' : ''}>Go to frame</option><option value="url"${lk.kind === 'url' ? ' selected' : ''}>Open URL</option></select></label>`;
  if (lk.kind === 'frame') h += `<label class="f" style="margin-top:6px"><span>To</span><select id="linkValue"><option value="">— choose —</option>${frames.map(f => `<option value="${f.id}"${lk.value === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>`;
  if (lk.kind === 'url') h += `<input class="url" id="linkValue" style="margin-top:6px" placeholder="https://…" value="${esc(lk.value || '')}" spellcheck="false">`;
  h += '</div>';

  propsEl.innerHTML = h;
  syncProps();
}

function syncProps() {
  if (!S.sel.length) return;
  const e = get(S.sel[0]); if (!e) return;
  $$('[data-k]', propsEl).forEach(n => {
    if (n === document.activeElement) return;
    const k = n.dataset.k; let v = getPath(e, k);
    if (n.dataset.pct) v = Math.round((v === undefined ? 1 : v) * 100);
    if (n.dataset.tok) n.value = typeof v === 'string' && v.startsWith('token:') && S.tokens[v.slice(6)] !== undefined ? v : '';
    else if (n.type === 'checkbox') n.checked = !!v;
    else if (n.type === 'color') { const c = tokenOf(v); n.value = /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff'; }
    else n.value = typeof v === 'number' ? r2(v) : (v === null || v === undefined ? '' : v);
  });
}

/* ---------------------------------------------------------------- applying */
const RERENDER = /(^layout$|\.type$|^sizeW$|^sizeH$|^tstyle$|^icon$|^wrap$|^url$)/;
function applyProp(k, v) {
  S.sel.forEach(id => {
    const e = get(id); if (!e) return;
    if (k === 'w') e.sizeW = 'fixed';
    if (k === 'h') e.sizeH = 'fixed';
    if ((k === 'w' || k === 'h') && v < (k === 'w' ? 1 : 0)) v = k === 'w' ? 1 : 0;
    setPath(e, k, v);
  });
  refresh();
}
propsEl.addEventListener('input', ev => {
  const t = ev.target;
  if (t.dataset.ov) { const inst = get(S.sel[0]); if (inst) setOverride(inst.id, t.dataset.ov, t.dataset.ovk, t.value); return; }
  if (t.id === 'linkValue') { const e = get(S.sel[0]); e.link = Object.assign({}, e.link, { value: t.value }); refresh(); return; }
  const k = t.dataset.k; if (!k || t.dataset.tok) return;
  let v;
  if (t.type === 'checkbox') v = t.checked;
  else if (NUM_LEAF.test(k) && t.tagName !== 'SELECT') { v = parseFloat(t.value); if (isNaN(v)) return; if (t.dataset.pct) v /= 100; }
  else if (t.tagName === 'SELECT' && NUM_LEAF.test(k)) v = parseFloat(t.value);
  else v = t.value;
  if (t.type === 'text' && t.classList.contains('hex') && !/^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent|rgba?\([^)]*\)|token:.+)$/i.test(v.trim())) return;
  applyProp(k, typeof v === 'string' ? v.trim() : v);
  if (t.type === 'color') $$(`input.hex[data-k="${k}"]`, propsEl).forEach(x => { x.value = v; });
  if (t.classList.contains('hex')) $$(`input[type=color][data-k="${k}"]`, propsEl).forEach(x => { const c = tokenOf(v); if (/^#[0-9a-f]{6}$/i.test(c)) x.value = c; });
});
propsEl.addEventListener('change', ev => {
  const t = ev.target;
  if (t.dataset.ov) { commit(); return; }
  if (t.id === 'preset') {
    if (!t.value) return;
    const [w, h] = t.value.split('x').map(Number); applyProp('w', w); applyProp('h', h); t.value = ''; commit(); return syncProps();
  }
  if (t.id === 'linkKind') { const e = get(S.sel[0]); e.link = t.value ? { kind: t.value, value: '' } : null; commit(); renderProps(); renderLayers(); refresh(); return; }
  if (t.id === 'linkValue') { commit(); renderLayers(); return; }
  if (t.dataset.tok) {
    const k = t.dataset.k;
    if (t.value) applyProp(k, t.value);
    else S.sel.forEach(id => { const e = get(id); const cur = getPath(e, k); setPath(e, k, tokenOf(cur)); });
    commit(); refresh(); renderProps(); return;
  }
  const k = t.dataset.k;
  if (k && (k === 'w' || k === 'h' || k.startsWith('layout') || RERENDER.test(k))) { commit(); renderProps(); renderLayers(); return; }
  commit(); syncProps();
});
propsEl.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, i = +b.dataset.i;
  const each = fn => { S.sel.forEach(id => { const e = get(id); if (e) fn(e); }); commit(); refresh(); renderProps(); };
  if (['front', 'forward', 'backward', 'back'].includes(act)) return reorder(act);
  switch (act) {
    case 'dup': return duplicate();
    case 'del': return removeSel();
    case 'group': return groupSel();
    case 'ungroup': return ungroupSel();
    case 'autolayout': return toggleAuto();
    case 'component': return createComponent();
    case 'detach': return detachInstance();
    case 'gotomain': { const e = get(S.sel[0]), m = e && get(e.ref); if (m) { if (m.page !== S.page) setPage(m.page); setSel([m.id]); fit([m.id]); } return; }
    case 'addfill': return each(e => e.fills.push(solid('#d9d9d9')));
    case 'rmfill': return each(e => e.fills.splice(i, 1));
    case 'addstroke': return each(e => e.strokes.push(stroke('#000000', 1)));
    case 'rmstroke': return each(e => e.strokes.splice(i, 1));
    case 'addeffect': return each(e => e.effects.push({ type: 'drop', x: 0, y: 8, blur: 24, spread: 0, color: 'rgba(0,0,0,.25)' }));
    case 'rmeffect': return each(e => e.effects.splice(i, 1));
    case 't-italic': return each(e => { e.italic = !e.italic; });
    case 't-underline': return each(e => { e.underline = !e.underline; });
    case 't-strike': return each(e => { e.strike = !e.strike; });
    case 'upload': { pickImageFile().then(f => f && setImageFor(S.sel[0], f)); return; }
    case 'clearimg': return each(e => { e.url = ''; });
    case 'mktstyle': return makeTextStyle();
  }
  if (act.startsWith('al-')) return alignSel(act.slice(3));
  if (act === 'dist-h') return distribute('h');
  if (act === 'dist-v') return distribute('v');
});
function makeTextStyle() {
  const e = get(S.sel[0]); if (!e) return;
  const name = (prompt('Name for this text style:', 'Heading') || '').trim(); if (!name) return;
  S.textStyles[name] = { font: e.font, fontSize: e.fontSize, fontWeight: e.fontWeight, lineHeight: e.lineHeight, letterSpacing: e.letterSpacing };
  e.tstyle = name; commit(); refresh(); renderProps(); toast(`Text style "${name}" saved`);
}
