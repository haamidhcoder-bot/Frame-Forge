# FrameForge v2

A Figma-style website layout designer. Frontend: HTML, CSS and vanilla JS. Backend: Python (Flask + SQLite).

Features: 2,050 Bootstrap Icons + the built-in icon set, import of everything you can export (.json, .html, .zip, .svg, .png, .pdf and images), auto layout (flex/grid), gradients, multiple fills/strokes/effects, image upload, extra shapes and form controls, text styling with Google Fonts, groups, alignment, rulers/guides/grid, components and instances, colour and text styles, block and page-template library, multiple pages, prototype/present mode, **Device Preview** (phone/tablet/custom screens, portrait/landscape, zoom, independent scrolling, clickable prototype links), export to HTML, HTML+CSS, React, Tailwind, Bootstrap, Flask project, PNG, SVG and PDF, publish link, light/dark theme, context menu, minimap, layer search and touch support.

See `static/user_guide.html` (also linked from the editor as "User Manual") for the full guide.

Layout: `app.py` (routes), `exporter.py` (code generation), `importer.py` (zip/html import), `icons.py` + `bootstrap_icons.json` (icon data), `static/js/import.js` (import UI), `static/js/device.js` (device preview), `templates/index.html`, `static/style.css`, `static/js/*.js`.

## Import / export round trip
Every code export embeds the editable project (`<script id="frameforge-project">` in HTML, `frameforge.json` in zips; SVG/PNG carry the frame inside), so **Import** reopens it exactly. Untick *Include editable project* in the Export menu to leave it out. Files not made by FrameForge are rebuilt from the rendered page (HTML/ZIP), or added as image layers (SVG/PNG/JPG/WebP/GIF). PDF pages become image frames (pdf.js is loaded from a CDN on first use).
