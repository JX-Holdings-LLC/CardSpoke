"""Shared helpers for building CardSpoke logo explorations with Vixl."""
import os
import subprocess
from pathlib import Path

from PIL import ImageFont
from vixl import Project

OUT = Path(__file__).resolve().parent.parent
FONT_CACHE = Path(os.environ.get("VIXL_FONT_CACHE", Path.home() / ".cache/vixl/fonts"))


def new(name, width, height, background="transparent", fonts=()):
    """Create a fresh .vixl master, install fonts into it and return the Project."""
    path = OUT / f"{name}.vixl"
    if path.exists():
        path.unlink()
    subprocess.run(["vixl", "new", f"{width}x{height}", "--background", background, "-o", str(path)],
                   check=True, capture_output=True)
    for family, weight in fonts:
        subprocess.run(["vixl", "-p", str(path), "font", "install", family, "--weight", str(weight)],
                       check=True, capture_output=True)
    return Project.load(str(path))


def font_name(family, weight):
    return f"{family.lower().replace(' ', '-')}-{weight}"


class Type:
    """Measures a string so frames, wires and cutouts can be placed on exact glyphs.

    Plain Vixl text sets the layer box to the tight ink bounds (PIL's getbbox), so the pen
    origin of a layer placed at (x, y) is (x - bbox.left, y - bbox.top). Tracked text is rich
    text; with line_height 1 its pen origin is the layer's (x, y) itself.
    Positions here are given as the ink box's top-left; `layer` converts them.
    """

    def __init__(self, family, weight, size, text, tracking=0):
        self.name = font_name(family, weight)
        self.size = size
        self.text = text
        self.tracking = tracking
        self.f = ImageFont.truetype(str(FONT_CACHE / f"{self.name}.ttf"), size)
        self.bbox = self.f.getbbox(text)
        self.width = self.bbox[2] - self.bbox[0] + tracking * (len(text) - 1)
        self.height = self.bbox[3] - self.bbox[1]

    def layer(self, name, x, y, color, **extra):
        """Text operation(s) whose ink box starts at (x, y); tracking is a text-style on the layer."""
        if self.tracking:
            x, y = x - self.bbox[0], y - self.bbox[1]
        ops = [{"type": "text", "name": name, "text": self.text, "size": self.size, "font": self.name,
                "x": round(x), "y": round(y), "color": color, **extra}]
        if self.tracking:
            ops.append({"type": "text-style", "target": name, "tracking": self.tracking, "line_height": 1})
        return ops

    def glyph(self, index, x, y):
        """Ink box [left, top, right, bottom] of character `index` for a layer placed at (x, y)."""
        ox, oy = x - self.bbox[0], y - self.bbox[1]
        advance = self.f.getlength(self.text[:index]) + self.tracking * index
        g = self.f.getbbox(self.text[index])
        return [ox + advance + g[0], oy + g[1], ox + advance + g[2], oy + g[3]]

    def baseline(self, y):
        return y - self.bbox[1] + self.f.getmetrics()[0]

    def cap_top(self, y):
        return self.glyph_top("H", y)

    def glyph_top(self, ch, y):
        return y - self.bbox[1] + self.f.getbbox(ch)[1]


def path(name, d, stroke=None, width=0, fill="none", cap="round", join="round", **extra):
    op = {"type": "shape", "shape": "path", "name": name, "path": d, "x": 0, "y": 0, "fill": fill}
    if stroke:
        op.update(stroke=stroke, stroke_width=width, line_cap=cap, line_join=join)
    op.update(extra)
    return op


def rect(name, x, y, w, h, fill="none", stroke=None, width=0, radius=0, **extra):
    """A rectangle whose stroke is centred on (x, y, w, h); Vixl strokes rectangles inside the box."""
    if stroke:
        x, y, w, h = x - width / 2, y - width / 2, w + width, h + width
        radius = radius + width / 2 if radius else 0
    op = {"type": "shape", "shape": "rounded-rectangle" if radius else "rectangle", "name": name,
          "x": round(x), "y": round(y), "width": round(w), "height": round(h), "fill": fill}
    if radius:
        op["radius"] = radius
    if stroke:
        op.update(stroke=stroke, stroke_width=width)
    op.update(extra)
    return op


def finish(p, name, svg=True):
    """Save the master, export PNG (and SVG), and report check findings that need fixing."""
    p.save()
    for ext in ("png", "svg") if svg else ("png",):
        target = OUT / f"{name}.{ext}"
        if target.exists():
            target.unlink()
        p.export(str(target))
    findings = p.check()
    fixes = [f for f in findings.get("findings", findings.get("issues", [])) if f.get("action") == "fix"] \
        if isinstance(findings, dict) else []
    print(name, "fix findings:", fixes or "none")


def wire_d(points, r=0):
    """SVG path data through `points` with corners rounded to radius `r` (orthogonal wiring)."""
    pts = [tuple(map(float, pt)) for pt in points]
    d = [f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"]
    for i in range(1, len(pts) - 1):
        (x0, y0), (x1, y1), (x2, y2) = pts[i - 1], pts[i], pts[i + 1]
        l1 = max(abs(x1 - x0), abs(y1 - y0))
        l2 = max(abs(x2 - x1), abs(y2 - y1))
        k = min(r, l1 / 2, l2 / 2)
        ax = x1 - k * (x1 - x0) / l1 if l1 else x1
        ay = y1 - k * (y1 - y0) / l1 if l1 else y1
        bx = x1 + k * (x2 - x1) / l2 if l2 else x1
        by = y1 + k * (y2 - y1) / l2 if l2 else y1
        d.append(f"L{ax:.1f} {ay:.1f} Q{x1:.1f} {y1:.1f} {bx:.1f} {by:.1f}")
    d.append(f"L{pts[-1][0]:.1f} {pts[-1][1]:.1f}")
    return " ".join(d)


def dot(name, cx, cy, r, fill, **extra):
    return {"type": "shape", "shape": "ellipse", "name": name, "x": round(cx - r), "y": round(cy - r),
            "width": round(2 * r), "height": round(2 * r), "fill": fill, **extra}
