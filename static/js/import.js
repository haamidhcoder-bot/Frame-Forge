'use strict';
/* FrameForge – import. Everything the Export menu produces can be brought back in:
     .json  .html (also Tailwind / Bootstrap / Flask pages)  .zip (HTML+CSS, React, Bootstrap, Flask)
     .svg   .png      – exported from a frame; they carry the editable frame inside, so they re-open as a design
     .pdf             – every page becomes an image-backed frame (needs internet for the PDF reader)
   Files that were not made by FrameForge still import: HTML/ZIP are rebuilt from the rendered page, SVG/PNG/JPG/WebP/GIF
   become image layers. */

const EMBED_RE = /<script[^>]*\bid=["']frameforge-project["'][^>]*>([\s\S]*?)<\/script>/i;
const IMPORT_EXT = /\.(json|html?|zip|svg|png|jpe?g|gif|webp|avif|bmp|pdf)$/i;

/* ----------------------------------------------------------------- helpers */
function asProject(obj, fallbackName) {
  const data = obj && obj.data && typeof obj.data === 'object' ? obj.data : obj;
  if (!data || !Array.isArray(data.els) || data.els.some(e => !e || !e.id || !e.type)) throw new Error('Not a FrameForge file');
  return { name: String((obj && obj.name) || fallbackName || 'Imported design').slice(0, 120), data };
}
function confirmReplace(what) {
  return !(S.dirty && S.els.length) || confirm(`Replace the current design with ${what}? Unsaved changes will be lost.`);
}
function openImported(name, data, note) {
  loadDoc(name, data); markDirty(); toast(note || 'Imported “' + name + '”');
}
const viewCenterWorld = () => { const c = viewport.getBoundingClientRect(); return { x: (c.width / 2 - S.view.x) / S.view.z - 120, y: (c.height / 2 - S.view.y) / S.view.z - 80 }; };

/* ---------- PNG: read / write an iTXt chunk named "frameforge" (so PNG exports re-open as designs) */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function pngEmbed(bytes, key, text) {
  const enc = new TextEncoder(), kb = enc.encode(key), tb = enc.encode(text);
  const data = new Uint8Array(kb.length + 5 + tb.length);          // keyword \0 flag method lang\0 translated\0 text
  data.set(kb, 0); data.set(tb, kb.length + 5);
  const chunk = pngChunk('iTXt', data), at = 33;                    // 8-byte signature + 25-byte IHDR
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, at), 0); out.set(chunk, at); out.set(bytes.subarray(at), at + chunk.length);
  return out;
}
function pngExtract(bytes, key) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || sig.some((v, i) => bytes[i] !== v)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder();
  for (let p = 8; p + 12 <= bytes.length;) {
    const len = dv.getUint32(p), type = dec.decode(bytes.subarray(p + 4, p + 8)), d = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'iTXt') {
      const z = d.indexOf(0);
      if (z > 0 && dec.decode(d.subarray(0, z)) === key && d[z + 1] === 0) {   // uncompressed only
        let q = z + 3; q = d.indexOf(0, q) + 1; q = d.indexOf(0, q) + 1;
        return dec.decode(d.subarray(q));
      }
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return null;
}

/* Everything a single frame needs to be re-opened later (children + the masters of its component instances). */
function frameProject(frame) {
  const ids = new Set(), add = id => {
    if (ids.has(id)) return; ids.add(id);
    kids(id).forEach(k => add(k.id));
    const e = get(id); if (e && e.ref) add(e.ref);
  };
  add(frame.id);
  const els = clone(S.els.filter(e => ids.has(e.id))).map(e => e.id === frame.id ? Object.assign(e, { parent: null, page: 'p1' }) : e);
  els.forEach(e => { e.page = 'p1'; });
  return { format: 'frameforge', version: 2, name: `${S.name} – ${frame.name}`, data: { els, pages: [{ id: 'p1', name: 'Page 1', guides: [] }], tokens: S.tokens, textStyles: S.textStyles, version: 2 } };
}
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function svgWithProject(svg, frame) {
  return svg.replace(/^(<svg\b[^>]*>)/, `$1<metadata id="frameforge-project">${xmlEsc(JSON.stringify(frameProject(frame)))}</metadata>`);
}

/* ----------------------------------------------------- HTML -> layers (fallback) */
const _cx = (() => { const c = document.createElement('canvas'); c.width = c.height = 1; return c.getContext('2d', { willReadFrequently: true }); })();
function parseColor(str) {
  if (!str || str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(str);
  if (m) { let a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]); return { r: +m[1] | 0, g: +m[2] | 0, b: +m[3] | 0, a }; }
  _cx.clearRect(0, 0, 1, 1); _cx.fillStyle = '#000'; _cx.fillStyle = str; _cx.fillRect(0, 0, 1, 1);
  const d = _cx.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
}
const hex2 = n => Math.round(n).toString(16).padStart(2, '0');
const toHex = c => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
const toCss = c => c.a >= 0.995 ? toHex(c) : `rgba(${c.r},${c.g},${c.b},${Math.round(c.a * 100) / 100})`;
const pxv = v => parseFloat(v) || 0;

function topLevelSplit(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }

async function domImport(html, name) {
  const fr = document.createElement('iframe');
  fr.setAttribute('sandbox', 'allow-same-origin');                   // no scripts run inside the imported page
  fr.style.cssText = 'position:fixed;left:-20000px;top:0;width:1440px;height:900px;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(fr);
  try {
    await new Promise((res, rej) => { const t = setTimeout(res, 9000); fr.onload = () => { clearTimeout(t); res(); }; fr.onerror = rej; fr.srcdoc = html; });
    const doc = fr.contentDocument, win = fr.contentWindow;
    if (!doc || !doc.body) throw new Error('Could not read that page');
    try { await Promise.race([doc.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch (_) {}
    doc.querySelectorAll('.ff-frame').forEach(f => f.classList.add('ff-active'));   // FrameForge prototypes hide inactive frames
    const out = [], ctx = { n: 0, max: 3000, cut: false };
    const bodyCs = win.getComputedStyle(doc.body), htmlCs = win.getComputedStyle(doc.documentElement);
    let bg = parseColor(bodyCs.backgroundColor); if (bg.a < 0.01) bg = parseColor(htmlCs.backgroundColor); if (bg.a < 0.01) bg = { r: 255, g: 255, b: 255, a: 1 };
    const W = 1440, H = Math.max(200, Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight)));
    const root = mk('frame', { name: name || 'Imported page', page: 'p1', x: 0, y: 0, w: W, h: H, fills: [solid(toHex(bg), bg.a)], clip: true });
    out.push(root);
    const title = (doc.title || '').trim(); if (title && !name) root.name = title;
    for (const c of doc.body.childNodes) walkDom(c, root, { left: 0, top: 0 }, { out, ctx, win, doc });
    if (out.length === 1) throw new Error('No visible content found in that page');
    if (ctx.cut) toast('Large page: imported the first ' + ctx.max + ' elements');
    return out;
  } finally { fr.remove(); }
}

const INLINE_TAGS = new Set(['A', 'B', 'I', 'EM', 'STRONG', 'SPAN', 'SMALL', 'CODE', 'U', 'S', 'MARK', 'SUB', 'SUP', 'BR', 'ABBR', 'LABEL', 'TIME', 'CITE', 'Q', 'DEL', 'INS', 'KBD', 'SAMP', 'VAR']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'BR', 'SOURCE', 'TRACK', 'COLGROUP', 'DATALIST', 'MAP', 'AREA']);

function hasBox(cs) {
  const bg = parseColor(cs.backgroundColor);
  const bw = ['Top', 'Right', 'Bottom', 'Left'].some(s => pxv(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none');
  return bg.a > 0.01 || bw || (cs.backgroundImage && cs.backgroundImage !== 'none') || (cs.boxShadow && cs.boxShadow !== 'none');
}
function isTextLeaf(el, win) {
  for (const c of el.children) {
    if (!INLINE_TAGS.has(c.tagName)) return false;
    const cs = win.getComputedStyle(c);
    if (cs.display !== 'inline' || hasBox(cs)) return false;
    if (c.children.length && !isTextLeaf(c, win)) return false;
  }
  return true;
}
function leafText(el, cs) {
  let t = '';
  (function rec(n) { for (const c of n.childNodes) { if (c.nodeType === 3) t += c.nodeValue; else if (c.tagName === 'BR') t += '\n'; else if (c.nodeType === 1) rec(c); } })(el);
  t = /^pre/.test(cs.whiteSpace) ? t : t.replace(/[ \t\r\n]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
  if (cs.textTransform === 'uppercase') t = t.toUpperCase(); else if (cs.textTransform === 'lowercase') t = t.toLowerCase();
  return t;
}
function textProps(cs) {
  const fs = pxv(cs.fontSize) || 16, lh = cs.lineHeight === 'normal' ? 1.3 : pxv(cs.lineHeight) / fs;
  const fam = (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();
  const font = FONT_LIST.find(f => f.toLowerCase() === fam.toLowerCase()) || (/mono|consolas|courier/i.test(fam) ? 'Mono' : /georgia|times|serif/i.test(cs.fontFamily) && !/sans/i.test(cs.fontFamily) ? 'Georgia' : 'Inter');
  const al = cs.textAlign === 'center' ? 'center' : (cs.textAlign === 'right' || cs.textAlign === 'end') ? 'right' : 'left';
  return {
    font, fontSize: Math.round(fs * 10) / 10, fontWeight: Math.round((+cs.fontWeight || 400) / 100) * 100, color: toCss(parseColor(cs.color)), align: al,
    lineHeight: Math.round(Math.max(0.8, lh) * 100) / 100, letterSpacing: cs.letterSpacing === 'normal' ? 0 : pxv(cs.letterSpacing),
    italic: cs.fontStyle === 'italic', underline: /underline/.test(cs.textDecorationLine), strike: /line-through/.test(cs.textDecorationLine),
  };
}
function boxProps(el, cs, w, h) {
  const p = {};
  const bg = parseColor(cs.backgroundColor), fills = [];
  if (bg.a > 0.01) fills.push(solid(toHex(bg), Math.round(bg.a * 100) / 100));
  const g = /linear-gradient\((.*)\)$/.exec(cs.backgroundImage || '');
  if (g) {
    const cols = (g[1].match(/rgba?\([^)]*\)/g) || []).map(parseColor), ang = /(-?[\d.]+)deg/.exec(g[1]);
    if (cols.length >= 2) fills.unshift({ type: 'linear', color: toHex(cols[0]), color2: toHex(cols[cols.length - 1]), angle: ang ? +ang[1] : 180, opacity: Math.min(1, Math.max(cols[0].a, 0.01)) });
  }
  p.fills = fills;
  const bw = pxv(cs.borderTopWidth), sides = ['Right', 'Bottom', 'Left'].every(s => pxv(cs['border' + s + 'Width']) === bw);
  const bc = parseColor(cs.borderTopColor);
  p.strokes = bw > 0 && sides && cs.borderTopStyle !== 'none' && bc.a > 0.01 ? [stroke(toCss(bc), bw)] : [];
  p.radius = Math.min(pxv(cs.borderTopLeftRadius), Math.min(w, h) / 2);
  p.opacity = Math.min(1, Math.max(0, +cs.opacity));
  p.clip = /hidden|clip/.test(cs.overflowX + cs.overflowY);
  p.effects = cs.boxShadow && cs.boxShadow !== 'none' ? topLevelSplit(cs.boxShadow).filter(s => !/inset/.test(s)).slice(0, 3).map(s => {
    const c = /rgba?\([^)]*\)/.exec(s), n = s.replace(/rgba?\([^)]*\)/, '').trim().split(/\s+/).map(pxv);
    return { type: 'drop', x: n[0] || 0, y: n[1] || 0, blur: n[2] || 0, spread: n[3] || 0, color: c ? c[0].replace(/\s+/g, '') : 'rgba(0,0,0,.25)' };
  }) : [];
  return p;
}
function linkOf(el) {
  const a = el.closest && el.closest('a[href]'); const h = a && a.getAttribute('href');
  return h && !/^javascript:/i.test(h) ? { kind: 'url', value: h } : null;
}
const okUrl = u => /^(data:image\/|https?:\/\/)/i.test(u || '');

function walkDom(node, par, pr, X) {
  const { out, ctx, win } = X;
  if (ctx.n >= ctx.max) { ctx.cut = true; return; }
  if (node.nodeType === 3) {                                         // loose text between elements
    const t = node.nodeValue.replace(/\s+/g, ' ').trim(); if (!t) return;
    const parentEl = node.parentElement, cs = win.getComputedStyle(parentEl), rg = X.doc.createRange(); rg.selectNodeContents(node);
    const r = rg.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    ctx.n++; out.push(mk('text', Object.assign(textProps(cs), { name: t.slice(0, 24), page: 'p1', parent: par.id, text: t, x: Math.round(r.left - pr.left), y: Math.round(r.top - pr.top), w: Math.ceil(r.width) + 2, h: Math.ceil(r.height) })));
    return;
  }
  if (node.nodeType !== 1 || SKIP_TAGS.has(node.tagName)) return;
  const el = node, tag = el.tagName, cs = win.getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return;
  if (cs.display === 'contents') { for (const c of el.childNodes) walkDom(c, par, pr, X); return; }
  const r = el.getBoundingClientRect(); if (r.width < 1 && r.height < 1) return;
  const x = Math.round(r.left - pr.left), y = Math.round(r.top - pr.top), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  const base = { page: 'p1', parent: par.id, x, y, w, h, name: tag.toLowerCase() + (el.id ? '#' + el.id : (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '')) };
  const add = (type, props) => { ctx.n++; const e = mk(type, Object.assign({}, base, props)); out.push(e); return e; };
  const link = linkOf(el), box = boxProps(el, cs, w, h);

  if (tag === 'IMG') { const src = el.currentSrc || el.getAttribute('src') || ''; add('image', { url: okUrl(src) ? src : '', fit: ({ cover: 'cover', contain: 'contain', 'scale-down': 'contain' })[cs.objectFit] || 'fill', fills: okUrl(src) ? [] : [solid('#e5e7eb')], radius: box.radius, opacity: box.opacity, link }); return; }
  if (tag === 'svg' || tag === 'SVG') {
    const c = el.cloneNode(true); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('width', w); c.setAttribute('height', h);
    if (!c.getAttribute('viewBox')) c.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const xml = new XMLSerializer().serializeToString(c).replace(/currentColor/gi, toHex(parseColor(cs.color)));
    add('image', { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml), fit: 'contain', fills: [], link }); return;
  }
  if (tag === 'CANVAS' || tag === 'VIDEO' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') { add('image', { name: tag.toLowerCase(), url: '', fills: [solid('#e5e7eb')] }); return; }
  if (tag === 'INPUT' && /^(checkbox|radio)$/.test(el.type)) { add('checkbox', { text: '', checked: el.checked, w: Math.max(w, 18), h: Math.max(h, 18) }); return; }
  if (tag === 'INPUT' && /^(button|submit|reset)$/.test(el.type)) { add('button', Object.assign(textProps(cs), box, { text: el.value || 'Button', align: 'center', link })); return; }
  if (tag === 'INPUT' || tag === 'TEXTAREA') { add('input', Object.assign(textProps(cs), box, { placeholder: el.getAttribute('placeholder') || el.value || '' })); return; }
  if (tag === 'SELECT') { add('select', Object.assign(textProps(cs), box, { text: [...el.options].map(o => o.text.trim()).filter(Boolean).join('\n') || 'Option 1' })); return; }
  const buttonish = tag === 'BUTTON' || (tag === 'A' && el.children.length === 0 && (box.fills.length || box.strokes.length) && /inline-block|flex|block/.test(cs.display));
  if (buttonish) { add('button', Object.assign(textProps(cs), box, { text: leafText(el, cs) || 'Button', align: cs.textAlign === 'left' || cs.textAlign === 'start' ? 'left' : 'center', link })); return; }

  const leaf = el.children.length === 0 || isTextLeaf(el, win), txt = leaf ? leafText(el, cs) : '';
  const visual = box.fills.length || box.strokes.length || box.effects.length || (cs.backgroundImage && cs.backgroundImage !== 'none');
  if (leaf && txt && !visual) { add('text', Object.assign(textProps(cs), { text: txt, w: w + 2, link, opacity: box.opacity })); return; }
  if (leaf && !txt && !visual && !el.children.length) return;        // empty spacer

  const frame = add('frame', Object.assign({ layout: 'none' }, box, { link: leaf ? null : link }));
  const bgUrl = /url\(["']?([^"')]+)["']?\)/.exec(cs.backgroundImage || '');
  if (bgUrl && okUrl(bgUrl[1])) { ctx.n++; out.push(mk('image', { name: 'background', page: 'p1', parent: frame.id, x: 0, y: 0, w, h, url: bgUrl[1], fit: cs.backgroundSize === 'contain' ? 'contain' : 'cover', fills: [] })); }
  if (leaf && txt) {                                                  // box with text inside: put the text where it renders
    const rg = X.doc.createRange(); rg.selectNodeContents(el); const tr = rg.getBoundingClientRect();
    ctx.n++; out.push(mk('text', Object.assign(textProps(cs), { name: txt.slice(0, 24), page: 'p1', parent: frame.id, text: txt, x: Math.round(tr.left - r.left), y: Math.round(tr.top - r.top), w: Math.ceil(tr.width) + 2, h: Math.ceil(tr.height), link })));
    return;
  }
  for (const c of el.childNodes) walkDom(c, frame, { left: r.left, top: r.top }, X);
}

/* --------------------------------------------------------------- PDF pages */
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  const base = window.PDFJS_BASE || 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = base + 'pdf.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF reader (internet is needed once)')); document.head.appendChild(s); });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
  return window.pdfjsLib;
}
async function pdfToElements(file) {
  const lib = await loadPdfJs(), pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const n = Math.min(pdf.numPages, 30), out = []; let x = 0;
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p), v1 = page.getViewport({ scale: 1 }), v2 = page.getViewport({ scale: 2 });
    const cv = document.createElement('canvas'); cv.width = Math.round(v2.width); cv.height = Math.round(v2.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: v2 }).promise;
    const w = Math.round(v1.width), h = Math.round(v1.height);
    const f = mk('frame', { name: 'Page ' + p, page: 'p1', x, y: 0, w, h, fills: [solid('#ffffff')], clip: true }); out.push(f);
    out.push(mk('image', { name: 'Page ' + p + ' image', page: 'p1', parent: f.id, x: 0, y: 0, w, h, url: cv.toDataURL('image/jpeg', 0.9), fit: 'fill', fills: [] }));
    x += w + 80;
  }
  if (pdf.numPages > n) toast(`Imported the first ${n} of ${pdf.numPages} pages`);
  return out;
}

/* ------------------------------------------------------------- dispatcher */
async function importHtmlText(text, name) {
  const m = EMBED_RE.exec(text);
  if (m) { try { const p = asProject(JSON.parse(m[1]), name); if (!confirmReplace('the imported design')) return; return openImported(p.name, p.data); } catch (_) { /* fall through to the page itself */ } }
  if (!confirmReplace('the imported page')) return;
  toast('Reading page…');
  const els = await domImport(text, name);
  openImported(name, { els }, `Imported “${name}” as layers (no editable project data found in the file)`);
}
async function importZip(file) {
  const r = await fetch('/api/import', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name) }, body: file });
  let j = {}; try { j = await r.json(); } catch (_) {}
  if (!r.ok) throw new Error(j.error || r.statusText);
  const name = j.name || file.name.replace(/\.zip$/i, '');
  if (j.kind === 'project') { const p = asProject(j, name); if (!confirmReplace('the imported design')) return; return openImported(p.name, p.data); }
  if (!confirmReplace('the imported page')) return;
  toast('Reading page…');
  const els = await domImport(j.html, name);
  openImported(name, { els }, j.note || `Imported “${name}” as layers (no editable project data found in the zip)`);
}
async function importOne(f) {
  const n = f.name || '', low = n.toLowerCase(), base = n.replace(/\.[^.]+$/, '') || 'Imported design';
  try {
    if (/\.json$/.test(low)) {
      const p = asProject(JSON.parse(await f.text()), base); if (!confirmReplace('the imported design')) return; return openImported(p.name, p.data);
    }
    if (/\.html?$/.test(low)) return await importHtmlText(await f.text(), base);
    if (/\.zip$/.test(low)) return await importZip(f);
    if (/\.pdf$/.test(low) || f.type === 'application/pdf') {
      toast('Reading PDF…'); const els = await pdfToElements(f); if (!confirmReplace('the PDF pages')) return;
      return openImported(base, { els }, 'Imported PDF pages as images (text is not editable)');
    }
    if (/\.svg$/.test(low) || f.type === 'image/svg+xml') {
      const text = await f.text(), meta = new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('metadata#frameforge-project');
      if (meta) { const p = asProject(JSON.parse(meta.textContent), base); if (!confirmReplace('the imported frame')) return; return openImported(p.name, p.data); }
      return await dropImage(new File([text], n, { type: 'image/svg+xml' }), viewCenterWorld());
    }
    if (/\.png$/.test(low) || f.type === 'image/png') {
      const emb = pngExtract(new Uint8Array(await f.arrayBuffer()), 'frameforge');
      if (emb) { const p = asProject(JSON.parse(emb), base); if (!confirmReplace('the imported frame')) return; return openImported(p.name, p.data); }
    }
    if (/^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|avif|bmp)$/.test(low)) return await dropImage(f, viewCenterWorld());
    throw new Error('Unsupported file type. Use .json, .html, .zip, .svg, .png or .pdf');
  } catch (e) { toast('Import failed: ' + e.message, true); }
}
$('#importFile').addEventListener('change', async ev => {
  const files = [...ev.target.files]; ev.target.value = '';
  for (const f of files) await importOne(f);
});
