#!/usr/bin/env python3
"""Synthesise the soundtrack and assemble the promo with Vixl's ``film-export`` workflow.

    python build.py          # 1. scene masters into ../scenes/
    python make_film.py      # 2. ../audio/*.wav, ../film-spec.json, ../cardspoke-promo.mp4
"""
import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np  # noqa: E402

import score  # noqa: E402
from kit import FPS, H, W  # noqa: E402
from scenes import SCENES  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, ".."))
XFADE = 400  # ms of crossfade into each shot after the first
OUTPUT = "cardspoke-promo.mp4"


def schedule(scenes):
    """Film start time (s) of each scene, mirroring film-export's frame-accurate crossfade overlap."""
    starts, frame = {}, 0
    overlap = round(XFADE * FPS / 1000)
    for i, s in enumerate(scenes):
        frame -= overlap if i else 0
        starts[s.name] = frame / FPS
        frame += math.ceil(s.duration * FPS / 1000)
    return starts, frame / FPS


def main():
    scenes = [make() for make in SCENES]
    starts, total = schedule(scenes)
    print(f"film length {total:.2f}s; synthesising audio ...", flush=True)
    music, sfx = score.build_audio(total, starts, scenes)
    for track in (music, sfx):
        n_out, n_in = int(1.2 * score.SR), int(0.05 * score.SR)
        track[-n_out:] *= np.linspace(1, 0, n_out)
        track[:n_in] *= np.linspace(0, 1, n_in)
    os.makedirs(os.path.join(ROOT, "audio"), exist_ok=True)
    score.write_wav(os.path.join(ROOT, "audio", "music.wav"), music, 0.85)
    score.write_wav(os.path.join(ROOT, "audio", "effects.wav"), sfx, 0.85)

    spec = {
        "version": 1, "width": W, "height": H, "fps": FPS,
        "shots": [],
        "audio": [
            {"source": "audio/music.wav", "start": 0, "volume": 1.1},
            {"source": "audio/effects.wav", "start": 0, "volume": 0.8},
        ],
    }
    for i, s in enumerate(scenes):
        shot = {"source": f"scenes/{s.name}.vixl", "duration": s.duration}
        if i:
            shot["transition"] = XFADE
        spec["shots"].append(shot)
    request = {"output": OUTPUT, "spec": spec}
    req_path = os.path.join(ROOT, "film-spec.json")
    with open(req_path, "w") as fh:
        json.dump(request, fh, indent=2)
        fh.write("\n")
    out = os.path.join(ROOT, OUTPUT)
    if os.path.exists(out):
        os.remove(out)
    print("film-plan ...", flush=True)
    plan_path = os.path.join(ROOT, ".film-plan-request.json")
    with open(plan_path, "w") as fh:
        json.dump({"spec": spec}, fh)
    try:
        subprocess.run(["vixl", "workflow", "film-plan", "--request", plan_path, "--workspace", ROOT], check=True)
    finally:
        os.remove(plan_path)
    print("film-export (renders every frame) ...", flush=True)
    subprocess.run(["vixl", "workflow", "film-export", "--request", req_path, "--workspace", ROOT], check=True)


if __name__ == "__main__":
    main()
