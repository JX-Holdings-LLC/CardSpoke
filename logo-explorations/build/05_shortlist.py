"""11-13 - second round, crossing the shortlisted directions (02c/02d, 03, 06, 09)."""
from vx import Type, dot, finish, new, path, rect, tabcard_d, wire_d

NAVY, PAPER, AMBER = "#16213a", "#f4f1ea", "#ffb23e"
DEEP, MINT, SAGE, LEAF = "#0d4a3a", "#bfe8d3", "#86cfac", "#2f7d5b"


def centre_on_caps(word, x, cy, letter="C"):
    """Ink-box position that puts `letter`'s vertical centre on cy."""
    g = word.f.getbbox(letter)
    return x, cy - (g[1] - word.bbox[1]) - (g[3] - g[1]) / 2


# 11 - card tree (03) in the reverse palette (02c), wired straight into the framed C and S
SW, PAD = 9, 16
p = new("11-tree-wired", 1700, 640, NAVY, fonts=[("Inter", 500)])
bus, kid_top, cw, ch = 318, 384, 84, 116
kids = [190, 310, 430]
word = Type("Inter", 500, 164, "CardSpoke", tracking=18)
tx, ty = centre_on_caps(word, 610, bus)
c, s = word.glyph(0, tx, ty), word.glyph(4, tx, ty)
ftop, fbot = c[1] - PAD - 6, c[3] + PAD + 6
fc_left = c[0] - PAD
sx = (s[0] + s[2]) / 2
ops = [
    path("trunk", f"M310 250 V{bus}", PAPER, SW),
    path("branch-l", wire_d([(310, bus), (kids[0], bus), (kids[0], kid_top)], 24), PAPER, SW),
    path("branch-r", wire_d([(310, bus), (kids[2], bus), (kids[2], kid_top)], 24), PAPER, SW),
    path("branch-m", f"M310 {bus} V{kid_top}", PAPER, SW),
    path("bus-to-c", f"M380 {bus} H{fc_left}", PAPER, SW),
    path("wire-to-s", wire_d([(kids[2], kid_top + ch), (kids[2], fbot + 70), (sx, fbot + 70), (sx, fbot)], 24),
         PAPER, SW),
    rect("parent", 250, 130, 120, 120, stroke=PAPER, width=SW, radius=12, fill=NAVY),
    rect("parent-line-1", 272, 166, 76, SW, fill=PAPER, radius=SW / 2),
    rect("parent-line-2", 272, 190, 50, SW, fill=PAPER, radius=SW / 2),
    rect("frame-c", fc_left, ftop, c[2] - c[0] + 2 * PAD, fbot - ftop, stroke=AMBER, width=SW, radius=10),
    rect("frame-s", s[0] - PAD, ftop, s[2] - s[0] + 2 * PAD, fbot - ftop, stroke=AMBER, width=SW, radius=10),
]
for i, kx in enumerate(kids):
    filled = i == 1
    ops.append(rect(f"child-{i}", kx - cw / 2, kid_top, cw, ch, radius=12, stroke=None if filled else PAPER,
                    width=SW, fill=AMBER if filled else NAVY))
ops += [dot("joint", 310, bus, 15, AMBER), dot("port-c", fc_left, bus, SW * 1.25, AMBER),
        dot("port-s", sx, fbot, SW * 1.25, AMBER)]
ops += word.layer("wordmark", tx, ty, PAPER)
p.apply(ops)
finish(p, "11-tree-wired")

p = new("11-tree-wired-mark", 512, 512, "transparent")
p.apply([
    rect("tile", 0, 0, 512, 512, fill=NAVY, radius=112),
    path("trunk", "M256 206 V262", PAPER, 20),
    path("branch-l", wire_d([(256, 262), (148, 262), (148, 302)], 26), PAPER, 20),
    path("branch-r", wire_d([(256, 262), (364, 262), (364, 302)], 26), PAPER, 20),
    path("branch-m", "M256 262 V302", PAPER, 20),
    rect("parent", 186, 96, 140, 110, stroke=PAPER, width=20, radius=18, fill=NAVY),
    rect("child-l", 108, 302, 80, 110, stroke=PAPER, width=20, radius=16, fill=NAVY),
    rect("child-m", 206, 292, 100, 130, fill=AMBER, radius=18),
    rect("child-r", 324, 302, 80, 110, stroke=PAPER, width=20, radius=16, fill=NAVY),
    dot("joint", 256, 262, 20, AMBER),
])
finish(p, "11-tree-wired-mark")


# 12 - the CS cards (06) as tabbed index cards (09), in the mint palette
p = new("12-tabbed-cs", 1700, 640, "#ffffff", fonts=[("DM Sans", 500), ("DM Sans", 700)])
SW = 9
cl = Type("DM Sans", 700, 140, "C")
sl = Type("DM Sans", 700, 140, "S")
back = (130, 120, 180, 270)     # x, y, w, h including the tab
front = (290, 196, 180, 270)
tab_h = 38
ops = [
    path("link", wire_d([(220, 390), (220, 510), (380, 510), (380, 466)], 26), DEEP, SW),
    path("card-c", tabcard_d(*back, back[0], 52, tab_h, 16), DEEP, SW, fill="#ffffff"),
    path("card-s", tabcard_d(*front, front[0], 52, tab_h, 16), fill=DEEP),
    dot("port", 220, 390, 15, SAGE),
]
ops += cl.layer("letter-c", 220 - cl.width / 2, back[1] + tab_h + (back[3] - tab_h) / 2 - cl.height / 2, DEEP)
ops += sl.layer("letter-s", 380 - sl.width / 2, front[1] + tab_h + (front[3] - tab_h) / 2 - sl.height / 2, MINT)
word = Type("DM Sans", 500, 190, "cardspoke")
tag = Type("DM Sans", 500, 40, "CARDS, CONNECTED", tracking=10)
wy = 236
ops += word.layer("wordmark", 570, wy, DEEP)
ops += tag.layer("tagline", 578, wy + word.height + 44, LEAF)
p.apply(ops)
finish(p, "12-tabbed-cs")

p = new("12-tabbed-cs-mark", 512, 512, "transparent", fonts=[("DM Sans", 700)])
cl = Type("DM Sans", 700, 110, "C")
sl = Type("DM Sans", 700, 110, "S")
ops = [
    rect("tile", 0, 0, 512, 512, fill=MINT, radius=112),
    path("card-c", tabcard_d(92, 84, 176, 236, 92, 56, 34, 18), DEEP, 20, fill=MINT),
    path("card-s", tabcard_d(244, 180, 176, 236, 244, 56, 34, 18), fill=DEEP),
]
ops += cl.layer("letter-c", 180 - cl.width / 2, 84 + 34 + 101 - cl.height / 2, DEEP)
ops += sl.layer("letter-s", 332 - sl.width / 2, 180 + 34 + 101 - sl.height / 2, MINT)
p.apply(ops)
finish(p, "12-tabbed-cs-mark")


# 13 - the name on a tabbed card (09) that branches into child cards (03), navy and amber (02)
p = new("13-name-card-tree", 1700, 640, "#ffffff", fonts=[("Inter", 500)])
SW = 9
X = 150
card = (X, 150, 1040, 330)
tab_h = 56
body_cy = card[1] + tab_h + (card[3] - tab_h) / 2
right = X + card[2]
bus_x = right + 90
kid_x, kw, kh = bus_x + 60, 150, 100
kid_ys = [body_cy - 150, body_cy, body_cy + 150]
word = Type("Inter", 500, 170, "CardSpoke")
ops = [
    path("trunk", f"M{right} {body_cy} H{kid_x}", NAVY, SW),
    path("branch-up", wire_d([(bus_x, body_cy), (bus_x, kid_ys[0]), (kid_x, kid_ys[0])], 26), NAVY, SW),
    path("branch-down", wire_d([(bus_x, body_cy), (bus_x, kid_ys[2]), (kid_x, kid_ys[2])], 26), NAVY, SW),
    path("name-card", tabcard_d(*card, X + 60, 230, tab_h, 28), fill=NAVY),
    dot("tab-dot", X + 106, card[1] + 34, 13, AMBER),
]
for i, ky in enumerate(kid_ys):
    filled = i == 1
    ops.append(rect(f"child-{i}", kid_x, ky - kh / 2, kw, kh, radius=14, stroke=None if filled else NAVY,
                    width=SW, fill=AMBER if filled else "#ffffff"))
ops.append(dot("joint", bus_x, body_cy, 15, AMBER))
ops += word.layer("wordmark", X + card[2] / 2 - word.width / 2, body_cy - word.height / 2 + 8, PAPER)
p.apply(ops)
finish(p, "13-name-card-tree")

p = new("13-name-card-tree-mark", 512, 512, "transparent")
ops = [
    rect("tile", 0, 0, 512, 512, fill=PAPER, radius=112),
    path("trunk", "M290 285 H384", NAVY, 20),
    path("branch-up", wire_d([(340, 285), (340, 190), (384, 190)], 24), NAVY, 20),
    path("branch-down", wire_d([(340, 285), (340, 380), (384, 380)], 24), NAVY, 20),
    path("name-card", tabcard_d(70, 130, 220, 270, 100, 100, 44, 24), fill=NAVY),
    dot("tab-dot", 128, 152, 11, AMBER),
    rect("line-1", 104, 230, 150, 18, fill=PAPER, radius=9),
    rect("line-2", 104, 268, 100, 18, fill=PAPER, radius=9),
    rect("child-up", 384, 156, 64, 68, stroke=NAVY, width=18, radius=12, fill=PAPER),
    rect("child-mid", 380, 245, 76, 80, fill=AMBER, radius=14),
    rect("child-down", 384, 346, 64, 68, stroke=NAVY, width=18, radius=12, fill=PAPER),
    dot("joint", 340, 285, 18, AMBER),
]
p.apply(ops)
finish(p, "13-name-card-tree-mark")
