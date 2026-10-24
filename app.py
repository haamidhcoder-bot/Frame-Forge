"""FrameForge - a Figma-style website layout editor.

Backend: Flask + SQLite (stdlib). Stores designs as JSON and exports them to
HTML/CSS, React, Tailwind and Bootstrap (see exporter.py).
"""
import json
import os
import re
import sqlite3
import time

from flask import Flask, Response, g, jsonify, render_template, request

from exporter import FORMATS, export_project
from icons import ICONS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "designs.db")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024  # embedded images can be large


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
    """Validate the {name, data:{els:[...], pages, tokens, textStyles}} body sent by the editor."""
    if not isinstance(payload, dict):
        raise ValueError("Body must be a JSON object")
    name = str(payload.get("name") or "Untitled design").strip()[:120] or "Untitled design"
    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("els"), list):
        raise ValueError("data.els must be a list")
    if len(data["els"]) > 8000:
        raise ValueError("Too many elements (max 8000)")
    for e in data["els"]:
        if not isinstance(e, dict) or "id" not in e or "type" not in e:
            raise ValueError("Every element needs an id and a type")
    for key, kind in (("pages", list), ("tokens", dict), ("textStyles", dict)):
        if key in data and not isinstance(data[key], kind):
            raise ValueError(f"data.{key} must be a {kind.__name__}")
    return name, data


def bad_request(msg):
    return jsonify(error=msg), 400


def export_opts(src):
    """Export options from a JSON body or query string."""
    mode = src.get("mode")
    return {
        "mode": "responsive" if mode == "responsive" else "absolute",
        "breakpoints": str(src.get("breakpoints", "")).lower() in ("1", "true", "yes"),
        "page": src.get("page") or None,
        "start": src.get("start") or None,
        "frame": src.get("frame") or None,
    }


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html", icons=ICONS)


@app.get("/p/<int:pid>")
def published(pid):
    """Public, read-only page for a saved project (the 'Publish' button links here)."""
    row = get_db().execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if row is None:
        return "Project not found", 404
    opts = export_opts({"mode": "responsive", "breakpoints": "1", "page": request.args.get("page")})
    body, mime, _ = export_project(row["name"], json.loads(row["data"]), "html", opts)
    return Response(body, mimetype=mime)


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
# Export
# --------------------------------------------------------------------------
def send_export(name, data, fmt_name, opts):
    if fmt_name not in FORMATS:
        return bad_request("Unknown export format")
    body, mime, filename = export_project(name, data, fmt_name, opts)
    return Response(body, mimetype=mime, headers={
        "Content-Disposition": f'inline; filename="{filename}"',
        "X-Export-Filename": filename,
        "Access-Control-Expose-Headers": "X-Export-Filename",
    })


@app.post("/api/export")
def export_route():
    payload = request.get_json(silent=True)
    try:
        name, data = clean_payload(payload)
    except ValueError as exc:
        return bad_request(str(exc))
    return send_export(name, data, payload.get("format", "html"), export_opts(payload))


@app.get("/api/projects/<int:pid>/export.html")
def export_saved(pid):
    row = get_db().execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if row is None:
        return jsonify(error="Project not found"), 404
    body, mime, _ = export_project(row["name"], json.loads(row["data"]), "html", export_opts(request.args))
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", row["name"]).strip("-") or "design"
    return Response(body, mimetype=mime,
                    headers={"Content-Disposition": f'attachment; filename="{safe}.html"'})


init_db()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
