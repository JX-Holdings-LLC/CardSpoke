from kit import Logo

def faithful():
    L = Logo(sw=10)
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    L.rect(cx-16*g, ct-2*g, 6*g, 8*g, name="card-a")
    L.rect(cx-8*g, ct+4*g, 6*g, 6*g, name="card-b")
    L.wire([(cx-10*g, ct+g), (cx-6*g, ct+g), (cx-6*g, ct-4*g), (cx+bw/2, ct-4*g), (cx+bw/2, ct)], name="spoke-a-c")
    L.wire([(cx-13*g, ct+6*g), (cx-13*g, ct+7*g), (cx-8*g, ct+7*g)], name="spoke-a-b")
    L.wire([(cx-5*g, ct+10*g), (cx-5*g, ct+13*g), (sx+bw/2, ct+13*g), (sx+bw/2, ct+10*g)], name="spoke-b-s")
    return L

def compact(sw=10, weight="Medium", nodes=False, accent=None):
    L = Logo(sw=sw, weight=weight)
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    # two smaller cards, same proportions as the letter cards, staggered inside the band
    aw, ah = bw*0.55, bh*0.55
    ax, ay = cx - 3*g - aw - 2.5*g - aw, ct
    bx, by = cx - 3*g - aw, ct + bh - ah
    L.rect(ax, ay, aw, ah, name="card-a")
    L.rect(bx, by, aw, ah, name="card-b")
    col = accent
    L.wire([(ax+aw, ay+ah/2), (cx, ay+ah/2)], name="spoke-a-c", color=col)
    L.wire([(ax+aw/2, ay+ah), (ax+aw/2, by+ah/2), (bx, by+ah/2)], name="spoke-a-b", color=col)
    rail = ct + bh + 2.6*g
    L.wire([(bx+aw/2, by+ah), (bx+aw/2, rail), (sx+bw/2, rail), (sx+bw/2, ct+bh)], name="spoke-b-s", color=col)
    if nodes:
        d = sw*2.6
        for (px, py) in [(cx, ay+ah/2), (ax+aw, ay+ah/2), (ax+aw/2, ay+ah), (bx, by+ah/2), (bx+aw/2, by+ah), (sx+bw/2, ct+bh)]:
            L.dot(px, py, d, color=col)
    return L

def linked():
    L = Logo(sw=10)
    w = L.wordmark(0, 0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    top = ct - 3*g
    L.wire([(cx+bw/2, ct), (cx+bw/2, top), (sx+bw/2, top), (sx+bw/2, ct)], name="spoke-c-s")
    return L

def deck():
    L = Logo(sw=10)
    o0 = L.cap*1.44/10*1.3
    w = L.wordmark(o0*2, 0, lead=2*o0)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    o = o0
    # two cards stacked behind C and S, offset up-left; only their visible edges are drawn
    for k in (1, 2):
        for (x, nm) in ((cx, "c"), (sx, "s")):
            L.wire([(x-k*o, ct+bh-k*o), (x-k*o, ct-k*o), (x+bw-k*o, ct-k*o), (x+bw-k*o, ct-(k-1)*o)], name=f"deck-{nm}-{k}")
    rail = ct + bh + 2.6*g
    L.wire([(cx+bw/2, ct+bh), (cx+bw/2, rail), (sx+bw/2, rail), (sx+bw/2, ct+bh)], name="spoke-c-s")
    return L

def knockout():
    L = Logo(sw=10)
    w = L.wordmark(0, 0, knockout=True)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    aw, ah = bw*0.55, bh*0.55
    ax, ay = cx - 3*g - aw - 2.5*g - aw, ct
    bx, by = cx - 3*g - aw, ct + bh - ah
    L.rect(ax, ay, aw, ah, name="card-a")
    L.rect(bx, by, aw, ah, name="card-b")
    L.wire([(ax+aw, ay+ah/2), (cx, ay+ah/2)], name="spoke-a-c")
    L.wire([(ax+aw/2, ay+ah), (ax+aw/2, by+ah/2), (bx, by+ah/2)], name="spoke-a-b")
    rail = ct + bh + 2.6*g
    L.wire([(bx+aw/2, by+ah), (bx+aw/2, rail), (sx+bw/2, rail), (sx+bw/2, ct+bh)], name="spoke-b-s")
    return L

def rounded():
    L2 = Logo(sw=12, weight="SemiBold")
    r = L2.cap * 1.44 / 10 * 1.6     # 1.6 grid units: the card height is cap + 2 * pad = 1.44 cap
    w = L2.wordmark(0, 0, radius=r)
    (cx, ct, bw, bh), (sx, _, _, _) = w["boxes"]; g = bh / 10
    aw, ah = bw*0.55, bh*0.55
    ax, ay = cx - 3*g - aw - 2.5*g - aw, ct
    bx, by = cx - 3*g - aw, ct + bh - ah
    L2.rect(ax, ay, aw, ah, name="card-a", r=r*0.6)
    L2.rect(bx, by, aw, ah, name="card-b", r=r*0.6)
    L2.wire([(ax+aw, ay+ah/2), (cx, ay+ah/2)], name="spoke-a-c", join="round", cap="round")
    L2.wire([(ax+aw/2, ay+ah), (ax+aw/2, by+ah/2), (bx, by+ah/2)], name="spoke-a-b", join="round", cap="round")
    rail = ct + bh + 2.6*g
    L2.wire([(bx+aw/2, by+ah), (bx+aw/2, rail), (sx+bw/2, rail), (sx+bw/2, ct+bh)], name="spoke-b-s", join="round", cap="round")
    return L2

def glyph(L, ox, oy, u, color=None, fill=None):
    """The card-and-spoke glyph on a 24-unit grid (u px per unit), wired like the wordmark."""
    A = (ox+2*u, oy+3*u, 6*u, 8*u)
    C = (ox+14*u, oy+7*u, 8*u, 11*u)
    B = (ox+7*u, oy+15*u, 5*u, 5*u)
    for (x, y, w, h), nm in ((A, "card-a"), (C, "card-c"), (B, "card-b")):
        L.rect(x, y, w, h, name=nm, color=color, fill=fill)
    L.wire([(ox+8*u, oy+9*u), (ox+14*u, oy+9*u)], name="spoke-a-c", color=color)
    L.wire([(ox+5*u, oy+11*u), (ox+5*u, oy+17.5*u), (ox+7*u, oy+17.5*u)], name="spoke-a-b", color=color)
    L.wire([(ox+9.5*u, oy+20*u), (ox+9.5*u, oy+22.5*u), (ox+18*u, oy+22.5*u), (ox+18*u, oy+18*u)], name="spoke-b-c", color=color)

def lockup():
    L = Logo(sw=10)
    u = L.cap*1.45/19.5
    L.sw = 0.8*u
    glyph(L, 0, -L.cap/2 - 12.75*u, u)
    l, t, r, b = L.run_ink("CardSpoke")
    L.text("CardSpoke", 22*u + 3*u - l, 0, name="wordmark")
    return L

def app_icon():
    L = Logo(sw=34, ink_color="#ffffff")
    u = 1024/24*0.6
    off = (1024 - 24*u)/2
    glyph(L, off, off + 0.3*u, u)
    L.sw = 0.85*u
    return L

VARIANTS = {
    "01-faithful": (faithful, {}),
    "02-compact": (compact, {}),
    "03-linked": (linked, {}),
    "04-deck": (deck, {}),
    "05-knockout": (knockout, {}),
    "06-rounded": (rounded, {}),
    "07-nodes": (lambda: compact(nodes=True), {}),
    "08-heavy": (lambda: compact(sw=20, weight="SemiBold"), {}),
    "09-lockup": (lockup, {}),
    "10-app-icon": (app_icon, {"square": 1024, "tile": (100, 100, 824, 824, "#111111"), "tile_radius": 184}),
}
