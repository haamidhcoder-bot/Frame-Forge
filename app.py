"""FrameForge - a Figma-style website layout editor.

Backend: Flask + SQLite (stdlib). Stores designs as JSON and exports them
to clean standalone HTML/CSS.
"""
import html
import json
import os
import re
import sqlite3
import time

from flask import Flask, Response, g, jsonify, render_template, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "designs.db")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB


# --------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """CREATE TABLE IF NOT EXISTS projects (
                   id      INTEGER PRIMARY KEY AUTOINCREMENT,
                   name    TEXT NOT NULL,
                   data    TEXT NOT NULL,
                   updated REAL NOT NULL
               )"""
        )


# --------------------------------------------------------------------------
# Validation helpers
# --------------------------------------------------------------------------
def clean_payload(payload):
    """Validate the {name, data:{els:[...]}} body sent by the editor."""
    if not isinstance(payload, dict):
        raise ValueError("Body must be a JSON object")
    name = str(payload.get("name") or "Untitled design").strip()[:120] or "Untitled design"
    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("els"), list):
        raise ValueError("data.els must be a list")
    if len(data["els"]) > 5000:
        raise ValueError("Too many elements (max 5000)")
    for e in data["els"]:
        if not isinstance(e, dict) or "id" not in e or "type" not in e:
            raise ValueError("Every element needs an id and a type")
    return name, data


def bad_request(msg):
    return jsonify(error=msg), 400


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


# --------------------------------------------------------------------------
# Projects API
# --------------------------------------------------------------------------
@app.get("/api/projects")
def list_projects():
    rows = get_db().execute(
        "SELECT id, name, updated FROM projects ORDER BY updated DESC"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/projects")
def create_project():
    try:
        name, data = clean_payload(request.get_json(silent=True))
    except ValueError as exc:
        return bad_request(str(exc))
    db = get_db()
    cur = db.execute(
        "INSERT INTO projects (name, data, updated) VALUES (?, ?, ?)",
        (name, json.dumps(data), time.time()),
    )
    db.commit()
    return jsonify(id=cur.lastrowid, name=name), 201


@app.get("/api/projects/<int:pid>")
def get_project(pid):
    row = get_db().execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if row is None:
        return jsonify(error="Project not found"), 404
    return jsonify(id=row["id"], name=row["name"], data=json.loads(row["data"]),
                   updated=row["updated"])


@app.put("/api/projects/<int:pid>")
def update_project(pid):
    try:
        name, data = clean_payload(request.get_json(silent=True))
    except ValueError as exc:
        return bad_request(str(exc))
    db = get_db()
    cur = db.execute(
        "UPDATE projects SET name = ?, data = ?, updated = ? WHERE id = ?",
        (name, json.dumps(data), time.time(), pid),
    )
    db.commit()
    if cur.rowcount == 0:
        return jsonify(error="Project not found"), 404
    return jsonify(id=pid, name=name)


@app.delete("/api/projects/<int:pid>")
def delete_project(pid):
    db = get_db()
    cur = db.execute("DELETE FROM projects WHERE id = ?", (pid,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify(error="Project not found"), 404
    return jsonify(ok=True)


# --------------------------------------------------------------------------
# HTML / CSS export
# --------------------------------------------------------------------------
COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{3,8}|transparent|rgba?\(\s*[\d.\s,%]+\))$")
FONTS = {
    "Inter": "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
    "Georgia": "Georgia, 'Times New Roman', serif",
    "Mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
}
ALIGN_FLEX = {"left": "flex-start", "center": "center", "right": "flex-end"}


def num(value, default=0.0):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    return n if n == n and abs(n) != float("inf") else default


def px(value):
    n = num(value)
    return f"{int(n)}px" if n == int(n) else f"{round(n, 2)}px"


def color(value, default="transparent"):
    if isinstance(value, str) and COLOR_RE.match(value.strip()):
        return value.strip()
    return default


def safe_url(value):
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if re.match(r"^(https?://|data:image/(png|jpe?g|gif|webp|svg\+xml);)", value, re.I):
        return value
    return ""


def element_css(e, is_root):
    t = e.get("type")
    r = []
    if is_root:
        r.append("position:relative;margin:32px auto")
    else:
        r.append(f"position:absolute;left:{px(e.get('x'))};top:{px(e.get('y'))}")
    r.append(f"width:{px(e.get('w'))};height:{px(e.get('h'))};box-sizing:border-box")

    if t != "text":
        r.append(f"background-color:{color(e.get('fill'), '#d9d9d9' if t != 'frame' else '#ffffff')}")
    sw = num(e.get("strokeW"))
    if sw > 0:
        r.append(f"border:{px(sw)} solid {color(e.get('stroke'), '#000000')}")
    if t == "ellipse":
        r.append("border-radius:50%")
    elif num(e.get("radius")) > 0:
        r.append(f"border-radius:{px(e.get('radius'))}")
    opacity = num(e.get("opacity"), 1)
    if opacity < 1:
        r.append(f"opacity:{round(max(0.0, opacity), 2)}")
    if e.get("shadow"):
        r.append("box-shadow:0 8px 24px rgba(0,0,0,.25)")
    if t == "frame" and e.get("clip"):
        r.append("overflow:hidden")

    if t in ("text", "button"):
        r.append(f"font-family:{FONTS.get(e.get('font'), FONTS['Inter'])}")
        r.append(f"font-size:{px(num(e.get('fontSize'), 16))}")
        r.append(f"font-weight:{int(num(e.get('fontWeight'), 400))}")
        r.append(f"color:{color(e.get('color'), '#111111')}")
        r.append("line-height:1.3;white-space:pre-wrap;word-wrap:break-word")
    if t == "text":
        align = e.get("align") if e.get("align") in ALIGN_FLEX else "left"
        r.append(f"text-align:{align}")
    if t == "button":
        align = e.get("align") if e.get("align") in ALIGN_FLEX else "center"
        r.append(f"display:flex;align-items:center;justify-content:{ALIGN_FLEX[align]};"
                 "cursor:pointer;padding:0 12px")
        if sw <= 0:
            r.append("border:none")
    return ";".join(r)


def render_element(e, children_of, is_root=False):
    if e.get("visible") is False:
        return ""
    t = e.get("type")
    cid = "n" + re.sub(r"[^a-zA-Z0-9_-]", "", str(e.get("id")))
    css = html.escape(element_css(e, is_root), quote=True)
    name = html.escape(str(e.get("name", "")), quote=True)
    text = html.escape(str(e.get("text", "")))

    if t == "text":
        return f'<div id="{cid}" data-name="{name}" style="{css}">{text}</div>'
    if t == "button":
        return f'<button id="{cid}" type="button" data-name="{name}" style="{css}">{text}</button>'
    if t == "image":
        url = safe_url(e.get("url"))
        if url:
            return (f'<img id="{cid}" src="{html.escape(url, quote=True)}" alt="{name}" '
                    f'style="{css};object-fit:cover;display:block">')
        return f'<div id="{cid}" data-name="{name}" style="{css}"></div>'
    inner = "".join(render_element(c, children_of) for c in children_of.get(e.get("id"), []))
    tag = "section" if t == "frame" else "div"
    return f'<{tag} id="{cid}" data-name="{name}" style="{css}">{inner}</{tag}>'


def export_html(name, els):
    children_of = {}
    for e in els:
        children_of.setdefault(e.get("parent"), []).append(e)
    ids = {e.get("id") for e in els}
    # roots = no parent, or a parent that doesn't exist
    roots = [e for e in els if not e.get("parent") or e.get("parent") not in ids]
    body = "\n".join(render_element(e, children_of, is_root=True) for e in roots)
    title = html.escape(name)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #e5e7eb; padding: 16px; overflow-x: auto; }}
  button {{ font: inherit; }}
</style>
</head>
<body>
{body}
</body>
</html>
"""


@app.post("/api/export")
def export_route():
    try:
        name, data = clean_payload(request.get_json(silent=True))
    except ValueError as exc:
        return bad_request(str(exc))
    return Response(export_html(name, data["els"]), mimetype="text/html")


@app.get("/api/projects/<int:pid>/export.html")
def export_saved(pid):
    row = get_db().execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if row is None:
        return jsonify(error="Project not found"), 404
    page = export_html(row["name"], json.loads(row["data"])["els"])
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", row["name"]).strip("-") or "design"
    return Response(page, mimetype="text/html",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.html"'})


init_db()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
