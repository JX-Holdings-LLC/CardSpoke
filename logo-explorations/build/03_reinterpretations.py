"""03-06 - same vibe (monoline cards, wiring, framed letters), different readings of the brief."""
from vx import Type, dot, finish, new, path, rect, wire_d

W, H = 1700, 640
SW = 9
INK = "#111111"
PAPER = "#ffffff"


def word_at(word, x, cy):
    """Ink-box position for a wordmark vertically centred on its x-height band at cy."""
    xh = word.f.getbbox("x")
    top_to_x = xh[1] - word.bbox[1]
    return x, cy - top_to_x - (xh[3] - xh[1]) / 2


# 03 - "a tree of cards": the hierarchy is the product, so the mark is a card tree
p = new("03-card-tree", W, H, PAPER, fonts=[("Space Grotesk", 600)])
cw, ch = 84, 116
kids = [190, 310, 430]
bus = 318
ops = [
    path("trunk", wire_d([(310, 250), (310, bus)], 0), INK, SW),
    path("branch-l", wire_d([(310, bus), (kids[0], bus), (kids[0], 384)], 24), INK, SW),
    path("branch-r", wire_d([(310, bus), (kids[2], bus), (kids[2], 384)], 24), INK, SW),
    path("branch-m", wire_d([(310, bus), (310, 384)], 0), INK, SW),
    rect("parent", 310 - 60, 130, 120, 120, stroke=INK, width=SW, radius=12, fill=PAPER),
    rect("parent-line-1", 272, 166, 76, SW, fill=INK, radius=SW / 2),
    rect("parent-line-2", 272, 190, 50, SW, fill=INK, radius=SW / 2),
]
for i, kx in enumerate(kids):
    filled = i == 1
    ops.append(rect(f"child-{i}", kx - cw / 2, 384, cw, ch, radius=12, stroke=None if filled else INK,
                    width=SW, fill=INK if filled else PAPER))
ops.append(dot("joint", 310, bus, 15, INK))
word = Type("Space Grotesk", 600, 176, "CardSpoke")
ops += word.layer("wordmark", *word_at(word, 590, 320), INK)
p.apply(ops)
finish(p, "03-card-tree")


# 04 - "local-first": your data lives inside your own cards; a terminal-flavoured wordmark
p = new("04-nested-local", W, H, PAPER, fonts=[("JetBrains Mono", 600)])
GREEN = "#1f9d55"
ops = [
    rect("card-outer", 140, 150, 250, 330, stroke=INK, width=SW, radius=22, fill=PAPER),
    rect("card-mid", 182, 214, 166, 224, stroke=INK, width=SW, radius=16, fill=PAPER),
    rect("card-inner", 222, 276, 86, 114, radius=11, fill=INK),
    dot("data", 265, 333, 17, GREEN),
    rect("tab-outer", 170, 178, 60, SW, fill=INK, radius=SW / 2),
    rect("tab-mid", 206, 238, 40, SW, fill=INK, radius=SW / 2),
]
word = Type("JetBrains Mono", 600, 150, "cardspoke")
x, y = word_at(word, 470, 330)
ops += word.layer("wordmark", x, y, INK)
last = word.glyph(len(word.text) - 1, x, y)
xband = word.f.getbbox("x")
ops.append(rect("cursor", last[2] + 18, last[3] - (xband[3] - xband[1]) - 34, 56,
                (xband[3] - xband[1]) + 34, fill=GREEN))
p.apply(ops)
finish(p, "04-nested-local")


# 05 - "hub and spokes": many cards, one centre; radial-repeat builds the wheel
p = new("05-hub-spokes", W, H, PAPER, fonts=[("DM Sans", 500)])
cx, cy = 320, 320
ops = [
    path("spoke-line", f"M{cx} {cy - 52} V{cy - 150}", INK, SW),
    rect("spoke-card", cx - 30, cy - 232, 60, 82, stroke=INK, width=SW, radius=9, fill=PAPER),
    {"type": "group", "name": "spoke", "targets": ["spoke-line", "spoke-card"]},
    {"type": "radial-repeat", "target": "spoke", "count": 6, "cx": cx, "cy": cy, "name": "wheel"},
    dot("hub-ring", cx, cy, 52, INK),
    dot("hub-hole", cx, cy, 52 - SW * 1.6, PAPER),
    dot("hub", cx, cy, 18, INK),
]
word = Type("DM Sans", 500, 184, "CardSpoke")
ops += word.layer("wordmark", *word_at(word, 610, 320), INK)
p.apply(ops)
finish(p, "05-hub-spokes")


# 06 - "a monogram you can stamp anywhere": C and S as two cards, one wire between them
p = new("06-cs-cards", W, H, PAPER, fonts=[("Inter", 500), ("Inter", 600)])
ORANGE = "#ff5a36"
c = Type("Inter", 600, 150, "C")
s = Type("Inter", 600, 150, "S")
ops = [
    path("link", wire_d([(214, 420), (214, 470), (382, 470), (382, 430)], 26), INK, SW),
    rect("card-c", 130, 150, 168, 230, stroke=INK, width=SW, radius=18, fill=PAPER),
    rect("card-s", 298, 210, 168, 230, radius=18, fill=INK),
    dot("port", 214, 380, 14, ORANGE),
]
ops += c.layer("letter-c", 214 - c.width / 2, 265 - c.height / 2, INK)
ops += s.layer("letter-s", 382 - s.width / 2, 325 - s.height / 2, PAPER)
word = Type("Inter", 500, 160, "CardSpoke")
tag = Type("Inter", 500, 40, "CARDS, CONNECTED", tracking=10)
ops += word.layer("wordmark", 560, 228, INK)
ops += tag.layer("tagline", 566, 228 + word.height + 46, ORANGE)
p.apply(ops)
finish(p, "06-cs-cards")
