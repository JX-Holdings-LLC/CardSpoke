"""01 - faithful recreation of CardSpoke.svg as editable Vixl layers."""
from vx import Type, new, path, rect, finish

INK = "#000000"
SW = 7  # the original's stroke weight on its 1500 px canvas

p = new("01-recreation", 1500, 1500, "#ffffff", fonts=[("Arimo", 400)])
word = Type("Arimo", 400, 164, "CardSpoke", tracking=16)
tx, ty = 415, 646

c = word.glyph(0, tx, ty)
s = word.glyph(4, tx, ty)
frame_top, frame_bottom = 625, 781
pad = 11
p.apply([
    # two loose cards on the left
    rect("card-a", 152, 590, 97, 122, stroke=INK, width=SW),
    rect("card-b", 277, 696, 84, 85, stroke=INK, width=SW),
    # framed initials, sized from the glyphs they hold
    rect("frame-c", c[0] - pad, frame_top, c[2] - c[0] + 2 * pad, frame_bottom - frame_top, stroke=INK, width=SW),
    rect("frame-s", s[0] - pad, frame_top, s[2] - s[0] + 2 * pad, frame_bottom - frame_top, stroke=INK, width=SW),
    # wires (square corners, like the original)
    path("wire-a-c", "M249 648 H316 V585 H474 V625", INK, SW, cap="butt", join="miter"),
    path("wire-a-b", "M200 712 V738 H277", INK, SW, cap="butt", join="miter"),
    path("wire-b-s", f"M317 781 V823 H{(s[0] + s[2]) / 2:.0f} V781", INK, SW, cap="butt", join="miter"),
    *word.layer("wordmark", tx, ty, INK),
])
finish(p, "01-recreation")
