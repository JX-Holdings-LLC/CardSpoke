"""02 - the original idea, refined: one stroke weight, matched cards, even frames, routed wires.

Variants: a (ink on white), b (two-tone accent), c (reversed on dark), and a square app mark.
"""
from vx import Type, dot, finish, new, path, rect, wire_d

SW = 9
R = 10           # card corner radius
WIRE_R = 22      # wire bend radius
PAD = 16         # glyph to frame clearance


def lockup(p, ink, accent, wire, port, x0=150, cap_top=250):
    word = Type("Inter", 500, 180, "CardSpoke", tracking=20)
    c_top = word.f.getbbox("C")[1] - word.bbox[1]          # C ink top below the string's ink top
    tx, ty = x0 + 330, cap_top - c_top
    c, s = word.glyph(0, tx, ty), word.glyph(4, tx, ty)
    ftop, fbot = c[1] - PAD - 6, c[3] + PAD + 6
    fh = fbot - ftop
    cx, sx = (c[0] + c[2]) / 2, (s[0] + s[2]) / 2

    # playing-card proportion (5:7) for the loose cards, aligned to the frame band
    aw, ah = 5 * 24, 7 * 24
    ax, ay = x0, ftop - 40
    bw, bh = 5 * 17, 7 * 17
    bx, by = ax + aw + 70, ay + ah - 30
    above = ay - 34
    below = fbot + 64

    ops = [
        path("wire-a-c", wire_d([(ax + aw, ay + ah * 0.32), (ax + aw + 35, ay + ah * 0.32),
                                 (ax + aw + 35, above), (cx, above), (cx, ftop)], WIRE_R), wire, SW),
        path("wire-a-b", wire_d([(ax + aw * 0.5, ay + ah), (ax + aw * 0.5, by + bh * 0.5),
                                 (bx, by + bh * 0.5)], WIRE_R), wire, SW),
        path("wire-b-s", wire_d([(bx + bw * 0.5, by + bh), (bx + bw * 0.5, below),
                                 (sx, below), (sx, fbot)], WIRE_R), wire, SW),
        rect("card-a", ax, ay, aw, ah, fill=port, stroke=ink, width=SW, radius=R),
        rect("card-b", bx, by, bw, bh, fill=port, stroke=ink, width=SW, radius=R),
        rect("frame-c", c[0] - PAD, ftop, c[2] - c[0] + 2 * PAD, fh, stroke=accent, width=SW, radius=R),
        rect("frame-s", s[0] - PAD, ftop, s[2] - s[0] + 2 * PAD, fh, stroke=accent, width=SW, radius=R),
        dot("port-c", cx, ftop, SW * 1.25, accent),
        dot("port-s", sx, fbot, SW * 1.25, accent),
        *word.layer("wordmark", tx, ty, ink),
    ]
    p.apply(ops)
    return word


fonts = [("Inter", 500)]

p = new("02a-refined", 1700, 640, "#ffffff", fonts=fonts)
lockup(p, ink="#111111", accent="#111111", wire="#111111", port="#ffffff")
finish(p, "02a-refined")

p = new("02b-refined-accent", 1700, 640, "#ffffff", fonts=fonts)
lockup(p, ink="#16213a", accent="#ff5a36", wire="#16213a", port="#ffffff")
finish(p, "02b-refined-accent")

p = new("02c-refined-reverse", 1700, 640, "#16213a", fonts=fonts)
lockup(p, ink="#f4f1ea", accent="#ffb23e", wire="#f4f1ea", port="#16213a")
finish(p, "02c-refined-reverse")

# square app mark: the two cards and their wire, with the C frame implied by the bigger card
p = new("02d-refined-mark", 512, 512, "transparent")
p.apply([
    rect("tile", 0, 0, 512, 512, fill="#16213a", radius=112),
    path("wire", wire_d([(224, 172), (352, 172), (352, 236)], 34), "#f4f1ea", 26),
    rect("card-a", 88, 84, 136, 192, fill="#16213a", stroke="#f4f1ea", width=26, radius=20),
    rect("card-b", 268, 236, 168, 200, fill="#ffb23e", radius=24),
    dot("port", 352, 236, 26, "#f4f1ea"),
])
finish(p, "02d-refined-mark")
