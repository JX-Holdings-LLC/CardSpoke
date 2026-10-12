"""Round 3: square marks derived from 02d (compact, app-matched)."""
from kit import Logo, ink
from variants2 import APP

TILE = "#111111"   # the app's theme_color


def card_dims(L):
    pad = L.cap * 0.22
    w = max(ink(L.font, ch)[2] - ink(L.font, ch)[0] for ch in "CS")
    return w + 2 * pad, L.cap + 2 * pad, pad


def letter_card(L, x, y, ch, knockout=False, letters=True):
    """A letter card whose outer top-left corner is (x, y); returns its centre-line box."""
    bw, bh, pad = card_dims(L)
    bx, by = x + L.sw / 2, y + L.sw / 2
    L.rect(bx, by, bw, bh, name=f"card-{ch}", fill=L.ink_color if knockout else None)
    if letters:
        l, t, r, b = ink(L.font, ch)
        L.text(ch, bx + bw / 2 - (l + r) / 2, by + pad + L.cap, name=f"letter-{ch}",
               color=(TILE_INK[L.ink_color] if knockout else None))
    return bx, by, bw, bh


TILE_INK = {"#000000": "#ffffff", "#ffffff": TILE}


def ladder(knockout=False, letters=True, ink_color="#000000", sw=None):
    """2 x 2: small cards on the left, C over S on the right, wired like 02d."""
    L = Logo(**{**APP, "ink_color": ink_color, **({"sw": sw} if sw else {})})
    bw, bh, _ = card_dims(L); g = bh / 10
    aw, ah = bw * 0.55, bh * 0.55
    cx, cy, _, _ = letter_card(L, 0, 0, "C", knockout, letters)
    sx, sy, _, _ = letter_card(L, 0, bh + 2.5 * g, "S", knockout, letters)
    ax, bxx = cx - 3 * g - aw, cx - 3 * g - aw
    ay, by = cy + (bh - ah) / 2, sy + (bh - ah) / 2
    L.rect(ax, ay, aw, ah, name="card-a")
    L.rect(bxx, by, aw, ah, name="card-b")
    L.wire([(ax + aw, ay + ah / 2), (cx, ay + ah / 2)], name="spoke-a-c")
    L.wire([(ax + aw / 2, ay + ah), (ax + aw / 2, by)], name="spoke-a-b")
    L.wire([(bxx + aw, by + ah / 2), (sx, by + ah / 2)], name="spoke-b-s")
    return L


def diagonal(knockout=False, ink_color="#000000"):
    """C top-left, S bottom-right, one elbow spoke."""
    L = Logo(**{**APP, "ink_color": ink_color})
    bw, bh, _ = card_dims(L); g = bh / 10
    cx, cy, _, _ = letter_card(L, 0, 0, "C", knockout)
    sx, sy, _, _ = letter_card(L, bw * 0.6, bh + 2.5 * g + L.sw, "S", knockout)
    L.wire([(cx + bw * 0.3, cy + bh), (cx + bw * 0.3, sy + bh / 2), (sx, sy + bh / 2)], name="spoke-c-s")
    return L


def cluster(knockout=False, ink_color="#000000"):
    """The left half of 02d folded into a square: two small cards feeding the C card."""
    L = Logo(**{**APP, "ink_color": ink_color})
    bw, bh, _ = card_dims(L); g = bh / 10
    cx, cy, _, _ = letter_card(L, 0, 0, "C", knockout)
    aw, ah = bw * 0.55, bh * 0.55
    # A above-left, B below-left, both linked into the C card's left edge
    ax, ay = cx - 3 * g - aw, cy - ah * 0.45
    bx, by = cx - 3 * g - aw * 0.55, cy + bh - ah * 0.55
    ax -= aw * 0.45
    L.rect(ax, ay, aw, ah, name="card-a")
    L.rect(bx, by, aw, ah, name="card-b")
    ya = cy + bh * 0.22
    L.wire([(ax + aw, ya), (cx, ya)], name="spoke-a-c")
    L.wire([(ax + aw / 2, ay + ah), (ax + aw / 2, by + ah / 2), (bx, by + ah / 2)], name="spoke-a-b")
    return L


def two_line(ink_color="#000000"):
    """02d broken onto two lines: [C]ard over [S]poke with the side cards on the left."""
    L = Logo(**{**APP, "ink_color": ink_color})
    bw, bh, _ = card_dims(L); g = bh / 10
    w1 = L.wordmark(0, 0, boxed=("C",), letters="Card", box_w=bw)
    lead = bh + 2.5 * g
    w2 = L.wordmark(0, lead, boxed=("S",), letters="Spoke", box_w=bw)
    (cx, cy, _, _), = w1["boxes"]; (sx, sy, _, _), = w2["boxes"]
    aw, ah = bw * 0.55, bh * 0.55
    ax = cx - 3 * g - aw
    ay, by = cy + (bh - ah) / 2, sy + (bh - ah) / 2
    L.rect(ax, ay, aw, ah, name="card-a")
    L.rect(ax, by, aw, ah, name="card-b")
    L.wire([(ax + aw, ay + ah / 2), (cx, ay + ah / 2)], name="spoke-a-c")
    L.wire([(ax + aw / 2, ay + ah), (ax + aw / 2, by)], name="spoke-a-b")
    L.wire([(ax + aw, by + ah / 2), (sx, by + ah / 2)], name="spoke-b-s")
    return L


MARKS = {
    "s1-ladder": ("Ladder", lambda c="#000000": ladder(ink_color=c)),
    "s2-ladder-solid": ("Ladder, solid letters", lambda c="#000000": ladder(knockout=True, ink_color=c)),
    "s3-diagonal": ("Diagonal", lambda c="#000000": diagonal(ink_color=c)),
    "s4-cluster": ("Single C", lambda c="#000000": cluster(ink_color=c)),
    "s5-cards-only": ("Cards only", lambda c="#000000": ladder(letters=False, ink_color=c, sw=24)),
    "s6-two-line": ("Two-line wordmark", lambda c="#000000": two_line(ink_color=c)),
}


def logo_cards(ink_color="#000000"):
    """s3 rebuilt from 2d's two small side cards: same size, position, line weight and spoke
    as in the wordmark, with C and S set inside them at the same scale as the cards (0.55)."""
    L = Logo(**{**APP, "ink_color": ink_color})
    bw, bh, pad = card_dims(L); g = bh / 10
    k = 0.55
    aw, ah = bw * k, bh * k
    # the 2d layout, relative to the C card's left edge at x = 0
    ax, ay = -3 * g - aw - 2.5 * g - aw, 0
    bx, by = -3 * g - aw, bh - ah
    size = L.size * k
    from PIL import ImageFont
    from kit import FONT_DIR, WEIGHTS
    font = ImageFont.truetype(str(FONT_DIR / WEIGHTS[L.weight]), size)
    cap = -ink(font, "H")[1]
    for (x, y, ch) in ((ax, ay, "C"), (bx, by, "S")):
        L.rect(x, y, aw, ah, name=f"card-{ch}")
        l, t, r, b = ink(font, ch)
        L.text(ch, x + aw / 2 - (l + r) / 2, y + (ah - cap) / 2 + cap, name=f"letter-{ch}", size=size)
    L.wire([(ax + aw / 2, ay + ah), (ax + aw / 2, by + ah / 2), (bx, by + ah / 2)], name="spoke-c-s")
    return L


MARKS["s3b-logo-cards"] = ("Diagonal, logo cards", lambda c="#000000": logo_cards(ink_color=c))
