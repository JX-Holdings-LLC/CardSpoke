"""The ten shots of the CardSpoke promo. Each function returns a ``Scene``; ``SCENES`` is the cut order.

The film tells how CardSpoke came to be: a place to keep notes as cards that hold other cards, built
for one person's way of thinking; then opened up, and made simple enough that anyone can reshape it
with themes and plugins. Your information, your way.

Screenshots come from ``../shots`` (``capture/capture.mjs`` drives the real app), and ``boxes.json``
holds where UI elements sit in them, so the cursor and highlights land on the real interface.
"""
from __future__ import annotations

import random

from kit import INK, MUTED, PAPER, SW, TILE, H, W, Scene, box, logo, text_width_estimate

# The app window sits right of a caption column in the product shots, so consecutive shots line up.
WIN_X, WIN_Y, WIN_W = 690, 220, 1120
CAP_X = 96
TAB_H = 46
DECK = 26  # offset of the card behind the window


def to_canvas(content, rect):
    """A screenshot-pixel rect [x, y, w, h] mapped into a window's content box."""
    cx, cy, cw, _ = content
    s = cw / 1920
    x, y, w, h = rect
    return (cx + x * s, cy + y * s, w * s, h * s)


def inside(rect, content, margin=24):
    """``rect`` cut to the window's content box, less a margin, for elements that scroll past it."""
    x, y, w, h = rect
    cx, cy, cw, ch = content
    x0, y0 = max(x, cx + margin), max(y, cy + margin)
    x1, y1 = min(x + w, cx + cw - margin), min(y + h, cy + ch - margin)
    return (x0, y0, x1 - x0, y1 - y0)


def centre(r):
    return (r[0] + r[2] / 2, r[1] + r[3] / 2)


def body_text(sc, name, s, t, y=520, size=30, x=CAP_X, color=MUTED):
    n = sc.text(name, s, x, y, size, color, font="body", line_height=1.38)
    sc.fade_in(n, t, 600, dy=16)
    return n


def product_window(sc, shots, slide_in=False):
    name, content = sc.window("win", WIN_X, WIN_Y, WIN_W, shots)
    if slide_in:
        sc.keys(name, "translate-y", [(0, 160), (0, 160, "ease-out-expo"), (900, 0)])
        sc.keys(name, "opacity", [(0, 0), (0, 0, "ease-out"), (450, 1)])
    return name, content


def swap(sc, layers, t, dur=320, zoom=1.03):
    """Show the screenshot ``layers[i]`` from time ``t[i - 1]`` on, with a quick settle-in."""
    for i, layer in enumerate(layers):
        if i == 0:
            continue
        start = t[i - 1] if isinstance(t, list) else t
        sc.keys(layer, "opacity", [(0, 0), (start, 0, "ease-out-cubic"), (start + dur, 1)])
        sc.keys(layer, "scale", [(0, zoom), (start, zoom, "ease-out-cubic"), (start + dur + 200, 1)])


def window_bounds(content):
    """The window group's bounds: tab on top, the offset card behind it to the lower right."""
    x, y, w, h = content
    return (x - SW / 2, y - TAB_H, w + DECK + SW, h + TAB_H + DECK + SW / 2)


# ---------------------------------------------------------------------------------------------- 01 intro
def intro():
    sc = Scene("01-intro", 5000)
    sc.backdrop(seed=0)
    g, (ox, oy, lw, lh), done = logo(sc, "logo", W / 2, H / 2 - 70, 1240, 300)
    sc.keys(g, "scale", [(0, 0.97, "ease-out-cubic"), (4600, 1.0)])
    tag = sc.text("tagline", "Your information, your way.", 0, oy + lh + 92, 70)
    sc.centred(tag)
    sc.words(tag, done + 250, dur=700, stagger=110)
    return sc


# ---------------------------------------------------------------------------------------------- 02 origin
def origin():
    sc = Scene("02-origin", 7000)
    sc.backdrop(seed=1)
    rng = random.Random(7)

    head1 = sc.text("head1", "It started as a place for my own notes.", CAP_X, 92, 76)
    sc.words(head1, 150, dur=600, stagger=80)
    sc.fade_out(head1, 2700, 350)
    head2 = sc.text("head2", "Little cards. Each one can hold more.", CAP_X, 92, 76)
    sc.words(head2, 3050, dur=650, stagger=90)

    cw, ch = 240, 84
    tree = {
        "Novel": (W / 2, 360),
        "Characters": (W / 2 - 520, 590), "Plot": (W / 2, 590), "Research": (W / 2 + 520, 590),
        "Mara": (W / 2 - 660, 830), "Elias": (W / 2 - 380, 830),
        "Act I": (W / 2 - 140, 830), "Act II": (W / 2 + 140, 830),
        "Tide tables": (W / 2 + 380, 830), "Lenses": (W / 2 + 660, 830),
    }
    edges = [("Novel", c) for c in ("Characters", "Plot", "Research")] + [
        ("Characters", "Mara"), ("Characters", "Elias"), ("Plot", "Act I"), ("Plot", "Act II"),
        ("Research", "Tide tables"), ("Research", "Lenses")]
    extras = ["Call Sam", "Groceries?", "Podcast idea", "Ramen place"]
    root_w, root_h = 320, 112

    def size(label):
        return (root_w, root_h) if label == "Novel" else (cw, ch)

    # Spokes first so the cards sit on top of them: right angles, like the logo's.
    for i, (a, b) in enumerate(edges):
        (ax, ay), (bx, by) = tree[a], tree[b]
        ah, bh = size(a)[1], size(b)[1]
        mid = (ay + ah / 2 + by - bh / 2) / 2
        n = sc.line(f"spoke{i}", [(ax, ay + ah / 2), (ax, mid), (bx, mid), (bx, by - bh / 2)])
        t = 3700 + (0 if a == "Novel" else 380) + i * 40
        sc.draw_on(n, t, 550)

    def note(label, x, y, idx):
        name = f"note{idx}"
        w, h = size(label)
        body = sc.card(f"{name}_bg", x - w / 2, y - h / 2, w, h)
        big = label == "Novel"
        fs = 40 if big else 30
        tw = text_width_estimate(label, fs, "display" if big else "body")
        t = sc.text(f"{name}_t", label, x - tw / 2, y - fs * 0.62, fs, INK, font="display" if big else "body")
        return sc.group(name, [body, t])

    for i, (label, (x, y)) in enumerate(tree.items()):
        g = note(label, x, y, i)
        sx, sy = rng.uniform(160, W - 160), rng.uniform(300, H - 140)
        rot = rng.uniform(-18, 18)
        appear = 200 + i * 120
        settle = 2800 + i * 55
        sc.keys(g, "opacity", [(0, 0), (appear, 0, "ease-out"), (appear + 300, 1)])
        sc.keys(g, "translate-x", [(0, sx - x), (appear, sx - x, "linear"),
                                   (settle, sx - x + rng.uniform(-30, 30), "ease-in-out-expo"), (settle + 850, 0)])
        sc.keys(g, "translate-y", [(0, sy - y + 40), (appear, sy - y + 40, "ease-out-cubic"),
                                   (appear + 500, sy - y, "linear"),
                                   (settle, sy - y + rng.uniform(-20, 20), "ease-in-out-expo"), (settle + 850, 0)])
        sc.keys(g, "rotation", [(0, rot), (settle, rot + rng.uniform(-6, 6), "ease-in-out-expo"), (settle + 850, 0)])
        sc.snaps.append(settle + 820)
    for j, label in enumerate(extras):
        i = len(tree) + j
        x, y = rng.uniform(220, W - 220), rng.uniform(320, H - 160)
        g = note(label, x, y, i)
        appear = 300 + j * 260
        sc.keys(g, "opacity", [(0, 0), (appear, 0, "ease-out"), (appear + 300, 1), (2600, 1, "ease-in"), (3000, 0)])
        sc.keys(g, "rotation", [(0, rng.uniform(-22, 22))])
        sc.keys(g, "scale", [(0, 1), (2600, 1, "ease-in-back"), (3000, 0.6)])
    sc.whooshes.append(2800)
    return sc


# ---------------------------------------------------------------------------------------------- 03 cards
def cards():
    sc = Scene("03-cards", 8000)
    sc.backdrop(seed=0)
    shots = [("s_home", "home-grid.png"), ("s_novel", "novel.png"), ("s_chars", "characters.png"),
             ("s_mara", "mara.png")]
    win, content = product_window(sc, shots, slide_in=True)
    swap(sc, [s for s, _ in shots], [1950, 3350, 4750])

    sc.caption("cap", "Cards", "Cards hold\ncards.", 300)
    body_text(sc, "cap_body", "Nest them as deep as\nyour thinking goes.", 1100, y=470)

    cur = sc.cursor()
    novel = centre(to_canvas(content, box("home-grid", "novel")))
    chars = centre(to_canvas(content, box("novel", "characters")))
    mara = centre(to_canvas(content, box("characters", "mara")))
    sc.move_cursor(cur, [(0, W + 60, H - 80), (900, W + 60, H - 80), (1750, novel[0] - 60, novel[1] - 20),
                         (2600, novel[0] - 60, novel[1] - 20), (3200, chars[0] - 340, chars[1] - 10),
                         (4000, chars[0] - 340, chars[1] - 10), (4600, mara[0] - 360, mara[1] - 10),
                         (5600, mara[0] - 360, mara[1] - 10), (6400, W + 80, H - 40)])
    sc.click("click1", 1850, novel[0] - 60, novel[1] - 20)
    sc.click("click2", 3250, chars[0] - 340, chars[1] - 10)
    sc.click("click3", 4650, mara[0] - 360, mara[1] - 10)
    # The breadcrumb trail is the payoff: All Cards / Novel / Characters / Mara Quinn.
    crumbs = to_canvas(content, box("mara", "breadcrumbs"))
    crumbs = (crumbs[0], crumbs[1], crumbs[2] * 0.34, crumbs[3])
    sc.highlight("crumbs_hl", crumbs, 5300, 7600, pad=8)
    # A spoke from the note to the trail it describes.
    note_y = 660
    note = sc.text("crumbs_note", "Breadcrumbs lead\nthe way back.", CAP_X, note_y, 32, INK, font="display",
                   line_height=1.2)
    sc.fade_in(note, 5600, 500, dy=10)
    nx = CAP_X + text_width_estimate("Breadcrumbs lead", 32, "display") + 24
    sp = sc.spoke("crumbs_spoke", [(nx, note_y + 20), (crumbs[0] - 30, note_y + 20), (crumbs[0] - 30,
                                   crumbs[1] + crumbs[3] / 2), (crumbs[0] - 8, crumbs[1] + crumbs[3] / 2)], 5500, 500)
    sc.keys(sp, "opacity", [(0, 1), (7600, 1, "ease-in"), (7900, 0)])
    return sc


# ---------------------------------------------------------------------------------------------- 04 links
def links():
    sc = Scene("04-links", 6500)
    sc.backdrop(seed=0)
    win, content = product_window(sc, [("s_mara", "mara.png")])
    # Zoom the whole window onto the [[links]] in Mara's card body.
    l1 = to_canvas(content, box("mara", "link1"))
    l2 = to_canvas(content, box("mara", "link2"))
    focus = ((l1[0] + l2[0] + l2[2]) / 2, l1[1] + l1[3] / 2)
    gx, gy, gw, gh = window_bounds(content)
    sc.pivot(win, [(focus[0] - gx) / gw, (focus[1] - gy) / gh])
    z, shift = 1.8, 300
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
    sc.caption("cap", "Links", "Connect\nanything.", 200)
    brackets = sc.text("brackets", "[[Act I]]", CAP_X, 460, 54, INK, font="mono")
    sc.fade_in(brackets, 1500, 500, dy=14)
    body_text(sc, "cap_body", "Write a card's title in\ndouble brackets to link it.\nRelated cards show up\non their own.",
              2100, y=550)
    rel = to_canvas(content, box("mara", "related"))
    sc.highlight("hl_rel", (rel[0], rel[1], rel[2] * 0.45, rel[3] * 0.8), 4700, 6300, pad=8)
    return sc


# ---------------------------------------------------------------------------------------------- 05 search
def search():
    sc = Scene("05-search", 5500)
    sc.backdrop(seed=0)
    shots = [("s_home", "home-grid.png")] + [(f"s_q{i}", f"search-{i}.png") for i in range(1, 5)] + [
        ("s_results", "search-results.png")]
    win, content = product_window(sc, shots)
    for i in range(1, 5):  # typing: each keystroke is its own real screenshot, shown on a hard cut
        sc.show(f"s_q{i}", 800 + i * 170)
    swap(sc, ["s_q4", "s_results"], 2200, dur=300, zoom=1.02)
    sc.clicks += [800 + i * 170 for i in range(1, 5)] + [2200]
    sc.highlight("hl_search", to_canvas(content, box("home-grid", "search")), 400, 2100, pad=6)
    sc.highlight("hl_results", to_canvas(content, box("search-results", "grid")), 2700, 5200, pad=10)
    sc.caption("cap", "Search", "Find it\nagain.", 200)
    body_text(sc, "cap_body", "Search forgives typos\nand looks through titles,\ntext and tags.", 1100, y=470)
    return sc


# ---------------------------------------------------------------------------------------------- 06 you
def you():
    """The turn of the story: one card branching out to many."""
    sc = Scene("06-you", 5000)
    sc.backdrop(seed=1)
    l1 = sc.text("line1", "If it helped me,", 0, 120, 92)
    sc.centred(l1)
    sc.words(l1, 200, dur=650, stagger=110)
    l2 = sc.text("line2", "it could help you.", 0, 232, 92)
    sc.centred(l2)
    sc.words(l2, 1500, dur=650, stagger=110)

    cx, cy = W / 2, 520
    mw, mh = 240, 150
    me = sc.card("me", cx - mw / 2, cy - mh / 2, mw, mh)
    sc.draw_on(me, 300, 650)
    sc.snaps.append(900)
    others = [(-640, 840), (-380, 840), (-120, 840), (120, 840), (380, 840), (640, 840)]
    ow, oh = 190, 120
    bus = cy + mh / 2 + 60
    trunk = sc.line("trunk", [(cx, cy + mh / 2), (cx, bus)])
    sc.draw_on(trunk, 1900, 250, "ease-out-cubic")
    for i, (dx, y) in enumerate(others):
        x = cx + dx
        t = 2150 + abs(dx) // 260 * 120
        side = sc.line(f"branch{i}", [(cx, bus), (x, bus), (x, y - oh / 2)])
        sc.draw_on(side, t, 450, "ease-out-cubic")
        c = sc.card(f"other{i}", x - ow / 2, y - oh / 2, ow, oh)
        sc.draw_on(c, t + 380, 480)
        sc.snaps.append(t + 820)
    return sc


# ---------------------------------------------------------------------------------------------- 07 themes
def themes():
    sc = Scene("07-themes", 7000)
    sc.backdrop(seed=0)
    win, content = product_window(sc, [("s_light", "home-grid.png")])
    cx, cy, cw, ch = content
    looks = [("s_dark", "home-grid-dark.png", "Dark mode", 1100),
             ("s_forest", "theme-forest.png", "Forest theme", 2900),
             ("s_cyber", "theme-cyberpunk.png", "Cyberpunk theme", 4700)]
    label_y = cy + ch + DECK + 34
    for layer, file, label, t in looks:
        base = sc.rect(f"{layer}_wipe", cx, cy, 2, ch, INK)
        sc.keys(base, "width", [(0, 2), (t, 2, "ease-in-out-cubic"), (t + 900, round(cw))])
        sc.image(layer, file, cx, cy, cw)
        sc.clip(layer, base)
        edge = sc.rect(f"{layer}_edge", cx - SW, cy, SW * 2, ch, INK)
        sc.keys(edge, "translate-x", [(0, 0), (t, 0, "ease-in-out-cubic"), (t + 900, cw)])
        sc.keys(edge, "opacity", [(0, 0), (t, 0, "hold"), (t + 1, 1), (t + 800, 1, "ease-in"), (t + 950, 0)])
        tag = sc.kicker(f"{layer}_label", label, cx, label_y)
        sc.fade_in(tag, t + 450, 300, dy=10)
        if layer != "s_cyber":
            sc.fade_out(tag, t + 1650, 250)
        sc.whooshes.append(t)
    sc.card("win_edge_top", cx, cy, cw, ch, fill=None)  # the window's edge, above the wipes
    sc.caption("cap", "Make it yours", "Simple enough\nto make your\nown.", 200)
    body_text(sc, "cap_body", "Light and dark, high\ncontrast, reading presets,\nand themes from plugins.",
              1000, y=550)
    return sc


# ---------------------------------------------------------------------------------------------- 08 plugins
def plugins():
    sc = Scene("08-plugins", 9000)
    sc.backdrop(seed=0)
    shots = [("s_consent", "plugin-consent.png"), ("s_board", "home-board.png"), ("s_kanban", "kanban.png"),
             ("s_create", "plugin-create.png")]
    win, content = product_window(sc, shots)
    swap(sc, [s for s, _ in shots], [1700, 2900, 5600])
    sc.whooshes.append(5600)

    cur = sc.cursor()
    allow = centre(to_canvas(content, box("plugin-consent", "allow")))
    board = centre(to_canvas(content, box("home-board", "board")))
    sc.move_cursor(cur, [(0, W + 60, H - 60), (300, W + 60, H - 60), (1100, allow[0], allow[1]),
                         (1700, allow[0], allow[1]), (2400, board[0] + 4, board[1] + 4),
                         (3100, board[0] + 4, board[1] + 4), (3900, W + 80, H - 40)])
    sc.click("click_allow", 1250, allow[0], allow[1])
    sc.click("click_board", 2700, board[0] + 4, board[1] + 4)
    sc.highlight("hl_allow", to_canvas(content, box("plugin-consent", "allow")), 500, 1500, pad=8)
    sc.highlight("hl_board", inside(to_canvas(content, box("kanban", "columns")), content), 3500, 5300, pad=10)
    sc.highlight("hl_manifest", to_canvas(content, box("plugin-create", "manifest")), 6300, 8700, pad=8)

    sc.caption("cap", "Plugins", "Add what\nyou need.", 200, end=5300)
    head2 = sc.text("cap_head2", "Or build\nyour own.", CAP_X - 4, 276, 72, INK, line_height=1.04)
    sc.words(head2, 5650, dur=650, stagger=90)

    # The three kinds of plugin, on a trunk like the cards in a tree.
    kinds = [("Theme", "Restyle it with CSS"), ("Feature", "Add panels and buttons"), ("App", "Reshape the whole app")]
    top, cw_, ch_ = 500, 420, 96
    trunk_x = CAP_X + 2
    trunk = sc.line("kinds_trunk", [(trunk_x, top - 20), (trunk_x, top + 2 * 124 + ch_ / 2)])
    sc.draw_on(trunk, 900, 500, "ease-out-cubic")
    for i, (name, desc) in enumerate(kinds):
        y = top + i * 124
        t = 1100 + i * 220
        x = CAP_X + 48
        sc.spoke(f"kind{i}_spoke", [(trunk_x, y + ch_ / 2), (x, y + ch_ / 2)], t, 250)
        bg = sc.card(f"kind{i}_bg", x, y, cw_, ch_)
        n = sc.text(f"kind{i}_n", name, x + 24, y + 14, 34, INK)
        d = sc.text(f"kind{i}_d", desc, x + 24, y + 58, 24, MUTED, font="body")
        g = sc.group(f"kind{i}", [bg, n, d])
        sc.keys(g, "opacity", [(0, 0), (t + 150, 0, "ease-out"), (t + 450, 1)])
        sc.keys(g, "translate-x", [(0, -40), (t + 150, -40, "ease-out-cubic"), (t + 600, 0)])
        sc.clicks.append(t + 150)
        # Kanban Board is an app plugin: invert the App card while it is on screen.
        if name == "App":
            inv_bg = sc.rect(f"kind{i}_inv", x, y, cw_, ch_, INK)
            inv_n = sc.text(f"kind{i}_invn", name, x + 24, y + 14, 34, PAPER)
            inv_d = sc.text(f"kind{i}_invd", "Kanban Board", x + 24, y + 58, 24, PAPER, font="body")
            inv = sc.group(f"kind{i}_active", [inv_bg, inv_n, inv_d])
            sc.keys(inv, "opacity", [(0, 0), (3000, 0, "ease-out"), (3250, 1), (5300, 1, "ease-in"), (5550, 0)])

    note = sc.text("note_ask", "CardSpoke asks before\nany plugin runs.", CAP_X, 900, 26, MUTED, font="body",
                   line_height=1.35)
    sc.fade_in(note, 600, 500, dy=10)
    sc.fade_out(note, 5300, 300)
    note2 = sc.text("note_json", "One JSON file.\nTest it right in the app.", CAP_X, 900, 26, INK, font="body",
                    line_height=1.35)
    sc.fade_in(note2, 6100, 500, dy=10)
    return sc


# ---------------------------------------------------------------------------------------------- 09 yours
def check_item(sc, name, label, x, y, t):
    """A square checkbox that ticks itself, then its label."""
    s = 34
    bx = sc.card(f"{name}_box", x, y, s, s, sw=4)
    sc.draw_on(bx, t, 350)
    tick = sc.line(f"{name}_tick", [(x + 7, y + s * 0.52), (x + 14, y + s * 0.74), (x + s - 6, y + s * 0.26)],
                   INK, sw=5)
    sc.draw_on(tick, t + 250, 300, "ease-out-cubic")
    lab = sc.text(f"{name}_t", label, x + s + 20, y - 1, 32, INK, font="body")
    sc.fade_in(lab, t + 150, 400)
    sc.clicks.append(t + 250)


def yours():
    sc = Scene("09-yours", 7000)
    sc.backdrop(seed=1)
    sc.caption("cap", "Private", "Kept on\nyour device.", 200)
    for i, label in enumerate(["No account", "No server", "Works offline", "PIN encryption", "Export anytime"]):
        check_item(sc, f"why{i}", label, CAP_X, 480 + i * 70, 1200 + i * 260)

    name, content = sc.window("desk", 700, 300, 900, [("s_dark", "novel-dark.png")], title="CardSpoke")
    sc.keys(name, "translate-x", [(0, 200), (200, 200, "ease-out-expo"), (1200, 0)])
    sc.keys(name, "opacity", [(0, 0), (200, 0, "ease-out"), (600, 1)])

    # A phone, drawn as one more card, holding the 390px-wide layout.
    pw, ph = 330, 714
    px, py = 1500, 230
    under = sc.card("phone_under", px + DECK, py + DECK, pw, ph)
    screen = sc.rect("phone_screen", px, py, pw, ph, PAPER)
    shot = sc.image("s_phone", "phone-kyoto.png", px, py, pw)
    sc.clip(shot, screen)
    edge = sc.card("phone_edge", px, py, pw, ph, fill=None)
    phone = sc.group("phone", [under, screen, shot, edge])
    sc.keys(phone, "translate-y", [(0, 380), (600, 380, "ease-out-expo"), (1700, 0)])
    sc.keys(phone, "opacity", [(0, 0), (600, 0, "ease-out"), (1000, 1)])
    sc.whooshes += [200, 600]
    return sc


# ---------------------------------------------------------------------------------------------- 10 end card
def end():
    sc = Scene("10-end", 6000, bg=TILE)
    sc.backdrop(seed=0, color="#2b2b2b")
    g, (ox, oy, lw, lh), done = logo(sc, "logo", W / 2, 390, 1100, 200, color=PAPER, step=130)
    tag = sc.text("tagline", "Your information, your way.", 0, oy + lh + 80, 72, PAPER)
    sc.centred(tag)
    sc.words(tag, done + 150, dur=700, stagger=110)
    sub = sc.text("sub", "Free and open source  ·  Public Preview", 0, oy + lh + 200, 32, "#a8a8a8", font="body")
    sc.centred(sub)
    sc.fade_in(sub, done + 900, 600, dy=12)
    url = sc.text("url", "jx-holdings-llc.github.io/CardSpoke", 0, oy + lh + 270, 40, PAPER, font="display",
                  tracking=0)
    sc.centred(url)
    sc.fade_in(url, done + 1400, 600, dy=12)
    by = sc.text("by", "JX Holdings, LLC", 0, 1000, 24, "#7a7a7a", font="body")
    sc.centred(by)
    sc.fade_in(by, done + 1800, 600)
    # Fade to black at the very end.
    veil = sc.rect("veil", 0, 0, W, H, "#000000")
    sc.keys(veil, "opacity", [(0, 0), (5200, 0, "ease-in"), (6000, 1)])
    return sc


SCENES = [intro, origin, cards, links, search, you, themes, plugins, yours, end]
