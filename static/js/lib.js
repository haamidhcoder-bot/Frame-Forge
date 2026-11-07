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

/* Theme palettes: every block/page is built from one of these, so light and dark share the same layout and styling. */
const THEMES = {
  light: { bg: '#ffffff', bg2: '#f8fafc', card: '#ffffff', text: '#0f172a', muted: '#475569', faint: '#64748b', line: '#e2e8f0', primary: '#2563eb', onPrimary: '#ffffff', accentSoft: '#dbeafe', inputBg: '#ffffff', inputLine: '#d1d5db',
    hero: ['#eff6ff', '#ffffff'], cta: ['#2563eb', '#7c3aed'], page: ['#e0e7ff', '#f8fafc'], avatar: ['#60a5fa', '#a78bfa'], footer: '#0f172a', footerText: '#94a3b8', footerLink: '#cbd5e1', shadow: 'rgba(15,23,42,.10)', img: ['#c7d2fe', '#fbcfe8'] },
  dark: { bg: '#0b1120', bg2: '#111827', card: '#1e293b', text: '#f1f5f9', muted: '#94a3b8', faint: '#64748b', line: '#334155', primary: '#3b82f6', onPrimary: '#ffffff', accentSoft: '#bfdbfe', inputBg: '#0f172a', inputLine: '#475569',
    hero: ['#172554', '#0b1120'], cta: ['#1d4ed8', '#6d28d9'], page: ['#1e1b4b', '#0b1120'], avatar: ['#3b82f6', '#8b5cf6'], footer: '#020617', footerText: '#64748b', footerLink: '#94a3b8', shadow: 'rgba(0,0,0,.55)', img: ['#312e81', '#831843'] },
};
const th_ = m => THEMES[m] || THEMES.light;
const shadowOf = p => ({ type: 'drop', x: 0, y: 4, blur: 16, spread: 0, color: p.shadow });
const txt = (text, p = {}) => T('text', Object.assign({ name: text.slice(0, 22), text, fontSize: 16, color: C.gray, w: 120, h: 24, sizeW: 'hug', sizeH: 'hug' }, p));
const para = (text, p = {}) => txt(text, Object.assign({ w: 400, sizeW: 'fill' }, p));
const button = (text, p = {}) => T('button', Object.assign({ name: text, text, w: 160, h: 48 }, p));
const row = (name, kids, p = {}) => T('frame', Object.assign({ name, layout: 'row', gap: 16, alignItems: 'center', sizeW: 'hug', sizeH: 'hug', fills: [], clip: false }, p), kids);
const col = (name, kids, p = {}) => T('frame', Object.assign({ name, layout: 'column', gap: 12, sizeW: 'hug', sizeH: 'hug', fills: [], clip: false }, p), kids);
const fillW = s => { s.props.sizeW = 'fill'; return s; };
/* themed element helpers */
const tx = (p, text, o = {}) => txt(text, Object.assign({ color: p.muted }, o));
const hd = (p, text, o = {}) => txt(text, Object.assign({ color: p.text, fontWeight: 700, fontSize: 36 }, o));
const pa = (p, text, o = {}) => para(text, Object.assign({ color: p.muted }, o));
const pbtn = (p, text, o = {}) => button(text, Object.assign({ fills: [solid(p.primary)], color: p.onPrimary }, o));
const pbtnGhost = (p, text, o = {}) => button(text, Object.assign({ fills: [], strokes: [stroke(p.primary, 2)], color: p.primary }, o));
const input = (p, name, ph, o = {}) => T('input', Object.assign({ name, placeholder: ph, sizeW: 'fill', fills: [solid(p.inputBg)], strokes: [stroke(p.inputLine)], color: p.text }, o));
const card = (p, name, kids, o = {}) => T('frame', Object.assign({ name, layout: 'column', gap: 12, padX: 24, padY: 24, sizeW: 'fill', sizeH: 'hug', w: 300, h: 160, radius: 16, fills: [solid(p.card)], strokes: [stroke(p.line)], effects: [shadowOf(p)], clip: false }, o), kids);
const sect = (p, name, kids, o = {}) => T('frame', Object.assign({ name, w: 1440, h: 320, sizeH: 'hug', layout: 'column', gap: 24, padX: 120, padY: 64, fills: [solid(p.bg)], clip: false }, o), kids);
const ico = (p, ic, o = {}) => T('icon', Object.assign({ name: 'Icon', icon: ic, color: p.primary, w: 32, h: 32 }, o));
const pic = (p, name, w, h, o = {}) => T('rect', Object.assign({ name, w, h, radius: 12, fills: [grad(p.img[0], p.img[1], 135)] }, o));

const BLOCKS = {
  navbar: p => T('frame', { name: 'Navbar', w: 1440, h: 72, sizeH: 'hug', layout: 'row', padX: 48, padY: 16, justify: 'between', alignItems: 'center', fills: [solid(p.bg)], effects: [shadowOf(p)], clip: false }, [
    tx(p, 'Acme', { name: 'Logo', fontSize: 24, fontWeight: 700, color: p.text }),
    row('Links', [tx(p, 'Product'), tx(p, 'Pricing'), tx(p, 'Docs')], { gap: 32 }),
    pbtn(p, 'Sign up', { w: 130, h: 44 })]),
  announce: p => T('frame', { name: 'Announcement bar', w: 1440, h: 44, sizeH: 'hug', layout: 'row', gap: 12, padX: 48, padY: 12, justify: 'center', alignItems: 'center', fills: [grad(p.cta[0], p.cta[1], 90)], clip: false }, [
    tx(p, 'New: dark mode variants are here.', { name: 'Message', fontSize: 14, color: '#ffffff', fontWeight: 500 }),
    tx(p, 'Learn more →', { name: 'Link', fontSize: 14, color: '#ffffff', fontWeight: 700 })]),
  hero: p => T('frame', { name: 'Hero', w: 1440, h: 480, sizeH: 'hug', layout: 'column', gap: 24, padX: 120, padY: 96, fills: [grad(p.hero[0], p.hero[1], 180)], clip: false }, [
    hd(p, 'Design layouts\nfaster than ever', { name: 'Headline', fontSize: 60, w: 720, sizeW: 'fixed', lineHeight: 1.1 }),
    pa(p, 'Drag, drop and export clean HTML & CSS straight from your browser.', { name: 'Subtitle', fontSize: 20, w: 560, sizeW: 'fixed' }),
    row('Actions', [pbtn(p, 'Get started', { w: 180, h: 56 }), pbtnGhost(p, 'Learn more', { w: 180, h: 56 })])]),
  heroSplit: p => T('frame', { name: 'Hero split', w: 1440, h: 520, sizeH: 'hug', layout: 'row', gap: 64, padX: 120, padY: 80, alignItems: 'center', fills: [solid(p.bg)], clip: false }, [
    col('Copy', [
      tx(p, 'NEW RELEASE', { name: 'Eyebrow', fontSize: 13, fontWeight: 700, color: p.primary, letterSpacing: 2 }),
      hd(p, 'Build beautiful\nproducts, together', { name: 'Headline', fontSize: 52, lineHeight: 1.1 }),
      pa(p, 'A calm workspace for teams who care about the details.', { name: 'Subtitle', fontSize: 18, w: 480, sizeW: 'fixed' }),
      row('Actions', [pbtn(p, 'Start free', { w: 160, h: 52 }), pbtnGhost(p, 'Watch demo', { w: 160, h: 52 })])], { gap: 20, sizeW: 'fill' }),
    pic(p, 'Hero image', 560, 360, { sizeW: 'fixed', radius: 20 })]),
  logos: p => sect(p, 'Logo cloud', [
    tx(p, 'Trusted by teams at', { name: 'Label', fontSize: 14, color: p.faint, align: 'center', w: 1200, sizeW: 'fill' }),
    row('Logos', ['Northwind', 'Globex', 'Initech', 'Umbrella', 'Hooli'].map(n => tx(p, n, { name: n, fontSize: 22, fontWeight: 700, color: p.faint })), { gap: 64, justify: 'center', sizeW: 'fill' })], { padY: 48, alignItems: 'center', fills: [solid(p.bg2)] }),
  features: p => T('frame', { name: 'Features', w: 1440, h: 320, sizeH: 'hug', layout: 'row', gap: 24, padX: 120, padY: 64, fills: [solid(p.bg)], clip: false },
    [['zap', 'Fast', 'Snap, align and resize with live guides.'], ['layers', 'Structured', 'Frames, layers and auto layout like Figma.'], ['code', 'Exportable', 'One click to HTML, React or Tailwind.']].map(([ic, t, d]) =>
      card(p, 'Card ' + t, [ico(p, ic), tx(p, t, { name: 'Title', fontSize: 22, fontWeight: 600, color: p.text }), pa(p, d, { name: 'Text' })], { padX: 28, padY: 28 }))),
  stats: p => T('frame', { name: 'Stats', w: 1440, h: 200, sizeH: 'hug', layout: 'row', gap: 24, padX: 120, padY: 56, justify: 'between', fills: [solid(p.bg2)], clip: false },
    [['120k+', 'Designers'], ['4.9/5', 'Average rating'], ['35M', 'Frames created'], ['99.9%', 'Uptime']].map(([n, l]) =>
      col('Stat ' + l, [hd(p, n, { name: 'Number', fontSize: 44, color: p.primary }), tx(p, l, { name: 'Label', fontSize: 15 })], { gap: 4, sizeW: 'fill', alignItems: 'center' }))),
  pricing: p => T('frame', { name: 'Pricing', w: 1440, h: 520, sizeH: 'hug', layout: 'row', gap: 24, padX: 120, padY: 64, alignItems: 'stretch', fills: [solid(p.bg2)], clip: false },
    [['Starter', '$0', 'For hobby projects'], ['Pro', '$19', 'For freelancers'], ['Team', '$49', 'For growing teams']].map(([n, pr, d], i) => {
      const hi = i === 1;
      return T('frame', { name: n + ' plan', layout: 'column', gap: 14, padX: 32, padY: 32, sizeW: 'fill', sizeH: 'hug', w: 300, h: 320, radius: 20, fills: [solid(hi ? p.primary : p.card)], strokes: hi ? [] : [stroke(p.line)], clip: false }, [
        tx(p, n, { name: 'Plan', fontSize: 18, fontWeight: 600, color: hi ? '#ffffff' : p.text }),
        tx(p, pr + ' / mo', { name: 'Price', fontSize: 40, fontWeight: 700, color: hi ? '#ffffff' : p.text }),
        pa(p, d, { name: 'About', color: hi ? '#dbeafe' : p.muted }),
        pa(p, '✓ Unlimited frames\n✓ HTML & CSS export\n✓ Community support', { name: 'Features', color: hi ? '#ffffff' : p.muted }),
        button('Choose ' + n, { sizeW: 'fill', fills: [solid(hi ? '#ffffff' : p.primary)], color: hi ? '#2563eb' : p.onPrimary })]);
    })),
  testimonial: p => T('frame', { name: 'Testimonial', w: 1440, h: 300, sizeH: 'hug', layout: 'column', gap: 24, padX: 240, padY: 72, alignItems: 'center', fills: [solid(p.bg)], clip: false }, [
    pa(p, '“FrameForge replaced three tools in our workflow. We ship landing pages in an afternoon.”', { name: 'Quote', fontSize: 28, fontWeight: 500, color: p.text, align: 'center', italic: true }),
    row('Author', [T('ellipse', { name: 'Avatar', w: 48, h: 48, fills: [grad(p.avatar[0], p.avatar[1])] }), col('Who', [tx(p, 'Priya Nair', { name: 'Name', fontWeight: 600, color: p.text }), tx(p, 'Product designer', { name: 'Role', fontSize: 14 })], { gap: 2 })])]),
  team: p => sect(p, 'Team', [
    hd(p, 'Meet the team', { name: 'Title', align: 'center', w: 1200, sizeW: 'fill' }),
    row('Members', [['Aarav Shah', 'CEO'], ['Meera Iyer', 'Design lead'], ['Rohan Das', 'Engineer'], ['Sara Khan', 'Marketing']].map(([n, r], i) =>
      col(n, [T('ellipse', { name: 'Photo', w: 96, h: 96, fills: [grad(p.avatar[i % 2], p.avatar[(i + 1) % 2])] }), tx(p, n, { name: 'Name', fontWeight: 600, color: p.text, align: 'center' }), tx(p, r, { name: 'Role', fontSize: 14, align: 'center' })], { gap: 8, alignItems: 'center', sizeW: 'fill' })), { gap: 24, sizeW: 'fill' })], { alignItems: 'center', gap: 40 }),
  cards: p => sect(p, 'Blog cards', [
    hd(p, 'Latest articles', { name: 'Title', fontSize: 32 }),
    row('Posts', [['Design systems that scale', 'Guides'], ['Auto layout, explained', 'Tutorial'], ['Shipping faster with blocks', 'News']].map(([t, tag]) =>
      T('frame', { name: 'Post', layout: 'column', gap: 0, sizeW: 'fill', sizeH: 'hug', w: 300, h: 300, radius: 16, fills: [solid(p.card)], strokes: [stroke(p.line)], clip: true }, [
        fillW(pic(p, 'Cover', 300, 160, { radius: 0 })),
        fillW(col('Body', [tx(p, tag.toUpperCase(), { name: 'Tag', fontSize: 12, fontWeight: 700, color: p.primary }), pa(p, t, { name: 'Headline', fontSize: 20, fontWeight: 600, color: p.text }), tx(p, 'Read more →', { name: 'Link', fontSize: 14, color: p.primary })], { padX: 20, padY: 20, gap: 8 }))])), { gap: 24, sizeW: 'fill', alignItems: 'stretch' })]),
  steps: p => sect(p, 'How it works', [
    hd(p, 'How it works', { name: 'Title', align: 'center', w: 1200, sizeW: 'fill' }),
    row('Steps', [['1', 'Sketch', 'Drop frames and blocks onto the canvas.'], ['2', 'Refine', 'Tune spacing, colour and type.'], ['3', 'Ship', 'Export clean code in one click.']].map(([n, t, d]) =>
      col('Step ' + n, [T('ellipse', { name: 'Badge', w: 44, h: 44, fills: [solid(p.primary)] }), tx(p, t, { name: 'Title', fontSize: 20, fontWeight: 600, color: p.text }), pa(p, d, { name: 'Text' })], { gap: 10, sizeW: 'fill' })), { gap: 32, sizeW: 'fill', alignItems: 'start' })], { fills: [solid(p.bg2)], gap: 40 }),
  faq: p => sect(p, 'FAQ', [
    hd(p, 'Frequently asked questions', { name: 'Title', fontSize: 32 }),
    ...[['Is FrameForge free?', 'Yes. Everything runs in your browser and your work stays on your machine.'], ['Can I export code?', 'HTML, CSS, React, Tailwind, Bootstrap, Flask and Kivy.'], ['Does it support dark mode?', 'Every library block comes in a light and a dark variant.']].map(([q, a]) =>
      fillW(col('Item', [tx(p, q, { name: 'Question', fontSize: 18, fontWeight: 600, color: p.text }), pa(p, a, { name: 'Answer', fontSize: 15 })], { gap: 6, padY: 18, strokes: [stroke(p.line)], fills: [] })))], { padX: 240, gap: 8 }),
  contact: p => T('frame', { name: 'Contact', w: 1440, h: 480, sizeH: 'hug', layout: 'row', gap: 64, padX: 120, padY: 72, fills: [solid(p.bg)], clip: false }, [
    col('Info', [hd(p, 'Get in touch', { name: 'Title', fontSize: 40 }), pa(p, 'Questions, feedback or ideas? We read every message.', { name: 'Text', w: 420, sizeW: 'fixed' }),
      row('Mail', [ico(p, 'mail', { w: 22, h: 22 }), tx(p, 'hello@acme.com', { color: p.text })], { gap: 10 }), row('Phone', [ico(p, 'phone', { w: 22, h: 22 }), tx(p, '+91 98765 43210', { color: p.text })], { gap: 10 })], { gap: 20, sizeW: 'fill' }),
    card(p, 'Form', [input(p, 'Name', 'Your name'), input(p, 'Email', 'Email address'), input(p, 'Message', 'Message', { h: 120 }), pbtn(p, 'Send message', { sizeW: 'fill' })], { sizeW: 'fill', gap: 14, padX: 28, padY: 28 })]),
  newsletter: p => T('frame', { name: 'Newsletter', w: 1440, h: 240, sizeH: 'hug', layout: 'column', gap: 16, padX: 240, padY: 64, alignItems: 'center', fills: [solid(p.bg2)], clip: false }, [
    hd(p, 'Stay in the loop', { name: 'Title', fontSize: 32 }), tx(p, 'One email a month. No spam.', { name: 'Sub' }),
    row('Form', [input(p, 'Email', 'you@example.com', { w: 320, sizeW: 'fixed' }), pbtn(p, 'Subscribe', { w: 140, h: 44 })], { gap: 12 })]),
  cta: p => T('frame', { name: 'Call to action', w: 1440, h: 320, sizeH: 'hug', layout: 'column', gap: 20, padX: 120, padY: 80, alignItems: 'center', fills: [grad(p.cta[0], p.cta[1])], clip: false }, [
    txt('Ready to build your next site?', { name: 'Headline', fontSize: 40, fontWeight: 700, color: '#ffffff' }),
    txt('Start designing in seconds. No sign-up needed.', { name: 'Sub', fontSize: 18, color: '#dbeafe' }),
    button('Start free', { w: 180, h: 56, fills: [solid('#ffffff')], color: '#2563eb' })]),
  footer: p => T('frame', { name: 'Footer', w: 1440, h: 120, sizeH: 'hug', layout: 'row', padX: 120, padY: 40, justify: 'between', alignItems: 'center', fills: [solid(p.footer)], strokes: [], clip: false }, [
    tx(p, '© 2026 Acme Inc.', { name: 'Copyright', color: p.footerText, fontSize: 14 }),
    row('Links', ['Privacy', 'Terms', 'Contact'].map(t => tx(p, t, { color: p.footerLink, fontSize: 14 })), { gap: 24 })]),
  footerCols: p => T('frame', { name: 'Footer columns', w: 1440, h: 280, sizeH: 'hug', layout: 'row', gap: 48, padX: 120, padY: 64, fills: [solid(p.footer)], clip: false }, [
    col('Brand', [tx(p, 'Acme', { name: 'Logo', fontSize: 24, fontWeight: 700, color: '#ffffff' }), pa(p, 'Design tools for teams that ship.', { color: p.footerText, fontSize: 14, w: 260, sizeW: 'fixed' })], { sizeW: 'fill' }),
    ...[['Product', 'Features', 'Pricing', 'Changelog'], ['Company', 'About', 'Careers', 'Press'], ['Support', 'Docs', 'Contact', 'Status']].map(([h, ...ls]) =>
      col(h, [tx(p, h, { name: 'Heading', fontWeight: 600, color: '#ffffff', fontSize: 15 }), ...ls.map(l => tx(p, l, { color: p.footerText, fontSize: 14 }))], { gap: 10, sizeW: 'fill' }))]),
  login: p => T('frame', { name: 'Login form', w: 400, h: 420, sizeH: 'hug', layout: 'column', gap: 16, padX: 32, padY: 32, radius: 16, fills: [solid(p.card)], strokes: [stroke(p.line)], effects: [shadowOf(p)], clip: false }, [
    hd(p, 'Welcome back', { name: 'Title', fontSize: 28 }),
    tx(p, 'Sign in to continue', { name: 'Subtitle', fontSize: 15 }),
    input(p, 'Email', 'Email address'), input(p, 'Password', 'Password'),
    T('checkbox', { name: 'Remember', text: 'Remember me', sizeW: 'fill', color: p.muted }),
    pbtn(p, 'Sign in', { sizeW: 'fill' }),
    tx(p, 'Forgot your password?', { name: 'Forgot', fontSize: 14, color: p.primary })]),
  signup: p => T('frame', { name: 'Sign-up form', w: 420, h: 520, sizeH: 'hug', layout: 'column', gap: 14, padX: 32, padY: 32, radius: 16, fills: [solid(p.card)], strokes: [stroke(p.line)], effects: [shadowOf(p)], clip: false }, [
    hd(p, 'Create your account', { name: 'Title', fontSize: 26 }), tx(p, 'Free forever. No card needed.', { name: 'Subtitle', fontSize: 15 }),
    input(p, 'Name', 'Full name'), input(p, 'Email', 'Email address'), input(p, 'Password', 'Password'),
    T('checkbox', { name: 'Terms', text: 'I agree to the Terms', sizeW: 'fill', color: p.muted }),
    pbtn(p, 'Create account', { sizeW: 'fill' }),
    tx(p, 'Already have an account? Sign in', { name: 'Switch', fontSize: 14, color: p.primary })]),
  product: p => T('frame', { name: 'Product card', w: 300, h: 380, sizeH: 'hug', layout: 'column', gap: 0, radius: 16, fills: [solid(p.card)], strokes: [stroke(p.line)], effects: [shadowOf(p)], clip: true }, [
    fillW(pic(p, 'Photo', 300, 200, { radius: 0 })),
    fillW(col('Body', [tx(p, 'Wireless headphones', { name: 'Name', fontSize: 18, fontWeight: 600, color: p.text }), tx(p, 'Noise cancelling · 40h battery', { name: 'Info', fontSize: 13 }),
      row('Buy', [tx(p, '$129', { name: 'Price', fontSize: 22, fontWeight: 700, color: p.text }), pbtn(p, 'Add to cart', { w: 120, h: 40 })], { justify: 'between', sizeW: 'fill', gap: 12 })], { padX: 20, padY: 20, gap: 8 }))]),
  sidebar: p => T('frame', { name: 'Sidebar', w: 260, h: 640, layout: 'column', gap: 6, padX: 16, padY: 24, fills: [solid(p.bg2)], strokes: [stroke(p.line)], clip: false }, [
    tx(p, 'Acme', { name: 'Logo', fontSize: 22, fontWeight: 700, color: p.text }),
    ...[['home', 'Overview', true], ['chart', 'Analytics'], ['users', 'Customers'], ['folder', 'Projects'], ['settings', 'Settings']].map(([ic, l, on]) =>
      fillW(row('Item ' + l, [ico(p, ic, { w: 20, h: 20, color: on ? p.onPrimary : p.muted }), tx(p, l, { color: on ? p.onPrimary : p.muted, fontWeight: on ? 600 : 400 })], { gap: 12, padX: 12, padY: 10, radius: 8, fills: on ? [solid(p.primary)] : [] })))]),
  notFound: p => T('frame', { name: 'Empty state', w: 720, h: 360, sizeH: 'hug', layout: 'column', gap: 14, padX: 48, padY: 64, alignItems: 'center', fills: [solid(p.bg)], clip: false }, [
    hd(p, '404', { name: 'Code', fontSize: 96, color: p.primary }), hd(p, 'Page not found', { name: 'Title', fontSize: 28 }),
    tx(p, 'The page you are looking for has moved or never existed.', { name: 'Text' }), pbtn(p, 'Back to home', { w: 180, h: 48 })]),
};
const BLOCK_INFO = [['navbar', 'Navbar', 'Logo, links and a button'], ['announce', 'Announcement bar', 'Gradient strip with a link'], ['hero', 'Hero', 'Big headline with two buttons'], ['heroSplit', 'Hero · split', 'Copy on the left, image on the right'], ['logos', 'Logo cloud', '“Trusted by” row'], ['features', 'Feature cards', 'Three icon cards'], ['stats', 'Stats', 'Four big numbers'], ['steps', 'How it works', 'Three numbered steps'], ['pricing', 'Pricing', 'Three plans'], ['testimonial', 'Testimonial', 'Quote with author'], ['team', 'Team', 'Four people with photos'], ['cards', 'Blog cards', 'Three article cards'], ['faq', 'FAQ', 'Questions and answers'], ['contact', 'Contact', 'Details plus a form'], ['newsletter', 'Newsletter', 'Email sign-up row'], ['cta', 'Call to action', 'Gradient banner'], ['footer', 'Footer', 'Copyright and links'], ['footerCols', 'Footer · columns', 'Brand plus three link columns'], ['login', 'Login form', 'Inputs, checkbox, button'], ['signup', 'Sign-up form', 'Name, email, password'], ['product', 'Product card', 'Photo, price, add to cart'], ['sidebar', 'Sidebar nav', 'App navigation with icons'], ['notFound', '404 / empty state', 'Big code, message, button']];

const pageFrame = (p, name, w, h, kids, o = {}) => T('frame', Object.assign({ name, w, h, sizeH: 'hug', layout: 'column', gap: 0, fills: [solid(p.bg)], clip: true }, o), kids);
const stack = (m, keys) => keys.map(k => fillW(BLOCKS[k](th_(m))));
const PAGES = {
  landing: (m = 'light') => pageFrame(th_(m), 'Landing page', 1440, 1800, stack(m, ['navbar', 'hero', 'features', 'testimonial', 'cta', 'footer'])),
  login: (m = 'light') => { const p = th_(m); return T('frame', { name: 'Login page', w: 1440, h: 900, layout: 'column', alignItems: 'center', justify: 'center', gap: 0, fills: [grad(p.page[0], p.page[1], 160)], clip: true }, [BLOCKS.login(p)]); },
  signup: (m = 'light') => { const p = th_(m); return T('frame', { name: 'Sign-up page', w: 1440, h: 900, layout: 'column', alignItems: 'center', justify: 'center', gap: 0, fills: [grad(p.page[0], p.page[1], 160)], clip: true }, [BLOCKS.signup(p)]); },
  saas: (m = 'light') => pageFrame(th_(m), 'SaaS home', 1440, 2400, stack(m, ['announce', 'navbar', 'heroSplit', 'logos', 'features', 'stats', 'steps', 'testimonial', 'pricing', 'faq', 'cta', 'footerCols'])),
  pricingPage: (m = 'light') => pageFrame(th_(m), 'Pricing page', 1440, 1500, stack(m, ['navbar', 'pricing', 'faq', 'newsletter', 'footer'])),
  blog: (m = 'light') => pageFrame(th_(m), 'Blog', 1440, 1400, stack(m, ['navbar', 'cards', 'cards', 'newsletter', 'footerCols'])),
  about: (m = 'light') => pageFrame(th_(m), 'About page', 1440, 1700, stack(m, ['navbar', 'hero', 'stats', 'team', 'testimonial', 'contact', 'footer'])),
  contactPage: (m = 'light') => pageFrame(th_(m), 'Contact page', 1440, 900, stack(m, ['navbar', 'contact', 'footer'])),
  dashboard: (m = 'light') => { const p = th_(m);
    return T('frame', { name: 'Dashboard', w: 1440, h: 860, layout: 'row', gap: 0, fills: [solid(p.bg)], clip: true }, [
      BLOCKS.sidebar(p),
      T('frame', { name: 'Main', layout: 'column', gap: 24, padX: 40, padY: 32, sizeW: 'fill', sizeH: 'fill', w: 1100, h: 860, fills: [], clip: false }, [
        row('Header', [hd(p, 'Overview', { name: 'Title', fontSize: 30 }), pbtn(p, 'New project', { w: 150, h: 44 })], { justify: 'between', sizeW: 'fill' }),
        row('Stat cards', [['Revenue', '$48,230', 'trending-up'], ['Users', '12,480', 'users'], ['Orders', '1,942', 'cart'], ['Conversion', '3.4%', 'chart']].map(([l, v, ic]) =>
          card(p, l, [row('Top', [tx(p, l, { name: 'Label', fontSize: 14 }), ico(p, ic, { w: 22, h: 22 })], { justify: 'between', sizeW: 'fill' }), hd(p, v, { name: 'Value', fontSize: 30 })], { gap: 8 })), { sizeW: 'fill', gap: 20, alignItems: 'stretch' }),
        card(p, 'Chart', [tx(p, 'Revenue over time', { name: 'Title', fontWeight: 600, color: p.text }), T('rect', { name: 'Chart area', w: 900, h: 240, sizeW: 'fill', radius: 12, fills: [grad(p.img[0], p.img[1], 90)] })], { gap: 16 })])]); },
  notFoundPage: (m = 'light') => { const p = th_(m); return T('frame', { name: '404 page', w: 1440, h: 800, layout: 'column', alignItems: 'center', justify: 'center', gap: 0, fills: [solid(p.bg)], clip: true }, [BLOCKS.notFound(p)]); },
  mobile: (m = 'light') => { const p = th_(m); return T('frame', { name: 'Mobile landing', w: 375, h: 812, sizeH: 'hug', layout: 'column', gap: 0, fills: [solid(p.bg)], clip: true }, [
    fillW(T('frame', { name: 'Navbar', w: 375, h: 64, layout: 'row', padX: 20, justify: 'between', alignItems: 'center', fills: [solid(p.bg)], effects: [shadowOf(p)], clip: false }, [tx(p, 'Acme', { name: 'Logo', fontSize: 22, fontWeight: 700, color: p.text }), T('icon', { name: 'Menu', icon: 'menu', color: p.text, w: 28, h: 28 })])),
    fillW(T('frame', { name: 'Hero', w: 375, h: 400, sizeH: 'hug', layout: 'column', gap: 16, padX: 24, padY: 48, fills: [grad(p.hero[0], p.hero[1], 180)], clip: false }, [
      pa(p, 'Design layouts faster than ever', { name: 'Headline', fontSize: 38, fontWeight: 700, color: p.text, lineHeight: 1.1 }),
      pa(p, 'Drag, drop and export clean HTML & CSS.', { name: 'Subtitle', fontSize: 17 }), pbtn(p, 'Get started', { sizeW: 'fill', h: 52 })])),
    fillW(T('frame', { name: 'Features', w: 375, h: 400, sizeH: 'hug', layout: 'column', gap: 16, padX: 24, padY: 32, fills: [solid(p.bg)], clip: false },
      ['zap', 'layers', 'code'].map((ic, i) => fillW(T('frame', { name: 'Card', layout: 'row', gap: 14, padX: 16, padY: 16, alignItems: 'center', w: 300, h: 80, sizeH: 'hug', radius: 14, fills: [solid(p.card)], strokes: [stroke(p.line)], clip: false }, [T('icon', { name: 'Icon', icon: ic, color: p.primary, w: 28, h: 28 }), pa(p, ['Fast and precise', 'Auto layout built in', 'Export to any stack'][i], { name: 'Text', color: p.text })])))))]); },
  mobileLogin: (m = 'light') => { const p = th_(m); return T('frame', { name: 'Mobile login', w: 375, h: 812, layout: 'column', gap: 16, padX: 24, padY: 80, fills: [grad(p.page[0], p.page[1], 170)], clip: true }, [
    hd(p, 'Welcome back', { name: 'Title', fontSize: 32 }), tx(p, 'Sign in to continue', { name: 'Subtitle' }), input(p, 'Email', 'Email address', { h: 52 }), input(p, 'Password', 'Password', { h: 52 }), pbtn(p, 'Sign in', { sizeW: 'fill', h: 52 }), tx(p, 'Create an account', { name: 'Link', color: p.primary, align: 'center', sizeW: 'fill' })]); },
};
const PAGE_INFO = [['landing', 'Landing page', 'Desktop · navbar, hero, features, testimonial, CTA, footer'], ['saas', 'SaaS home', 'Desktop · full marketing page with 12 sections'], ['pricingPage', 'Pricing page', 'Desktop · plans, FAQ, newsletter'], ['about', 'About page', 'Desktop · hero, stats, team, contact'], ['blog', 'Blog', 'Desktop · article cards and newsletter'], ['contactPage', 'Contact page', 'Desktop · details and form'], ['dashboard', 'Dashboard', 'Desktop · sidebar, stat cards, chart'], ['login', 'Login page', 'Desktop · centred login card'], ['signup', 'Sign-up page', 'Desktop · centred sign-up card'], ['notFoundPage', '404 page', 'Desktop · empty state'], ['mobile', 'Mobile landing', '375px wide mobile layout'], ['mobileLogin', 'Mobile login', '375px wide sign-in screen']];

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
let iconReplaceId = null;   // set when the Library is opened from the "Change icon" button
function insertIcon(name) {
  if (iconReplaceId) {
    const t = get(iconReplaceId); iconReplaceId = null;
    if (t && t.type === 'icon') { t.icon = name; commit(); render(); renderProps(); closeLibrary(); return; }
  }
  const parent = insertionParent();
  const c = viewport.getBoundingClientRect(), pa = parent ? absPos(parent) : { x: 0, y: 0 };
  const e = mk('icon', { name: 'Icon ' + iconLabel(name), icon: name, parent: parent ? parent.id : null, x: Math.round((c.width / 2 - S.view.x) / S.view.z - 16 - pa.x), y: Math.round((c.height / 2 - S.view.y) / S.view.z - 16 - pa.y) });
  S.els.push(e); reindex(); S.sel = [e.id]; commit(); render(); closeLibrary();
}

/* --------------------------------------------------------------- library UI */
let libTab = 'blocks';
let libTheme = 'light';
try { libTheme = localStorage.getItem('ff.libTheme') === 'dark' ? 'dark' : 'light'; } catch (e) { /* storage unavailable */ }
function openLibrary(tab) { libTab = tab || libTab; $('#libModal').hidden = false; renderLibrary(); }
function closeLibrary() { $('#libModal').hidden = true; iconReplaceId = null; }
function renderLibrary() {
  $$('#libTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === libTab));
  const body = $('#libBody'); body.innerHTML = '';
  const card = (title, sub, fn, extra = '') => { const d = document.createElement('button'); d.className = 'libcard'; d.innerHTML = `${extra}<strong>${esc(title)}</strong><span>${esc(sub)}</span>`; d.addEventListener('click', fn); body.appendChild(d); };
  const themeBar = () => {
    const bar = document.createElement('div'); bar.className = 'libtheme';
    bar.innerHTML = '<span>Style</span><button data-m="light">☀ Light</button><button data-m="dark">☾ Dark</button>';
    $$('button', bar).forEach(b => { b.classList.toggle('on', b.dataset.m === libTheme); b.addEventListener('click', () => { libTheme = b.dataset.m; try { localStorage.setItem('ff.libTheme', libTheme); } catch (e) { /* ignore */ } renderLibrary(); }); });
    body.appendChild(bar);
  };
  const swatch = m => { const p = th_(m); return `<i class="libsw" style="background:${p.bg};border-color:${p.line}"><b style="background:${p.primary}"></b><u style="background:${p.text}"></u></i>`; };
  if (libTab === 'blocks') {
    themeBar();
    const note = document.createElement('p'); note.className = 'libnote'; note.textContent = 'Blocks are built with auto layout. Select a frame first to insert into it, or nothing to place on the canvas.'; body.appendChild(note);
    BLOCK_INFO.forEach(([k, t, s]) => card(t, s, () => insertSpec(BLOCKS[k](th_(libTheme))), swatch(libTheme)));
  } else if (libTab === 'pages') {
    themeBar();
    PAGE_INFO.forEach(([k, t, s]) => card(t, s, () => insertSpec(PAGES[k](libTheme), true), swatch(libTheme)));
  } else if (libTab === 'components') {
    const list = components();
    if (!list.length) { const p = document.createElement('p'); p.className = 'libnote'; p.innerHTML = 'No components yet. Select a frame or group and press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> (or the ◆ button) to turn it into a component. Then insert linked copies here — editing the main component updates every copy.'; body.appendChild(p); }
    list.forEach(m => card('◆ ' + m.name, `${Math.round(m.w)} × ${Math.round(m.h)} · ${m.page === S.page ? 'this page' : (S.pages.find(p => p.id === m.page) || {}).name}`, () => { const par = insertionParent(); createInstance(m.id, par && par.id !== m.id ? par.id : null); closeLibrary(); }));
  } else if (libTab === 'icons') {
    const head = document.createElement('div'); head.className = 'iconhead';
    head.innerHTML = '<div class="isets"></div><input type="search" placeholder="Search icons…" spellcheck="false" autocomplete="off">';
    const grid = document.createElement('div'); grid.className = 'icongrid';
    const q = $('input', head), paint = () => { grid._pick = insertIcon; fillIconGrid(grid, iconNames(iconSet, q.value), iconReplaceId && get(iconReplaceId) ? get(iconReplaceId).icon : null, 26); };
    q.addEventListener('input', paint);
    renderIconSets($('.isets', head), paint);
    if (iconReplaceId) { const n = document.createElement('p'); n.className = 'libnote'; n.textContent = 'Pick an icon to replace the selected one.'; body.appendChild(n); }
    body.appendChild(head); body.appendChild(grid); paint();
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
