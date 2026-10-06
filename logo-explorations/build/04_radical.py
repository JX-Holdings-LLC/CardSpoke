"""07-10 - radically different directions."""
import math

from vx import Type, dot, finish, new, path, rect

# 07 - "the wheel": spoke taken literally; cards are the spokes of a bright wheel
p = new("07-card-wheel", 1200, 1200, "#0f1222", fonts=[("Unbounded", 700)])
cx, cy, ring = 600, 470, 250
colors = ["#ff5a36", "#ffb23e", "#2ec4b6", "#3a86ff", "#8338ec", "#ff006e", "#ffd60a", "#06d6a0"]
ops = [dot("rim", cx, cy, ring + 38, "#f4f1ea"), dot("rim-hole", cx, cy, ring + 22, "#0f1222")]
for i, color in enumerate(colors):
    a = math.radians(i * 45 - 90)
    r = ring - 108
    w, h = 78, 124
    ops.append(path(f"spoke-{i}", f"M{cx} {cy} L{cx + math.cos(a) * (ring + 22):.1f} {cy + math.sin(a) * (ring + 22):.1f}",
                    "#f4f1ea", 8))
    ops.append(rect(f"card-{i}", cx - w / 2, cy - r - h / 2, w, h, fill=color, radius=16))
    ops.append({"type": "pivot", "target": f"card-{i}", "value": [cx, cy], "units": "canvas"})
    ops.append({"type": "rotate", "target": f"card-{i}", "value": i * 45})
ops += [dot("hub", cx, cy, 44, "#f4f1ea"), dot("hub-core", cx, cy, 18, "#0f1222")]
word = Type("Unbounded", 700, 118, "CardSpoke")
ops += word.layer("wordmark", cx - word.width / 2, 870, "#f4f1ea")
p.apply(ops)
finish(p, "07-card-wheel")


# 08 - "a hand of cards": warm, literary, for a notes-and-ideas app
p = new("08-hand-of-cards", 1700, 640, "#f6efe3", fonts=[("Fraunces", 700)])
INK, CREAM, CLAY = "#2b1d14", "#fffaf0", "#c8553d"
px, py = 330, 560           # the fan's pivot, below the cards
ops = []
angles = [-30, -15, 0, 15, 30]
for i, ang in enumerate(angles):
    front = i == len(angles) - 1
    name = f"card-{i}"
    ops.append(rect(name, px - 85, 150, 170, 240, fill=CLAY if front else CREAM, stroke=INK, width=8, radius=16))
    ops.append({"type": "pivot", "target": name, "value": [px, py], "units": "canvas"})
    ops.append({"type": "rotate", "target": name, "value": ang})
pip = Type("Fraunces", 700, 120, "C")
ops += pip.layer("pip", px - pip.width / 2, 270 - pip.height / 2, CREAM)
ops.append({"type": "pivot", "target": "pip", "value": [px, py], "units": "canvas"})
ops.append({"type": "rotate", "target": "pip", "value": 30})
word = Type("Fraunces", 700, 190, "CardSpoke")
ops += word.layer("wordmark", 640, 320 - word.height / 2 + 10, INK)
p.apply(ops)
finish(p, "08-hand-of-cards")


# 09 - "index tab": friendly, soft, the name lives on a card
p = new("09-index-tab", 1700, 640, "#ffffff", fonts=[("DM Sans", 500)])
MINT, DEEP, SAGE = "#bfe8d3", "#0d4a3a", "#86cfac"
ops = [
    rect("back-card-2", 190, 136, 1320, 360, fill="#e3f4ea", radius=40),
    rect("back-tab-2", 640, 76, 220, 120, fill="#e3f4ea", radius=26),
    rect("back-card-1", 170, 176, 1360, 360, fill=SAGE, radius=40),
    rect("back-tab-1", 410, 126, 220, 120, fill=SAGE, radius=26),
    rect("body", 150, 216, 1400, 360, fill=MINT, radius=40),
    rect("tab", 180, 176, 220, 100, fill=MINT, radius=26),
    {"type": "pathfinder", "targets": ["body", "tab"], "mode": "union", "name": "card"},
]
word = Type("DM Sans", 500, 200, "cardspoke")
ops += word.layer("wordmark", 850 - word.width / 2, 396 - word.height / 2 + 6, DEEP)
ops.append(dot("dot", 238, 226, 16, DEEP))
p.apply(ops)
finish(p, "09-index-tab")


# 10 - "brutalist": loud stacked type, a hard-shadowed card slab
p = new("10-brutalist", 1200, 1200, "#e8ff3a", fonts=[("Syne", 800)])
INK = "#0a0a0a"
top = Type("Syne", 800, 186, "CARD")
bottom = Type("Syne", 800, 186, "SPOKE")
x0 = 600 - bottom.width / 2
ops = [
    rect("slab-shadow", x0 - 40 + 28, 640 + 28, bottom.width + 80, bottom.height + 90, fill=INK),
    rect("slab", x0 - 40, 640, bottom.width + 80, bottom.height + 90, fill="#ffffff", stroke=INK, width=12),
]
ops += top.layer("card", x0, 640 - top.height - 70, INK)
ops += bottom.layer("spoke", x0, 640 + 45, INK)
ops.append(rect("rule", x0, 640 - 40, bottom.width, 14, fill=INK))
p.apply(ops)
finish(p, "10-brutalist")
