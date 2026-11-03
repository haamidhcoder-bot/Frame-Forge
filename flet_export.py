"""Flet (Python) code generation for FrameForge designs.

Maps a design onto Flet 1.x controls:
    frame/group + auto layout  -> Container(Row | Column)      (grid -> Column of Rows)
    frame/group, free layout   -> Container(Stack)  (children positioned with left/top)
    rect / ellipse / line      -> Container
    polygon                    -> flet.canvas path
    text, button, input, checkbox, select, image, icon -> Text, Button, TextField, Checkbox, Dropdown, Image, Icon
Each root frame becomes a screen; links between frames become `show("screen")` calls.
Buttons and form fields get empty event-handler stubs at the top of the file for your own logic.
"""
import base64
import json
import math
import re
import urllib.parse

from exporter import (HEX_RE, RGB_RE, color, fmt, is_auto, num, prepare, safe_href, slug)
from icons import BI_PREFIX, ICONS, icon_inner, is_bi

# FrameForge icon -> Material icon (ft.Icons.<NAME>); anything else is drawn as an SVG image
MATERIAL = {
    "home": "HOME", "search": "SEARCH", "user": "PERSON", "heart": "FAVORITE", "star": "STAR", "menu": "MENU",
    "check": "CHECK", "close": "CLOSE", "arrow-right": "ARROW_FORWARD", "mail": "MAIL", "phone": "PHONE",
    "settings": "SETTINGS", "cart": "SHOPPING_CART", "bell": "NOTIFICATIONS", "play": "PLAY_ARROW", "plus": "ADD",
    "chevron-down": "KEYBOARD_ARROW_DOWN", "globe": "PUBLIC", "lock": "LOCK", "camera": "CAMERA_ALT", "zap": "BOLT",
    "shield": "SHIELD", "layers": "LAYERS", "code": "CODE", "chart": "BAR_CHART", "trash": "DELETE", "edit": "EDIT",
    "download": "DOWNLOAD", "upload": "UPLOAD", "eye": "VISIBILITY", "calendar": "CALENDAR_MONTH", "clock": "ACCESS_TIME",
    "map-pin": "LOCATION_ON", "link": "LINK", "share": "SHARE", "bookmark": "BOOKMARK", "filter": "FILTER_ALT",
    "grid": "GRID_VIEW", "list": "LIST", "image": "IMAGE", "video": "VIDEOCAM", "mic": "MIC", "wifi": "WIFI",
    "sun": "LIGHT_MODE", "moon": "DARK_MODE", "cloud": "CLOUD", "info": "INFO", "alert": "WARNING", "help": "HELP",
    "thumbs-up": "THUMB_UP", "message": "CHAT_BUBBLE", "send": "SEND", "gift": "CARD_GIFTCARD", "tag": "LOCAL_OFFER",
    "credit-card": "CREDIT_CARD", "folder": "FOLDER", "file": "INSERT_DRIVE_FILE", "copy": "CONTENT_COPY",
    "refresh": "REFRESH", "minus": "REMOVE", "more": "MORE_HORIZ", "arrow-left": "ARROW_BACK", "arrow-up": "ARROW_UPWARD",
    "arrow-down": "ARROW_DOWNWARD", "chevron-right": "CHEVRON_RIGHT", "chevron-left": "CHEVRON_LEFT",
    "chevron-up": "KEYBOARD_ARROW_UP", "award": "EMOJI_EVENTS", "briefcase": "WORK", "smile": "SENTIMENT_SATISFIED",
    "trending-up": "TRENDING_UP", "users": "GROUP", "book": "MENU_BOOK",
}
FONT_FAMILY = {"Georgia": "Georgia", "Mono": "Courier New"}
MAIN = {"start": "START", "center": "CENTER", "end": "END", "between": "SPACE_BETWEEN"}
CROSS = {"start": "START", "center": "CENTER", "end": "END", "stretch": "STRETCH"}
PAD = "    "


def rgba(c):
    """('#rrggbb', alpha) for a FrameForge colour string."""
    c = color(c, "#000000")
    if c == "transparent":
        return "#000000", 0.0
    m = HEX_RE.match(c)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(ch * 2 for ch in h)
        if len(h) == 6:
            h += "ff"
        return "#" + h[:6].lower(), int(h[6:8], 16) / 255
    m = RGB_RE.match(c)
    if m:
        r, g, b = (max(0, min(255, round(float(m.group(i))))) for i in (1, 2, 3))
        return "#%02x%02x%02x" % (r, g, b), float(m.group(4) if m.group(4) is not None else 1)
    return "#000000", 1.0


def fcolor(c, opacity=1.0):
    hx, a = rgba(c)
    a *= opacity
    if a <= 0.004:
        return "ft.Colors.TRANSPARENT"
    return repr(hx) if a >= 0.996 else f"ft.Colors.with_opacity({fmt(round(a, 3))}, {hx!r})"


def ident(text, fallback="el"):
    s = re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_") or fallback
    return "_" + s if s[0].isdigit() else s


def indent(text):
    """Indent every line after the first (the first line is already positioned by the caller)."""
    return text.replace("\n", "\n" + PAD)


def render(name, args, ind=0):
    """`name(arg, key=value, ...)` on one line when short, otherwise one argument per line.
    Nested values are built relative to column 0 and re-indented here, so callers never track depth."""
    parts = [(f"{k}={v}" if k else v) for k, v in args]
    flat = f"{name}({', '.join(parts)})"
    if "\n" not in flat and len(flat) <= 88:
        return flat
    return name + "(\n" + "".join(f"{PAD}{indent(p)},\n" for p in parts) + ")"


def lst(items, ind=0):
    if not items:
        return "[]"
    return "[\n" + "".join(f"{PAD}{indent(i)},\n" for i in items) + "]"


class Gen:
    def __init__(self, els, name, embed_assets):
        self.name = name
        self.by_parent = {}
        for e in els:
            self.by_parent.setdefault(e.get("parent"), []).append(e)
        self.ids = {e["id"] for e in els}
        self.embed_assets = embed_assets            # True: images as base64 constants; False: files under assets/
        self.assets = {}                            # file name -> bytes
        self.asset_names = {}                       # dedupe by content
        self.svgs = {}                              # constant name -> svg text
        self.handlers = {}                          # function name -> description
        self.screens = {}                           # frame id -> screen key
        self.notes = set()
        self.uses_canvas = False
        self.skipped = 0

    # ---- bookkeeping -------------------------------------------------
    def handler(self, kind, e):
        base = f"{kind}_{ident(e.get('name') or e['type'])}"
        n, i = base, 2
        while n in self.handlers:
            n, i = f"{base}_{i}", i + 1
        self.handlers[n] = (kind, e.get("name") or e["type"])
        return n

    def svg_const(self, svg):
        for k, v in self.svgs.items():
            if v == svg:
                return k
        k = f"SVG_{len(self.svgs) + 1}"
        self.svgs[k] = svg
        return k

    def image_src(self, url):
        """Python expression for an Image src, or None when the URL is not usable."""
        url = (url or "").strip()
        if re.match(r"^https?://", url, re.I):
            return repr(url)
        m = re.match(r"^data:(image/[\w.+-]+)((?:;[\w=.+-]+)*),(.*)$", url, re.S | re.I)
        if not m:
            return None
        mime, b64, body = m.group(1).lower(), ";base64" in m.group(2).lower(), m.group(3)
        try:
            raw = base64.b64decode(body) if b64 else urllib.parse.unquote_to_bytes(body)
        except ValueError:
            return None
        ext = {"image/jpeg": "jpg", "image/svg+xml": "svg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}.get(mime, "png")
        key = (ext, raw)
        if key not in self.asset_names:
            self.asset_names[key] = f"img_{len(self.asset_names) + 1}"
            self.assets[f"{self.asset_names[key]}.{ext}"] = raw
        stem = self.asset_names[key]
        return f'ASSETS["{stem}"]' if self.embed_assets else repr(f"{stem}.{ext}")

    # ---- shared argument builders -----------------------------------
    def parent_kind(self, parent):
        return parent["layout"] if parent is not None and is_auto(parent) else None

    def size_args(self, e, parent, text_like=False):
        pk = self.parent_kind(parent)
        sw, sh = e["sizeW"], e["sizeH"]
        can_hug = is_auto(e) or e["type"] in ("text", "button")
        if sw == "fill" and not pk:
            sw = "fixed"
        if sh == "fill" and not pk:
            sh = "fixed"
        if sw == "hug" and not can_hug:
            sw = "fixed"
        if sh == "hug" and not can_hug:
            sh = "fixed"
        args = []
        if sw == "fixed":
            args.append(("width", fmt(e["w"])))
        elif sw == "fill":
            args.append(("expand", "True") if pk == "row" else ("width", 'float("inf")'))
        if not text_like:
            if sh == "fixed":
                args.append(("height", fmt(e["h"])))
            elif sh == "fill":
                if pk == "column":
                    if ("expand", "True") not in args:
                        args.append(("expand", "True"))
                else:
                    args.append(("height", 'float("inf")'))
        return args

    def pos_args(self, e, parent):
        if parent is None or is_auto(parent):
            return []
        return [("left", fmt(e["x"])), ("top", fmt(e["y"]))]

    def fill_args(self, e):
        if e["type"] == "text":
            return []
        layers = [f for f in e["fills"] if isinstance(f, dict)]
        if not layers:
            return []
        if len(layers) > 1:
            self.notes.add("Elements with several fills use only the top fill.")
        f = layers[0]
        op = min(1.0, max(0.0, num(f.get("opacity"), 1)))
        t = f.get("type", "solid")
        if t == "linear":
            th = math.radians(num(f.get("angle"), 90))
            sx, sy = math.sin(th), -math.cos(th)
            return [("gradient", render("ft.LinearGradient", [
                ("begin", f"ft.Alignment({fmt(round(-sx, 3))}, {fmt(round(-sy, 3))})"),
                ("end", f"ft.Alignment({fmt(round(sx, 3))}, {fmt(round(sy, 3))})"),
                ("colors", f"[{fcolor(f.get('color'), op)}, {fcolor(f.get('color2'), op)}]")], 0))]
        if t == "radial":
            return [("gradient", render("ft.RadialGradient", [
                ("center", "ft.Alignment(0, 0)"), ("radius", "0.7"),
                ("colors", f"[{fcolor(f.get('color'), op)}, {fcolor(f.get('color2'), op)}]")], 0))]
        return [("bgcolor", fcolor(f.get("color", "#d9d9d9"), op))]

    def stroke_of(self, e):
        s = [s for s in e["strokes"] if num(s.get("width")) > 0]
        if len(s) > 1:
            self.notes.add("Only the first stroke of an element is exported.")
        return s[0] if s else None

    def shadow_args(self, e):
        out = []
        for ef in e["effects"]:
            if ef.get("type") == "drop":
                out.append(render("ft.BoxShadow", [
                    ("spread_radius", fmt(num(ef.get("spread")))), ("blur_radius", fmt(num(ef.get("blur")))),
                    ("color", fcolor(ef.get("color") or "rgba(0,0,0,.25)")),
                    ("offset", f"ft.Offset({fmt(num(ef.get('x')))}, {fmt(num(ef.get('y')))})")], 0))
            elif ef.get("type") in ("inner", "blur", "bgblur"):
                self.notes.add("Inner shadows and blur effects are not exported.")
        if not out:
            return []
        return [("shadow", out[0] if len(out) == 1 else "[" + ", ".join(out) + "]")]

    def radius_value(self, e):
        if e["type"] == "ellipse":
            return min(e["w"], e["h"]) / 2 if abs(e["w"] - e["h"]) < 2 else min(e["w"], e["h"]) / 2
        return e["radius"]

    def link_action(self, e):
        """('url', '...') | ('click', 'lambda ...') | None"""
        lk = e.get("link") if isinstance(e.get("link"), dict) else None
        if not lk:
            return None
        if lk.get("kind") == "url" and safe_href(lk.get("value")):
            return ("url", repr(safe_href(lk["value"])))
        if lk.get("kind") == "frame" and lk.get("value") in self.screens:
            return ("click", f'lambda e: show("{self.screens[lk["value"]]}")')
        return None

    # ---- element builders -------------------------------------------
    def node(self, e, parent, ind):
        if not e.get("visible", True):
            return None
        t = e["type"]
        act = self.link_action(e)
        if t in ("frame", "group", "rect", "ellipse", "line"):
            return self.container(e, parent, ind, act)
        inner_args = self.leaf_args(e, parent)
        if inner_args is None:
            self.skipped += 1
            return None
        name, args = inner_args
        if not act or t == "button":
            if act and t == "button":
                args += [("url", act[1])] if act[0] == "url" else [("on_click", act[1])]
            return render(name, args + self.pos_args(e, parent), ind)
        # wrap non-clickable controls so the link works; the wrapper takes over the position
        wrap = self.pos_args(e, parent)
        if ("expand", "True") in args:
            args.remove(("expand", "True"))
            wrap.append(("expand", "True"))
        wrap = [("content", render(name, args, ind + 1))] + wrap
        wrap.append(("url", act[1]) if act[0] == "url" else ("on_click", act[1]))
        return render("ft.Container", wrap, ind)

    def box_args(self, e, parent):
        args = self.pos_args(e, parent) + self.size_args(e, parent)
        args += self.fill_args(e)
        s = self.stroke_of(e)
        if s:
            args.append(("border", f"ft.Border.all({fmt(num(s['width']))}, {fcolor(s.get('color'))})"))
        r = self.radius_value(e)
        if r > 0:
            args.append(("border_radius", f"ft.BorderRadius.all({fmt(round(r, 2))})"))
        args += self.shadow_args(e)
        if e["opacity"] < 1:
            args.append(("opacity", fmt(e["opacity"])))
        return args

    def container(self, e, parent, ind, act):
        t = e["type"]
        args = self.box_args(e, parent)
        kids = [c for c in self.by_parent.get(e["id"], []) if c.get("visible", True)]
        if t in ("frame", "group"):
            if e["clip"]:
                args.append(("clip_behavior", "ft.ClipBehavior.ANTI_ALIAS"))
            body = None
            if is_auto(e):
                pad = []
                if e["padX"] or e["padY"]:
                    pad.append(("padding", f"ft.Padding.symmetric(horizontal={fmt(e['padX'])}, vertical={fmt(e['padY'])})"))
                body = self.auto_body(e, kids, ind + 1)
                args += pad
            elif kids:
                items = [x for x in (self.node(c, e, ind + 3) for c in kids) if x]
                st = [("controls", lst(items, ind + 2)), ("width", fmt(e["w"])), ("height", fmt(e["h"]))]
                body = render("ft.Stack", st, ind + 1)
            if body:
                args.insert(0, ("content", body))
        if act:
            args.append(("url", act[1]) if act[0] == "url" else ("on_click", act[1]))
        return render("ft.Container", args, ind)

    def auto_body(self, e, kids, ind):
        lay = e["layout"]
        gap = fmt(e["gap"])
        if lay == "grid":
            cols = max(1, e["cols"])
            rows = []
            for i in range(0, len(kids), cols):
                chunk = kids[i:i + cols]
                cells = []
                for c in chunk:
                    x = self.node(c, e, ind + 4)
                    if x:
                        cells.append(f"ft.Container(content={x}, expand=1)" if "\n" not in x else x)
                cells += ["ft.Container(expand=1)"] * (cols - len(chunk))
                rows.append(render("ft.Row", [("controls", lst(cells, ind + 2)), ("spacing", gap),
                                              ("vertical_alignment", "ft.CrossAxisAlignment.START")], ind + 2))
            return render("ft.Column", [("controls", lst(rows, ind + 1)), ("spacing", gap)], ind)
        items = [x for x in (self.node(c, e, ind + 2) for c in kids) if x]
        main = f"ft.MainAxisAlignment.{MAIN.get(e['justify'], 'START')}"
        cross = f"ft.CrossAxisAlignment.{CROSS.get(e['alignItems'], 'START')}"
        if lay == "row":
            a = [("controls", lst(items, ind)), ("spacing", gap), ("alignment", main), ("vertical_alignment", cross)]
            if e["wrap"]:
                a += [("wrap", "True"), ("run_spacing", gap)]
            if e["sizeW"] == "hug":
                a.append(("tight", "True"))
            return render("ft.Row", a, ind)
        a = [("controls", lst(items, ind)), ("spacing", gap), ("alignment", main), ("horizontal_alignment", cross)]
        if e["sizeH"] == "hug":
            a.append(("tight", "True"))
        return render("ft.Column", a, ind)

    def font_args(self, e):
        a = [("size", fmt(e["fontSize"]))]
        w = int(max(100, min(900, round(e["fontWeight"] / 100) * 100)))
        if w != 400:
            a.append(("weight", f"ft.FontWeight.W_{w}"))
        a.append(("color", fcolor(e["color"])))
        if e["italic"]:
            a.append(("italic", "True"))
        fam = FONT_FAMILY.get(e["font"], e["font"])
        if e["font"] not in ("Inter",):
            a.append(("font_family", repr(fam)))
        return a

    def text_style(self, e):
        s = []
        if abs(e["lineHeight"] - 1.2) > 0.01 and e["lineHeight"] > 0:
            s.append(("height", fmt(round(e["lineHeight"], 2))))
        if e["letterSpacing"]:
            s.append(("letter_spacing", fmt(e["letterSpacing"])))
        deco = [d for d, on in (("UNDERLINE", e["underline"]), ("LINE_THROUGH", e["strike"])) if on]
        if deco:
            s.append(("decoration", "ft.TextDecoration." + deco[0]))
        return s

    def leaf_args(self, e, parent):
        t = e["type"]
        if t == "text":
            a = [(None, repr(str(e["text"])))] + self.font_args(e)
            al = e["align"] if e["align"] in ("left", "center", "right") else "left"
            if al != "left":
                a.append(("text_align", f"ft.TextAlign.{al.upper()}"))
            ts = self.text_style(e)
            if ts:
                a.append(("style", render("ft.TextStyle", ts, 0)))
            return "ft.Text", a + self.size_args(e, parent, text_like=True)
        if t == "button":
            label = render("ft.Text", [(None, repr(str(e["text"])))] + self.font_args(e)
                           + ([("style", render("ft.TextStyle", self.text_style(e), 0))] if self.text_style(e) else []), 0)
            fills = self.fill_args(e)
            bg = fills[0] if fills else ("bgcolor", "ft.Colors.TRANSPARENT")
            if bg[0] == "gradient":
                bg = ("bgcolor", fcolor([f for f in e["fills"] if isinstance(f, dict)][0].get("color")))
                self.notes.add("Gradient button fills are exported as a solid colour.")
            sty = [("elevation", "0"), ("shape", f"ft.RoundedRectangleBorder(radius={fmt(e['radius'])})"),
                   ("padding", "ft.Padding.symmetric(horizontal=12)")]
            s = self.stroke_of(e)
            if s:
                sty.append(("side", f"ft.BorderSide({fmt(num(s['width']))}, {fcolor(s.get('color'))})"))
            al = e["align"] if e["align"] in ("left", "center", "right") else "center"
            if al != "center":
                sty.append(("alignment", f"ft.Alignment({-1 if al == 'left' else 1}, 0)"))
            # transparent buttons use Flet's outlined / text buttons (a transparent filled Button renders grey)
            filled = bool(fills)
            cls = "ft.Button" if filled else ("ft.OutlinedButton" if s else "ft.TextButton")
            a = [("content", label)] + ([bg] if filled else []) + [("style", render("ft.ButtonStyle", sty, 0))]
            a += self.size_args(e, parent) + (self.shadow_args(e) if filled else [])
            if not (self.link_action(e)):
                a.append(("on_click", self.handler("on_click", e)))
            return cls, a
        if t == "input":
            s = self.stroke_of(e)
            fills = self.fill_args(e)
            a = [("hint_text", repr(str(e["placeholder"]))), ("text_size", fmt(e["fontSize"])), ("color", fcolor(e["color"]))]
            if fills and fills[0][0] == "bgcolor":
                a += [fills[0], ("filled", "True")]
            if s:
                a += [("border_color", fcolor(s.get("color"))), ("border_width", fmt(num(s["width"])))]
            else:
                a.append(("border", "ft.InputBorder.NONE"))
            if e["radius"]:
                a.append(("border_radius", fmt(e["radius"])))
            a.append(("content_padding", "ft.Padding.symmetric(horizontal=12)"))
            a += self.size_args(e, parent)
            a.append(("on_change", self.handler("on_change", e)))
            return "ft.TextField", a
        if t == "checkbox":
            lab = [("size", fmt(e["fontSize"])), ("color", fcolor(e["color"]))]
            a = [("label", repr(str(e["text"]))), ("value", "True" if e["checked"] else "False"),
                 ("label_style", render("ft.TextStyle", lab, 0))]
            a += self.size_args(e, parent, text_like=True)
            a.append(("on_change", self.handler("on_change", e)))
            return "ft.Checkbox", a
        if t == "select":
            opts = [o.strip() for o in str(e["text"]).splitlines() if o.strip()] or ["Select"]
            s = self.stroke_of(e)
            fills = self.fill_args(e)
            a = [("options", "[" + ", ".join(f"ft.DropdownOption({o!r})" for o in opts) + "]"), ("value", repr(opts[0])),
                 ("text_size", fmt(e["fontSize"])), ("color", fcolor(e["color"]))]
            if fills and fills[0][0] == "bgcolor":
                a += [("fill_color", fills[0][1]), ("filled", "True")]
            if s:
                a += [("border_color", fcolor(s.get("color"))), ("border_width", fmt(num(s["width"])))]
            if e["radius"]:
                a.append(("border_radius", fmt(e["radius"])))
            a += self.size_args(e, parent)
            a.append(("on_select", self.handler("on_select", e)))
            return "ft.Dropdown", a
        if t == "image":
            src = self.image_src(e["url"])
            if src is None:
                a = [("bgcolor", fcolor("#e5e7eb"))] + self.size_args(e, parent)
                if e["radius"]:
                    a.append(("border_radius", f"ft.BorderRadius.all({fmt(e['radius'])})"))
                return "ft.Container", a
            fit = {"cover": "COVER", "contain": "CONTAIN", "fill": "FILL"}.get(e["fit"], "COVER")
            a = [("src", src), ("fit", f"ft.BoxFit.{fit}")] + self.size_args(e, parent)
            if e["radius"]:
                a.append(("border_radius", f"ft.BorderRadius.all({fmt(e['radius'])})"))
            if e["opacity"] < 1:
                a.append(("opacity", fmt(e["opacity"])))
            return "ft.Image", a
        if t == "icon":
            size = fmt(min(e["w"], e["h"]))
            name = e["icon"]
            if name in MATERIAL and not is_bi(name):
                return "ft.Icon", [("icon", "ft.Icons." + MATERIAL[name]), ("color", fcolor(e["color"])), ("size", size)] \
                    + ([("opacity", fmt(e["opacity"]))] if e["opacity"] < 1 else [])
            hx, _ = rgba(e["color"])
            inner = icon_inner(name)
            if is_bi(name):
                svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="{hx}">{inner}</svg>'
            else:
                svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%s" stroke-width="2" '
                       'stroke-linecap="round" stroke-linejoin="round">%s</svg>' % (hx, inner))
            return "ft.Image", [("src", self.svg_const(svg)), ("width", fmt(e["w"])), ("height", fmt(e["h"]))] \
                + ([("opacity", fmt(e["opacity"]))] if e["opacity"] < 1 else [])
        if t == "polygon":
            self.uses_canvas = True
            n = e["sides"] * 2 if e["star"] else e["sides"]
            pts = []
            for i in range(n):
                ang = -math.pi / 2 + i * 2 * math.pi / n
                r = 0.5 if (not e["star"] or i % 2 == 0) else 0.225
                pts.append((e["w"] * (0.5 + r * math.cos(ang)), e["h"] * (0.5 + r * math.sin(ang))))
            els = [f"cv.Path.MoveTo({fmt(round(pts[0][0], 1))}, {fmt(round(pts[0][1], 1))})"]
            els += [f"cv.Path.LineTo({fmt(round(x, 1))}, {fmt(round(y, 1))})" for x, y in pts[1:]] + ["cv.Path.Close()"]
            f = next((f for f in e["fills"] if isinstance(f, dict)), None)
            col = fcolor(f.get("color"), num(f.get("opacity"), 1)) if f else "ft.Colors.TRANSPARENT"
            path = f"cv.Path([{', '.join(els)}], paint=ft.Paint(color={col}, style=ft.PaintingStyle.FILL))"
            return "cv.Canvas", [("shapes", f"[{path}]"), ("width", fmt(e["w"])), ("height", fmt(e["h"]))]
        return None


HEADER = '''"""{title} - Flet app generated by FrameForge.

Run it:
    pip install "flet>=1.0"
    python main.py

Edit the event handlers below with your own logic. To change the design, edit it in
FrameForge and export again (or import this file back into FrameForge to keep editing).
"""
'''


def build_app(name, data, opts, embed_assets):
    """Return (python_source, assets {filename: bytes}, notes [str])."""
    els, _page = prepare(data, opts.get("page"), opts.get("frame"))
    g = Gen(els, name, embed_assets)
    roots = [e for e in g.by_parent.get(None, []) if e["type"] == "frame" and e.get("visible", True)]
    if not roots:
        raise ValueError("Add at least one frame to export a Flet app")
    start = opts.get("start")
    if start and any(r["id"] == start for r in roots):
        roots.sort(key=lambda r: r["id"] != start)
    used = set()
    for r in roots:
        key = ident(r.get("name") or "screen", "screen")
        base, i = key, 2
        while key in used:
            key, i = f"{base}_{i}", i + 1
        used.add(key)
        g.screens[r["id"]] = key
    screens = []
    for r in roots:
        body = g.node(r, None, 1)
        screens.append((g.screens[r["id"]], r, body))
    skipped_loose = len([e for e in g.by_parent.get(None, []) if e["type"] != "frame"])
    if skipped_loose:
        g.notes.add(f"{skipped_loose} element(s) outside frames were not exported (put them inside a frame).")
    if g.skipped:
        g.notes.add(f"{g.skipped} element(s) of an unsupported type were skipped.")

    out = [HEADER.format(title=name.replace('"""', "'''"))]
    imports = []
    if embed_assets and g.assets:
        imports.append("import base64")
    imports.append("import flet as ft")
    if g.uses_canvas:
        imports.append("import flet.canvas as cv")
    out.append("\n".join(imports) + "\n")
    if g.handlers:
        out.append("\n# " + "-" * 70 + "\n# Event handlers - add your own logic here\n# " + "-" * 70)
        for fn, (kind, label) in g.handlers.items():
            if kind == "on_click":
                out.append(f'\n\ndef {fn}(e):\n    """Clicked: {label.replace(chr(34), chr(39))}"""\n    pass')
            elif kind == "on_select":
                out.append(f'\n\ndef {fn}(e):\n    """Option chosen in: {label.replace(chr(34), chr(39))}. Value: e.control.value"""\n    pass')
            else:
                out.append(f'\n\ndef {fn}(e):\n    """Changed: {label.replace(chr(34), chr(39))}. New value: e.control.value"""\n    pass')
        out.append("\n")
    if g.svgs or (embed_assets and g.assets):
        out.append("\n# " + "-" * 70 + "\n# Assets (icons drawn as SVG, images)\n# " + "-" * 70)
        for k, v in g.svgs.items():
            out.append(f"\n{k} = {v!r}.encode()")
        if embed_assets and g.assets:
            out.append("\nASSETS = {")
            for fname, raw in g.assets.items():
                out.append(f'    "{fname.rsplit(".", 1)[0]}": base64.b64decode(\n        "{base64.b64encode(raw).decode()}"\n    ),')
            out.append("}")
        out.append("\n")
    out.append("\n# " + "-" * 70 + "\n# Screens (one per frame)\n# " + "-" * 70)
    for key, r, body in screens:
        out.append(f"\n\ndef screen_{key}(show):\n    return {indent(body)}")
    out.append("\n\n\nSCREENS = {\n" + "".join(f'    "{k}": screen_{k},\n' for k, _r, _b in screens) + "}")
    out.append(f'\nSTART = "{screens[0][0]}"\n')
    first = screens[0][1]
    hx, _a = rgba(next((f.get("color") for f in first["fills"] if isinstance(f, dict) and f.get("type", "solid") == "solid"), "#ffffff"))
    out.append(f'''
def main(page: ft.Page):
    page.title = {name!r}
    page.padding = 0
    page.bgcolor = {hx!r}
    page.scroll = ft.ScrollMode.AUTO
    page.horizontal_alignment = ft.CrossAxisAlignment.CENTER
    page.window.width = {fmt(min(first["w"], 1600))}
    page.window.height = {fmt(min(first["h"], 1000))}

    def show(name):
        page.clean()
        page.add(SCREENS[name](show))
        page.update()

    show(START)

''')
    run = "ft.run(main)" if embed_assets or not g.assets else 'ft.run(main, assets_dir="assets")'
    out.append(f'\nif __name__ == "__main__":\n    {run}\n')
    return "".join(out), ({} if embed_assets else g.assets), sorted(g.notes)


README = """# {name} (Flet)

Generated by FrameForge.

    pip install -r requirements.txt
    python main.py

- `main.py` - the UI (one function per frame) plus empty event handlers (`on_click_*`, `on_change_*`, `on_select_*`) for your logic.
- `assets/` - images used by the design.
- `frameforge.json` - the editable design. Use FrameForge > Import to keep editing it.

To run in a browser instead of a desktop window: `flet run --web main.py`.
{notes}"""
