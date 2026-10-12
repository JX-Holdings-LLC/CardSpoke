"""Rebuild the round-2 studies into ../round-2: python3 build2.py [name ...]"""
import sys
from pathlib import Path
from variants2 import VARIANTS

OUT = Path(__file__).resolve().parent.parent / "round-2"
OUT.mkdir(exist_ok=True)
for name in sys.argv[1:] or VARIANTS:
    make, options = VARIANTS[name]
    options = dict(options)
    project = make().build(margin=options.pop("margin", 30), **options)
    project.save(str(OUT / f"{name}.vixl"), overwrite=True)
    project.export(str(OUT / f"{name}.svg"), overwrite=True)
    project.export(str(OUT / f"{name}.png"), overwrite=True)
    print(name)
