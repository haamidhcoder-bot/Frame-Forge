# FrameForge – Figma-style website layout designer

Stack: HTML/CSS/vanilla JS frontend, Python (Flask + SQLite) backend.

## Run
    pip install -r requirements.txt
    python app.py        # open http://localhost:5000

## Features
- Infinite canvas: pan (Space+drag / scroll), zoom (Ctrl+scroll), fit
- Tools: Frame, Rectangle, Ellipse, Text, Button, Image (V H F R O T B I)
- Nested frames, layers panel (rename, hide, lock, reorder)
- Properties: position/size, fill, stroke, radius, opacity, shadow, fonts, alignment, device presets
- Smart snapping guides, resize handles, multi-select, copy/paste/duplicate, nudge
- Undo/redo, auto-save to SQLite, open/delete projects, JSON import/export
- Export/preview clean standalone HTML + CSS (server-side, sanitized)

## API
GET/POST /api/projects · GET/PUT/DELETE /api/projects/<id> · POST /api/export · GET /api/projects/<id>/export.html
