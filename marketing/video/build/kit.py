"""Helpers for writing the promo's scenes as Vixl operations.

A ``Scene`` collects the same JSON operations ``vixl apply`` takes, imports the app screenshots as
raster layers and saves an editable ``.vixl`` master with a keyframe timeline. Layer order is draw
order. Every scene is 1920x1080; positions are pixels from the top-left.

The look follows the logo and the app's cards (see brand/README.md): black ink on white paper, square
corners, one line weight, right-angled spokes, Inter Bold headings at -0.03em. No tints, glows or
gradients. The end card is the one dark frame, on the app icon's #111111.
"""
from __future__ import annotations

import json
import os
import subprocess

from vixl.project import Project
from vixl.typefaces import install_font

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(VIDEO, "..", ".."))
SHOTS = os.path.join(VIDEO, "shots")
WORDMARK = os.path.join(ROOT, "brand", "master", "wordmark.vixl")
W, H, FPS = 1920, 1080, 30

PAPER = "#ffffff"
INK = "#000000"
MUTED = "#5c5c5c"
FAINT = "#e4e4e4"   # background cards and spokes
TILE = "#111111"    # the app icon tile and theme_color
SW = 6              # the one line weight for cards, spokes, frames and highlights

# Registered under their own names: "body" and "display" are also Vixl type roles with defaults of their own.
FONTS = [("Inter", 700, "cs-display"), ("Inter", 500, "cs-body"), ("JetBrains Mono", 600, "cs-mono")]
FONT = {"display": "cs-display", "body": "cs-body", "mono": "cs-mono"}
HEADING_TRACKING = -0.03  # the app's --font-brand heading style, and the wordmark's

with open(os.path.join(SHOTS, "boxes.json")) as fh:
    BOXES = json.load(fh)


def box(shot, key):
    return BOXES[shot][key]


class Scene:
    def __init__(self, name: str, duration: int, bg: str = PAPER):
        self.name, self.duration, self.bg = name, duration, bg
        self.ops: list[dict] = []
        self.images: list[tuple[str, str]] = []
        self.clicks: list[int] = []   # ms of each cursor click, for the sound effects
        self.whooshes: list[int] = []  # ms of big moves
        self.snaps: list[int] = []     # ms of cards landing or logo parts drawing in

    # ------------------------------------------------------------------ primitives
    def op(self, **kw):
        self.ops.append(kw)

    def rect(self, name, x, y, w, h, fill=None, stroke=None, sw=SW, opacity=None):
        op = {"type": "shape", "shape": "rectangle", "name": name, "x": round(x, 2), "y": round(y, 2),
              "width": max(1, round(w)), "height": max(1, round(h)),
              "fill": fill if fill is not None else "transparent"}
        if stroke:
            op["stroke"], op["stroke_width"] = stroke, sw
        if opacity is not None:
            op["opacity"] = opacity
        self.ops.append(op)
        return name

    def card(self, name, x, y, w, h, stroke=INK, fill=PAPER, sw=SW):
        """A square-cornered card outlined on its edge, as the logo draws them: the stroke is centred on
        (x, y, w, h), so cards and spokes meet exactly."""
        pad = sw / 2
        op = {"type": "shape", "shape": "path", "name": name, "x": round(x - pad, 2), "y": round(y - pad, 2),
              "width": round(w + sw, 2), "height": round(h + sw, 2), "path_view": [round(w + sw, 2), round(h + sw, 2)],
              "path": f"M {pad} {pad} H {w + pad:.2f} V {h + pad:.2f} H {pad} Z",
              "fill": fill or "transparent", "stroke": stroke, "stroke_width": sw, "line_join": "miter"}
        self.ops.append(op)
        return name

    def line(self, name, pts, stroke=INK, sw=SW, opacity=None, cap="butt"):
        op = {"type": "pen", "name": name, "points": [[round(x, 2), round(y, 2)] for x, y in pts],
              "closed": False, "smooth": False, "stroke": stroke, "stroke_width": sw, "line_cap": cap,
              "line_join": "miter"}
        if opacity is not None:
            op["opacity"] = opacity
        self.ops.append(op)
        return name

    def poly(self, name, pts, fill, stroke=None, sw=2):
        op = {"type": "pen", "name": name, "points": [[round(x, 2), round(y, 2)] for x, y in pts],
              "closed": True, "smooth": False, "fill": fill}
        if stroke:
            op["stroke"], op["stroke_width"] = stroke, sw
        self.ops.append(op)
        return name

    def text(self, name, s, x, y, size, color=INK, font="display", align="left", tracking=None, line_height=None):
        op = {"type": "text", "name": name, "text": s, "x": round(x), "y": round(y), "size": int(size),
              "color": color, "font": FONT[font], "align": align}
        if tracking is None and font == "display":
            tracking = HEADING_TRACKING
        if tracking is not None:
            op["tracking"] = tracking
        if line_height is not None:
            op["line_height"] = line_height
        self.ops.append(op)
        return name

    def centred(self, name):
        self.ops.append({"type": "move", "target": name, "x": "center"})

    def image(self, name, file, x, y, width):
        """Import an image (a path under ``shots/`` or absolute) and fit it to ``width`` at (x, y)."""
        self.images.append((name, file if os.path.isabs(file) else os.path.join(SHOTS, file)))
        self.ops.append({"type": "resize", "target": name, "width": round(width), "keep_aspect": True})
        self.ops.append({"type": "move", "target": name, "x": round(x, 2), "y": round(y, 2)})
        return name

    def group(self, name, children):
        self.ops.append({"type": "group", "name": name, "targets": list(children)})
        return name

    def clip(self, target, base):
        self.ops.append({"type": "clip", "target": target, "base": base})

    def pivot(self, target, value):
        self.ops.append({"type": "pivot", "target": target, "value": value})

    # ------------------------------------------------------------------ motion
    def key(self, target, prop, t, value, easing=None):
        op = {"type": "keyframe", "target": target, "property": prop, "time": max(0, round(t)), "value": value}
        if easing:
            op["easing"] = easing
        self.ops.append(op)

    def keys(self, target, prop, frames):
        """``frames``: [(t, value, easing?)...]."""
        for f in frames:
            self.key(target, prop, f[0], f[1], f[2] if len(f) > 2 else None)

    def fade_in(self, target, t, dur=500, dy=0, easing="ease-out-cubic"):
        self.keys(target, "opacity", [(0, 0), (t, 0, easing), (t + dur, 1)])
        if dy:
            self.keys(target, "translate-y", [(0, dy), (t, dy, easing), (t + dur, 0)])

    def fade_out(self, target, t, dur=400, easing="ease-in-cubic"):
        self.key(target, "opacity", t, 1, easing)
        self.key(target, "opacity", t + dur, 0)

    def draw_on(self, target, t, dur=550, easing="ease-in-out-cubic"):
        self.keys(target, "trim_end", [(0, 0), (t, 0, easing), (t + dur, 100)])

    def show(self, target, t0, t1=None):
        self.key(target, "visible", 0, False)
        self.key(target, "visible", t0, True)
        if t1 is not None:
            self.key(target, "visible", t1, False)

    def words(self, target, start, preset="fade-up", unit="word", dur=600, stagger=90, **kw):
        self.ops.append({"type": "text-animate", "target": target, "preset": preset, "unit": unit, "start": start,
                         "duration": dur, "stagger": stagger, "extend": False, **kw})

    # ------------------------------------------------------------------ building blocks
    def backdrop(self, seed=0, drift=True, color=FAINT, bg=None):
        """Paper with a few faint cards joined by right-angled spokes, drifting slowly upward."""
        self.rect("bg", 0, 0, W, H, bg or self.bg)
        layouts = [
            [(70, 70, 150, 104), (250, 150, 96, 70), (1650, 820, 170, 120), (1520, 930, 96, 70)],
            [(1680, 60, 170, 120), (1560, 200, 96, 70), (60, 860, 150, 104), (250, 960, 96, 70)],
        ]
        cards = layouts[seed % len(layouts)]
        parts = []
        for i, (x, y, w, h) in enumerate(cards):
            parts.append(self.card(f"bg_card{i}", x, y, w, h, stroke=color, fill=None, sw=4))
        for i in (0, 2):  # each big card feeds the small one beside it, as in the logo
            (ax, ay, aw, ah), (bx, by, bw, bh) = cards[i], cards[i + 1]
            if bx > ax:
                pts = [(ax + aw / 2, ay + ah), (ax + aw / 2, by + bh / 2), (bx, by + bh / 2)]
            else:
                pts = [(ax + aw / 2, ay + ah), (ax + aw / 2, by + bh / 2), (bx + bw, by + bh / 2)]
            parts.append(self.line(f"bg_spoke{i}", pts, color, sw=4))
        g = self.group("bg_cards", parts)
        if drift:
            self.keys(g, "translate-y", [(0, 0, "linear"), (self.duration, -36)])
        return g

    def kicker(self, name, label, x, y, t=None, inverse=False):
        """A small black label with white capitals, like the app's selected view toggle (GRID)."""
        size = 24
        tw = text_width_estimate(label.upper(), size, "display", tracking=0.08)
        bg = self.rect(f"{name}_bg", x, y, tw + 32, size + 22, PAPER if inverse else INK)
        t_ = self.text(f"{name}_t", label.upper(), x + 16, y + 10, size, INK if inverse else PAPER,
                       font="display", tracking=0.08)
        g = self.group(name, [bg, t_])
        if t is not None:
            self.keys(g, "opacity", [(0, 0), (t, 0, "ease-out"), (t + 250, 1)])
            self.keys(g, "translate-x", [(0, -24), (t, -24, "ease-out-cubic"), (t + 450, 0)])
        return g

    def window(self, name, x, y, w, shots, title="CardSpoke  ·  My Brain", deck=True):
        """The app as a card: the screenshot inside a black-edged card with a tab on top and, behind it,
        a second card offset like the logo's stacked cards. ``shots`` is [(layer, file)], stacked; the first
        is shown first. Returns (group name, content box)."""
        ch = w * 9 / 16
        tab_h = 46
        parts = []
        if deck:
            parts.append(self.card(f"{name}_under", x + 26, y + 26, w, ch, fill=PAPER))
        tab_w = text_width_estimate(title, 22, "display") + 40
        parts.append(self.rect(f"{name}_tab", x - SW / 2, y - tab_h, tab_w, tab_h, INK))
        parts.append(self.text(f"{name}_tabtext", title, x - SW / 2 + 20, y - tab_h + 11, 22, PAPER, font="display",
                               tracking=0))
        base = self.rect(f"{name}_viewport", x, y, w, ch, PAPER)
        parts.append(base)
        for layer, file in shots:
            parts.append(self.image(layer, file, x, y, w))
            self.clip(layer, base)
        parts.append(self.card(f"{name}_edge", x, y, w, ch, fill=None))
        self.group(name, parts)
        return name, (x, y, w, ch)

    def cursor(self, name="cursor", scale=1.3):
        """An arrow pointer whose tip is at the group's (0, 0) translation origin; move it with
        translate-x/translate-y keys (absolute canvas positions of the tip)."""
        k = 1.25 * scale
        pts = [(0, 0), (0, 34), (9, 26), (15, 40), (21, 37), (15, 24), (27, 24)]
        arrow = self.poly(f"{name}_arrow", [(px * k, py * k) for px, py in pts], INK, PAPER, 2.5)
        self.group(name, [arrow])
        return name

    def move_cursor(self, name, path):
        """``path``: [(t, x, y, easing?)]; positions are where the tip points."""
        for f in path:
            e = f[3] if len(f) > 3 else "ease-in-out-cubic"
            self.key(name, "translate-x", f[0], f[1], e)
            self.key(name, "translate-y", f[0], f[2], e)

    def click(self, name, t, x, y, color=INK):
        """A square ripple at (x, y) at time t."""
        self.clicks.append(t)
        ring = self.card(name, x - 36, y - 36, 72, 72, stroke=color, fill=None, sw=4)
        self.keys(ring, "opacity", [(0, 0), (t, 0, "hold"), (t + 1, 1, "ease-out"), (t + 450, 0)])
        self.keys(ring, "scale", [(0, 0.3), (t, 0.3, "ease-out-cubic"), (t + 450, 1.3)])
        return ring

    def highlight(self, name, rect, t0, t1, pad=10, color=INK):
        """A card outline drawn around a piece of UI, then faded."""
        x, y, w, h = rect
        n = self.card(name, x - pad, y - pad, w + 2 * pad, h + 2 * pad, stroke=color, fill=None)
        self.draw_on(n, t0, 500)
        self.keys(n, "opacity", [(0, 1), (t1, 1, "ease-in"), (t1 + 300, 0)])
        return n

    def spoke(self, name, pts, t, dur=500, color=INK, sw=SW):
        """A right-angled connector that draws itself from its first point."""
        n = self.line(name, pts, color, sw=sw)
        self.draw_on(n, t, dur, "ease-out-cubic")
        return n

    def caption(self, name, kicker, headline, t, x=96, y=200, size=72, end=None):
        """A kicker label over a large headline, animated in word by word."""
        k = self.kicker(f"{name}_kicker", kicker, x, y, t)
        h = self.text(f"{name}_head", headline, x - 4, y + 76, size, INK, font="display", line_height=1.04)
        self.words(h, t + 120, dur=650, stagger=80)
        layers = [k, h]
        if end is not None:
            for n in layers:
                self.fade_out(n, end, 350)
        return layers

    # ------------------------------------------------------------------ output
    def build(self, directory):
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, f"{self.name}.vixl")
        project = Project.new(width=W, height=H, background=self.bg)
        for family, weight, role in FONTS:
            install_font(project, family, weight, name=role)
        project.apply([{"type": "timeline-set", "duration": self.duration, "fps": FPS, "loop": 1}], detail="brief")
        # Images must exist before operations that address them; import them in order of first use.
        pending = {name: file for name, file in self.images}
        batch: list[dict] = []
        for op in self.ops:
            target = op.get("target")
            if op.get("type") == "resize" and target in pending:
                if batch:
                    project.apply(batch, detail="brief")
                    batch = []
                project.import_image(pending.pop(target), name=target)
            batch.append(op)
        for i in range(0, len(batch), 9000):
            project.apply(batch[i:i + 9000], detail="brief")
        if os.path.exists(path):
            os.remove(path)
        project.save(path)
        return path


# ---------------------------------------------------------------------------------------------- the logo
WORDMARK_PARTS = ["card-a", "spoke-a-b", "card-b", "spoke-a-c", "card-C", "spoke-b-s", "card-S"]
LETTER_LAYERS = ["letter-C", "word-ard", "letter-S", "word-poke"]
_LETTERS: dict = {}


def wordmark_geometry():
    """The wordmark master's cards and spokes: ({name: (path, stroke_width)}, (view_w, view_h))."""
    master = Project.load(WORDMARK)
    parts = {}
    for name in WORDMARK_PARTS:
        layer = master.layer(name)
        parts[name] = (layer["path"], layer["stroke_width"])
    return parts, tuple(master.layer(WORDMARK_PARTS[0])["path_view"])


def wordmark_letters(color):
    """A PNG of the wordmark's letters alone, the full master canvas at 3x, in ``color`` (built on demand
    into ``build/.logo/``, which is not committed)."""
    if color in _LETTERS:
        return _LETTERS[color]
    from PIL import Image

    cache = os.path.join(HERE, ".logo")
    os.makedirs(cache, exist_ok=True)
    src = os.path.join(cache, "letters.vixl")
    black = os.path.join(cache, "letters-black.png")
    if not os.path.exists(black) or os.path.getmtime(black) < os.path.getmtime(WORDMARK):
        master = Project.load(WORDMARK)
        master.apply([{"type": "delete", "target": n} for n in WORDMARK_PARTS], detail="brief")
        master.save(src, overwrite=True)
        subprocess.run(["vixl", "-p", src, "render", "--scale", "3", "--out", black, "--overwrite"], check=True,
                       capture_output=True)
    out = os.path.join(cache, f"letters-{color.lstrip('#')}.png")
    if out != black:
        im = Image.open(black).convert("RGBA")
        solid = Image.new("RGBA", im.size, color)
        solid.putalpha(im.getchannel("A"))
        solid.save(out)
    _LETTERS[color] = out
    return out


def logo(sc, name, cx, cy, width, t0, color=INK, step=170):
    """The CardSpoke wordmark from brand/master/wordmark.vixl. Its cards and spokes draw themselves in the
    order the logo reads (small card, spoke, small card, spoke, C card, spoke, S card), then the letters
    rise into their cards. Returns (group, (x, y, w, h), time the logo is complete)."""
    parts, (vw, vh) = wordmark_geometry()
    k = width / vw
    h = vh * k
    ox, oy = cx - width / 2, cy - h / 2
    layers = []
    t = t0
    for part in WORDMARK_PARTS:
        path, sw = parts[part]
        n = f"{name}_{part}"
        sc.op(type="shape", shape="path", name=n, x=round(ox, 2), y=round(oy, 2), width=round(width, 2),
              height=round(h, 2), path_view=[vw, vh], path=path, stroke=color, stroke_width=round(sw * k, 2),
              line_join="miter", line_cap="butt", fill="transparent")
        is_card = part.startswith("card")
        dur = 520 if is_card else 380
        sc.draw_on(n, t, dur, "ease-in-out-cubic" if is_card else "ease-out-cubic")
        if is_card:
            sc.snaps.append(t + dur - 60)
        layers.append(n)
        t += step if is_card else step * 0.7
    t_letters = t + 120
    letters = sc.image(f"{name}_letters", wordmark_letters(color), ox, oy, width)
    sc.fade_in(letters, t_letters, 500, dy=10)
    layers.append(letters)
    g = sc.group(name, layers)
    return g, (ox, oy, width, h), t_letters + 500


_FONT_DATA: dict = {}


def text_width_estimate(text: str, size: int, role: str = "body", tracking: float | None = None) -> float:
    """Width of one line in pixels, measured with the same font file the scene embeds."""
    import io

    from PIL import ImageFont

    from vixl.typefaces import fetch_font

    family, weight = {r: (f, w) for f, w, r in FONTS}[FONT[role]]
    if role not in _FONT_DATA:
        _FONT_DATA[role] = fetch_font(family, weight, False)[0]
    if tracking is None:
        tracking = HEADING_TRACKING if role == "display" else 0
    base = ImageFont.truetype(io.BytesIO(_FONT_DATA[role]), size).getlength(text)
    return base + tracking * size * max(0, len(text) - 1)
