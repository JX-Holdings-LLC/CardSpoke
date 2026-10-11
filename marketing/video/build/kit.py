"""Helpers for writing the promo's scenes as Vixl operations.

A ``Scene`` collects the same JSON operations ``vixl apply`` takes, imports the app screenshots as
raster layers and saves an editable ``.vixl`` master with a keyframe timeline. Layer order is draw
order. Every scene is 1920x1080; positions are pixels from the top-left.
"""
from __future__ import annotations

import json
import os

from vixl.project import Project
from vixl.typefaces import install_font

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.abspath(os.path.join(HERE, ".."))
SHOTS = os.path.join(VIDEO, "shots")
W, H, FPS = 1920, 1080, 30

BG = "#09090b"
PANEL = "#18181c"
LINE = "#26262c"
INK = "#f5f5f7"
MUTED = "#9a9aa4"
ACCENT = "#ffd23f"

# Registered under their own names: "body" and "display" are also Vixl type roles with defaults of their own.
FONTS = [("Inter", 800, "cs-display"), ("Inter", 500, "cs-body"), ("JetBrains Mono", 600, "cs-mono")]
FONT = {"display": "cs-display", "body": "cs-body", "mono": "cs-mono"}

with open(os.path.join(SHOTS, "boxes.json")) as fh:
    BOXES = json.load(fh)


def box(shot, key):
    return BOXES[shot][key]


class Scene:
    def __init__(self, name: str, duration: int, bg: str = BG):
        self.name, self.duration, self.bg = name, duration, bg
        self.ops: list[dict] = []
        self.images: list[tuple[str, str]] = []
        self.clicks: list[int] = []   # ms of each cursor click, for the sound effects
        self.whooshes: list[int] = []  # ms of big moves

    # ------------------------------------------------------------------ primitives
    def op(self, **kw):
        self.ops.append(kw)

    def rect(self, name, x, y, w, h, fill=None, r=0, stroke=None, sw=2, opacity=None):
        op = {"type": "shape", "shape": "rounded-rectangle" if r else "rectangle", "name": name,
              "x": round(x, 2), "y": round(y, 2), "width": max(1, round(w)), "height": max(1, round(h)),
              "fill": fill if fill is not None else "transparent"}
        if r:
            op["radius"] = r
        if stroke:
            op["stroke"], op["stroke_width"] = stroke, sw
        if opacity is not None:
            op["opacity"] = opacity
        self.ops.append(op)
        return name

    def ellipse(self, name, cx, cy, w, h, fill=None, stroke=None, sw=2, opacity=None):
        op = {"type": "shape", "shape": "ellipse", "name": name, "x": cx - w / 2, "y": cy - h / 2,
              "width": max(1, round(w)), "height": max(1, round(h)), "fill": fill if fill is not None else "transparent"}
        if stroke:
            op["stroke"], op["stroke_width"] = stroke, sw
        if opacity is not None:
            op["opacity"] = opacity
        self.ops.append(op)
        return name

    def line(self, name, pts, stroke, sw=3, opacity=None, cap="round"):
        op = {"type": "pen", "name": name, "points": [[round(x, 2), round(y, 2)] for x, y in pts],
              "closed": False, "smooth": False, "stroke": stroke, "stroke_width": sw, "line_cap": cap}
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

    def text(self, name, s, x, y, size, color=INK, font="display", align="left", spacing=None, tracking=None,
             line_height=None):
        op = {"type": "text", "name": name, "text": s, "x": round(x), "y": round(y), "size": int(size),
              "color": color, "font": FONT[font], "align": align}
        if spacing is not None:
            op["spacing"] = spacing
        if tracking is not None:
            op["tracking"] = tracking
        if line_height is not None:
            op["line_height"] = line_height
        self.ops.append(op)
        return name

    def gradient(self, name, stops, direction="vertical", x=0, y=0, w=W, h=H, opacity=None, center=None,
                 falloff=None):
        op = {"type": "gradient", "name": name, "direction": direction, "x": x, "y": y, "width": round(w),
              "height": round(h), "stops": [{"offset": o, "color": c} for o, c in stops]}
        if center:
            op["center"] = center
        if falloff:
            op["falloff"] = falloff
        if opacity is not None:
            op["opacity"] = opacity
        self.ops.append(op)
        return name

    def image(self, name, file, x, y, width):
        """Import a screenshot and fit it to ``width`` at (x, y)."""
        self.images.append((name, os.path.join(SHOTS, file)))
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

    def shadow(self, target, blur=60, dy=30, opacity=0.55, color="#000000"):
        self.ops.append({"type": "layer-style", "target": target, "name": "drop-shadow",
                         "settings": {"color": color, "offset_x": 0, "offset_y": dy, "blur": blur, "opacity": opacity}})

    def glow(self, target, color=ACCENT, radius=24, opacity=0.6):
        self.ops.append({"type": "layer-style", "target": target, "name": "outer-glow",
                         "settings": {"color": color, "radius": radius, "opacity": opacity}})

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

    def show(self, target, t0, t1=None):
        self.key(target, "visible", 0, False)
        self.key(target, "visible", t0, True)
        if t1 is not None:
            self.key(target, "visible", t1, False)

    def words(self, target, start, preset="fade-up", unit="word", dur=600, stagger=90, **kw):
        self.ops.append({"type": "text-animate", "target": target, "preset": preset, "unit": unit, "start": start,
                         "duration": dur, "stagger": stagger, "extend": False, **kw})

    # ------------------------------------------------------------------ building blocks
    def backdrop(self, glow_at=(0.75, 0.2), drift=True):
        """Near-black stage with a soft accent glow and faint card outlines drifting upward."""
        self.rect("bg", 0, 0, W, H, BG)
        self.gradient("bg_glow", [(0, "#3a3010"), (0.55, "#151310"), (1, BG)], "radial",
                      center=list(glow_at), falloff="smooth", opacity=0.9)
        motif = [(90, 640, 210, 140), (1590, 120, 240, 160), (1670, 760, 170, 120), (300, 90, 150, 100),
                 (860, 930, 200, 130), (40, 300, 120, 90)]
        for i, (x, y, w, h) in enumerate(motif):
            n = self.rect(f"bg_card{i}", x, y, w, h, None, r=10, stroke="#1e1e24", sw=2)
            if drift:
                self.keys(n, "translate-y", [(0, 0, "linear"), (self.duration, -40 - 12 * (i % 3))])

    def window(self, name, x, y, w, shots, title="CardSpoke"):
        """A dark browser-style window. ``shots`` is [(layer, file)], stacked; the first is shown first.
        Returns (group name, content box)."""
        s = w / 1920
        bar = 54 * s * 1.6
        ch = w * 9 / 16
        parts = [self.rect(f"{name}_frame", x - 2, y - 2, w + 4, ch + bar + 4, "#202026", r=22 * s * 1.6)]
        self.shadow(parts[0], blur=80, dy=40, opacity=0.6)
        for i, c in enumerate(("#ff5f57", "#febc2e", "#28c840")):
            parts.append(self.ellipse(f"{name}_dot{i}", x + 30 * s * 1.6 + i * 26 * s * 1.6, y + bar / 2,
                                      14 * s * 1.6, 14 * s * 1.6, c))
        pw = 520 * s * 1.6
        parts.append(self.rect(f"{name}_url", x + w / 2 - pw / 2, y + bar * 0.22, pw, bar * 0.56, "#2b2b32",
                               r=bar * 0.28))
        size = round(18 * s * 1.6)
        parts.append(self.text(f"{name}_urltext", title, x + w / 2 - text_width_estimate(title, size) / 2,
                               y + bar / 2 - size * 0.62, size, MUTED, font="body"))
        base = self.rect(f"{name}_viewport", x, y + bar, w, ch, "#ffffff")
        parts.append(base)
        for layer, file in shots:
            parts.append(self.image(layer, file, x, y + bar, w))
            self.clip(layer, base)
        self.group(name, parts)
        return name, (x, y + bar, w, ch)

    def cursor(self, name="cursor", scale=1.3):
        """An arrow pointer whose tip is at the group's (0, 0) translation origin; move it with
        translate-x/translate-y keys (absolute canvas positions of the tip)."""
        k = 1.25 * scale
        pts = [(0, 0), (0, 34), (9, 26), (15, 40), (21, 37), (15, 24), (27, 24)]
        arrow = self.poly(f"{name}_arrow", [(px * k, py * k) for px, py in pts], "#111111", "#ffffff", 2.5)
        self.shadow(arrow, blur=10, dy=4, opacity=0.5)
        self.group(name, [arrow])
        return name

    def move_cursor(self, name, path):
        """``path``: [(t, x, y, easing?)]; positions are where the tip points."""
        for f in path:
            e = f[3] if len(f) > 3 else "ease-in-out-cubic"
            self.key(name, "translate-x", f[0], f[1], e)
            self.key(name, "translate-y", f[0], f[2], e)

    def click(self, name, t, x, y, color=ACCENT):
        """A ripple at (x, y) at time t."""
        self.clicks.append(t)
        ring = self.ellipse(name, x, y, 90, 90, None, stroke=color, sw=5)
        self.keys(ring, "opacity", [(0, 0), (t, 0, "hold"), (t + 1, 1, "ease-out"), (t + 450, 0)])
        self.keys(ring, "scale", [(0, 0.2), (t, 0.2, "ease-out-cubic"), (t + 450, 1.4)])
        return ring

    def highlight(self, name, rect, t0, t1, pad=10, color=ACCENT, sw=5, r=12):
        x, y, w, h = rect
        n = self.rect(name, x - pad, y - pad, w + 2 * pad, h + 2 * pad, None, r=r, stroke=color, sw=sw)
        self.glow(n, color, radius=18, opacity=0.5)
        self.keys(n, "trim_end", [(0, 0), (t0, 0, "ease-in-out-cubic"), (t0 + 500, 100)])
        self.keys(n, "opacity", [(0, 1), (t1, 1, "ease-in"), (t1 + 300, 0)])
        return n

    def caption(self, name, kicker, headline, t, x=120, y=110, size=84, width=None, color=INK, end=None):
        """A small accent kicker over a large headline, animated in word by word."""
        k = self.text(f"{name}_kicker", kicker.upper(), x, y, 26, ACCENT, font="mono", tracking=0.12)
        self.fade_in(k, t, 450, dy=14)
        h = self.text(f"{name}_head", headline, x, y + 52, size, color, font="display", line_height=1.05)
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
        ops = self.ops
        pending = {name: file for name, file in self.images}
        batch: list[dict] = []
        for op in ops:
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


_FONT_DATA: dict = {}


def text_width_estimate(text: str, size: int, role: str = "body") -> float:
    """Width of one line in pixels, measured with the same font file the scene embeds."""
    import io

    from PIL import ImageFont

    from vixl.typefaces import fetch_font

    family, weight = {r: (f, w) for f, w, r in FONTS}[FONT[role]]
    if role not in _FONT_DATA:
        _FONT_DATA[role] = fetch_font(family, weight, False)[0]
    return ImageFont.truetype(io.BytesIO(_FONT_DATA[role]), size).getlength(text)
