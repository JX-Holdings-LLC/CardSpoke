"""The ten shots of the CardSpoke promo. Each function returns a ``Scene``; ``SCENES`` is the cut order.

Screenshots come from ``../shots`` (``capture/capture.mjs`` drives the real app), and ``boxes.json``
holds where UI elements sit in them, so the cursor and highlights land on the real interface.
"""
from __future__ import annotations

import random

from kit import ACCENT, BG, INK, MUTED, PANEL, H, W, Scene, box, text_width_estimate

# The app window sits right of a caption column in the product shots, so consecutive shots line up.
WIN_X, WIN_Y, WIN_W = 640, 160, 1200
CAP_X = 96

# CardSpoke.svg's mark in SVG units: four boxes and the "spokes" joining them.
LOGO_BOXES = [(150, 587.9, 101.8, 125.3), (273.6, 694.1, 90.5, 90.5), (400.6, 623.2, 147.3, 161.4),
              (823.4, 623.2, 125.6, 161.4)]
LOGO_LINES = [[(314.7, 583.7), (314.7, 652.0)], [(318.8, 650.6), (251.8, 650.6)],
              [(314.7, 587.9), (478.5, 587.9)], [(474.3, 587.9), (474.3, 623.2)],
              [(200.9, 713.2), (200.9, 739.4)], [(196.7, 739.4), (273.6, 739.4)],
              [(318.8, 784.6), (318.8, 822.2)], [(314.7, 822.2), (889.8, 822.2)],
              [(886.2, 822.2), (886.2, 784.6)]]
LOGO_PNG_W, LOGO_PNG_H, LOGO_UNITS_W = 2470, 530, 1235


def to_canvas(content, rect):
    """A screenshot-pixel rect [x, y, w, h] mapped into a window's content box."""
    cx, cy, cw, _ = content
    s = cw / 1920
    x, y, w, h = rect
    return (cx + x * s, cy + y * s, w * s, h * s)


def centre(r):
    return (r[0] + r[2] / 2, r[1] + r[3] / 2)


def logo(sc, name, cx, cy, width, t0, draw=True, hold_vector=False):
    """The CardSpoke logo: boxes and spokes draw on as vectors, then the wordmark fades in over them."""
    k = width / LOGO_UNITS_W
    h = LOGO_PNG_H * width / LOGO_PNG_W
    ox, oy = cx - width / 2, cy - h / 2

    def p(x, y):
        return (ox + (x - 140) * k, oy + (y - 575) * k)

    parts = []
    if draw:
        for i, (x, y, w, hh) in enumerate(LOGO_BOXES):
            # Vixl strokes a rectangle inside its box; the SVG strokes on the outline, so grow by half a stroke.
            x0, y0 = p(x - 6.75, y - 6.75)
            n = sc.rect(f"{name}_box{i}", x0, y0, (w + 13.5) * k, (hh + 13.5) * k, None, stroke="#ffffff",
                        sw=13.5 * k)
            t = t0 + i * 160
            sc.keys(n, "trim_end", [(0, 0), (t, 0, "ease-in-out-cubic"), (t + 650, 100)])
            parts.append(n)
        for i, seg in enumerate(LOGO_LINES):
            n = sc.line(f"{name}_spoke{i}", [p(*seg[0]), p(*seg[1])], "#ffffff", sw=8.25 * k, cap="square")
            t = t0 + 500 + i * 70
            sc.keys(n, "trim_end", [(0, 0), (t, 0, "ease-out-cubic"), (t + 380, 100)])
            parts.append(n)
    mark = sc.image(f"{name}_png", "logo-white.png", ox, oy, width)
    t_word = t0 + (1250 if draw else 0)
    sc.keys(mark, "opacity", [(0, 0), (t_word, 0, "ease-out-cubic"), (t_word + 600, 1)])
    if draw and not hold_vector:
        for n in parts:
            sc.show(n, 0, t_word + 650)
    return mark, parts, (ox, oy, width, h)


# ---------------------------------------------------------------------------------------------- 01 intro
def intro():
    sc = Scene("01-intro", 5000)
    sc.backdrop(glow_at=(0.5, 0.48))
    mark, parts, (ox, oy, lw, lh) = logo(sc, "logo", W / 2, H / 2 - 60, 1100, 300)
    group = sc.group("logo_all", [*parts, mark])
    sc.keys(group, "scale", [(0, 0.94, "ease-out-cubic"), (4200, 1.0)])
    tag = sc.text("tagline", "Think in cards.", 0, oy + lh + 70, 64, INK, font="display", align="center")
    sc.op(type="move", target=tag, x="center")
    sc.words(tag, 2300, dur=700, stagger=110)
    rule = sc.line("tag_rule", [(W / 2 - 140, oy + lh + 170), (W / 2 + 140, oy + lh + 170)], ACCENT, sw=6)
    sc.keys(rule, "trim_start", [(0, 50), (2900, 50, "ease-out-cubic"), (3500, 0)])
    sc.keys(rule, "trim_end", [(0, 50), (2900, 50, "ease-out-cubic"), (3500, 100)])
    sc.whooshes.append(250)
    return sc


# ---------------------------------------------------------------------------------------------- 02 chaos -> tree
def chaos():
    sc = Scene("02-shape", 6500)
    sc.backdrop(glow_at=(0.5, 0.6))
    rng = random.Random(7)

    head1 = sc.text("head1", "Notes pile up.", CAP_X, 96, 88, INK)
    sc.words(head1, 150, dur=600, stagger=90)
    sc.fade_out(head1, 2500, 350)
    head2 = sc.text("head2", "CardSpoke gives them shape.", CAP_X, 96, 88, INK)
    sc.words(head2, 2850, dur=650, stagger=90)

    cw, ch = 250, 92
    tree = {
        "Novel": (W / 2, 330),
        "Characters": (W / 2 - 520, 560), "Plot": (W / 2, 560), "Research": (W / 2 + 520, 560),
        "Mara": (W / 2 - 660, 800), "Elias": (W / 2 - 380, 800),
        "Act I": (W / 2 - 140, 800), "Act II": (W / 2 + 140, 800),
        "Tide tables": (W / 2 + 380, 800), "Lenses": (W / 2 + 660, 800),
    }
    edges = [("Novel", c) for c in ("Characters", "Plot", "Research")] + [
        ("Characters", "Mara"), ("Characters", "Elias"), ("Plot", "Act I"), ("Plot", "Act II"),
        ("Research", "Tide tables"), ("Research", "Lenses")]
    extras = ["Call Sam", "Groceries?", "Podcast idea", "Ramen place"]

    # Spokes first so the cards sit on top of them.
    for i, (a, b) in enumerate(edges):
        (ax, ay), (bx, by) = tree[a], tree[b]
        mid = (ay + ch / 2 + by - ch / 2) / 2
        n = sc.line(f"spoke{i}", [(ax, ay + ch / 2), (ax, mid), (bx, mid), (bx, by - ch / 2)], "#5b5b66", sw=4,
                    cap="square")
        t = 3600 + (0 if a == "Novel" else 350) + i * 40
        sc.keys(n, "trim_end", [(0, 0), (t, 0, "ease-in-out-cubic"), (t + 550, 100)])

    def note(label, x, y, idx, accent=False):
        name = f"note{idx}"
        body = sc.rect(f"{name}_bg", x - cw / 2, y - ch / 2, cw, ch, PANEL, r=14,
                       stroke=ACCENT if accent else "#34343c", sw=3)
        bar = sc.rect(f"{name}_bar", x - cw / 2 + 22, y - 6, 10, 10, ACCENT if accent else "#55555f", r=3)
        t = sc.text(f"{name}_t", label, x - cw / 2 + 46, y - 20, 32, INK, font="body")
        sc.shadow(body, blur=30, dy=14, opacity=0.5)
        return sc.group(name, [body, bar, t])

    for i, (label, (x, y)) in enumerate(tree.items()):
        g = note(label, x, y, i, accent=(label == "Novel"))
        sx, sy = rng.uniform(140, W - 140), rng.uniform(260, H - 120)
        rot = rng.uniform(-22, 22)
        appear = 200 + i * 120
        settle = 2700 + i * 55
        sc.keys(g, "opacity", [(0, 0), (appear, 0, "ease-out"), (appear + 300, 1)])
        sc.keys(g, "translate-x", [(0, sx - x), (appear, sx - x, "linear"), (settle, sx - x + rng.uniform(-30, 30),
                                                                            "ease-in-out-expo"),
                                   (settle + 850, 0)])
        sc.keys(g, "translate-y", [(0, sy - y + 40), (appear, sy - y + 40, "ease-out-cubic"),
                                   (appear + 500, sy - y, "linear"), (settle, sy - y + rng.uniform(-20, 20),
                                                                      "ease-in-out-expo"), (settle + 850, 0)])
        sc.keys(g, "rotation", [(0, rot), (settle, rot + rng.uniform(-6, 6), "ease-in-out-expo"), (settle + 850, 0)])
    for j, label in enumerate(extras):
        i = len(tree) + j
        x, y = rng.uniform(200, W - 200), rng.uniform(300, H - 150)
        g = note(label, x, y, i)
        appear = 300 + j * 260
        sc.keys(g, "opacity", [(0, 0), (appear, 0, "ease-out"), (appear + 300, 1), (2500, 1, "ease-in"), (2900, 0)])
        sc.keys(g, "rotation", [(0, rng.uniform(-25, 25))])
        sc.keys(g, "scale", [(0, 1), (2500, 1, "ease-in-back"), (2900, 0.6)])
    sc.whooshes.append(2700)
    return sc


# ---------------------------------------------------------------------------------------------- product window
def product_window(sc, shots, title="CardSpoke  ·  My Brain", slide_in=False):
    name, content = sc.window("win", WIN_X, WIN_Y, WIN_W, shots, title=title)
    if slide_in:
        sc.keys(name, "translate-y", [(0, 140), (0, 140, "ease-out-expo"), (900, 0)])
        sc.keys(name, "opacity", [(0, 0), (0, 0, "ease-out"), (500, 1)])
    return name, content


def swap(sc, layers, t, dur=320, zoom=1.03):
    """Show the screenshot ``layers[i]`` from time ``t[i]`` on, with a quick settle-in."""
    for i, layer in enumerate(layers):
        if i == 0:
            continue
        start = t[i - 1] if isinstance(t, list) else t
        sc.keys(layer, "opacity", [(0, 0), (start, 0, "ease-out-cubic"), (start + dur, 1)])
        sc.keys(layer, "scale", [(0, zoom), (start, zoom, "ease-out-cubic"), (start + dur + 200, 1)])


def body_text(sc, name, s, t, y=520, size=30, width=None):
    n = sc.text(name, s, CAP_X, y, size, MUTED, font="body", line_height=1.35)
    sc.fade_in(n, t, 600, dy=16)
    return n


# ---------------------------------------------------------------------------------------------- 03 cards
def cards():
    sc = Scene("03-cards", 8000)
    sc.backdrop(glow_at=(0.15, 0.25))
    shots = [("s_home", "home-grid.png"), ("s_novel", "novel.png"), ("s_chars", "characters.png"),
             ("s_mara", "mara.png")]
    win, content = product_window(sc, shots, slide_in=True)
    swap(sc, [s for s, _ in shots], [1950, 3350, 4750])

    sc.caption("cap", "Cards", "Every idea\nis a card.", 300, x=CAP_X, y=200, size=70)
    body_text(sc, "cap_body", "Nest cards inside cards,\nas deep as your\nthinking goes.", 1100, y=430)

    cur = sc.cursor()
    novel = centre(to_canvas(content, box("home-grid", "novel")))
    chars = centre(to_canvas(content, box("novel", "characters")))
    mara = centre(to_canvas(content, box("characters", "mara")))
    sc.move_cursor(cur, [(0, W + 60, H - 80), (900, W + 60, H - 80), (1750, novel[0] - 60, novel[1] - 20),
                         (2600, novel[0] - 60, novel[1] - 20), (3200, chars[0] - 360, chars[1] - 10),
                         (4000, chars[0] - 360, chars[1] - 10), (4600, mara[0] - 380, mara[1] - 10),
                         (5600, mara[0] - 380, mara[1] - 10), (6400, W + 80, H - 40)])
    sc.click("click1", 1850, novel[0] - 60, novel[1] - 20)
    sc.click("click2", 3250, chars[0] - 360, chars[1] - 10)
    sc.click("click3", 4650, mara[0] - 380, mara[1] - 10)
    # The breadcrumb trail is the payoff: All Cards / Novel / Characters / Mara Quinn.
    crumbs = to_canvas(content, box("mara", "breadcrumbs"))
    crumbs = (crumbs[0], crumbs[1], crumbs[2] * 0.36, crumbs[3])
    sc.highlight("crumbs_hl", crumbs, 5300, 7600, pad=8)
    note = sc.text("crumbs_note", "Breadcrumbs always\nlead the way back.", CAP_X, 640, 26, ACCENT, font="mono",
                   line_height=1.4)
    sc.fade_in(note, 5700, 500, dy=10)
    return sc


# ---------------------------------------------------------------------------------------------- 04 links
def links():
    sc = Scene("04-links", 6500)
    sc.backdrop(glow_at=(0.15, 0.25))
    win, content = product_window(sc, [("s_mara", "mara.png")])
    # Zoom the whole window onto the [[links]] in Mara's card body.
    l1 = to_canvas(content, box("mara", "link1"))
    l2 = to_canvas(content, box("mara", "link2"))
    focus = ((l1[0] + l2[0] + l2[2]) / 2, l1[1] + l1[3] / 2)
    gx, gy, gw = WIN_X - 2, WIN_Y - 2, WIN_W + 4
    gh = content[1] + content[3] + 2 - gy
    sc.pivot(win, [(focus[0] - gx) / gw, (focus[1] - gy) / gh])
    z, shift = 1.8, 380
    for prop, value in (("scale", z), ("translate-x", shift)):
        rest = 1 if prop == "scale" else 0
        sc.keys(win, prop, [(0, rest, "ease-in-out-cubic"), (300, rest, "ease-in-out-cubic"), (1300, value),
                            (3500, value, "ease-in-out-cubic"), (4500, rest)])
    sc.whooshes += [300, 3500]

    def zoomed(r):
        x, y, w, h = r
        return (focus[0] + (x - focus[0]) * z + shift, focus[1] + (y - focus[1]) * z, w * z, h * z)

    sc.highlight("hl_l1", zoomed(l1), 1400, 3300, pad=10)
    sc.highlight("hl_l2", zoomed(l2), 1600, 3300, pad=10)
    sc.caption("cap", "Links", "Connect\nanything.", 200, x=CAP_X, y=200, size=70)
    brackets = sc.text("brackets", "[[Act I]]", CAP_X, 430, 54, ACCENT, font="mono")
    sc.fade_in(brackets, 1500, 500, dy=14)
    body_text(sc, "cap_body", "Type a card's title in\ndouble brackets to link it.\nRelated cards show up\non their own.", 2100,
              y=520)
    rel = to_canvas(content, box("mara", "related"))
    sc.highlight("hl_rel", (rel[0], rel[1], rel[2] * 0.45, rel[3] * 0.8), 4700, 6300, pad=8)
    return sc


# ---------------------------------------------------------------------------------------------- 05 search
def search():
    sc = Scene("05-search", 6000)
    sc.backdrop(glow_at=(0.15, 0.25))
    shots = [("s_home", "home-grid.png")] + [(f"s_q{i}", f"search-{i}.png") for i in range(1, 5)] + [
        ("s_results", "search-results.png")]
    win, content = product_window(sc, shots)
    for i in range(1, 5):  # typing: each keystroke is its own real screenshot, shown on a hard cut
        sc.show(f"s_q{i}", 900 + i * 170)
    swap(sc, ["s_q4", "s_results"], 2300, dur=300, zoom=1.02)
    sc.clicks += [900 + i * 170 for i in range(1, 5)] + [2300]
    sc.highlight("hl_search", to_canvas(content, box("home-grid", "search")), 500, 2200, pad=6, r=10)
    sc.highlight("hl_results", to_canvas(content, box("search-results", "grid")), 2800, 5700, pad=10)
    sc.caption("cap", "Search", "Find anything.\nInstantly.", 200, x=CAP_X, y=200, size=70)
    body_text(sc, "cap_body", "Fuzzy search across every\ncard, with filters, tags\nand keyboard navigation.",
              1200, y=430)
    return sc


# ---------------------------------------------------------------------------------------------- 06 themes
def themes():
    sc = Scene("06-themes", 7000)
    sc.backdrop(glow_at=(0.15, 0.25))
    win, content = product_window(sc, [("s_light", "home-grid.png")])
    cx, cy, cw, ch = content
    looks = [("s_dark", "home-grid-dark.png", "Dark mode", 1100),
             ("s_forest", "theme-forest.png", "Forest theme", 2900),
             ("s_cyber", "theme-cyberpunk.png", "Cyberpunk theme", 4700)]
    parts = []
    for layer, file, label, t in looks:
        base = sc.rect(f"{layer}_wipe", cx, cy, 2, ch, "#000000")
        sc.keys(base, "width", [(0, 2), (t, 2, "ease-in-out-cubic"), (t + 900, round(cw))])
        sc.image(layer, file, cx, cy, cw)
        sc.clip(layer, base)
        edge = sc.rect(f"{layer}_edge", cx - 3, cy, 6, ch, ACCENT)
        sc.glow(edge, ACCENT, radius=30, opacity=0.8)
        sc.keys(edge, "translate-x", [(0, 0), (t, 0, "ease-in-out-cubic"), (t + 900, cw)])
        sc.keys(edge, "opacity", [(0, 0), (t, 0, "hold"), (t + 1, 1), (t + 800, 1, "ease-in"), (t + 950, 0)])
        tag_w = 330
        pill = sc.rect(f"{layer}_pill", cx + cw - tag_w - 24, cy + ch - 84, tag_w, 60, "#0b0b0dcc", r=30,
                       stroke=ACCENT, sw=2)
        lw = text_width_estimate(label, 26, "mono")
        txt = sc.text(f"{layer}_label", label, cx + cw - tag_w / 2 - 24 - lw / 2, cy + ch - 70, 26, INK, font="mono")
        end = t + 1700 if layer != "s_cyber" else None
        for n in (pill, txt):
            sc.fade_in(n, t + 500, 350, dy=12)
            if end:
                sc.fade_out(n, end, 250)
        parts += [base, layer, edge, pill, txt]
        sc.whooshes.append(t)
    sc.caption("cap", "Appearance", "Make it\nyours.", 200, x=CAP_X, y=200, size=70)
    body_text(sc, "cap_body", "Light and dark, high\ncontrast, dyslexia-\nfriendly type, and\nthemes from plugins.",
              1000, y=430)
    return sc


# ---------------------------------------------------------------------------------------------- 07 local-first
def chip(sc, name, label, x, y, t, font="body", size=34, color=INK, check=False, stroke="#3a3a44", pad=34):
    w = text_width_estimate(label, size, font) + pad * 2 + (44 if check else 0)
    bg = sc.rect(f"{name}_bg", x - w / 2, y, w, size + 40, PANEL, r=(size + 40) / 2, stroke=stroke, sw=2)
    parts = [bg]
    tx = x - w / 2 + pad
    if check:
        mark = sc.line(f"{name}_check", [(tx, y + (size + 40) * 0.52), (tx + 10, y + (size + 40) * 0.66),
                                         (tx + 28, y + (size + 40) * 0.34)], ACCENT, sw=5)
        sc.keys(mark, "trim_end", [(0, 0), (t + 200, 0, "ease-out-cubic"), (t + 600, 100)])
        parts.append(mark)
        tx += 44
    parts.append(sc.text(f"{name}_t", label, tx, y + 18, size, color, font=font))
    g = sc.group(name, parts)
    sc.keys(g, "opacity", [(0, 0), (t, 0, "ease-out"), (t + 300, 1)])
    sc.keys(g, "scale", [(0, 0.7), (t, 0.7, "ease-out-back"), (t + 500, 1)])
    return g


def local():
    sc = Scene("07-local", 7000)
    sc.backdrop(glow_at=(0.5, 0.35))
    k = sc.text("kicker", "LOCAL-FIRST", 0, 150, 28, ACCENT, font="mono", align="center", tracking=0.14)
    sc.op(type="move", target=k, x="center")
    sc.fade_in(k, 100, 400, dy=12)
    head = sc.text("head", "Your notes live on your device.", 0, 205, 92, INK, align="center")
    sc.op(type="move", target=head, x="center")
    sc.words(head, 250, dur=650, stagger=80)

    # The app's own "Saved locally" badge, redrawn large.
    pill_w = 430
    pill = sc.rect("saved_bg", W / 2 - pill_w / 2, 360, pill_w, 78, "#dcfce7", r=39, stroke="#86efac", sw=3)
    dot = sc.ellipse("saved_dot", W / 2 - pill_w / 2 + 48, 399, 18, 18, "#16a34a")
    txt = sc.text("saved_t", "SAVED LOCALLY", W / 2 - pill_w / 2 + 76, 380, 34, "#166534", font="display",
                  tracking=0.06)
    g = sc.group("saved", [pill, dot, txt])
    sc.keys(g, "opacity", [(0, 0), (1100, 0, "ease-out"), (1400, 1)])
    sc.keys(g, "scale", [(0, 0.6), (1100, 0.6, "ease-out-back"), (1700, 1)])
    sc.keys(dot, "opacity", [(0, 1), (1800, 1, "ease-in-out-sine"), (2300, 0.3, "ease-in-out-sine"), (2800, 1)])
    sc.clicks.append(1150)

    for i, label in enumerate(["No account", "No server", "Works offline"]):
        chip(sc, f"why{i}", label, W / 2 + (i - 1) * 400, 520, 2000 + i * 180, check=True)

    ex = sc.text("export_k", "EXPORT ANYTIME", 0, 690, 26, MUTED, font="mono", align="center", tracking=0.14)
    sc.op(type="move", target=ex, x="center")
    sc.fade_in(ex, 3300, 400, dy=10)
    for i, label in enumerate(["JSON", "Markdown", "TXT", "CSV"]):
        chip(sc, f"fmt{i}", label, W / 2 + (i - 1.5) * 280, 740, 3500 + i * 140, font="mono", size=32,
             color=ACCENT, stroke=ACCENT)
        sc.clicks.append(3500 + i * 140)

    # A padlock for optional PIN-encrypted datasets.
    lx, ly = W / 2 - 330, 905
    shackle = sc.ellipse("lock_shackle", lx + 22, ly + 6, 30, 40, None, stroke=INK, sw=6)
    body = sc.rect("lock_body", lx, ly + 8, 44, 36, INK, r=6)
    hole = sc.ellipse("lock_hole", lx + 22, ly + 25, 8, 8, BG)
    lock_t = sc.text("lock_t", "Optional PIN encryption, per dataset", lx + 70, ly + 6, 34, INK, font="body")
    lg = sc.group("lock", [shackle, body, hole, lock_t])
    sc.fade_in(lg, 4700, 500, dy=16)
    return sc


# ---------------------------------------------------------------------------------------------- 08 plugins
def plugins():
    sc = Scene("08-plugins", 6500)
    sc.backdrop(glow_at=(0.15, 0.25))
    win, content = product_window(sc, [("s_gallery", "plugin-gallery.png")])
    sc.caption("cap", "Plugins", "Extend it\nyour way.", 200, x=CAP_X, y=200, size=70)
    layers = [("Theme", "CSS-only restyles"), ("Feature", "New UI and behaviour"), ("App", "Deeper transformations")]
    for i, (name, desc) in enumerate(layers):
        y = 440 + i * 128
        t = 1000 + i * 260
        bg = sc.rect(f"layer{i}_bg", CAP_X, y, 400, 104, PANEL, r=16, stroke=ACCENT if i == 0 else "#34343c", sw=2)
        n = sc.text(f"layer{i}_n", name, CAP_X + 28, y + 16, 36, INK, font="display")
        d = sc.text(f"layer{i}_d", desc, CAP_X + 28, y + 62, 24, MUTED, font="body")
        g = sc.group(f"layer{i}", [bg, n, d])
        sc.keys(g, "opacity", [(0, 0), (t, 0, "ease-out"), (t + 350, 1)])
        sc.keys(g, "translate-x", [(0, -60), (t, -60, "ease-out-cubic"), (t + 500, 0)])
        sc.clicks.append(t)
        # Walk the accent outline down the three layers.
        sc.keys(bg, "stroke", [(0, "#34343c"), (2400 + i * 700, "#34343c", "ease-out"), (2600 + i * 700, ACCENT),
                               (2900 + i * 700 + (600 if i == 2 else 0), ACCENT, "ease-in"),
                               (3200 + i * 700 + (600 if i == 2 else 0), "#34343c")])
    safe = sc.text("safe", "Sandboxed workers · permission\nchecks · safe mode", CAP_X, 840, 24, MUTED, font="mono",
                   line_height=1.4)
    sc.fade_in(safe, 2200, 500, dy=10)
    # The gallery lists Forest, Cyberpunk and Monochrome first; sweep a highlight down them.
    for i in range(3):
        sc.highlight(f"hl_item{i}", to_canvas(content, box("plugin-gallery", f"item{i}")), 2400 + i * 700,
                     2950 + i * 700 + (900 if i == 2 else 0), pad=6, r=10)
    return sc


# ---------------------------------------------------------------------------------------------- 09 everywhere
def everywhere():
    sc = Scene("09-everywhere", 6000)
    sc.backdrop(glow_at=(0.6, 0.5))
    head = sc.text("head", "On the web, desktop and mobile.", 0, 70, 80, INK, align="center")
    sc.op(type="move", target=head, x="center")
    sc.words(head, 150, dur=600, stagger=80)
    name, content = sc.window("desk", 170, 250, 1180, [("s_dark", "novel-dark.png")], title="CardSpoke")
    sc.keys(name, "translate-x", [(0, -220), (300, -220, "ease-out-expo"), (1300, 0)])
    sc.keys(name, "opacity", [(0, 0), (300, 0, "ease-out"), (800, 1)])

    # A phone, drawn from shapes, holding the 390px-wide layout.
    pw, ph = 380, 822
    px, py = 1400, 215
    frame = sc.rect("phone_frame", px - 16, py - 16, pw + 32, ph + 32, "#1f1f25", r=64, stroke="#3b3b44", sw=3)
    sc.shadow(frame, blur=70, dy=40, opacity=0.6)
    screen = sc.rect("phone_screen", px, py, pw, ph, "#ffffff", r=48)
    shot = sc.image("s_phone", "phone-kyoto.png", px, py + 40, pw)  # clear of the notch
    sc.clip(shot, screen)
    notch = sc.rect("phone_notch", px + pw / 2 - 60, py + 12, 120, 30, "#000000", r=15)
    phone = sc.group("phone", [frame, screen, shot, notch])
    sc.keys(phone, "translate-y", [(0, 420), (700, 420, "ease-out-expo"), (1800, 0)])
    sc.keys(phone, "rotation", [(0, 8), (700, 8, "ease-out-expo"), (1800, 0)])
    sc.keys(phone, "opacity", [(0, 0), (700, 0, "ease-out"), (1100, 1)])
    sc.whooshes += [300, 700]

    plats = sc.text("plats", "Browser  ·  Windows  ·  macOS  ·  Linux  ·  Mobile preview", 170, 1000, 28, MUTED,
                    font="mono")
    sc.fade_in(plats, 2300, 600, dy=10)
    return sc


# ---------------------------------------------------------------------------------------------- 10 end card
def end():
    sc = Scene("10-end", 6000)
    sc.backdrop(glow_at=(0.5, 0.45), drift=True)
    mark, parts, (ox, oy, lw, lh) = logo(sc, "logo", W / 2, 400, 1000, 200)
    tag = sc.text("tagline", "Think in cards.", 0, oy + lh + 60, 72, INK, align="center")
    sc.op(type="move", target=tag, x="center")
    sc.words(tag, 1700, dur=700, stagger=110)
    sub = sc.text("sub", "Free and open source  ·  Local-first  ·  Public Preview", 0, oy + lh + 170, 32, MUTED,
                  font="body", align="center")
    sc.op(type="move", target=sub, x="center")
    sc.fade_in(sub, 2400, 600, dy=12)
    url = sc.text("url", "github.com/jxburros/CardSpoke", 0, oy + lh + 260, 40, ACCENT, font="mono",
                  align="center")
    sc.op(type="move", target=url, x="center")
    sc.fade_in(url, 3000, 600, dy=12)
    by = sc.text("by", "JX Holdings, LLC", 0, 1000, 24, "#6b6b75", font="body", align="center")
    sc.op(type="move", target=by, x="center")
    sc.fade_in(by, 3400, 600)
    # Fade to black at the very end.
    veil = sc.rect("veil", 0, 0, W, H, "#000000")
    sc.keys(veil, "opacity", [(0, 0), (5200, 0, "ease-in"), (6000, 1)])
    return sc


SCENES = [intro, chaos, cards, links, search, themes, local, plugins, everywhere, end]
