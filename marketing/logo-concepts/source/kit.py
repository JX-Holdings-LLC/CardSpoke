"""Small layout kit for the CardSpoke logo studies: measures Inter glyph ink with Pillow,
lays the wordmark out with boxed letters, then emits Vixl operations."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from vixl import Project
from vixl.fonts import import_font

FONT_DIR = Path("/usr/share/fonts/opentype/inter")
WEIGHTS = {"Regular": "Inter-Regular.otf", "Medium": "Inter-Medium.otf",
           "SemiBold": "Inter-SemiBold.otf", "Bold": "Inter-Bold.otf"}


def ink(font, text):
    """Ink box of text drawn with its pen origin at (0, 0) on the baseline: (l, t, r, b)."""
    img = Image.new("L", (int(font.size * (len(text) + 2)), int(font.size * 3)), 0)
    ox, oy = font.size, int(font.size * 2)
    ImageDraw.Draw(img).text((ox, oy), text, font=font, fill=255, anchor="ls")
    l, t, r, b = img.getbbox()
    return l - ox, t - oy, r - ox, b - oy


class Logo:
    def __init__(self, ink_color="#000000", sw=10, weight="Medium", size=200, tracking=0):
        self.items = []          # (kind, data)
        self.ink_color = ink_color
        self.sw = sw
        self.weight = weight
        self.size = size
        self.tracking = tracking
        self.font = ImageFont.truetype(str(FONT_DIR / WEIGHTS[weight]), size)
        self.cap = -ink(self.font, "H")[1]

    # --- primitives (coordinates are stroke centre lines) ---
    def rect(self, x, y, w, h, fill=None, name=None, r=0, color=None):
        self.items.append(("rect", dict(x=x, y=y, w=w, h=h, fill=fill, name=name, r=r, color=color)))
        return (x, y, w, h)

    def wire(self, pts, name=None, color=None, join="miter", cap="butt"):
        self.items.append(("wire", dict(pts=pts, name=name, color=color, join=join, cap=cap)))

    def dot(self, cx, cy, d, name=None, color=None):
        self.items.append(("dot", dict(cx=cx, cy=cy, d=d, name=name, color=color)))

    def text(self, s, x, baseline, name=None, color=None, size=None, weight=None):
        self.items.append(("text", dict(s=s, x=x, baseline=baseline, name=name, color=color,
                                        size=size or self.size, weight=weight or self.weight)))

    def run_ink(self, s, size=None, weight=None):
        f = self.font if size is None and weight is None else ImageFont.truetype(
            str(FONT_DIR / WEIGHTS[weight or self.weight]), size or self.size)
        return ink(f, s)

    def advance(self, s):
        return self.font.getlength(s) + self.tracking * len(s)

    # --- the wordmark with boxed letters ---
    def wordmark(self, x0, baseline, boxed=("C", "S"), pad=None, gap=None, box_w=None,
                 knockout=False, box_fill=None, text_color=None, radius=0, letters="CardSpoke", lead=0):
        """Lay out `letters`, drawing a card around each letter listed in `boxed` (by index
        for repeated letters: pass ints). Returns {"boxes": [...], "right": x, "runs": [...]}."""
        pad = self.cap * 0.22 if pad is None else pad
        gap = self.cap * 0.16 if gap is None else gap
        idx = [i for i, ch in enumerate(letters) if (i in boxed or ch in boxed)]
        widths = [ink(self.font, letters[i])[2] - ink(self.font, letters[i])[0] for i in idx]
        bw = box_w or (max(widths) + 2 * pad)
        bh = self.cap + 2 * pad
        top = baseline - self.cap - pad
        out = {"boxes": [], "runs": []}
        x = x0
        i = 0
        prev_box = False
        while i < len(letters):
            if i in idx:
                bx = x + self.sw / 2 + (lead if i else 0)
                fill = self.ink_color if knockout else box_fill
                self.rect(bx, top, bw, bh, fill=fill, name=f"card-{letters[i]}", r=radius)
                l, t, r, b = ink(self.font, letters[i])
                lx = bx + bw / 2 - (l + r) / 2
                self.text(letters[i], lx, baseline, name=f"letter-{letters[i]}",
                          color=("#ffffff" if knockout else text_color))
                out["boxes"].append((bx, top, bw, bh))
                x = bx + bw + self.sw / 2
                prev_box = True
                i += 1
            else:
                j = i
                while j < len(letters) and j not in idx:
                    j += 1
                run = letters[i:j]
                l, t, r, b = ink(self.font, run)
                rx = x + (gap if i else 0) - l
                self.text(run, rx, baseline, name=f"word-{run}", color=text_color)
                out["runs"].append((run, rx + l, rx + r))
                x = rx + r + gap
                prev_box = False
                i = j
        out["right"] = out["runs"][-1][2] if not prev_box else x
        out["top"], out["bottom"], out["bw"], out["bh"] = top, top + bh, bw, bh
        return out

    # --- build ---
    def bounds(self):
        xs, ys = [], []
        h = self.sw / 2
        for kind, d in self.items:
            if kind == "rect":
                xs += [d["x"] - h, d["x"] + d["w"] + h]; ys += [d["y"] - h, d["y"] + d["h"] + h]
            elif kind == "wire":
                xs += [p[0] - h for p in d["pts"]] + [p[0] + h for p in d["pts"]]
                ys += [p[1] - h for p in d["pts"]] + [p[1] + h for p in d["pts"]]
            elif kind == "dot":
                xs += [d["cx"] - d["d"] / 2, d["cx"] + d["d"] / 2]; ys += [d["cy"] - d["d"] / 2, d["cy"] + d["d"] / 2]
            else:
                f = ImageFont.truetype(str(FONT_DIR / WEIGHTS[d["weight"]]), d["size"])
                l, t, r, b = ink(f, d["s"])
                xs += [d["x"] + l, d["x"] + r]; ys += [d["baseline"] + t, d["baseline"] + b]
        return min(xs), min(ys), max(xs), max(ys)

    def build(self, margin=40, background=None, square=None, tile=None, tile_radius=0):
        x0, y0, x1, y1 = self.bounds()
        W, H = x1 - x0 + 2 * margin, y1 - y0 + 2 * margin
        if square:
            W = H = square
            dx = (square - (x1 - x0)) / 2 - x0
            dy = (square - (y1 - y0)) / 2 - y0
        else:
            dx, dy = margin - x0, margin - y0
        W, H = round(W), round(H)
        p = Project(W, H, background=background or "transparent")
        used = sorted({d["weight"] for k, d in self.items if k == "text"})
        for w in used:
            import_font(p, str(FONT_DIR / WEIGHTS[w]), f"Inter{w}")
        ops = []
        if tile:
            ops.append({"type": "shape", "shape": "path", "name": "tile", "x": 0, "y": 0, "width": W, "height": H,
                        "path": rounded_rect(tile[0], tile[1], tile[2], tile[3], tile_radius), "fill": tile[4]})
        n = 0
        for kind, d in self.items:
            n += 1
            color = d.get("color") or self.ink_color
            if kind == "rect":
                x, y = d["x"] + dx, d["y"] + dy
                op = {"type": "shape", "shape": "path", "name": d["name"] or f"card-{n}", "x": 0, "y": 0,
                      "width": W, "height": H, "path": rounded_rect(x, y, d["w"], d["h"], d["r"]),
                      "stroke": color, "stroke_width": self.sw, "line_join": "miter" if not d["r"] else "round",
                      "fill": d["fill"] or "none"}
                ops.append(op)
            elif kind == "wire":
                pts = [(px + dx, py + dy) for px, py in d["pts"]]
                path = "M " + " L ".join(f"{px:.2f} {py:.2f}" for px, py in pts)
                ops.append({"type": "shape", "shape": "path", "name": d["name"] or f"spoke-{n}", "x": 0, "y": 0,
                            "width": W, "height": H, "path": path, "stroke": color, "stroke_width": self.sw,
                            "line_join": d["join"], "line_cap": d["cap"], "fill": "none"})
            elif kind == "dot":
                ops.append({"type": "shape", "shape": "ellipse", "name": d["name"] or f"node-{n}",
                            "x": d["cx"] + dx - d["d"] / 2, "y": d["cy"] + dy - d["d"] / 2,
                            "width": d["d"], "height": d["d"], "fill": color})
            else:
                ops.append({"type": "text", "name": d["name"] or f"text-{n}", "text": d["s"], "size": d["size"],
                            "font": f"Inter{d['weight']}", "x": d["x"] + dx, "baseline_y": d["baseline"] + dy,
                            "color": color, "tracking": 0})
        p.apply(ops)
        return p


def rounded_rect(x, y, w, h, r):
    if not r:
        return f"M {x:.2f} {y:.2f} H {x + w:.2f} V {y + h:.2f} H {x:.2f} Z"
    return (f"M {x + r:.2f} {y:.2f} H {x + w - r:.2f} A {r} {r} 0 0 1 {x + w:.2f} {y + r:.2f} "
            f"V {y + h - r:.2f} A {r} {r} 0 0 1 {x + w - r:.2f} {y + h:.2f} H {x + r:.2f} "
            f"A {r} {r} 0 0 1 {x:.2f} {y + h - r:.2f} V {y + r:.2f} A {r} {r} 0 0 1 {x + r:.2f} {y:.2f} Z")
