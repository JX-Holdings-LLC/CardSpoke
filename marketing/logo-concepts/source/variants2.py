"""Round 2: three directions plus an app-matched version for each of the four favourites (02, 03, 05, 09)."""
from kit import Logo
from variants import glyph

# The app's own type treatment: Inter Bold headings tracked to -0.03em, square 2 px borders.
APP = dict(weight="Bold", tracking=-6, sw=15)


def side_cards(L, cx, ct, bw, bh, g, solid=False, shadow=0):
    aw, ah = bw*0.55, bh*0.55
    ax, ay = cx - 3*g - aw - 2.5*g - aw, ct
    bx, by = cx - 3*g - aw, ct + bh - ah
    for (x, y, nm) in ((ax, ay, "card-a"), (bx, by, "card-b")):
        L.rect(x, y, aw, ah, name=nm, fill=L.ink_color if solid else None)
    return ax, ay, bx, by, aw, ah


def compact_wires(L, cx, ct, bw, bh, g, sx, ax, ay, bx, by, aw, ah, over=False):
    L.wire([(ax+aw, ay+ah/2), (cx, ay+ah/2)], name="spoke-a-c")
    L.wire([(ax+aw/2, ay+ah), (ax+aw/2, by+ah/2), (bx, by+ah/2)], name="spoke-a-b")
    if over:
        top = ct - 2.6*g
        L.wire([(ax+aw/2, ay), (ax+aw/2, top), (sx+bw/2, top), (sx+bw/2, ct)], name="spoke-a-s")
    else:
        rail = ct + bh + 2.6*g
        L.wire([(bx+aw/2, by+ah), (bx+aw/2, rail), (sx+bw/2, rail), (sx+bw/2, ct+bh)], name="spoke-b-s")


# ---- 02 compact ----
def compact_over():
    L = Logo(sw=10)
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    a = side_cards(L, cx, ct, bw, bh, g)
    compact_wires(L, cx, ct, bw, bh, g, sx, *a, over=True)
    return L


def compact_single():
    L = Logo(sw=10)
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    aw, ah = bw*0.6, bh*0.6
    ax, ay = cx - 3.5*g - aw, ct
    L.rect(ax, ay, aw, ah, name="card-a")
    L.wire([(ax+aw, ay+ah/2), (cx, ay+ah/2)], name="spoke-a-c")
    rail = ct + bh + 2.6*g
    L.wire([(ax+aw/2, ay+ah), (ax+aw/2, rail), (sx+bw/2, rail), (sx+bw/2, ct+bh)], name="spoke-a-s")
    return L


def compact_row():
    L = Logo(sw=10)
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    # cards grow toward the C card, bottoms on one line, joined by short spokes
    s1, s2 = 0.42, 0.66
    bx = cx - 2.5*g - bw*s2
    ax = bx - 2.5*g - bw*s1
    L.rect(ax, ct+bh*(1-s1), bw*s1, bh*s1, name="card-a")
    L.rect(bx, ct+bh*(1-s2), bw*s2, bh*s2, name="card-b")
    y = ct + bh*(1 - s1/2)
    L.wire([(ax+bw*s1, y), (bx, y)], name="spoke-a-b")
    L.wire([(bx+bw*s2, y), (cx, y)], name="spoke-b-c")
    rail = ct + bh + 2.6*g
    L.wire([(bx+bw*s2/2, ct+bh), (bx+bw*s2/2, rail), (sx+bw/2, rail), (sx+bw/2, ct+bh)], name="spoke-b-s")
    return L


def compact_app():
    L = Logo(**APP)
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    a = side_cards(L, cx, ct, bw, bh, g)
    compact_wires(L, cx, ct, bw, bh, g, sx, *a)
    return L


# ---- 03 linked ----
def linked_under():
    L = Logo(sw=10)
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    rail = ct + bh + 2.6*g
    L.wire([(cx+bw/2, ct+bh), (cx+bw/2, rail), (sx+bw/2, rail), (sx+bw/2, ct+bh)], name="spoke-c-s")
    return L


def linked_nodes():
    L = Logo(sw=10)
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    top = ct - 3*g
    L.wire([(cx+bw/2, ct), (cx+bw/2, top), (sx+bw/2, top), (sx+bw/2, ct)], name="spoke-c-s")
    for x in (cx+bw/2, sx+bw/2):
        L.dot(x, ct, L.sw*2.8)
    return L


def linked_heavy():
    L = Logo(sw=20, weight="SemiBold")
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    top = ct - 3*g
    L.wire([(cx+bw/2, ct), (cx+bw/2, top), (sx+bw/2, top), (sx+bw/2, ct)], name="spoke-c-s")
    return L


def linked_app():
    L = Logo(**APP)
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    top = ct - 3*g
    L.wire([(cx+bw/2, ct), (cx+bw/2, top), (sx+bw/2, top), (sx+bw/2, ct)], name="spoke-c-s")
    return L


# ---- 05 knockout ----
def knockout_linked():
    L = Logo(sw=10)
    w = L.wordmark(0, 0, knockout=True)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    top = ct - 3*g
    L.wire([(cx+bw/2, ct), (cx+bw/2, top), (sx+bw/2, top), (sx+bw/2, ct)], name="spoke-c-s")
    return L


def knockout_solid():
    L = Logo(sw=10)
    w = L.wordmark(0, 0, knockout=True)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    a = side_cards(L, cx, ct, bw, bh, g, solid=True)
    compact_wires(L, cx, ct, bw, bh, g, sx, *a)
    return L


def knockout_shadow():
    L = Logo(sw=10)
    o = 0.8 * L.cap * 1.44 / 10          # 0.8 grid unit
    gap = L.cap*0.16 + o                 # room for the shadow before the next letter
    probe = Logo(sw=10); w = probe.wordmark(0, 0, gap=gap)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]
    # solid cards offset down-right, drawn first so the outlined letter cards sit on top
    for x, nm in ((cx, "c"), (sx, "s")):
        L.rect(x + o, ct + o, bw, bh, fill=L.ink_color, name=f"shadow-{nm}")
    w = L.wordmark(0, 0, box_fill="#ffffff", gap=gap)
    g = bh / 10
    a = side_cards(L, cx, ct, bw, bh, g)
    ax, ay, bx, by, aw, ah = a
    L.wire([(ax+aw, ay+ah/2), (cx, ay+ah/2)], name="spoke-a-c")
    L.wire([(ax+aw/2, ay+ah), (ax+aw/2, by+ah/2), (bx, by+ah/2)], name="spoke-a-b")
    rail = ct + bh + 2.6*g
    L.wire([(bx+aw/2, by+ah), (bx+aw/2, rail), (sx+bw/2 + o, rail), (sx+bw/2 + o, ct+bh+o)], name="spoke-b-s")
    return L


def knockout_app():
    L = Logo(**APP)
    w = L.wordmark(0, 0, knockout=True)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    a = side_cards(L, cx, ct, bw, bh, g)
    compact_wires(L, cx, ct, bw, bh, g, sx, *a)
    return L


# ---- 09 lockup ----
def mini_glyph(L, ox, oy, u):
    """Two cards and one spoke on the same 24-unit grid: the icon reduced for favicons."""
    L.rect(ox+3*u, oy+3*u, 8*u, 11*u, name="card-a")
    L.rect(ox+13*u, oy+10*u, 8*u, 11*u, name="card-b")
    L.wire([(ox+7*u, oy+14*u), (ox+7*u, oy+15.5*u), (ox+13*u, oy+15.5*u)], name="spoke-a-b")


def lockup(glyph_fn=glyph, weight="Medium", sw_ratio=0.8, tracking=0, words=None, gap=3):
    L = Logo(sw=10, weight=weight, tracking=tracking)
    u = L.cap*1.45/19.5
    L.sw = sw_ratio*u
    glyph_fn(L, 0, -L.cap/2 - 12.75*u, u)
    x = 22*u + gap*u
    if words:
        for text, wt in words:
            l, t, r, b = L.run_ink(text, weight=wt)
            L.text(text, x - l, 0, name=f"word-{text}", weight=wt)
            x = x - l + r + L.cap*0.07
    else:
        l, t, r, b = L.run_ink("CardSpoke")
        L.text("CardSpoke", x - l, 0, name="wordmark")
    return L


def lockup_stacked():
    L = Logo(sw=10)
    l, t, r, b = L.run_ink("CardSpoke")
    width = r - l
    u = L.cap*2.7/19.5
    L.sw = 0.7*u
    glyph(L, l + width/2 - 12*u, -L.cap - 0.75*L.cap - 22.5*u, u)
    L.text("CardSpoke", 0, 0, name="wordmark")
    return L


def lockup_two_weight():
    return lockup(words=[("Card", "Bold"), ("Spoke", "Regular")])


def lockup_mini():
    return lockup(glyph_fn=mini_glyph)


def lockup_app():
    return lockup(weight="Bold", sw_ratio=1.0, tracking=-6, gap=2.6)


VARIANTS = {
    "02a-compact-over": (compact_over, {}),
    "02b-compact-single": (compact_single, {}),
    "02c-compact-row": (compact_row, {}),
    "02d-compact-app": (compact_app, {}),
    "03a-linked-under": (linked_under, {}),
    "03b-linked-nodes": (linked_nodes, {}),
    "03c-linked-heavy": (linked_heavy, {}),
    "03d-linked-app": (linked_app, {}),
    "05a-knockout-linked": (knockout_linked, {}),
    "05b-knockout-solid": (knockout_solid, {}),
    "05c-knockout-shadow": (knockout_shadow, {}),
    "05d-knockout-app": (knockout_app, {}),
    "09a-lockup-stacked": (lockup_stacked, {}),
    "09b-lockup-two-weight": (lockup_two_weight, {}),
    "09c-lockup-mini": (lockup_mini, {}),
    "09d-lockup-app": (lockup_app, {}),
}
