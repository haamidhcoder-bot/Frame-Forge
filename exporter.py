"""FrameForge export engine.

Turns the editor's JSON document into clean, standalone code:
  * HTML (single file) or HTML + CSS (zip)
  * React component + CSS (zip)
  * Tailwind HTML (utility classes, Play CDN)
  * Bootstrap 5 HTML + CSS (zip)

The CSS rules here mirror static/js/model.js (declsFor) so the canvas and the
exported page look the same.
"""
import html
import io
import json
import math
import re
import zipfile
from collections import defaultdict

from icons import ICONS

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------
FONTS = {
    "Inter": ("Inter, system-ui, -apple-system, 'Segoe UI', sans-serif", "Inter:wght@400;500;600;700"),
    "Poppins": ("Poppins, system-ui, sans-serif", "Poppins:wght@400;500;600;700"),
    "Roboto": ("Roboto, system-ui, sans-serif", "Roboto:wght@400;500;700"),
    "Montserrat": ("Montserrat, system-ui, sans-serif", "Montserrat:wght@400;500;600;700"),
    "Playfair Display": ("'Playfair Display', Georgia, serif", "Playfair+Display:wght@400;600;700"),
    "Lato": ("Lato, system-ui, sans-serif", "Lato:wght@400;700"),
    "Open Sans": ("'Open Sans', system-ui, sans-serif", "Open+Sans:wght@400;600;700"),
    "Space Grotesk": ("'Space Grotesk', system-ui, sans-serif", "Space+Grotesk:wght@400;500;700"),
    "Georgia": ("Georgia, 'Times New Roman', serif", None),
    "Mono": ("ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", None),
}

COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{3,8}|transparent|rgba?\(\s*[\d.\s,%]+\))$")
HEX_RE = re.compile(r"^#([0-9a-fA-F]{3,8})$")
RGB_RE = re.compile(r"^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$")
FLEX_ALIGN = {"start": "flex-start", "center": "center", "end": "flex-end", "stretch": "stretch"}
GRID_ALIGN = {"start": "start", "center": "center", "end": "end", "stretch": "stretch"}
JUSTIFY = {"start": "flex-start", "center": "center", "end": "flex-end", "between": "space-between"}
TEXT_ALIGN_FLEX = {"left": "flex-start", "center": "center", "right": "flex-end"}

DEFAULTS = dict(
    x=0, y=0, w=100, h=100, parent=None, visible=True, locked=False, page="p1", name="",
    fills=None, strokes=None, effects=None, radius=0, opacity=1, clip=False,
    text="", font="Inter", fontSize=16, fontWeight=400, color="#111111", align="left",
    lineHeight=1.3, letterSpacing=0, italic=False, underline=False, strike=False, tstyle="",
    layout="none", gap=0, padX=0, padY=0, wrap=False, alignItems="start", justify="start", cols=2,
    sizeW="fixed", sizeH="fixed", url="", fit="cover", sides=5, star=False, icon="star",
    placeholder="", checked=False, ref="", overrides=None, link=None, isComp=False,
)

BASE_CSS = """*, *::before, *::after { box-sizing: border-box; }
h1, h2, p { margin: 0; }
button, input, select { font: inherit; }
button { cursor: pointer; }
::placeholder { color: #9ca3af; }
label input[type=checkbox] { width: 18px; height: 18px; margin: 0; flex: none; accent-color: #2563eb; }
a.ff-a { display: contents; }
.ff-link { cursor: pointer; }
.ff-frame:not(.ff-active) { display: none; }
"""

PROTO_JS = """document.addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-goto]');
  if (!t) return;
  var key = t.getAttribute('data-goto');
  var next = document.querySelector('[data-frame="' + key + '"]');
  if (!next) return;
  document.querySelectorAll('[data-frame]').forEach(function (f) { f.classList.remove('ff-active'); });
  next.classList.add('ff-active');
  window.scrollTo(0, 0);
});"""


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def num(value, default=0.0):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    return n if n == n and abs(n) != float("inf") else default


def fmt(n):
    n = round(n, 3)
    return str(int(n)) if n == int(n) else str(n)


def px(value):
    return fmt(num(value)) + "px"


def color(value, default="transparent"):
    if isinstance(value, str) and COLOR_RE.match(value.strip()):
        return value.strip()
    return default


def with_alpha(c, a):
    if a >= 1:
        return c
    m = HEX_RE.match(c)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(ch * 2 for ch in h)
        if len(h) == 6:
            h += "ff"
        if len(h) == 8:
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            al = int(h[6:8], 16) / 255
            return f"rgba({r},{g},{b},{fmt(al * a)})"
    m = RGB_RE.match(c)
    if m:
        al = float(m.group(4) or 1) * a
        return f"rgba({fmt(float(m.group(1)))},{fmt(float(m.group(2)))},{fmt(float(m.group(3)))},{fmt(al)})"
    return c


def safe_url(value):
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if re.match(r"^(https?://|data:image/(png|jpe?g|gif|webp|svg\+xml);)", value, re.I):
        return value
    return ""


def safe_href(value):
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if re.match(r"^(https?://|mailto:|tel:|#|/)", value, re.I):
        return value
    return ""


def slug(text):
    s = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")
    if not s or s[0].isdigit():
        s = "n-" + s if s else "el"
    return s[:40]


# --------------------------------------------------------------------------
# Normalisation, instances, tokens, text styles
# --------------------------------------------------------------------------
def norm(e):
    """Return a copy of an element with defaults filled in and legacy fields migrated."""
    c = dict(DEFAULTS)
    c.update({k: v for k, v in e.items() if v is not None or k in ("parent", "link", "overrides")})
    for k in ("x", "y", "w", "h", "radius", "gap", "padX", "padY", "fontSize", "fontWeight", "letterSpacing"):
        c[k] = num(c[k])
    c["w"] = max(1.0, c["w"])
    c["h"] = max(0.0, c["h"])
    c["opacity"] = min(1.0, max(0.0, num(c["opacity"], 1)))
    c["lineHeight"] = num(c["lineHeight"], 1.3) or 1.3
    c["cols"] = max(1, int(num(c["cols"], 2)))
    c["sides"] = max(3, min(12, int(num(c["sides"], 5))))
    if not isinstance(e.get("fills"), list):
        legacy = e.get("fill")
        if c["type"] == "text" or not legacy or legacy == "transparent":
            c["fills"] = []
        else:
            c["fills"] = [{"type": "solid", "color": legacy, "opacity": 1}]
    if not isinstance(e.get("strokes"), list):
        sw = num(e.get("strokeW"))
        c["strokes"] = [{"color": e.get("stroke", "#000000"), "width": sw}] if sw > 0 else []
    if not isinstance(e.get("effects"), list):
        c["effects"] = ([{"type": "drop", "x": 0, "y": 8, "blur": 24, "spread": 0, "color": "rgba(0,0,0,.25)"}]
                        if e.get("shadow") else [])
    c["fills"] = [f for f in c["fills"] if isinstance(f, dict)]
    c["strokes"] = [s for s in c["strokes"] if isinstance(s, dict)]
    c["effects"] = [f for f in c["effects"] if isinstance(f, dict)]
    return c


def expand_instances(els):
    """Replace every `instance` element with a copy of its component tree."""
    for _ in range(4):
        if not any(e["type"] == "instance" for e in els):
            break
        by_id = {e["id"]: e for e in els}
        kids = defaultdict(list)
        for e in els:
            kids[e.get("parent")].append(e)
        out = []
        for e in els:
            if e["type"] != "instance":
                out.append(e)
            else:
                out.extend(expand_one(e, by_id, kids))
        els = out
    return [e for e in els if e["type"] != "instance"]


def expand_one(inst, by_id, kids):
    master = by_id.get(inst.get("ref"))
    if not master or master["type"] not in ("frame", "group"):
        ph = dict(DEFAULTS)
        ph.update(id=inst["id"], type="rect", x=inst["x"], y=inst["y"], w=inst["w"], h=inst["h"],
                  parent=inst.get("parent"), page=inst.get("page"), name=inst.get("name", ""),
                  fills=[{"type": "solid", "color": "#e5e7eb", "opacity": 1}], strokes=[], effects=[])
        return [ph]
    overrides = inst.get("overrides") or {}
    out = []

    def walk(node, is_root, new_parent):
        c = dict(node)
        orig = node["id"]
        if is_root:
            c.update(id=inst["id"], parent=inst.get("parent"), x=inst["x"], y=inst["y"], w=inst["w"], h=inst["h"],
                     name=inst.get("name") or node.get("name", ""), page=inst.get("page"),
                     visible=inst.get("visible", True), sizeW=inst.get("sizeW", "fixed"),
                     sizeH=inst.get("sizeH", "fixed"), isComp=False,
                     link=inst.get("link") or node.get("link"))
        else:
            c.update(id=f"{inst['id']}::{orig}", parent=new_parent, page=inst.get("page"), isComp=False)
            ov = overrides.get(orig)
            if isinstance(ov, dict):
                if "text" in ov:
                    c["text"] = str(ov["text"])
                if ov.get("color"):
                    if c["type"] in ("text", "icon", "input", "checkbox", "select") or not c["fills"]:
                        if c["type"] in ("text", "icon", "input", "checkbox", "select"):
                            c["color"] = ov["color"]
                        else:
                            c["fills"] = [{"type": "solid", "color": ov["color"], "opacity": 1}]
                    else:
                        c["fills"] = [dict(c["fills"][0], color=ov["color"])] + c["fills"][1:]
        out.append(c)
        for k in kids.get(orig, []):
            walk(k, False, c["id"])

    walk(master, True, None)
    return out


def apply_tokens(e, tokens, tstyles):
    def tk(v):
        if isinstance(v, str) and v.startswith("token:"):
            return tokens.get(v[6:], "#888888")
        return v
    e["color"] = tk(e["color"])
    e["fills"] = [dict(f, color=tk(f.get("color")), color2=tk(f.get("color2"))) for f in e["fills"]]
    e["strokes"] = [dict(s, color=tk(s.get("color"))) for s in e["strokes"]]
    e["effects"] = [dict(f, color=tk(f.get("color"))) for f in e["effects"]]
    ts = tstyles.get(e.get("tstyle")) if e.get("tstyle") else None
    if isinstance(ts, dict):
        for k in ("font", "fontSize", "fontWeight", "lineHeight", "letterSpacing"):
            if k in ts and ts[k] not in (None, ""):
                e[k] = ts[k]
        for k in ("fontSize", "fontWeight", "lineHeight", "letterSpacing"):
            e[k] = num(e[k], DEFAULTS[k])
    return e


def prepare(data, page_id=None, frame_id=None):
    pages = data.get("pages") if isinstance(data.get("pages"), list) else []
    if not page_id:
        page_id = (pages[0].get("id") if pages and isinstance(pages[0], dict) else None) or "p1"
    tokens = data.get("tokens") if isinstance(data.get("tokens"), dict) else {}
    tstyles = data.get("textStyles") if isinstance(data.get("textStyles"), dict) else {}
    els = [norm(e) for e in data.get("els", []) if isinstance(e, dict) and "id" in e and "type" in e]
    els = expand_instances(els)
    # component masters are building blocks, not page content: leave them (and their children) out
    hidden = {e["id"] for e in els if e.get("isComp")}
    grew = True
    while grew:
        grew = False
        for e in els:
            if e["id"] not in hidden and e.get("parent") in hidden:
                hidden.add(e["id"])
                grew = True
    els = [e for e in els if e.get("page") == page_id and e["id"] not in hidden]
    if frame_id:
        keep = {frame_id}
        grew = True
        while grew:
            grew = False
            for e in els:
                if e["id"] not in keep and e.get("parent") in keep:
                    keep.add(e["id"])
                    grew = True
        els = [dict(e, parent=None) if e["id"] == frame_id else e for e in els if e["id"] in keep]
    return [apply_tokens(e, tokens, tstyles) for e in els], page_id


# --------------------------------------------------------------------------
# CSS declarations (mirror of declsFor in model.js)
# --------------------------------------------------------------------------
def is_auto(e):
    return e["layout"] in ("row", "column", "grid") and e["type"] in ("frame", "group")


def polygon_points(sides, star):
    pts = []
    n = sides * 2 if star else sides
    for i in range(n):
        ang = -math.pi / 2 + i * 2 * math.pi / n
        r = 50 if (not star or i % 2 == 0) else 22.5
        pts.append(f"{fmt(50 + r * math.cos(ang))}% {fmt(50 + r * math.sin(ang))}%")
    return "polygon(" + ",".join(pts) + ")"


def fill_css(f):
    c1 = with_alpha(color(f.get("color"), "#d9d9d9"), min(1.0, max(0.0, num(f.get("opacity"), 1))))
    t = f.get("type")
    if t in ("linear", "radial"):
        c2 = with_alpha(color(f.get("color2"), "#ffffff"), min(1.0, max(0.0, num(f.get("opacity"), 1))))
        if t == "linear":
            return f"linear-gradient({fmt(num(f.get('angle'), 90))}deg,{c1},{c2})"
        return f"radial-gradient(circle,{c1},{c2})"
    return f"linear-gradient({c1},{c1})"


def size_decls(e, parent, d, resp):
    pk = parent["layout"] if parent is not None and is_auto(parent) else None
    sw, sh = e["sizeW"], e["sizeH"]
    if sw == "fill" and not pk:
        sw = "fixed"
    if sh == "fill" and not pk:
        sh = "fixed"
    can_hug = is_auto(e) or e["type"] in ("text", "button")
    if sw == "hug" and not can_hug:
        sw = "fixed"
    if sh == "hug" and not can_hug:
        sh = "fixed"
    if sw == "fixed":
        d.append(("width", px(e["w"])))
        if pk and resp:
            d.append(("max-width", "100%"))
    elif sw == "hug":
        d.append(("width", "fit-content"))
    elif pk == "row":
        d += [("flex", "1 1 0%"), ("min-width", "0")]
    elif pk == "column":
        d.append(("align-self", "stretch"))
    else:
        d.append(("width", "100%"))
    if sh == "fixed":
        d.append(("height", px(e["h"])))
    elif sh == "hug":
        d.append(("height", "fit-content"))
    elif pk == "column":
        d += [("flex", "1 1 0%"), ("min-height", "0")]
    elif pk == "row":
        d.append(("align-self", "stretch"))
    else:
        d.append(("height", "100%"))
    if not resp:
        if pk == "row" and sw == "fixed":
            d.append(("flex-shrink", "0"))
        if pk == "column" and sh == "fixed":
            d.append(("flex-shrink", "0"))


def css_decls(e, parent, resp):
    """Ordered (property, value) pairs for one element."""
    t = e["type"]
    d = []
    pk = parent["layout"] if parent is not None and is_auto(parent) else None
    if parent is None:
        d.append(("position", "relative"))
        d.append(("margin", "0 auto" if resp else "32px auto"))
    elif pk:
        d.append(("position", "relative"))
    else:
        d += [("position", "absolute"), ("left", px(e["x"])), ("top", px(e["y"]))]
    size_decls(e, parent, d, resp)
    if parent is None and resp and is_auto(e):
        d = [x for x in d if x[0] not in ("width", "flex", "min-width", "align-self")]
        d += [("width", "100%"), ("max-width", px(e["w"]))]
    d.append(("box-sizing", "border-box"))

    # background
    if t != "text":
        layers = e["fills"]
        if len(layers) == 1 and layers[0].get("type", "solid") == "solid":
            f = layers[0]
            d.append(("background-color", with_alpha(color(f.get("color"), "#d9d9d9"),
                                                      min(1.0, max(0.0, num(f.get("opacity"), 1))))))
        elif layers:
            d.append(("background", ",".join(fill_css(f) for f in layers)))
        elif t in ("button", "input", "select"):
            d.append(("background-color", "transparent"))  # form controls otherwise get the browser's grey

    # strokes + effects
    strokes = [s for s in e["strokes"] if num(s.get("width")) > 0]
    shadows, filt, bgblur = [], None, None
    if strokes and t != "text":
        s0 = strokes[0]
        d.append(("border", f"{px(s0['width'])} solid {color(s0.get('color'), '#000000')}"))
        cum = 0.0
        for s in strokes[1:]:
            cum += num(s["width"])
            shadows.append(f"inset 0 0 0 {px(cum)} {color(s.get('color'), '#000000')}")
    elif t in ("button", "input", "select"):
        d.append(("border", "none"))
    inner, drop = [], []
    for ef in e["effects"]:
        et = ef.get("type")
        c = color(ef.get("color"), "rgba(0,0,0,.25)")
        if et == "drop":
            drop.append(f"{px(ef.get('x'))} {px(ef.get('y'))} {px(ef.get('blur'))} {px(ef.get('spread'))} {c}")
        elif et == "inner":
            inner.append(f"inset {px(ef.get('x'))} {px(ef.get('y'))} {px(ef.get('blur'))} {px(ef.get('spread'))} {c}")
        elif et == "blur":
            filt = f"blur({px(ef.get('blur'))})"
        elif et == "bgblur":
            bgblur = f"blur({px(ef.get('blur'))})"
    shadows += inner + drop
    if shadows:
        d.append(("box-shadow", ",".join(shadows)))
    if filt:
        d.append(("filter", filt))
    if bgblur:
        d += [("-webkit-backdrop-filter", bgblur), ("backdrop-filter", bgblur)]

    # shape
    if t == "polygon":
        d.append(("clip-path", polygon_points(e["sides"], bool(e["star"]))))
    elif t == "ellipse":
        d.append(("border-radius", "50%"))
    elif e["radius"] > 0:
        d.append(("border-radius", px(e["radius"])))
    if e["opacity"] < 1:
        d.append(("opacity", fmt(e["opacity"])))
    if t == "frame" and e["clip"]:
        d.append(("overflow", "hidden"))
    if t == "image":
        d.append(("overflow", "hidden"))
        d.append(("object-fit", e["fit"] if e["fit"] in ("cover", "contain", "fill") else "cover"))
        d.append(("display", "block"))

    # auto layout
    if is_auto(e):
        lay = e["layout"]
        pad = ""
        if e["padX"] or e["padY"]:
            pad = f"{px(e['padY'])} {px(e['padX'])}"
        if lay in ("row", "column"):
            d += [("display", "flex"), ("flex-direction", lay), ("gap", px(e["gap"]))]
            if pad:
                d.append(("padding", pad))
            d.append(("align-items", FLEX_ALIGN.get(e["alignItems"], "flex-start")))
            d.append(("justify-content", JUSTIFY.get(e["justify"], "flex-start")))
            if e["wrap"]:
                d.append(("flex-wrap", "wrap"))
        else:
            d += [("display", "grid"), ("grid-template-columns", f"repeat({e['cols']},1fr)"), ("gap", px(e["gap"]))]
            if pad:
                d.append(("padding", pad))
            d.append(("align-items", GRID_ALIGN.get(e["alignItems"], "start")))

    # typography
    if t in ("text", "button", "input", "checkbox", "select"):
        fam = FONTS.get(e["font"], FONTS["Inter"])[0]
        d += [("font-family", fam), ("font-size", px(e["fontSize"])), ("font-weight", str(int(e["fontWeight"]))),
              ("line-height", fmt(e["lineHeight"]))]
        if e["letterSpacing"]:
            d.append(("letter-spacing", px(e["letterSpacing"])))
        d.append(("color", color(e["color"], "#111111")))
        if e["italic"]:
            d.append(("font-style", "italic"))
        deco = " ".join(x for x, on in (("underline", e["underline"]), ("line-through", e["strike"])) if on)
        if deco:
            d.append(("text-decoration", deco))
    if t == "text":
        al = e["align"] if e["align"] in TEXT_ALIGN_FLEX else "left"
        d += [("text-align", al), ("white-space", "pre-wrap"), ("word-wrap", "break-word")]
    elif t == "button":
        al = e["align"] if e["align"] in TEXT_ALIGN_FLEX else "center"
        d += [("display", "flex"), ("align-items", "center"), ("justify-content", TEXT_ALIGN_FLEX[al]),
              ("text-align", al), ("white-space", "pre-wrap"), ("padding", "0 12px"), ("cursor", "pointer")]
        if e["link"] and e["link"].get("kind") == "url":
            d.append(("text-decoration", "none"))
    elif t == "input":
        d += [("display", "flex"), ("align-items", "center"), ("padding", "0 12px")]
    elif t == "select":
        d += [("padding", "0 12px")]
    elif t == "checkbox":
        d += [("display", "flex"), ("align-items", "center"), ("gap", "8px")]
    elif t == "icon":
        d.append(("display", "block"))
        d.append(("color", color(e["color"], "#111111")))
    return d


# --------------------------------------------------------------------------
# Tree building
# --------------------------------------------------------------------------
class Builder:
    def __init__(self, els, opts):
        self.opts = opts
        self.resp = opts.get("mode") == "responsive"
        self.by_parent = defaultdict(list)
        self.ids = {e["id"] for e in els}
        for e in els:
            self.by_parent[e["parent"]].append(e)
        self.used = defaultdict(int)
        self.cls_of = {}
        self.h1_used = False
        self.els = els

    def unique(self, base):
        self.used[base] += 1
        n = self.used[base]
        return base if n == 1 else f"{base}-{n}"

    def roots(self):
        return [e for e in self.els if not e["parent"] or e["parent"] not in self.ids]

    def assign_classes(self, e):
        if e.get("visible") is False:
            return
        base = slug(e.get("name") or e["type"])
        self.cls_of[e["id"]] = self.unique(base)
        for c in self.by_parent.get(e["id"], []):
            self.assign_classes(c)

    def node(self, e, parent):
        if e.get("visible") is False:
            return None
        t = e["type"]
        n = dict(e=e, cls=self.cls_of[e["id"]], tag="div", attrs={}, kids=[], decls=css_decls(e, parent, self.resp),
                 media=[], text=None, void=False, wrap_href=None, wrap_goto=None)
        if t == "frame":
            n["tag"] = "section" if parent is None else "div"
        elif t == "text":
            size, wt = e["fontSize"], e["fontWeight"]
            if size >= 36 and not self.h1_used:
                n["tag"], self.h1_used = "h1", True
            elif size >= 24 and wt >= 600:
                n["tag"] = "h2"
            else:
                n["tag"] = "p"
            n["text"] = e["text"]
        elif t == "button":
            n["tag"] = "button"
            n["attrs"]["type"] = "button"
            n["text"] = e["text"]
        elif t == "image":
            url = safe_url(e["url"])
            if url:
                n["tag"], n["void"] = "img", True
                n["attrs"].update(src=url, alt=e.get("name", ""))
            else:
                n["attrs"]["role"] = "img"
        elif t == "input":
            n["tag"], n["void"] = "input", True
            n["attrs"].update(type="text", placeholder=e["placeholder"])
        elif t == "checkbox":
            n["tag"] = "label"
        elif t == "select":
            n["tag"] = "select"
        elif t == "icon":
            n["tag"] = "svg"
        link = e.get("link") if isinstance(e.get("link"), dict) else None
        if link:
            if link.get("kind") == "url" and safe_href(link.get("value")):
                n["wrap_href"] = safe_href(link["value"])
            elif link.get("kind") == "frame" and link.get("value") in self.cls_of:
                n["wrap_goto"] = self.cls_of[link["value"]]
        for c in self.by_parent.get(e["id"], []):
            child = self.node(c, e)
            if child:
                n["kids"].append(child)
        return n


def display_of(e):
    if e["layout"] in ("row", "column") and is_auto(e):
        return "flex"
    if e["layout"] == "grid" and is_auto(e):
        return "grid"
    return "block"


def build(els, opts):
    """Return (roots, meta) where roots is a list of node dicts."""
    b = Builder(els, opts)
    root_els = b.roots()
    for r in root_els:
        b.assign_classes(r)
    roots = [b.node(r, None) for r in root_els if r.get("visible") is not False]
    roots = [r for r in roots if r]
    goto_used = any_goto(roots)
    frames = [r for r in roots if r["e"]["type"] == "frame"]
    proto = goto_used and bool(frames)
    start = opts.get("start")
    if proto:
        start_node = next((f for f in frames if f["e"]["id"] == start), frames[0])
        for f in frames:
            f["attrs"]["data-frame"] = f["cls"]
            f["extra_cls"] = ["ff-frame"] + (["ff-active"] if f is start_node else [])
    elif opts.get("breakpoints") and len(frames) > 1:
        apply_breakpoints(frames)
    meta = dict(proto=proto, fonts=sorted({e["font"] for e in els if e["type"] in
                                          ("text", "button", "input", "checkbox", "select")}))
    return roots, meta


def any_goto(nodes):
    for n in nodes:
        if n["wrap_goto"] or any_goto(n["kids"]):
            return True
    return False


def apply_breakpoints(frames):
    frames.sort(key=lambda f: -f["e"]["w"])
    bps = []
    for i, f in enumerate(frames):
        w = f["e"]["w"]
        bp = 767 if w < 600 else 1023 if w < 1100 else int(w) - 1
        if bps and bp >= bps[-1]:
            bp = bps[-1] - 1
        bps.append(bp)
    n = len(frames)
    for i, f in enumerate(frames):
        disp = display_of(f["e"])
        lo = bps[i + 1] + 1 if i + 1 < n else 0
        hi = bps[i] if i > 0 else None
        if i == 0:
            f["media"].append(({"max": bps[1]}, [("display", "none")]))
        else:
            f["decls"].append(("display", "none"))
            cond = {"max": hi}
            if lo:
                cond["min"] = lo
            f["media"].append((cond, [("display", disp)]))


# --------------------------------------------------------------------------
# CSS output
# --------------------------------------------------------------------------
def walk(nodes):
    for n in nodes:
        yield n
        yield from walk(n["kids"])


def decl_block(selector, decls, ind=""):
    # a later duplicate property wins, so keep only the last of each
    seen, out = set(), []
    for p, v in reversed(decls):
        if p in seen:
            continue
        seen.add(p)
        out.append((p, v))
    out.reverse()
    body = "".join(f"{ind}  {p}: {v};\n" for p, v in out)
    return f"{ind}{selector} {{\n{body}{ind}}}\n"


def media_query(cond):
    parts = []
    if cond.get("min") is not None:
        parts.append(f"(min-width: {cond['min']}px)")
    if cond.get("max") is not None:
        parts.append(f"(max-width: {cond['max']}px)")
    return " and ".join(parts)


def css_text(roots, extra_decls=None):
    out = []
    medias = []
    for n in walk(roots):
        out.append(decl_block("." + n["cls"], n["decls"]))
        for cond, decls in n["media"]:
            medias.append((cond, n["cls"], decls))
    for cond, cls, decls in medias:
        out.append(f"@media {media_query(cond)} {{\n" + decl_block("." + cls, decls, "  ") + "}\n")
    return "\n".join(out)


# --------------------------------------------------------------------------
# HTML / JSX rendering
# --------------------------------------------------------------------------
def esc(s):
    return html.escape(str(s), quote=True)


def class_attr(n, extra=""):
    cls = [n["cls"]] + n.get("extra_cls", [])
    if n["wrap_goto"]:
        cls.append("ff-link")
    if extra:
        cls.append(extra)
    return " ".join(cls)


def svg_open(n):
    return ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"')


def inner_of(n):
    e = n["e"]
    t = e["type"]
    if t == "checkbox":
        chk = " checked" if e["checked"] else ""
        return f'<input type="checkbox"{chk}><span>{esc(e["text"])}</span>'
    if t == "select":
        opts = [o.strip() for o in str(e["text"]).splitlines() if o.strip()] or ["Select"]
        return "".join(f"<option>{esc(o)}</option>" for o in opts)
    if t == "icon":
        return ICONS.get(e["icon"], ICONS["star"])
    return None


def html_node(n, ind, tw=None):
    """Render a node. `tw` is an optional function decls->class string (Tailwind/Bootstrap)."""
    pad = "  " * ind
    e = n["e"]
    attrs = dict(n["attrs"])
    cls = class_attr(n)
    if tw:
        cls = tw(n, cls)
    a = f' class="{esc(cls)}"'
    for k, v in attrs.items():
        a += f' {k}="{esc(v)}"'
    if n["wrap_goto"]:
        a += f' data-goto="{esc(n["wrap_goto"])}"'
    if n["void"]:
        s = f"{pad}<{n['tag']}{a}>"
    elif e["type"] == "icon":
        s = f"{pad}{svg_open(n)}{a}>{inner_of(n)}</svg>"
    else:
        inner = inner_of(n)
        if n["kids"]:
            body = "\n".join(html_node(k, ind + 1, tw) for k in n["kids"])
            s = f"{pad}<{n['tag']}{a}>\n{body}\n{pad}</{n['tag']}>"
        else:
            if inner is None:
                inner = esc(n["text"]) if n["text"] is not None else ""
            s = f"{pad}<{n['tag']}{a}>{inner}</{n['tag']}>"
    if n["wrap_href"]:
        s = (f'{pad}<a class="ff-a" href="{esc(n["wrap_href"])}" target="_blank" rel="noopener">\n'
             f'{s}\n{pad}</a>')
    return s


def google_fonts_link(fonts):
    fams = [FONTS[f][1] for f in fonts if f in FONTS and FONTS[f][1]]
    if not fams:
        return ""
    href = "https://fonts.googleapis.com/css2?" + "&".join("family=" + f for f in fams) + "&display=swap"
    return ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
            f'<link rel="stylesheet" href="{href}">\n')


def page_head(title, meta, extra=""):
    return ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f'<title>{esc(title)}</title>\n{google_fonts_link(meta["fonts"])}{extra}')


def body_css(opts):
    if opts.get("mode") == "responsive":
        return "body { margin: 0; background: #ffffff; }\n"
    return "body { margin: 0; background: #e5e7eb; padding: 16px; overflow-x: auto; }\n"


def proto_script(meta):
    return f"<script>\n{PROTO_JS}\n</script>\n" if meta["proto"] else ""


def render_html(name, roots, meta, opts, separate_css):
    css = BASE_CSS + body_css(opts) + "\n" + css_text(roots)
    body = "\n".join(html_node(r, 1) for r in roots)
    if separate_css:
        head = page_head(name, meta, '<link rel="stylesheet" href="style.css">\n')
        page = f"{head}</head>\n<body>\n{body}\n{proto_script(meta)}</body>\n</html>\n"
        return page, css
    head = page_head(name, meta, f"<style>\n{css}</style>\n")
    return f"{head}</head>\n<body>\n{body}\n{proto_script(meta)}</body>\n</html>\n", css


# ---- Tailwind -------------------------------------------------------------
def tw_one(prop, val):
    v = str(val)
    simple = {
        ("position", "absolute"): "absolute", ("position", "relative"): "relative",
        ("display", "flex"): "flex", ("display", "grid"): "grid", ("display", "block"): "block",
        ("display", "none"): "hidden",
        ("flex-direction", "column"): "flex-col", ("flex-direction", "row"): "flex-row",
        ("flex-wrap", "wrap"): "flex-wrap",
        ("align-items", "flex-start"): "items-start", ("align-items", "center"): "items-center",
        ("align-items", "flex-end"): "items-end", ("align-items", "stretch"): "items-stretch",
        ("justify-content", "flex-start"): "justify-start", ("justify-content", "center"): "justify-center",
        ("justify-content", "flex-end"): "justify-end", ("justify-content", "space-between"): "justify-between",
        ("overflow", "hidden"): "overflow-hidden", ("cursor", "pointer"): "cursor-pointer",
        ("flex-shrink", "0"): "shrink-0", ("align-self", "stretch"): "self-stretch",
        ("width", "100%"): "w-full", ("height", "100%"): "h-full",
        ("width", "fit-content"): "w-fit", ("height", "fit-content"): "h-fit",
        ("box-sizing", "border-box"): "", ("border-radius", "50%"): "rounded-full",
        ("font-style", "italic"): "italic", ("text-align", "center"): "text-center",
        ("text-align", "left"): "text-left", ("text-align", "right"): "text-right",
        ("flex", "1 1 0%"): "flex-1",
    }
    if (prop, v) in simple:
        return simple[(prop, v)]
    arb = {"left": "left", "top": "top", "width": "w", "height": "h", "gap": "gap", "max-width": "max-w",
           "min-width": "min-w", "min-height": "min-h", "opacity": "opacity"}
    if prop in arb:
        return f"{arb[prop]}-[{v.replace(' ', '_')}]"
    if prop == "padding":
        parts = v.split()
        if len(parts) == 2:
            return f"py-[{parts[0]}] px-[{parts[1]}]"
        return f"p-[{v.replace(' ', '_')}]"
    if prop == "margin":
        parts = v.split()
        if len(parts) == 2 and parts[1] == "auto":
            return f"my-[{parts[0]}] mx-auto"
    return f"[{prop}:{v.replace(' ', '_')}]"


def tw_classes(decls, prefix=""):
    seen, items = set(), []
    for p, v in reversed(decls):
        if p in seen:
            continue
        seen.add(p)
        items.append((p, v))
    items.reverse()
    out = []
    for p, v in items:
        for c in tw_one(p, v).split():
            out.append(prefix + c)
    return out


def tw_prefix(cond):
    p = ""
    if cond.get("min") is not None:
        p += f"min-[{cond['min']}px]:"
    if cond.get("max") is not None:
        p += f"max-[{cond['max']}px]:"
    return p


def tailwind_cls(n, _cls):
    classes = tw_classes(n["decls"])
    for cond, decls in n["media"]:
        classes += tw_classes(decls, tw_prefix(cond))
    extra = n.get("extra_cls", []) + (["ff-link"] if n["wrap_goto"] else [])
    return " ".join(classes + extra)


def render_tailwind(name, roots, meta, opts):
    extra = ('<script src="https://cdn.tailwindcss.com"></script>\n'
             "<style>\n" + BASE_CSS.replace("*, *::before, *::after { box-sizing: border-box; }\n", "") +
             body_css(opts) + "</style>\n")
    head = page_head(name, meta, extra)
    body = "\n".join(html_node(r, 1, tailwind_cls) for r in roots)
    return f"{head}</head>\n<body>\n{body}\n{proto_script(meta)}</body>\n</html>\n"


# ---- Bootstrap ------------------------------------------------------------
BS_MAP = {
    ("position", "relative"): "position-relative", ("position", "absolute"): "position-absolute",
    ("display", "flex"): "d-flex", ("display", "grid"): "d-grid",
    ("flex-direction", "column"): "flex-column", ("flex-wrap", "wrap"): "flex-wrap",
    ("align-items", "flex-start"): "align-items-start", ("align-items", "center"): "align-items-center",
    ("align-items", "flex-end"): "align-items-end", ("align-items", "stretch"): "align-items-stretch",
    ("justify-content", "flex-start"): "justify-content-start", ("justify-content", "center"): "justify-content-center",
    ("justify-content", "flex-end"): "justify-content-end", ("justify-content", "space-between"): "justify-content-between",
    ("overflow", "hidden"): "overflow-hidden", ("flex-shrink", "0"): "flex-shrink-0",
    ("border-radius", "50%"): "rounded-circle", ("margin", "0 auto"): "mx-auto",
    ("font-weight", "700"): "fw-bold", ("font-weight", "600"): "fw-semibold",
    ("font-weight", "500"): "fw-medium", ("font-weight", "400"): "fw-normal",
}


def bootstrap_split(n):
    """Split decls into Bootstrap utility classes + remaining custom declarations."""
    seen, items = set(), []
    for p, v in reversed(n["decls"]):
        if p in seen:
            continue
        seen.add(p)
        items.append((p, v))
    items.reverse()
    classes, rest = [], []
    # Bootstrap's d-* utilities are !important and would defeat our own show/hide rules
    keep_display = bool(n["media"] or n.get("extra_cls"))
    for p, v in items:
        if (p, v) in BS_MAP and not (p == "display" and keep_display):
            classes.append(BS_MAP[(p, v)])
        else:
            rest.append((p, v))
    return classes, rest


def render_bootstrap(name, roots, meta, opts):
    css_parts = []
    for r in walk(roots):
        classes, rest = bootstrap_split(r)
        r["bs"] = classes
        r["decls"] = rest
        css_parts.append(decl_block("." + r["cls"], rest))
    medias = []
    for r in walk(roots):
        for cond, decls in r["media"]:
            medias.append(f"@media {media_query(cond)} {{\n" + decl_block("." + r["cls"], decls, "  ") + "}\n")
    css = (BASE_CSS.replace("*, *::before, *::after { box-sizing: border-box; }\n", "") + body_css(opts) + "\n"
           + "\n".join(css_parts + medias))

    def bs_cls(n, cls):
        return cls + " " + " ".join(n.get("bs", []))

    head = page_head(name, meta,
                     '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">\n'
                     '<link rel="stylesheet" href="style.css">\n')
    body = "\n".join(html_node(r, 1, bs_cls) for r in roots)
    page = f"{head}</head>\n<body>\n{body}\n{proto_script(meta)}</body>\n</html>\n"
    return page, css


# ---- React ----------------------------------------------------------------
def jsx_node(n, ind, proto):
    pad = "  " * ind
    e = n["e"]
    cls_expr = None
    classes = [n["cls"]] + ([c for c in n.get("extra_cls", []) if c not in ("ff-active",)])
    if n["wrap_goto"]:
        classes.append("ff-link")
    cls_attr = f'className="{esc(" ".join(classes))}"'
    if proto and "ff-frame" in n.get("extra_cls", []):
        cls_attr = f'className={{"{esc(" ".join(classes))}" + (active === "{n["cls"]}" ? " ff-active" : "")}}'
    a = " " + cls_attr
    for k, v in n["attrs"].items():
        if k == "data-frame":
            continue
        a += f' {k}="{esc(v)}"'
    if n["wrap_goto"]:
        a += f' onClick={{() => setActive("{esc(n["wrap_goto"])}")}}'
    tag = n["tag"]
    if n["void"]:
        s = f"{pad}<{tag}{a} />"
    elif e["type"] == "icon":
        s = (f'{pad}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" '
             f'strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"{a}>{ICONS.get(e["icon"], ICONS["star"])}</svg>')
    elif e["type"] == "checkbox":
        chk = " defaultChecked" if e["checked"] else ""
        s = f'{pad}<label{a}><input type="checkbox"{chk} /><span>{{{json.dumps(e["text"])}}}</span></label>'
    elif e["type"] == "select":
        opts = [o.strip() for o in str(e["text"]).splitlines() if o.strip()] or ["Select"]
        s = f"{pad}<select{a}>" + "".join(f"<option>{{{json.dumps(o)}}}</option>" for o in opts) + "</select>"
    elif n["kids"]:
        body = "\n".join(jsx_node(k, ind + 1, proto) for k in n["kids"])
        s = f"{pad}<{tag}{a}>\n{body}\n{pad}</{tag}>"
    else:
        inner = "{" + json.dumps(n["text"]) + "}" if n["text"] else ""
        s = f"{pad}<{tag}{a}>{inner}</{tag}>"
    if n["wrap_href"]:
        s = (f'{pad}<a className="ff-a" href="{esc(n["wrap_href"])}" target="_blank" rel="noopener noreferrer">\n'
             f"{s}\n{pad}</a>")
    return s


def render_react(name, roots, meta, opts):
    css = BASE_CSS + body_css(opts) + "\n" + css_text(roots)
    frames = [r for r in roots if "ff-frame" in r.get("extra_cls", [])]
    proto = meta["proto"]
    start = next((f["cls"] for f in frames if "ff-active" in f["extra_cls"]), None)
    body = "\n".join(jsx_node(r, 3, proto) for r in roots)
    comp = slug(name).replace("-", " ").title().replace(" ", "") or "Design"
    if not comp[0].isalpha():
        comp = "Design"
    imp = "import { useState } from 'react';\n" if proto else ""
    state = f'  const [active, setActive] = useState("{start}");\n' if proto else ""
    jsx = (f"{imp}import './design.css';\n\n"
           f"// Generated by FrameForge\nexport default function {comp}() {{\n{state}  return (\n    <>\n{body}\n    </>\n  );\n}}\n")
    return comp, jsx, css


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------
FORMATS = ("html", "html-css", "react", "tailwind", "bootstrap")


def export_project(name, data, fmt_name="html", opts=None):
    """Return (bytes, mimetype, filename)."""
    opts = dict(opts or {})
    els, page_id = prepare(data, opts.get("page"), opts.get("frame"))
    roots, meta = build(els, opts)
    base = re.sub(r"[^a-zA-Z0-9_-]+", "-", name).strip("-") or "design"
    if fmt_name == "html":
        page, _ = render_html(name, roots, meta, opts, separate_css=False)
        return page.encode("utf-8"), "text/html", base + ".html"
    if fmt_name == "tailwind":
        page = render_tailwind(name, roots, meta, opts)
        return page.encode("utf-8"), "text/html", base + "-tailwind.html"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        if fmt_name == "html-css":
            page, css = render_html(name, roots, meta, opts, separate_css=True)
            z.writestr("index.html", page)
            z.writestr("style.css", css)
        elif fmt_name == "bootstrap":
            page, css = render_bootstrap(name, roots, meta, opts)
            z.writestr("index.html", page)
            z.writestr("style.css", css)
        elif fmt_name == "react":
            comp, jsx, css = render_react(name, roots, meta, opts)
            z.writestr(f"{comp}.jsx", jsx)
            z.writestr("design.css", css)
            z.writestr("README.txt", f"Import the component:\n\n  import {comp} from './{comp}';\n\n"
                                     "design.css is imported by the component. Google Fonts are not bundled; "
                                     "add the font <link> from your index.html if you use custom fonts.\n")
        else:
            raise ValueError("Unknown format")
    suffix = {"html-css": "", "bootstrap": "-bootstrap", "react": "-react"}[fmt_name]
    return buf.getvalue(), "application/zip", f"{base}{suffix}.zip"
