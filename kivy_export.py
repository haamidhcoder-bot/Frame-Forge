"""Kivy (Python) code generation for FrameForge designs.

Each root frame becomes a screen (a function returning a widget tree). The generated
main.py has three parts:

    1. your design   - handlers, assets, one ``screen_<name>(show)`` function per frame
    2. the app       - SCREENS / START and a small ``App`` subclass that shows one screen at a time
    3. the runtime   - Box / Txt / Btn / Field / Check / Dropdown / Pic / Svg helpers that draw
                       rounded boxes, gradients, shadows, auto layout (row / column / grid / wrap)
                       and icons with plain Kivy. It needs nothing but ``pip install kivy``.

Mapping:
    frame/group + auto layout  -> Box(layout="row" | "column" | "grid")
    frame/group, free layout   -> Box(...) children placed at x / y (top-left origin, like the editor)
    rect / ellipse / line      -> Box
    polygon, icons             -> Svg (drawn from path data - no image files needed)
    text, button, input, checkbox, select, image -> Txt, Btn, Field, Check, Dropdown, Pic
Links between frames become ``show("screen")`` calls; buttons and fields get empty event-handler
stubs at the top of the file for your own logic.
"""
import base64
import json
import math
import re
import urllib.parse

from exporter import (HEX_RE, RGB_RE, color, fmt, is_auto, num, prepare, safe_href, slug)
from icons import BI_PREFIX, ICONS, icon_inner, is_bi

FONT_FAMILY = {"Georgia": "Georgia", "Mono": "Courier New"}
MAIN = {"start": "start", "center": "center", "end": "end", "between": "between"}
CROSS = {"start": "start", "center": "center", "end": "end", "stretch": "stretch"}
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


def kcolor(c, opacity=1.0):
    """Python expression for a colour: C("#rrggbb") or C("#rrggbb", alpha)."""
    hx, a = rgba(c)
    a = round(a * opacity, 3)
    return f'C("{hx}")' if a >= 0.996 else f'C("{hx}", {fmt(max(0.0, a))})'


def ident(text, fallback="el"):
    s = re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_") or fallback
    return "_" + s if s[0].isdigit() else s


def indent(text):
    """Indent every line after the first (the first line is already positioned by the caller)."""
    return text.replace("\n", "\n" + PAD)


def render(name, args):
    """`name(arg, key=value, ...)` on one line when short, otherwise one argument per line."""
    parts = [(f"{k}={v}" if k else v) for k, v in args]
    flat = f"{name}({', '.join(parts)})"
    if "\n" not in flat and len(flat) <= 88:
        return flat
    return name + "(\n" + "".join(f"{PAD}{indent(p)},\n" for p in parts) + ")"


class Gen:
    def __init__(self, els, name, embed_assets):
        self.name = name
        self.by_parent = {}
        for e in els:
            self.by_parent.setdefault(e.get("parent"), []).append(e)
        self.embed_assets = embed_assets            # True: images as base64 constants; False: files under assets/
        self.assets = {}                            # file name -> bytes
        self.asset_names = {}                       # dedupe by content
        self.svgs = {}                              # constant name -> svg text
        self.handlers = {}                          # function name -> (kind, label)
        self.screens = {}                           # frame id -> screen key
        self.fonts = set()
        self.notes = set()
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
        """Python expression for a Pic src (URL or asset file name), or None when the URL is not usable."""
        url = (url or "").strip()
        if re.match(r"^https?://", url, re.I):
            if url.lower().split("?")[0].endswith(".svg"):
                self.notes.add("SVG images loaded from a web address cannot be drawn by Kivy (grey box instead).")
                return None
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
        return repr(f"{self.asset_names[key]}.{ext}")

    # ---- shared argument builders -----------------------------------
    def parent_kind(self, parent):
        return parent["layout"] if parent is not None and is_auto(parent) else None

    def base_args(self, e, parent, act=None):
        """Position, size, opacity and click arguments shared by every element."""
        pk = self.parent_kind(parent)
        args = []
        if parent is not None and not is_auto(parent):
            args += [("x", fmt(e["x"])), ("y", fmt(e["y"]))]
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
        args += [("w", fmt(e["w"])), ("h", fmt(e["h"]))]
        if sw != "fixed":
            args.append(("sw", repr(sw)))
        if sh != "fixed":
            args.append(("sh", repr(sh)))
        if e["opacity"] < 1:
            args.append(("opacity", fmt(e["opacity"])))
        if act:
            args.append(("on_click", act))
        return args

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
            return [("fill", f"Linear({fmt(num(f.get('angle'), 90))}, {kcolor(f.get('color'), op)}, {kcolor(f.get('color2'), op)})")]
        if t == "radial":
            return [("fill", f"Radial({kcolor(f.get('color'), op)}, {kcolor(f.get('color2'), op)})")]
        return [("fill", kcolor(f.get("color", "#d9d9d9"), op))]

    def stroke_of(self, e):
        s = [s for s in e["strokes"] if num(s.get("width")) > 0]
        if len(s) > 1:
            self.notes.add("Only the first stroke of an element is exported.")
        return s[0] if s else None

    def style_args(self, e):
        """fill / border / radius / shadow."""
        args = self.fill_args(e)
        s = self.stroke_of(e)
        if s:
            args.append(("border", f"({fmt(num(s['width']))}, {kcolor(s.get('color'))})"))
        r = self.radius_value(e)
        if r > 0:
            args.append(("radius", fmt(round(r, 2))))
        shadows = []
        for ef in e["effects"]:
            if ef.get("type") == "drop":
                shadows.append(f"({fmt(num(ef.get('x')))}, {fmt(num(ef.get('y')))}, {fmt(num(ef.get('blur')))}, "
                               f"{fmt(num(ef.get('spread')))}, {kcolor(ef.get('color') or 'rgba(0,0,0,.25)')})")
            elif ef.get("type") in ("inner", "blur", "bgblur"):
                self.notes.add("Inner shadows and blur effects are not exported.")
        if shadows:
            args.append(("shadow", "[" + ", ".join(shadows) + "]"))
        return args

    def radius_value(self, e):
        if e["type"] == "ellipse":
            return min(e["w"], e["h"]) / 2
        return e["radius"]

    def link_action(self, e):
        """Python expression for an on_click callback, or None."""
        lk = e.get("link") if isinstance(e.get("link"), dict) else None
        if not lk:
            return None
        if lk.get("kind") == "url" and safe_href(lk.get("value")):
            return f"link({safe_href(lk['value'])!r})"
        if lk.get("kind") == "frame" and lk.get("value") in self.screens:
            return f'lambda w: show("{self.screens[lk["value"]]}")'
        return None

    # ---- element builders -------------------------------------------
    def node(self, e, parent):
        if not e.get("visible", True):
            return None
        t = e["type"]
        act = self.link_action(e)
        if t in ("frame", "group", "rect", "ellipse", "line"):
            return self.container(e, parent, act)
        leaf = self.leaf(e, parent, act)
        if leaf is None:
            self.skipped += 1
            return None
        name, args = leaf
        return render(name, args)

    def container(self, e, parent, act):
        t = e["type"]
        kids = []
        opts = []
        if t in ("frame", "group"):
            visible = [c for c in self.by_parent.get(e["id"], []) if c.get("visible", True)]
            kids = [x for x in (self.node(c, e) for c in visible) if x]
            if e["clip"]:
                opts.append(("clip", "True"))
            if is_auto(e):
                opts.append(("layout", repr(e["layout"])))
                if e["gap"]:
                    opts.append(("gap", fmt(e["gap"])))
                if e["padX"] or e["padY"]:
                    opts.append(("pad", f"({fmt(e['padX'])}, {fmt(e['padY'])})"))
                if e["justify"] != "start":
                    opts.append(("justify", repr(MAIN.get(e["justify"], "start"))))
                if e["alignItems"] != "start":
                    opts.append(("align", repr(CROSS.get(e["alignItems"], "start"))))
                if e["layout"] == "grid":
                    opts.append(("cols", str(max(1, int(e["cols"])))))
                elif e["wrap"] and e["layout"] == "row":
                    opts.append(("wrap", "True"))
        args = [(None, k) for k in kids] + self.base_args(e, parent, act) + opts + self.style_args(e)
        return render("Box", args)

    def font_args(self, e):
        a = [("size", fmt(e["fontSize"]))]
        w = int(max(100, min(900, round(e["fontWeight"] / 100) * 100)))
        if w != 400:
            a.append(("weight", str(w)))
        a.append(("color", kcolor(e["color"])))
        if e["italic"]:
            a.append(("italic", "True"))
        if e["underline"]:
            a.append(("underline", "True"))
        if e["strike"]:
            a.append(("strike", "True"))
        if e["font"] not in ("Inter",):
            fam = FONT_FAMILY.get(e["font"], e["font"])
            self.fonts.add(fam)
            a.append(("font", repr(fam)))
        if abs(e["lineHeight"] - 1.2) > 0.01 and e["lineHeight"] > 0:
            a.append(("line_height", fmt(round(e["lineHeight"], 2))))
        if e["letterSpacing"]:
            self.notes.add("Letter spacing is not supported by Kivy labels.")
        return a

    def leaf(self, e, parent, act):
        t = e["type"]
        base = self.base_args(e, parent, act)
        if t == "text":
            al = e["align"] if e["align"] in ("left", "center", "right") else "left"
            a = [(None, repr(str(e["text"])))] + self.font_args(e)
            if al != "left":
                a.append(("align", repr(al)))
            return "Txt", a + base
        if t == "button":
            al = e["align"] if e["align"] in ("left", "center", "right") else "center"
            a = [(None, repr(str(e["text"])))] + self.font_args(e)
            if al != "center":
                a.append(("align", repr(al)))
            a += self.style_args(e)
            if not act:
                base.append(("on_click", self.handler("on_click", e)))
            return "Btn", a + base
        if t == "input":
            a = [(None, repr(str(e["placeholder"]))), ("size", fmt(e["fontSize"])), ("color", kcolor(e["color"]))]
            a += self.style_args(e)
            a.append(("on_change", self.handler("on_change", e)))
            return "Field", a + base
        if t == "checkbox":
            a = [(None, repr(str(e["text"]))), ("checked", "True" if e["checked"] else "False"),
                 ("size", fmt(e["fontSize"])), ("color", kcolor(e["color"])), ("on_change", self.handler("on_change", e))]
            return "Check", a + base
        if t == "select":
            opts = [o.strip() for o in str(e["text"]).splitlines() if o.strip()] or ["Select"]
            a = [(None, repr(opts)), ("size", fmt(e["fontSize"])), ("color", kcolor(e["color"]))]
            a += self.style_args(e)
            a.append(("on_select", self.handler("on_select", e)))
            return "Dropdown", a + base
        if t == "image":
            src = self.image_src(e["url"])
            if src is None:
                return "Box", [("fill", kcolor("#e5e7eb"))] + ([("radius", fmt(e["radius"]))] if e["radius"] else []) + base
            fit = e["fit"] if e["fit"] in ("cover", "contain", "fill") else "cover"
            a = [(None, src), ("fit", repr(fit))]
            if e["radius"]:
                a.append(("radius", fmt(e["radius"])))
            return "Pic", a + base
        if t == "icon":
            name = e["icon"]
            hx, _ = rgba(e["color"])
            inner = icon_inner(name)
            if is_bi(name):
                svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="{hx}">{inner}</svg>'
            else:
                svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%s" stroke-width="2" '
                       'stroke-linecap="round" stroke-linejoin="round">%s</svg>' % (hx, inner))
            return "Svg", [(None, self.svg_const(svg))] + base
        if t == "polygon":
            n = e["sides"] * 2 if e["star"] else e["sides"]
            pts = []
            for i in range(n):
                ang = -math.pi / 2 + i * 2 * math.pi / n
                r = 0.5 if (not e["star"] or i % 2 == 0) else 0.225
                pts.append(f"{fmt(round(e['w'] * (0.5 + r * math.cos(ang)), 1))},{fmt(round(e['h'] * (0.5 + r * math.sin(ang)), 1))}")
            f = next((f for f in e["fills"] if isinstance(f, dict)), None)
            hx, a = rgba(f.get("color")) if f else ("#000000", 0.0)
            if f:
                a *= min(1.0, max(0.0, num(f.get("opacity"), 1)))
            svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(e["w"])} {fmt(e["h"])}" fill="{hx}">'
                   f'<polygon points="{" ".join(pts)}"/></svg>')
            if a < 0.996:
                base = [(k, (fmt(round(float(v) * a, 3)) if k == "opacity" else v)) for k, v in base]
                if not any(k == "opacity" for k, _ in base):
                    base.append(("opacity", fmt(round(a, 3))))
            return "Svg", [(None, self.svg_const(svg))] + base
        return None


HEADER = '''"""{title} - Kivy app generated by FrameForge.

Run it:
    pip install kivy
    python main.py

Edit the event handlers below with your own logic. To change the design, edit it in
FrameForge and export again (or import this file back into FrameForge to keep editing).
"""
'''

IMPORTS = '''import io
import os
import re
import math
import webbrowser
import xml.etree.ElementTree as ET
'''

KIVY_IMPORTS = '''from kivy.app import App
from kivy.core.image import Image as CoreImage
from kivy.core.text import Label as CoreLabel
from kivy.core.window import Window
from kivy.graphics import Color, InstructionGroup, Line, Mesh, Rectangle, RoundedRectangle
from kivy.graphics.tesselator import TYPE_POLYGONS, WINDING_NONZERO, Tesselator
from kivy.graphics.texture import Texture
from kivy.loader import Loader
from kivy.uix.floatlayout import FloatLayout
from kivy.uix.label import Label
from kivy.uix.scrollview import ScrollView
from kivy.uix.spinner import Spinner
from kivy.uix.stencilview import StencilView
from kivy.uix.textinput import TextInput
from kivy.uix.widget import Widget
from kivy.utils import escape_markup, get_color_from_hex
'''

# --------------------------------------------------------------------------
# Runtime that ships inside every generated main.py (plain Kivy, no dependencies)
# --------------------------------------------------------------------------
RUNTIME = r'''
# ----------------------------------------------------------------------
# FrameForge runtime - draws the design above with plain Kivy.
# You normally do not need to edit anything below this line.
# ----------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))


def C(hex_color, alpha=1.0):
    """'#rrggbb' -> Kivy RGBA tuple."""
    r, g, b, _a = get_color_from_hex(hex_color)
    return (r, g, b, alpha)


def link(url):
    """on_click callback that opens a web address."""
    return lambda w: webbrowser.open(url)


class Linear:
    """Linear gradient fill; angle in CSS degrees (90 = left to right)."""

    def __init__(self, angle, c1, c2):
        self.kind, self.angle, self.c1, self.c2 = "linear", angle, c1, c2


class Radial:
    """Radial gradient fill (centre colour c1, edge colour c2)."""

    def __init__(self, c1, c2):
        self.kind, self.angle, self.c1, self.c2 = "radial", 0, c1, c2


_TEX = {}


def _gradient_texture(g, n=64):
    key = (g.kind, round(g.angle, 2), g.c1, g.c2)
    if key not in _TEX:
        tex = Texture.create(size=(n, n), colorfmt="rgba")
        tex.mag_filter = tex.min_filter = "linear"
        th = math.radians(g.angle)
        dx, dy = math.sin(th), -math.cos(th)
        span = (abs(dx) + abs(dy)) or 1.0
        buf = bytearray()
        for j in range(n):                       # texture row 0 is the bottom of the box
            v = 1 - (j + 0.5) / n
            for i in range(n):
                u = (i + 0.5) / n
                if g.kind == "linear":
                    t = ((u - 0.5) * dx + (v - 0.5) * dy) / span + 0.5
                else:
                    t = math.hypot(u - 0.5, v - 0.5) / 0.7071
                t = min(1.0, max(0.0, t))
                for a, b in zip(g.c1, g.c2):
                    buf.append(int(round((a + (b - a) * t) * 255)))
        tex.blit_buffer(bytes(buf), colorfmt="rgba", bufferfmt="ubyte")
        _TEX[key] = tex
    return _TEX[key]


_META = ("x", "y", "w", "h", "sw", "sh", "on_click", "opacity")


def _split(kw):
    return {k: kw.pop(k) for k in _META if k in kw}


def _measure(c, avail=None):
    m = getattr(c, "ff_measure", None)
    return m(avail) if m else (c.width, c.height)


def _spec(c):
    return getattr(c, "ff_sw", "fixed"), getattr(c, "ff_sh", "fixed")


class Item:
    """Behaviour shared by every FrameForge widget: design size, sizing mode, click handler."""

    def ff_set(self, meta):
        self.ff_x, self.ff_y = meta.get("x", 0), meta.get("y", 0)
        self.ff_w, self.ff_h = meta.get("w", 0), meta.get("h", 0)
        self.ff_sw, self.ff_sh = meta.get("sw", "fixed"), meta.get("sh", "fixed")
        self.ff_click = meta.get("on_click")
        self.ff_rel = (0, 0)
        self.size_hint = (None, None)
        self.size = (self.ff_w, self.ff_h)
        self.opacity = meta.get("opacity", 1)

    def ff_measure(self, avail=None):
        return (self.ff_w, self.ff_h)

    def on_touch_down(self, touch):
        if super().on_touch_down(touch):
            return True
        if self.ff_click and self.collide_point(*touch.pos) and not getattr(touch, "is_mouse_scrolling", False):
            touch.grab(self)
            return True
        return False

    def on_touch_up(self, touch):
        if touch.grab_current is self:
            touch.ungrab(self)
            if self.collide_point(*touch.pos) and self.ff_click:
                self.ff_click(self)
            return True
        return super().on_touch_up(touch)


# ---- text ---------------------------------------------------------------
class Txt(Item, Label):
    def __init__(self, text, size=14, weight=400, color=(0, 0, 0, 1), italic=False, underline=False,
                 strike=False, font=None, align="left", line_height=1.2, **kw):
        meta = _split(kw)
        markup = bool(underline or strike)
        s = escape_markup(str(text)) if markup else str(text)
        if underline:
            s = "[u]%s[/u]" % s
        if strike:
            s = "[s]%s[/s]" % s
        opts = dict(text=s, font_size=size, bold=weight >= 600, italic=bool(italic), markup=markup,
                    halign=align, valign="top", line_height=line_height / 1.2)
        fname = FONTS.get(font)
        if fname:
            opts["font_name"] = fname
        super().__init__(color=color, **opts)
        self._opts, self._cache = opts, {}
        self.ff_set(meta)
        self.bind(size=self._fit)
        self._fit()

    def _tex(self, wrap):
        if wrap not in self._cache:
            core = CoreLabel(text_size=(wrap, None), **self._opts)
            core.refresh()
            self._cache[wrap] = tuple(core.texture.size) if core.texture else (0, self._opts["font_size"] * 1.2)
        return self._cache[wrap]

    def ff_measure(self, avail=None):
        nat_w = self._tex(None)[0]
        if self.ff_sw == "fixed":
            w = self.ff_w
        elif self.ff_sw == "fill" and avail is not None:
            w = avail
        else:
            w = nat_w if (avail is None or nat_w <= avail) else avail
        wrap = None if (w >= nat_w and self.ff_sw != "fixed") else w + 2
        h = self.ff_h if self.ff_sh == "fixed" else self._tex(wrap)[1]
        return (w, h)

    def _fit(self, *_):
        self.text_size = (self.width + 2, self.height if self.ff_sh == "fixed" else None)


# ---- boxes + layout -------------------------------------------------------
class _Box(Item, Widget):
    def __init__(self, *kids, **kw):
        meta = _split(kw)
        super().__init__()
        self.ff_set(meta)
        self.ff_layout = kw.get("layout", "abs")
        self.ff_gap = kw.get("gap", 0)
        self.ff_pad = kw.get("pad", (0, 0))
        self.ff_justify = kw.get("justify", "start")
        self.ff_align = kw.get("align", "start")
        self.ff_wrap = kw.get("wrap", False)
        self.ff_cols = kw.get("cols", 1)
        self.ff_fill = kw.get("fill")
        self.ff_border = kw.get("border")
        self.ff_radius = kw.get("radius", 0)
        self.ff_shadow = kw.get("shadow", ())
        self._busy = False
        self._grp = InstructionGroup()
        self.canvas.before.add(self._grp)
        for k in kids:
            self.add_widget(k)
        self.bind(pos=self._moved, size=self._resized)
        self._resized()

    # -- drawing
    def _paint(self):
        g = self._grp
        g.clear()
        x, y, w, h = self.x, self.y, self.width, self.height
        if w <= 0 or h <= 0:
            return
        r = max(0.0, min(self.ff_radius, w / 2, h / 2))
        for dx, dy, blur, spread, col in self.ff_shadow:
            steps = max(1, min(8, int(blur / 2) + 1))
            for i in range(steps):
                grow = spread + blur * (steps - i) / steps / 2
                g.add(Color(col[0], col[1], col[2], col[3] / steps * 0.9))
                g.add(RoundedRectangle(pos=(x + dx - grow, y - dy - grow), size=(w + 2 * grow, h + 2 * grow), radius=[r + max(grow, 0)]))
        f = self.ff_fill
        if isinstance(f, (Linear, Radial)):
            g.add(Color(1, 1, 1, 1))
            g.add(RoundedRectangle(pos=(x, y), size=(w, h), radius=[r], texture=_gradient_texture(f)))
        elif f is not None and f[3] > 0:
            g.add(Color(*f))
            g.add(RoundedRectangle(pos=(x, y), size=(w, h), radius=[r]))
        if self.ff_border:
            bw, bc = self.ff_border
            g.add(Color(*bc))
            if r > 0:
                g.add(Line(rounded_rectangle=(x + bw / 2, y + bw / 2, w - bw, h - bw, max(r - bw / 2, 0)), width=bw))
            else:
                g.add(Line(rectangle=(x + bw / 2, y + bw / 2, w - bw, h - bw), width=bw))

    # -- layout
    def _moved(self, *_):
        for c in self.children:
            rx, ry = getattr(c, "ff_rel", (0, 0))
            c.pos = (self.x + rx, self.top - ry - c.height)
        self._paint()

    def _resized(self, *_):
        if self._busy:
            return
        self._busy = True
        try:
            px, py = self.ff_pad
            _cw, _ch, items = self._flow(max(0, self.width - 2 * px), max(0, self.height - 2 * py))
            for c, x, y, w, h in items:
                if abs(c.width - w) > 0.01 or abs(c.height - h) > 0.01:
                    c.size = (w, h)
                c.ff_rel = (px + x, py + y)
                c.pos = (self.x + px + x, self.top - py - y - h)
        finally:
            self._busy = False
        self._paint()

    def ff_measure(self, avail=None):
        sw, sh = self.ff_sw, self.ff_sh
        if sw == "fixed" and sh == "fixed":
            return (self.ff_w, self.ff_h)
        px, py = self.ff_pad
        iw = (self.ff_w if sw == "fixed" else avail)
        iw = None if iw is None else max(0, iw - 2 * px)
        cw, ch, _items = self._flow(iw, self.ff_h - 2 * py if sh == "fixed" else None)
        w = self.ff_w if sw == "fixed" else (avail if (sw == "fill" and avail is not None) else cw + 2 * px)
        h = self.ff_h if sh == "fixed" else ch + 2 * py
        return (w, h)

    def _flow(self, iw, ih):
        """Lay the children out inside an inner box of iw x ih (None = size to content).
        Returns (content_w, content_h, [(child, x, y, w, h)])."""
        kids = list(reversed(self.children))
        lay = self.ff_layout
        out = []
        if lay == "abs":
            for c in kids:
                w, h = _measure(c)
                out.append((c, getattr(c, "ff_x", 0), getattr(c, "ff_y", 0), w, h))
            return (max((x + w for _c, x, _y, w, _h in out), default=0),
                    max((y + h for _c, _x, y, _w, h in out), default=0), out)
        if lay == "stack":
            for c in kids:
                nw, nh = _measure(c, iw)
                out.append((c, 0, 0, iw if iw is not None else nw, ih if ih is not None else nh))
            return (max((w for *_a, w, _h in out), default=0), max((h for *_a, h in out), default=0), out)
        gap = self.ff_gap
        if lay == "grid":
            cols = max(1, int(self.ff_cols))
            if iw is not None:
                cell = max(0, (iw - gap * (cols - 1)) / cols)
            else:
                cell = max((_measure(c)[0] for c in kids), default=0)
            y = 0
            for i in range(0, len(kids), cols):
                row = kids[i:i + cols]
                sizes = []
                for c in row:
                    sw, _sh = _spec(c)
                    sizes.append(_measure(c, cell) if sw != "fill" else (cell, _measure(c, cell)[1]))
                rh = max((h for _w, h in sizes), default=0)
                for j, (c, (w, h)) in enumerate(zip(row, sizes)):
                    out.append((c, j * (cell + gap), y, w, rh if _spec(c)[1] == "fill" else h))
                y += rh + gap
            return (cell * cols + gap * (cols - 1), max(0, y - gap), out)
        # row / column
        m = 0 if lay == "row" else 1            # main axis index in (w, h)
        im, ic = (iw, ih) if m == 0 else (ih, iw)
        lines = [kids]
        if m == 0 and self.ff_wrap and iw is not None and kids:
            lines, cur, used = [], [], 0
            for c in kids:
                w = _measure(c)[0]
                if cur and used + gap + w > iw:
                    lines.append(cur)
                    cur, used = [], 0
                cur.append(c)
                used += w + (gap if len(cur) > 1 else 0)
            lines.append(cur)
        main_total, cross_total, cross_pos = 0, 0, 0
        placed = []
        for ks in lines:
            n = len(ks)
            mains, nat, fills = [], [], []
            for i, c in enumerate(ks):
                s = _spec(c)
                nat.append(_measure(c, ic if m == 1 else None))
                if s[m] == "fill" and im is not None:
                    fills.append(i)
                    mains.append(0)
                else:
                    mains.append(nat[i][m])
            free = (im - sum(mains) - gap * (n - 1)) if im is not None else 0
            if fills:
                share = max(0, free) / len(fills)
                for i in fills:
                    mains[i] = share
                free = 0
            start, extra = 0, 0
            if free > 0 and not fills:
                j = self.ff_justify
                start = free / 2 if j == "center" else free if j == "end" else 0
                extra = free / (n - 1) if (j == "between" and n > 1) else 0
            crosses = []
            for i, c in enumerate(ks):
                s = _spec(c)
                natc = _measure(c, mains[i])[1] if m == 0 else nat[i][0]     # a row child may rewrap at its final width
                if ic is not None and (s[1 - m] == "fill" or (self.ff_align == "stretch" and s[1 - m] != "fixed")):
                    crosses.append(ic)
                else:
                    crosses.append(natc)
            line_cross = max(crosses, default=0) if (ic is None or self.ff_wrap) else ic
            pos = start
            for i, c in enumerate(ks):
                a = self.ff_align
                off = (line_cross - crosses[i]) / 2 if a == "center" else (line_cross - crosses[i]) if a == "end" else 0
                placed.append((c, pos, cross_pos + off, mains[i], crosses[i]))
                pos += mains[i] + gap + extra
            main_total = max(main_total, pos - gap - extra if n else 0)
            cross_pos += line_cross + gap
            cross_total = cross_pos - gap
        for c, p, q, mm, cc in placed:
            out.append((c, p, q, mm, cc) if m == 0 else (c, q, p, cc, mm))
        cw, ch = (main_total, cross_total) if m == 0 else (cross_total, main_total)
        return cw, ch, out


class _ClipBox(_Box, StencilView):
    """A Box that clips its children to its bounds."""


def Box(*kids, **kw):
    """Rectangle / frame. Children are positioned by x/y ("abs") or by auto layout ("row", "column", "grid")."""
    return (_ClipBox if kw.pop("clip", False) else _Box)(*kids, **kw)


def Btn(text, align="center", size=14, weight=400, color=(0, 0, 0, 1), **kw):
    """Button: a Box with a centred label. on_click(button) is called when it is pressed."""
    txt = {k: kw.pop(k) for k in ("italic", "underline", "strike", "font", "line_height") if k in kw}
    kw.update(layout="row", justify={"left": "start", "right": "end"}.get(align, "center"), align="center",
              pad=(12, 8 if kw.get("sh") == "hug" else 0))
    label = Txt(text, size=size, weight=weight, color=color, sw="hug", sh="hug", w=0, h=size * 1.2, **txt)
    return Box(label, **kw)


class _Tick(Widget):
    def __init__(self, color, checked, **kw):
        super().__init__(size_hint=(None, None), size=(18, 18), **kw)
        self.color, self.checked = color, checked
        self.bind(pos=self._paint, size=self._paint)
        self._paint()

    def _paint(self, *_):
        self.canvas.clear()
        x, y, w, h = self.x, self.y, self.width, self.height
        with self.canvas:
            Color(*self.color)
            if self.checked:
                RoundedRectangle(pos=(x, y), size=(w, h), radius=[4])
                Color(1, 1, 1, 1)
                Line(points=[x + 4, y + h / 2, x + w * 0.42, y + 4.5, x + w - 4, y + h - 5], width=1.6, cap="round", joint="round")
            else:
                Line(rounded_rectangle=(x + 1, y + 1, w - 2, h - 2, 4), width=1.3)


def Check(label, checked=False, size=14, color=(0, 0, 0, 1), on_change=None, **kw):
    """Checkbox with a label. on_change(box, value) is called when it is toggled."""
    tick = _Tick(color, checked)
    text = Txt(label, size=size, color=color, sw="hug", sh="hug", w=0, h=size * 1.2)
    kw.update(layout="row", gap=8, align="center")
    box = Box(tick, text, **kw)
    box.value = checked

    def toggle(_w):
        box.value = not box.value
        tick.checked = box.value
        tick._paint()
        if on_change:
            on_change(box, box.value)
    box.ff_click = toggle
    return box


def Field(hint="", size=14, color=(0, 0, 0, 1), on_change=None, **kw):
    """Single-line text field. on_change(field, text) is called while typing."""
    h = kw.get("h", 40)
    ti = TextInput(hint_text=hint, multiline=False, font_size=size, foreground_color=color, cursor_color=color,
                   hint_text_color=(color[0], color[1], color[2], color[3] * 0.5), background_color=(0, 0, 0, 0),
                   background_normal="", background_active="", size_hint=(None, None),
                   padding=[12, max(0, (h - size * 1.25) / 2), 12, 0])
    if on_change:
        ti.bind(text=lambda inst, v: on_change(inst, v))
    kw.update(layout="stack")
    box = Box(ti, **kw)
    box.input = ti
    return box


def Dropdown(options, size=14, color=(0, 0, 0, 1), on_select=None, **kw):
    """Drop-down list. on_select(dropdown, value) is called when an option is chosen."""
    sp = Spinner(text=options[0], values=options, font_size=size, color=color, background_normal="",
                 background_down="", background_color=(0, 0, 0, 0), halign="left", valign="middle",
                 size_hint=(None, None))
    sp.bind(size=lambda i, s: setattr(i, "text_size", (s[0] - 24, s[1])))
    if on_select:
        sp.bind(text=lambda inst, v: on_select(inst, v))
    kw.update(layout="stack", pad=(12, 0))
    box = Box(sp, **kw)
    box.input = sp
    return box


# ---- images ----------------------------------------------------------------
def _asset_bytes(name):
    if name in ASSETS:
        return ASSETS[name]
    with open(os.path.join(HERE, "assets", name), "rb") as fh:
        return fh.read()


class _Pic(Item, Widget):
    def __init__(self, src, fit="cover", radius=0, **kw):
        meta = _split(kw)
        super().__init__()
        self.ff_set(meta)
        self.fit, self.radius, self.tex = fit, radius, None
        self._grp = InstructionGroup()
        self.canvas.add(self._grp)
        self.bind(pos=self._paint, size=self._paint)
        if src.startswith(("http://", "https://")):
            proxy = Loader.image(src)
            proxy.bind(on_load=lambda p: self._set(p.texture))
            if proxy.loaded:
                self._set(proxy.texture)
        else:
            try:
                ext = src.rsplit(".", 1)[-1].lower()
                self._set(CoreImage(io.BytesIO(_asset_bytes(src)), ext=ext).texture)
            except Exception as exc:
                print("Could not load image", src, exc)
        self._paint()

    def _set(self, tex):
        self.tex = tex
        self._paint()

    def _paint(self, *_):
        g = self._grp
        g.clear()
        w, h = self.size
        if w <= 0 or h <= 0:
            return
        if self.tex is None:
            g.add(Color(0.9, 0.91, 0.92, 1))
            g.add(Rectangle(pos=self.pos, size=self.size))
            return
        tw, th = self.tex.size
        x, y, rw, rh = self.x, self.y, w, h
        u0, v0, u1, v1 = 0.0, 0.0, 1.0, 1.0
        if self.fit == "cover":
            s = max(w / tw, h / th)
            fu, fv = w / (tw * s), h / (th * s)
            u0, u1, v0, v1 = (1 - fu) / 2, (1 + fu) / 2, (1 - fv) / 2, (1 + fv) / 2
        elif self.fit == "contain":
            s = min(w / tw, h / th)
            rw, rh = tw * s, th * s
            x, y = self.x + (w - rw) / 2, self.y + (h - rh) / 2
        coords = (u0, v0, u1, v0, u1, v1, u0, v1)
        g.add(Color(1, 1, 1, 1))
        if self.radius > 0 and self.fit != "contain":
            g.add(RoundedRectangle(pos=(x, y), size=(rw, rh), texture=self.tex, tex_coords=coords,
                                   radius=[min(self.radius, rw / 2, rh / 2)]))
        else:
            g.add(Rectangle(pos=(x, y), size=(rw, rh), texture=self.tex, tex_coords=coords))


def Pic(src, **kw):
    """Image from a web address or an asset file name (.svg assets are drawn as vectors)."""
    if not src.startswith(("http://", "https://")) and src.lower().endswith(".svg"):
        kw.pop("fit", None)
        kw.pop("radius", None)
        return Svg(_asset_bytes(src).decode("utf-8", "replace"), **kw)
    return _Pic(src, **kw)


# ---- vector graphics (icons, polygons, simple .svg files) ---------------------
_NUM = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")


def _arc(x1, y1, rx, ry, phi, fa, fs, x2, y2):
    if rx == 0 or ry == 0 or (x1 == x2 and y1 == y2):
        return [(x2, y2)]
    rx, ry, phi = abs(rx), abs(ry), math.radians(phi)
    cp, sp = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p, y1p = cp * dx + sp * dy, -sp * dx + cp * dy
    lam = x1p ** 2 / rx ** 2 + y1p ** 2 / ry ** 2
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    den = rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2
    co = math.sqrt(max(0.0, (rx ** 2 * ry ** 2 - den) / den)) if den else 0.0
    if fa == fs:
        co = -co
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx, cy = cp * cxp - sp * cyp + (x1 + x2) / 2, sp * cxp + cp * cyp + (y1 + y2) / 2
    ux, uy = (x1p - cxp) / rx, (y1p - cyp) / ry
    vx, vy = (-x1p - cxp) / rx, (-y1p - cyp) / ry
    th1 = math.atan2(uy, ux)
    dth = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    if not fs and dth > 0:
        dth -= 2 * math.pi
    elif fs and dth < 0:
        dth += 2 * math.pi
    steps = max(4, int(abs(dth) / (math.pi / 16)) + 1)
    pts = []
    for i in range(1, steps + 1):
        t = th1 + dth * i / steps
        pts.append((cx + rx * math.cos(t) * cp - ry * math.sin(t) * sp, cy + rx * math.cos(t) * sp + ry * math.sin(t) * cp))
    return pts


def _flatten_path(d):
    """SVG path data -> [(points, closed)] (curves and arcs are flattened to line segments)."""
    n, pos = len(d), 0
    subs, cur = [], None
    x = y = sx = sy = 0.0
    cmd, last_c, last_q = "", None, None

    def skip():
        nonlocal pos
        while pos < n and d[pos] in " \t\r\n,":
            pos += 1

    def number():
        nonlocal pos
        skip()
        m = _NUM.match(d, pos)
        if not m:
            raise ValueError("bad path data")
        pos = m.end()
        return float(m.group())

    def flag():
        nonlocal pos
        skip()
        v = d[pos]
        pos += 1
        return v == "1"

    def bezier(p0, p1, p2, p3):
        return [(((1 - t) ** 3) * p0[0] + 3 * ((1 - t) ** 2) * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0],
                 ((1 - t) ** 3) * p0[1] + 3 * ((1 - t) ** 2) * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1])
                for t in [i / 14 for i in range(1, 15)]]

    while True:
        skip()
        if pos >= n:
            break
        if d[pos].isalpha():
            cmd = d[pos]
            pos += 1
            if cmd in "Zz":
                if cur:
                    subs.append((cur, True))
                x, y, cur, last_c, last_q = sx, sy, None, None, None
                continue
        elif not cmd:
            raise ValueError("bad path data")
        rel, K = cmd.islower(), cmd.upper()
        ox, oy = (x, y) if rel else (0.0, 0.0)
        if K == "M":
            x, y = number() + ox, number() + oy
            if cur:
                subs.append((cur, False))
            sx, sy, cur = x, y, [(x, y)]
            cmd, last_c, last_q = ("l" if rel else "L"), None, None
            continue
        if cur is None:
            cur = [(x, y)]
        if K == "L":
            x, y = number() + ox, number() + oy
            cur.append((x, y))
            last_c = last_q = None
        elif K == "H":
            x = number() + ox
            cur.append((x, y))
            last_c = last_q = None
        elif K == "V":
            y = number() + oy
            cur.append((x, y))
            last_c = last_q = None
        elif K in "CS":
            if K == "C":
                p1 = (number() + ox, number() + oy)
            else:
                p1 = (2 * x - last_c[0], 2 * y - last_c[1]) if last_c else (x, y)
            p2 = (number() + ox, number() + oy)
            p3 = (number() + ox, number() + oy)
            cur += bezier((x, y), p1, p2, p3)
            x, y = p3
            last_c, last_q = p2, None
        elif K in "QT":
            if K == "Q":
                q = (number() + ox, number() + oy)
            else:
                q = (2 * x - last_q[0], 2 * y - last_q[1]) if last_q else (x, y)
            p3 = (number() + ox, number() + oy)
            c1 = (x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y))
            c2 = (p3[0] + 2 / 3 * (q[0] - p3[0]), p3[1] + 2 / 3 * (q[1] - p3[1]))
            cur += bezier((x, y), c1, c2, p3)
            x, y = p3
            last_q, last_c = q, None
        elif K == "A":
            rx, ry, rot = number(), number(), number()
            fa, fs = flag(), flag()
            nx, ny = number() + ox, number() + oy
            cur += _arc(x, y, rx, ry, rot, fa, fs, nx, ny)
            x, y = nx, ny
            last_c = last_q = None
        else:
            raise ValueError("unsupported path command " + cmd)
    if cur:
        subs.append((cur, False))
    return subs


def _ellipse_pts(cx, cy, rx, ry, n=48):
    return [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]


def _svg_color(v, default):
    if v is None:
        return default
    v = v.strip()
    if v.startswith("#"):
        return get_color_from_hex(v)
    if v in ("none", "transparent"):
        return None
    return default


def _parse_svg(text):
    root = ET.fromstring(text)
    vb = [float(v) for v in re.split(r"[ ,]+", root.get("viewBox", "").strip()) if v]
    if len(vb) != 4:
        vb = [0.0, 0.0, float(re.sub(r"[^0-9.]", "", root.get("width", "24")) or 24), float(re.sub(r"[^0-9.]", "", root.get("height", "24")) or 24)]
    shapes = []

    def visit(el, inh):
        st = dict(inh)
        for k in ("fill", "stroke", "stroke-width"):
            if el.get(k) is not None:
                st[k] = el.get(k)
        tag = el.tag.rsplit("}", 1)[-1]
        polys = None
        f = lambda k, d=0.0: float(el.get(k, d))
        if tag == "path":
            polys = _flatten_path(el.get("d", ""))
        elif tag == "circle":
            polys = [(_ellipse_pts(f("cx"), f("cy"), f("r"), f("r")), True)]
        elif tag == "ellipse":
            polys = [(_ellipse_pts(f("cx"), f("cy"), f("rx"), f("ry")), True)]
        elif tag == "rect":
            x, y, w, h = f("x"), f("y"), f("width"), f("height")
            polys = [([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], True)]
        elif tag == "line":
            polys = [([(f("x1"), f("y1")), (f("x2"), f("y2"))], False)]
        elif tag in ("polygon", "polyline"):
            nums = [float(v) for v in _NUM.findall(el.get("points", ""))]
            polys = [(list(zip(nums[0::2], nums[1::2])), tag == "polygon")]
        if polys:
            fill = _svg_color(st.get("fill"), (0, 0, 0, 1))
            stroke = _svg_color(st.get("stroke"), None)
            shapes.append((polys, fill, stroke, float(st.get("stroke-width", 1))))
        for ch in el:
            visit(ch, st)

    visit(root, {})
    return vb, shapes


class Svg(Item, Widget):
    """Draws simple SVG vector data (paths, circles, rectangles, lines, polygons) - used for icons."""

    def __init__(self, svg, **kw):
        meta = _split(kw)
        super().__init__()
        self.ff_set(meta)
        try:
            self.vb, self.shapes = _parse_svg(svg)
        except Exception as exc:
            print("Could not read SVG:", exc)
            self.vb, self.shapes = [0, 0, 1, 1], []
        self._grp = InstructionGroup()
        self.canvas.add(self._grp)
        self.bind(pos=self._paint, size=self._paint)
        self._paint()

    def _paint(self, *_):
        g = self._grp
        g.clear()
        vx, vy, vw, vh = self.vb
        if self.width <= 0 or self.height <= 0 or vw <= 0 or vh <= 0:
            return
        s = min(self.width / vw, self.height / vh)
        ox, oy = (self.width - vw * s) / 2, (self.height - vh * s) / 2
        flat = lambda pts: [c for px, py in pts for c in (self.x + ox + (px - vx) * s, self.top - oy - (py - vy) * s)]
        for polys, fill, stroke, sw in self.shapes:
            if fill is not None:
                tess = Tesselator()
                for pts, _closed in polys:
                    if len(pts) >= 3:
                        tess.add_contour(flat(pts))
                if tess.tesselate(WINDING_NONZERO, TYPE_POLYGONS):
                    g.add(Color(*fill))
                    for verts, idx in tess.meshes:
                        g.add(Mesh(vertices=verts, indices=idx, mode="triangle_fan"))
            if stroke is not None:
                g.add(Color(*stroke))
                for pts, closed in polys:
                    if len(pts) >= 2:
                        g.add(Line(points=flat(pts), width=max(1.0, sw * s), cap="round", joint="round", close=closed))


# ---- the app --------------------------------------------------------------------
class DesignApp(App):
    def build(self):
        self.title = TITLE
        self.scroll = ScrollView(bar_width=8, scroll_type=["bars", "content"], do_scroll_x=True, do_scroll_y=True)
        self._fit = None
        self.show(START)
        return self.scroll

    def show(self, name):
        """Switch to another screen (a frame of the design)."""
        screen = SCREENS[name](self.show)
        holder = FloatLayout(size_hint=(None, None))
        screen.pos_hint = {"center_x": 0.5, "top": 1}
        holder.add_widget(screen)

        def fit(*_):
            holder.size = (max(screen.width, Window.width), screen.height)
        if self._fit:
            Window.unbind(size=self._fit)
        self._fit = fit
        Window.bind(size=fit)
        fit()
        Window.clearcolor = C(*BG.get(name, ("#ffffff", 1.0)))
        self.scroll.clear_widgets()
        self.scroll.add_widget(holder)
        self.scroll.scroll_y = 1
        self.scroll.scroll_x = 0
'''


def build_app(name, data, opts, embed_assets):
    """Return (python_source, assets {filename: bytes}, notes [str])."""
    els, _page = prepare(data, opts.get("page"), opts.get("frame"))
    g = Gen(els, name, embed_assets)
    roots = [e for e in g.by_parent.get(None, []) if e["type"] == "frame" and e.get("visible", True)]
    if not roots:
        raise ValueError("Add at least one frame to export a Kivy app")
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
    screens = [(g.screens[r["id"]], r, g.node(r, None)) for r in roots]
    skipped_loose = len([e for e in g.by_parent.get(None, []) if e["type"] != "frame"])
    if skipped_loose:
        g.notes.add(f"{skipped_loose} element(s) outside frames were not exported (put them inside a frame).")
    if g.skipped:
        g.notes.add(f"{g.skipped} element(s) of an unsupported type were skipped.")
    if g.fonts:
        g.notes.add("Kivy ships only the Roboto font: map other font names to .ttf files in the FONTS dict at the top of main.py.")

    first = roots[0]
    gw, gh = min(first["w"], 1600), min(first["h"], 1000)
    out = [HEADER.format(title=name.replace('"""', "'''"))]
    out.append("from kivy.config import Config\n\n"
               f'Config.set("graphics", "width", "{int(max(320, gw))}")\n'
               f'Config.set("graphics", "height", "{int(max(240, gh))}")\n'
               'Config.set("input", "mouse", "mouse,disable_multitouch")  # no red dots on right-click\n\n')
    imports = IMPORTS + KIVY_IMPORTS
    if embed_assets and g.assets:
        imports = "import base64\n" + imports
    out.append(imports)
    out.append(f"\nTITLE = {name!r}\n")
    if g.fonts:
        out.append("\n# Custom fonts: map a design font name to a .ttf / .otf file (Kivy ships only Roboto).\nFONTS = {\n"
                   + "".join(f'    {f!r}: None,  # e.g. "assets/{f.replace(" ", "")}-Regular.ttf"\n' for f in sorted(g.fonts)) + "}\n")
    else:
        out.append("\nFONTS = {}  # design font name -> .ttf file (Kivy ships only Roboto)\n")
    if g.handlers:
        out.append("\n# " + "-" * 70 + "\n# Event handlers - add your own logic here\n# " + "-" * 70)
        for fn, (kind, label) in g.handlers.items():
            lab = label.replace(chr(34), chr(39)).replace("\n", " ")
            if kind == "on_click":
                out.append(f'\n\ndef {fn}(instance):\n    """Pressed: {lab}"""\n    pass')
            elif kind == "on_select":
                out.append(f'\n\ndef {fn}(instance, value):\n    """Option chosen in: {lab}"""\n    pass')
            else:
                out.append(f'\n\ndef {fn}(instance, value):\n    """Changed: {lab}"""\n    pass')
        out.append("\n")
    out.append("\n# " + "-" * 70 + "\n# Assets (icons as SVG, images)\n# " + "-" * 70)
    for k, v in g.svgs.items():
        out.append(f"\n{k} = {v!r}")
    if embed_assets and g.assets:
        out.append("\nASSETS = {")
        for fname, raw in g.assets.items():
            out.append(f'    "{fname}": base64.b64decode(\n        "{base64.b64encode(raw).decode()}"\n    ),')
        out.append("}")
    else:
        out.append("\nASSETS = {}  # images are loaded from the assets/ folder")
    out.append("\n")
    out.append("\n# " + "-" * 70 + "\n# Screens (one per frame)\n# " + "-" * 70)
    for key, _r, body in screens:
        out.append(f"\n\ndef screen_{key}(show):\n    return {indent(body)}")
    out.append("\n\n\nSCREENS = {\n" + "".join(f'    "{k}": screen_{k},\n' for k, _r, _b in screens) + "}")
    bgs = []
    for key, r, _b in screens:
        f = next((f for f in r["fills"] if isinstance(f, dict) and f.get("type", "solid") == "solid"), None)
        hx, al = rgba(f.get("color")) if f else ("#ffffff", 1.0)
        al = al * min(1.0, max(0.0, num(f.get("opacity"), 1))) if f else 1.0
        bgs.append(f'    "{key}": ("{hx}", {fmt(round(al, 3))}),\n')
    out.append("\n# Page background behind each screen\nBG = {\n" + "".join(bgs) + "}")
    out.append(f'\nSTART = "{screens[0][0]}"\n')
    out.append(RUNTIME)
    out.append('\n\nif __name__ == "__main__":\n    DesignApp().run()\n')
    return "".join(out), ({} if embed_assets else g.assets), sorted(g.notes)


README = """# {name} (Kivy)

Generated by FrameForge.

    pip install -r requirements.txt
    python main.py

- `main.py` - the UI (one function per frame), empty event handlers (`on_click_*`, `on_change_*`, `on_select_*`) for your logic, and a small plain-Kivy runtime at the bottom that draws the design.
- `assets/` - images used by the design.
- `frameforge.json` - the editable design. Use FrameForge > Import to keep editing it.

Each frame is a screen with its own pixel size. Buttons linked to a frame call `show("screen")`.
To ship it to Android / iOS, point [Buildozer](https://buildozer.readthedocs.io) / kivy-ios at this folder.
{notes}"""
