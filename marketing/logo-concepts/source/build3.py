"""Rebuild the round-3 square marks into ../round-3: python3 build3.py [name ...]

Each mark is written twice: `NAME.svg` (black on transparent, square canvas) and
`NAME-tile.svg` (white on a full-bleed #111111 square with the mark inside the
centre 60%, which keeps it within the maskable-icon safe zone. Marks in FAVICON also get
`NAME-favicon.svg`, the tile with the mark filling 86% of it.)"""
import sys
from pathlib import Path
from variants3 import MARKS, TILE

OUT = Path(__file__).resolve().parent.parent / "round-3"
OUT.mkdir(exist_ok=True)
SIZE = 1024
FAVICON = {"s3b-logo-cards"}


def fit(L, frac):
    """Scale everything so the mark's larger side is frac * SIZE."""
    x0, y0, x1, y1 = L.bounds()
    k = SIZE * frac / max(x1 - x0, y1 - y0)
    for kind, d in L.items:
        for key in ("x", "y", "w", "h", "cx", "cy", "d", "baseline", "r"):
            if key in d and isinstance(d[key], (int, float)):
                d[key] *= k
        if kind == "wire":
            d["pts"] = [(px * k, py * k) for px, py in d["pts"]]
        if kind == "text":
            d["size"] *= k
            d["tracking"] = d.get("tracking", 0) * k
    L.sw *= k


if __name__ == "__main__":
    for name in sys.argv[1:] or MARKS:
        _, make = MARKS[name]
        outputs = [("", "#000000", 0.8, None), ("-tile", "#ffffff", 0.6, TILE)]
        if name in FAVICON:
            # browser tabs never crop, so the favicon fills the tile instead of keeping the safe zone
            outputs.append(("-favicon", "#ffffff", 0.86, TILE))
        for suffix, color, frac, tile in outputs:
            L = make(color)
            fit(L, frac)
            options = {"square": SIZE}
            if tile:
                options.update(tile=(0, 0, SIZE, SIZE, tile))
            project = L.build(**options)
            project.save(str(OUT / f"{name}{suffix}.vixl"), overwrite=True)
            project.export(str(OUT / f"{name}{suffix}.svg"), overwrite=True)
            project.export(str(OUT / f"{name}{suffix}.png"), overwrite=True)
        print(name)
