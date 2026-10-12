"""Write the editable logo masters into brand/master/ (python3 masters.py).

The masters are the chosen designs: the 2d wordmark (round-2/02d-compact-app) and the s3b
square mark (round-3/s3b-logo-cards). brand/build.py turns them into the logo package
and the app's icon files."""
from pathlib import Path
from variants2 import compact_app
from variants3 import logo_cards, TILE
from build3 import fit, SIZE

OUT = Path(__file__).resolve().parents[3] / "brand" / "master"
OUT.mkdir(parents=True, exist_ok=True)


def save(project, name):
    project.save(str(OUT / f"{name}.vixl"), overwrite=True)
    print(name, project.render().size)


# Wordmark: tight canvas (only the stroke's own half-width as margin), black on transparent,
# so it fills the app header's 64 px exactly. Clear space belongs to the package lockups.
save(compact_app().build(margin=2), "wordmark")

# Square mark: black on transparent, 80% of a 1024 canvas.
L = logo_cards(); fit(L, 0.8)
save(L.build(square=SIZE), "mark")

# App icon: white mark on a full-bleed #111111 square, mark inside the middle 60% (maskable safe zone).
L = logo_cards("#ffffff"); fit(L, 0.6)
save(L.build(square=SIZE, tile=(0, 0, SIZE, SIZE, TILE)), "icon-tile")

# Favicon: the same tile with the mark filling 86% (browser tabs never crop).
L = logo_cards("#ffffff"); fit(L, 0.86)
save(L.build(square=SIZE, tile=(0, 0, SIZE, SIZE, TILE)), "favicon")

# Desktop icon: macOS-style 824 px rounded tile with a 100 px margin, the convention
# desktop/build/icon.svg already used; the mark fills 60% of the tile.
L = logo_cards("#ffffff"); fit(L, 0.6 * 824 / SIZE)
save(L.build(square=SIZE, tile=(100, 100, 824, 824, TILE), tile_radius=184), "desktop-icon")
