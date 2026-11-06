# FrameForge v2

A Figma-style website layout designer. Frontend: HTML, CSS and vanilla JS. Backend: Python (Flask + SQLite).

Features: HTML | Flet output switch (export a Python Flet app), 2,050 Bootstrap Icons + the built-in icon set, import of everything you can export (.json, .html, .zip, .svg, .png, .pdf and images), auto layout (flex/grid), gradients, multiple fills/strokes/effects, image upload, extra shapes and form controls, text styling with Google Fonts, groups, alignment, rulers/guides/grid, components and instances, colour and text styles, block and page-template library (23 blocks, 12 pages, each in light and dark), multiple pages, prototype links with a DevTools-style device preview (phones, tablets, desktop), export to HTML, HTML+CSS, React, Tailwind, Bootstrap, Flask project, PNG, SVG and PDF, publish link, light/dark theme, context menu, minimap, layer search and touch support.

See `static/user_guide.html` (also linked from the editor as "User Manual") for the full guide.

Layout: `app.py` (routes), `exporter.py` (code generation), `flet_export.py` (Flet/Python generation), `importer.py` (zip/html import), `icons.py` + `bootstrap_icons.json` (icon data), `static/js/import.js` (import UI), `templates/index.html`, `static/style.css`, `static/js/*.js`.

## Import / export round trip
Every code export embeds the editable project (`<script id="frameforge-project">` in HTML, `frameforge.json` in zips; SVG/PNG carry the frame inside), so **Import** reopens it exactly. Untick *Include editable project* in the Export menu to leave it out. Files not made by FrameForge are rebuilt from the rendered page (HTML/ZIP), or added as image layers (SVG/PNG/JPG/WebP/GIF). PDF pages become image frames (pdf.js is loaded from a CDN on first use).

## Flet mode
Use the **HTML | Flet** switch in the top bar. In Flet mode, Export creates a Python app (Flet 1.x): each frame is a screen, auto layout becomes Row/Column, free layout becomes a Stack, links between frames switch screens, and buttons/fields get empty handlers (`on_click_*`, `on_change_*`, `on_select_*`) for your logic. Run it with `pip install flet` and `python main.py`. The mode is saved with the project. Not exported: inner shadows/blur, extra fills/strokes beyond the first, fonts that Flet does not have.
