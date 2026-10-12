"""Rebuild every logo study: python3 build.py (needs Vixl installed and the Inter OTFs in kit.FONT_DIR)."""
from pathlib import Path
from variants import VARIANTS

OUT = Path(__file__).resolve().parent.parent
for name, (make, options) in VARIANTS.items():
    options = dict(options)
    project = make().build(margin=options.pop("margin", 30), **options)
    project.save(str(OUT / f"{name}.vixl"), overwrite=True)
    project.export(str(OUT / f"{name}.svg"), overwrite=True)
    project.export(str(OUT / f"{name}.png"), overwrite=True)
    print(name)
