#!/usr/bin/env python3
"""Build the scene masters into ../scenes/ (all, or the names given) and write a contact sheet of each.

    python build.py                 # every scene
    python build.py 03-cards        # one scene
    python build.py --no-sheets     # skip the contact sheets
"""
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from scenes import SCENES  # noqa: E402

OUT = os.path.abspath(os.path.join(HERE, "..", "scenes"))
SHEETS = os.path.abspath(os.path.join(HERE, "..", "sheets"))


def main(argv):
    wanted = [a for a in argv if not a.startswith("--")]
    sheets = "--no-sheets" not in argv
    for make in SCENES:
        scene = make()
        if wanted and scene.name not in wanted:
            continue
        t = time.time()
        path = scene.build(OUT)
        print(f"{scene.name}: {len(scene.ops)} operations, {time.time() - t:.1f}s -> {path}", flush=True)
        if sheets:
            os.makedirs(SHEETS, exist_ok=True)
            sheet = os.path.join(SHEETS, f"{scene.name}.png")
            if os.path.exists(sheet):
                os.remove(sheet)
            subprocess.run(["vixl", "-p", path, "timeline-sheet", "--out", sheet, "--count", "12"], check=True, capture_output=True)


if __name__ == "__main__":
    main(sys.argv[1:])
