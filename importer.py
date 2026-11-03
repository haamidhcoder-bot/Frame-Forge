"""Import support: read back anything FrameForge can export.

Every code export (HTML, HTML+CSS zip, Tailwind, Bootstrap, React zip, Flask zip)
embeds the editable project (exporter.EMBED_ID / frameforge.json), so re-importing
is lossless. For files without that data (hand-written or third-party HTML, zips
made elsewhere) we return the page markup and the editor rebuilds layers from the
rendered DOM (see static/js/import.js).
"""
import html as html_lib
import io
import json
import posixpath
import re
import zipfile

from exporter import EMBED_ID

MAX_ZIP_TOTAL = 120 * 1024 * 1024  # uncompressed bytes we are willing to read
EMBED_RE = re.compile(r'<script[^>]*\bid=["\']' + EMBED_ID + r'["\'][^>]*>(.*?)</script>', re.S | re.I)


class ImportError_(ValueError):
    pass


def as_project(obj, fallback_name="Imported design"):
    """Accept {name, data:{els}} or a bare {els: [...]} and return (name, data)."""
    if not isinstance(obj, dict):
        raise ImportError_("Not a FrameForge project")
    data = obj.get("data") if isinstance(obj.get("data"), dict) else obj
    els = data.get("els")
    if not isinstance(els, list) or any(not isinstance(e, dict) or "id" not in e or "type" not in e for e in els):
        raise ImportError_("Not a FrameForge project")
    if len(els) > 8000:
        raise ImportError_("Too many elements (max 8000)")
    name = str(obj.get("name") or fallback_name).strip()[:120] or fallback_name
    return name, data


def project_from_html(text):
    m = EMBED_RE.search(text)
    if not m:
        return None
    try:
        return as_project(json.loads(m.group(1)))
    except (ValueError, ImportError_):
        return None


def result_project(name, data):
    return {"kind": "project", "name": name, "data": data}


def jsx_to_html(jsx, css):
    """Best-effort conversion of a FrameForge-style React component to a static HTML page."""
    m = re.search(r"return\s*\(\s*<>(.*)</>\s*\)\s*;?\s*\}", jsx, re.S)
    if not m:
        return None
    body = m.group(1)
    body = re.sub(r'\{("(?:[^"\\]|\\.)*")\}',
                  lambda x: html_lib.escape(json.loads(x.group(1))), body)           # {"text"}
    body = re.sub(r'className=\{"([^"]*)"[^}]*\}\s*\}?', r'class="\1 ff-active"', body)  # conditional class
    body = body.replace("className=", "class=").replace("defaultChecked", "checked")
    body = re.sub(r'\sonClick=\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', "", body)
    body = re.sub(r"\b(stroke|fill|clip)(Width|Linecap|Linejoin|Rule|Opacity)=",
                  lambda x: x.group(1) + "-" + x.group(2).lower() + "=", body)
    return f"<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>{css}</style></head><body>{body}</body></html>"


def import_zip(raw, fallback_name):
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise ImportError_("That is not a valid .zip file")
    infos = [i for i in z.infolist() if not i.is_dir() and ".." not in i.filename.split("/")]
    if sum(i.file_size for i in infos) > MAX_ZIP_TOTAL:
        raise ImportError_("Zip is too large")
    by_name = {i.filename: i for i in infos}

    def text(path):
        return z.read(by_name[path]).decode("utf-8", "replace")

    # 1) lossless: frameforge.json written by every FrameForge zip export
    for path in by_name:
        if posixpath.basename(path) == "frameforge.json":
            try:
                name, data = as_project(json.loads(text(path)), fallback_name)
                return result_project(name, data)
            except (ValueError, ImportError_):
                break
    # 2) embedded project inside an HTML page
    htmls = sorted((p for p in by_name if p.lower().endswith((".html", ".htm"))), key=lambda p: (p.count("/"), p))
    for p in htmls:
        found = project_from_html(text(p))
        if found:
            return result_project(*found)
    # 3) fallback: rebuild from the rendered page
    css = "\n".join(text(p) for p in by_name if p.lower().endswith(".css"))
    page = None
    note = None
    if htmls:
        index = next((p for p in htmls if posixpath.basename(p).lower() == "index.html"), htmls[0])
        page = text(index)
        page = re.sub(r'<link[^>]+rel=["\']stylesheet["\'][^>]+href=["\'](?!https?:|//)[^"\']*["\'][^>]*>', "", page, flags=re.I)
        page = re.sub(r'<link[^>]+href=["\'](?!https?:|//)[^"\']*\.css["\'][^>]*>', "", page, flags=re.I)
        page = page.replace("</head>", f"<style>{css}</style></head>", 1) if "</head>" in page else f"<style>{css}</style>{page}"
        if len(htmls) > 1:
            note = f"Imported {posixpath.basename(index)} only ({len(htmls)} pages found)."
    else:
        jsx = next((p for p in by_name if p.lower().endswith((".jsx", ".tsx"))), None)
        if jsx:
            page = jsx_to_html(text(jsx), css)
    if not page:
        raise ImportError_("No FrameForge project data or HTML page found in this zip")
    return {"kind": "html", "name": fallback_name, "html": page, "note": note}


def import_file(filename, raw):
    """Dispatch on file extension. Returns a dict for the editor; raises ImportError_."""
    base = re.sub(r"\.[^.]+$", "", posixpath.basename(filename or "")) or "Imported design"
    low = (filename or "").lower()
    if low.endswith(".zip"):
        return import_zip(raw, base)
    text = raw.decode("utf-8", "replace")
    if low.endswith(".json"):
        try:
            name, data = as_project(json.loads(text), base)
        except ValueError as exc:
            raise ImportError_(str(exc) if isinstance(exc, ImportError_) else "Not a FrameForge file")
        return result_project(name, data)
    if low.endswith((".html", ".htm")):
        found = project_from_html(text)
        if found:
            return result_project(*found)
        return {"kind": "html", "name": base, "html": text, "note": None}
    raise ImportError_("Unsupported file type")
