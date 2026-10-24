'use strict';
/* FrameForge – Library (blocks, pages, components, icons), styles manager and the prototype player. */

/* ---------------------------------------------------------- tree builder */
const T = (type, props = {}, kids = []) => ({ type, props, kids });
function build(spec, parentId) {
  const e = mk(spec.type, Object.assign({ parent: parentId }, spec.props));
  S.els.push(e); reindex();
  spec.kids.forEach(k => build(k, e.id));
  return e;
}
const C = { primary: '#2563eb', dark: '#0f172a', gray: '#475569', line: '#e2e8f0', soft: '#f8fafc' };
const grad = (a, b, ang = 135) => ({ type: 'linear', color: a, color2: b, angle: ang, opacity: 1 });
const shadowSm = { type: 'drop', x: 0, y: 4, blur: 16, spread: 0, color: 'rgba(15,23,42,.10)' };
const txt = (text, p = {}) => T('text', Object.assign({ name: text.slice(0, 22), text, fontSize: 16, color: C.gray, w: 120, h: 24, sizeW: 'hug', sizeH: 'hug' }, p));
const para = (text, p = {}) => txt(text, Object.assign({ w: 400, sizeW: 'fill' }, p));
const button = (text, p = {}) => T('button', Object.assign({ name: text, text, w: 160, h: 48 }, p));
const row = (name, kids, p = {}) => T('frame', Object.assign({ name, layout: 'row', gap: 16, alignItems: 'center', sizeW: 'hug', sizeH: 'hug', fills: [], clip: false }, p), kids);
const col = (name, kids, p = {}) => T('frame', Object.assign({ name, layout: 'column', gap: 12, sizeW: 'hug', sizeH: 'hug', fills: [], clip: false }, p), kids);
const fillW = s => { s.props.sizeW = 'fill'; return s; };

const BLOCKS = {
  navbar: () => T('frame', { name: 'Navbar', w: 1440, h: 72, sizeH: 'hug', layout: 'row', padX: 48, padY: 16, justify: 'between', alignItems: 'center', fills: [solid('#ffffff')], effects: [shadowSm], clip: false }, [
    txt('Acme', { name: 'Logo', fontSize: 24, fontWeight: 700, color: C.dark }),
    row('Links', [txt('Product'), txt('Pricing'), txt('Docs')], { gap: 32 }),
    button('Sign up', { w: 130, h: 44 })]),
  hero: () => T('frame', { name: 'Hero', w: 1440, h: 480, sizeH: 'hug', layout: 'column', gap: 24, padX: 120, padY: 96, fills: [grad('#eff6ff', '#ffffff', 180)], clip: false }, [
    txt('Design layouts\nfaster than ever', { name: 'Headline', fontSize: 60, fontWeight: 700, color: C.dark, w: 720, sizeW: 'fixed', lineHeight: 1.1 }),
    para('Drag, drop and export clean HTML & CSS straight from your browser.', { name: 'Subtitle', fontSize: 20, w: 560, sizeW: 'fixed' }),
    row('Actions', [button('Get started', { w: 180, h: 56 }), button('Learn more', { w: 180, h: 56, fills: [], strokes: [stroke(C.primary, 2)], color: C.primary })])]),
  features: () => T('frame', { name: 'Features', w: 1440, h: 320, sizeH: 'hug', layout: 'row', gap: 24, padX: 120, padY: 64, fills: [solid('#ffffff')], clip: false },
    [['zap', 'Fast', 'Snap, align and resize with live guides.'], ['layers', 'Structured', 'Frames, layers and auto layout like Figma.'], ['code', 'Exportable', 'One click to HTML, React or Tailwind.']].map(([ic, t, d]) =>
      T('frame', { name: 'Card ' + t, layout: 'column', gap: 12, padX: 28, padY: 28, sizeW: 'fill', sizeH: 'hug', w: 300, h: 180, radius: 16, fills: [solid('#ffffff')], strokes: [stroke(C.line)], effects: [shadowSm], clip: false }, [
        T('icon', { name: 'Icon', icon: ic, color: C.primary, w: 32, h: 32 }),
        txt(t, { name: 'Title', fontSize: 22, fontWeight: 600, color: C.dark }),
        para(d, { name: 'Text' })]))),
  pricing: () => T('frame', { name: 'Pricing', w: 1440, h: 520, sizeH: 'hug', layout: 'row', gap: 24, padX: 120, padY: 64, alignItems: 'stretch', fills: [solid(C.soft)], clip: false },
    [['Starter', '$0', 'For hobby projects'], ['Pro', '$19', 'For freelancers'], ['Team', '$49', 'For growing teams']].map(([n, p, d], i) =>
      T('frame', { name: n + ' plan', layout: 'column', gap: 14, padX: 32, padY: 32, sizeW: 'fill', sizeH: 'hug', w: 300, h: 320, radius: 20, fills: [solid(i === 1 ? C.primary : '#ffffff')], strokes: i === 1 ? [] : [stroke(C.line)], clip: false }, [
        txt(n, { name: 'Plan', fontSize: 18, fontWeight: 600, color: i === 1 ? '#ffffff' : C.dark }),
        txt(p + ' / mo', { name: 'Price', fontSize: 40, fontWeight: 700, color: i === 1 ? '#ffffff' : C.dark }),
        para(d, { name: 'About', color: i === 1 ? '#dbeafe' : C.gray }),
        para('✓ Unlimited frames\n✓ HTML & CSS export\n✓ Community support', { name: 'Features', color: i === 1 ? '#ffffff' : C.gray }),
        button('Choose ' + n, { sizeW: 'fill', fills: [solid(i === 1 ? '#ffffff' : C.primary)], color: i === 1 ? C.primary : '#ffffff' })]))),
  testimonial: () => T('frame', { name: 'Testimonial', w: 1440, h: 300, sizeH: 'hug', layout: 'column', gap: 24, padX: 240, padY: 72, alignItems: 'center', fills: [solid('#ffffff')], clip: false }, [
    para('“FrameForge replaced three tools in our workflow. We ship landing pages in an afternoon.”', { name: 'Quote', fontSize: 28, fontWeight: 500, color: C.dark, align: 'center', italic: true }),
    row('Author', [T('ellipse', { name: 'Avatar', w: 48, h: 48, fills: [grad('#60a5fa', '#a78bfa')] }), col('Who', [txt('Priya Nair', { name: 'Name', fontWeight: 600, color: C.dark }), txt('Product designer', { name: 'Role', fontSize: 14 })], { gap: 2 })])]),
  cta: () => T('frame', { name: 'Call to action', w: 1440, h: 320, sizeH: 'hug', layout: 'column', gap: 20, padX: 120, padY: 80, alignItems: 'center', fills: [grad('#2563eb', '#7c3aed')], clip: false }, [
    txt('Ready to build your next site?', { name: 'Headline', fontSize: 40, fontWeight: 700, color: '#ffffff' }),
    txt('Start designing in seconds. No sign-up needed.', { name: 'Sub', fontSize: 18, color: '#dbeafe' }),
    button('Start free', { w: 180, h: 56, fills: [solid('#ffffff')], color: C.primary })]),
  footer: () => T('frame', { name: 'Footer', w: 1440, h: 120, sizeH: 'hug', layout: 'row', padX: 120, padY: 40, justify: 'between', alignItems: 'center', fills: [solid(C.dark)], clip: false }, [
    txt('© 2026 Acme Inc.', { name: 'Copyright', color: '#94a3b8', fontSize: 14 }),
    row('Links', [txt('Privacy', { color: '#cbd5e1', fontSize: 14 }), txt('Terms', { color: '#cbd5e1', fontSize: 14 }), txt('Contact', { color: '#cbd5e1', fontSize: 14 })], { gap: 24 })]),
  login: () => T('frame', { name: 'Login form', w: 400, h: 420, sizeH: 'hug', layout: 'column', gap: 16, padX: 32, padY: 32, radius: 16, fills: [solid('#ffffff')], strokes: [stroke(C.line)], effects: [shadowSm], clip: false }, [
    txt('Welcome back', { name: 'Title', fontSize: 28, fontWeight: 700, color: C.dark }),
    txt('Sign in to continue', { name: 'Subtitle', fontSize: 15 }),
    T('input', { name: 'Email', placeholder: 'Email address', sizeW: 'fill' }),
    T('input', { name: 'Password', placeholder: 'Password', sizeW: 'fill' }),
    T('checkbox', { name: 'Remember', text: 'Remember me', sizeW: 'fill' }),
    button('Sign in', { sizeW: 'fill' }),
    txt('Forgot your password?', { name: 'Forgot', fontSize: 14, color: C.primary })]),
};
const BLOCK_INFO = [['navbar', 'Navbar', 'Logo, links and a button'], ['hero', 'Hero', 'Big headline with two buttons'], ['features', 'Feature cards', 'Three icon cards'], ['pricing', 'Pricing', 'Three plans'], ['testimonial', 'Testimonial', 'Quote with author'], ['cta', 'Call to action', 'Gradient banner'], ['footer', 'Footer', 'Copyright and links'], ['login', 'Login form', 'Inputs, checkbox, button']];

const PAGES = {
  landing: () => T('frame', { name: 'Landing page', w: 1440, h: 1800, sizeH: 'hug', layout: 'column', gap: 0, fills: [solid('#ffffff')], clip: true },
    ['navbar', 'hero', 'features', 'testimonial', 'cta', 'footer'].map(k => fillW(BLOCKS[k]()))),
  login: () => T('frame', { name: 'Login page', w: 1440, h: 900, layout: 'column', alignItems: 'center', justify: 'center', gap: 0, fills: [grad('#e0e7ff', '#f8fafc', 160)], clip: true }, [BLOCKS.login()]),
  mobile: () => T('frame', { name: 'Mobile landing', w: 375, h: 812, sizeH: 'hug', layout: 'column', gap: 0, fills: [solid('#ffffff')], clip: true }, [
    fillW(T('frame', { name: 'Navbar', w: 375, h: 64, layout: 'row', padX: 20, justify: 'between', alignItems: 'center', fills: [solid('#ffffff')], effects: [shadowSm], clip: false }, [txt('Acme', { name: 'Logo', fontSize: 22, fontWeight: 700, color: C.dark }), T('icon', { name: 'Menu', icon: 'menu', color: C.dark, w: 28, h: 28 })])),
    fillW(T('frame', { name: 'Hero', w: 375, h: 400, sizeH: 'hug', layout: 'column', gap: 16, padX: 24, padY: 48, fills: [grad('#eff6ff', '#ffffff', 180)], clip: false }, [
      para('Design layouts faster than ever', { name: 'Headline', fontSize: 38, fontWeight: 700, color: C.dark, lineHeight: 1.1 }),
      para('Drag, drop and export clean HTML & CSS.', { name: 'Subtitle', fontSize: 17 }), button('Get started', { sizeW: 'fill', h: 52 })])),
    fillW(T('frame', { name: 'Features', w: 375, h: 400, sizeH: 'hug', layout: 'column', gap: 16, padX: 24, padY: 32, fills: [solid('#ffffff')], clip: false },
      ['zap', 'layers', 'code'].map((ic, i) => fillW(T('frame', { name: 'Card', layout: 'row', gap: 14, padX: 16, padY: 16, alignItems: 'center', w: 300, h: 80, sizeH: 'hug', radius: 14, fills: [solid(C.soft)], clip: false }, [T('icon', { name: 'Icon', icon: ic, color: C.primary, w: 28, h: 28 }), para(['Fast and precise', 'Auto layout built in', 'Export to any stack'][i], { name: 'Text', color: C.dark })])))))]),
};
const PAGE_INFO = [['landing', 'Landing page', 'Desktop · navbar, hero, features, testimonial, CTA, footer'], ['login', 'Login page', 'Desktop · centred login card'], ['mobile', 'Mobile landing', '375px wide mobile layout']];

/* ------------------------------------------------------------- inserting */
function insertionParent() {
  const e = S.sel.length === 1 ? get(S.sel[0]) : null;
  return e && isContainer(e) ? e : null;
}
function insertSpec(spec, asPage) {
  const parent = asPage ? null : insertionParent();
  const e = build(spec, parent ? parent.id : null);
  if (parent) {
    if (isAuto(parent)) { if (e.type === 'frame') e.sizeW = 'fill'; }
    else { e.x = 0; e.y = 0; e.w = Math.min(e.w, parent.w); }
  } else {
    const roots = pageEls().filter(r => !r.parent && r.id !== e.id);
    e.x = roots.length ? Math.max(...roots.map(r => r.x + r.w)) + 100 : 0; e.y = 0;
  }
  S.sel = [e.id]; commit(); render();
  if (!parent) fit([e.id]); else measure();
  closeLibrary();
}
function insertIcon(name) {
  const parent = insertionParent();
  const c = viewport.getBoundingClientRect(), pa = parent ? absPos(parent) : { x: 0, y: 0 };
  const e = mk('icon', { name: 'Icon ' + name, icon: name, parent: parent ? parent.id : null, x: Math.round((c.width / 2 - S.view.x) / S.view.z - 16 - pa.x), y: Math.round((c.height / 2 - S.view.y) / S.view.z - 16 - pa.y) });
  S.els.push(e); reindex(); S.sel = [e.id]; commit(); render(); closeLibrary();
}

/* --------------------------------------------------------------- library UI */
let libTab = 'blocks';
function openLibrary(tab) { libTab = tab || libTab; $('#libModal').hidden = false; renderLibrary(); }
function closeLibrary() { $('#libModal').hidden = true; }
function renderLibrary() {
  $$('#libTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === libTab));
  const body = $('#libBody'); body.innerHTML = '';
  const card = (title, sub, fn, extra = '') => { const d = document.createElement('button'); d.className = 'libcard'; d.innerHTML = `${extra}<strong>${esc(title)}</strong><span>${esc(sub)}</span>`; d.addEventListener('click', fn); body.appendChild(d); };
  if (libTab === 'blocks') {
    const note = document.createElement('p'); note.className = 'libnote'; note.textContent = 'Blocks are built with auto layout. Select a frame first to insert into it, or nothing to place on the canvas.'; body.appendChild(note);
    BLOCK_INFO.forEach(([k, t, s]) => card(t, s, () => insertSpec(BLOCKS[k]())));
  } else if (libTab === 'pages') {
    PAGE_INFO.forEach(([k, t, s]) => card(t, s, () => insertSpec(PAGES[k](), true)));
  } else if (libTab === 'components') {
    const list = components();
    if (!list.length) { const p = document.createElement('p'); p.className = 'libnote'; p.innerHTML = 'No components yet. Select a frame or group and press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> (or the ◆ button) to turn it into a component. Then insert linked copies here — editing the main component updates every copy.'; body.appendChild(p); }
    list.forEach(m => card('◆ ' + m.name, `${Math.round(m.w)} × ${Math.round(m.h)} · ${m.page === S.page ? 'this page' : (S.pages.find(p => p.id === m.page) || {}).name}`, () => { const par = insertionParent(); createInstance(m.id, par && par.id !== m.id ? par.id : null); closeLibrary(); }));
  } else if (libTab === 'icons') {
    const grid = document.createElement('div'); grid.className = 'icongrid';
    Object.keys(ICONS).forEach(n => { const b = document.createElement('button'); b.title = n; b.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg><span>${n}</span>`; b.addEventListener('click', () => insertIcon(n)); grid.appendChild(b); });
    body.appendChild(grid);
  }
}
$('#libTabs').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) { libTab = b.dataset.tab; renderLibrary(); } });
$('#libClose').addEventListener('click', closeLibrary);
$('#libModal').addEventListener('pointerdown', ev => { if (ev.target.id === 'libModal') closeLibrary(); });

/* ------------------------------------------------------------ styles manager */
function openStyles() { $('#stylesModal').hidden = false; renderStyles(); }
function renameToken(oldName, newName) {
  newName = newName.trim(); if (!newName || newName === oldName || S.tokens[newName] !== undefined) return false;
  S.tokens = Object.fromEntries(Object.entries(S.tokens).map(([k, v]) => [k === oldName ? newName : k, v]));
  const o = 'token:' + oldName, n = 'token:' + newName, sw = v => v === o ? n : v;
  S.els.forEach(e => { e.color = sw(e.color); e.fills.forEach(f => { f.color = sw(f.color); f.color2 = sw(f.color2); }); e.strokes.forEach(s => { s.color = sw(s.color); }); e.effects.forEach(f => { f.color = sw(f.color); }); });
  return true;
}
function renderStyles() {
  const body = $('#stylesBody'); let h = '<h4>Colour styles</h4>';
  Object.entries(S.tokens).forEach(([n, c]) => { h += `<div class="strow"><input type="color" data-tc="${esc(n)}" value="${esc(c)}"><input type="text" class="stname" data-tn="${esc(n)}" value="${esc(n)}"><span class="muted">${esc(c)}</span><button class="plus" data-del-token="${esc(n)}" title="Delete">−</button></div>`; });
  h += '<div class="strow"><input type="color" id="newTokColor" value="#2563eb"><input type="text" class="stname" id="newTokName" placeholder="New colour name"><button class="mini" id="addToken">Add colour</button></div>';
  h += '<h4 style="margin-top:18px">Text styles</h4>';
  Object.entries(S.textStyles).forEach(([n, s]) => {
    h += `<div class="strow ts"><input type="text" class="stname" value="${esc(n)}" readonly><select data-ts="${esc(n)}" data-f="font">${FONT_LIST.map(f => `<option${f === s.font ? ' selected' : ''}>${f}</option>`).join('')}</select>
      <input type="number" data-ts="${esc(n)}" data-f="fontSize" value="${s.fontSize}" title="Size"><input type="number" data-ts="${esc(n)}" data-f="fontWeight" step="100" value="${s.fontWeight}" title="Weight"><input type="number" data-ts="${esc(n)}" data-f="lineHeight" step="0.05" value="${s.lineHeight}" title="Line height"><button class="plus" data-del-ts="${esc(n)}" title="Delete">−</button></div>`;
  });
  h += '<div class="strow"><input type="text" class="stname" id="newTsName" placeholder="New text style name"><button class="mini" id="addTs">Add text style</button></div>';
  h += '<p class="libnote">Apply a colour style from the ◆ menu next to any colour. Apply a text style from the “Style” menu in the Text section. Changing a style here updates every layer that uses it.</p>';
  body.innerHTML = h;
}
$('#stylesBody').addEventListener('input', ev => {
  const t = ev.target;
  if (t.dataset.tc) { S.tokens[t.dataset.tc] = t.value; refresh(); }
  else if (t.dataset.ts) { const s = S.textStyles[t.dataset.ts], f = t.dataset.f; s[f] = t.tagName === 'SELECT' ? t.value : parseFloat(t.value) || s[f]; refresh(); }
});
$('#stylesBody').addEventListener('change', ev => {
  const t = ev.target;
  if (t.dataset.tn) { if (renameToken(t.dataset.tn, t.value)) { commit(); refresh(); renderProps(); } renderStyles(); return; }
  commit(); renderProps();
});
$('#stylesBody').addEventListener('click', ev => {
  const t = ev.target;
  if (t.id === 'addToken') { const n = $('#newTokName').value.trim(); if (!n || S.tokens[n] !== undefined) return toast('Pick a unique name', true); S.tokens[n] = $('#newTokColor').value; commit(); renderStyles(); renderProps(); }
  else if (t.id === 'addTs') { const n = $('#newTsName').value.trim(); if (!n || S.textStyles[n]) return toast('Pick a unique name', true); S.textStyles[n] = { font: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 }; commit(); renderStyles(); renderProps(); }
  else if (t.dataset.delToken) { const n = t.dataset.delToken, c = S.tokens[n]; S.els.forEach(e => { const fix = v => v === 'token:' + n ? c : v; e.color = fix(e.color); e.fills.forEach(f => { f.color = fix(f.color); f.color2 = fix(f.color2); }); e.strokes.forEach(s => { s.color = fix(s.color); }); e.effects.forEach(f => { f.color = fix(f.color); }); }); delete S.tokens[n]; commit(); refresh(); renderStyles(); renderProps(); }
  else if (t.dataset.delTs) { const n = t.dataset.delTs; S.els.forEach(e => { if (e.tstyle === n) e.tstyle = ''; }); delete S.textStyles[n]; commit(); refresh(); renderStyles(); renderProps(); }
});
$('#stylesClose').addEventListener('click', () => { $('#stylesModal').hidden = true; });
$('#stylesModal').addEventListener('pointerdown', ev => { if (ev.target.id === 'stylesModal') ev.target.hidden = true; });

/* ----------------------------------------------------------- prototype player */
const present = { open: false, hist: [], cur: null, hot: false };
function startPresent() {
  resolveAll();
  const frames = RES.filter(f => f.type === 'frame' && !f.parent && !f.isComp);
  if (!frames.length) return toast('Add a frame first', true);
  const sel = S.sel.length ? rootOf(get(S.sel[0])) : null;
  const start = sel && frames.some(f => f.id === sel.id) ? sel.id : frames[0].id;
  present.open = true; present.hist = []; $('#present').hidden = false; showFrame(start, false);
}
function showFrame(id, push = true) {
  const f = RMAP.get(id); if (!f) return;
  if (push && present.cur) present.hist.push(present.cur);
  present.cur = id;
  const stage = $('#presentStage'); stage.innerHTML = '';
  const reg = new Map(), node = buildNode(f, reg);
  node.style.left = '0px'; node.style.top = '0px';
  const box = $('#presentBox').getBoundingClientRect();
  const k = Math.min((box.width - 32) / f.w, (box.height - 32) / f.h, 1.5);
  const wrap = document.createElement('div'); wrap.className = 'pwrap';
  wrap.style.cssText = `width:${f.w * k}px;height:${f.h * k}px`;
  node.style.transformOrigin = '0 0'; node.style.transform = `scale(${k})`;
  wrap.appendChild(node); stage.appendChild(wrap);
  $('#presentName').textContent = f.name;
  $('#presentBack').disabled = !present.hist.length;
}
function closePresent() { present.open = false; present.cur = null; $('#present').hidden = true; $('#presentStage').innerHTML = ''; }
$('#presentStage').addEventListener('click', ev => {
  let n = ev.target.closest('.el');
  while (n) {
    const e = RMAP.get(n.dataset.id);
    if (e && e.link && e.link.kind === 'frame' && RMAP.has(e.link.value)) return showFrame(e.link.value);
    if (e && e.link && e.link.kind === 'url' && /^https?:\/\//i.test(e.link.value || '')) return void window.open(e.link.value, '_blank', 'noopener');
    n = n.parentElement && n.parentElement.closest('.el');
  }
});
$('#presentBack').addEventListener('click', () => { const id = present.hist.pop(); if (id) showFrame(id, false); $('#presentBack').disabled = !present.hist.length; });
$('#presentClose').addEventListener('click', closePresent);
$('#presentHot').addEventListener('click', () => { present.hot = !present.hot; $('#present').classList.toggle('hot', present.hot); });
window.addEventListener('keydown', ev => {
  if (!present.open) return;
  if (ev.key === 'Escape') { ev.stopPropagation(); closePresent(); }
  if (ev.key === 'Backspace' || ev.key === 'ArrowLeft') { ev.preventDefault(); $('#presentBack').click(); }
}, true);
window.addEventListener('resize', () => { if (present.open && present.cur) showFrame(present.cur, false); });
