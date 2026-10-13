"""A small numpy synthesiser for the promo's music bed and interface sound effects.

The music is 120 BPM (one bar = 2 s): a warm pad over Fmaj7 - Am7 - Dm9 - Bbmaj7, a sub bass, a plucked
arpeggio, and drums that enter with the product shots and drop out for the end card. The effects
(clicks, keystrokes, whooshes, card snaps, a soft logo hit) are placed from the times each scene records.
"""
from __future__ import annotations

import wave

import numpy as np

SR = 48000
BEAT = 0.5
BAR = 4 * BEAT


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


CHORDS = [  # (bass root, chord tones) as MIDI notes
    (41, [53, 57, 60, 64]),  # Fmaj7
    (45, [57, 60, 64, 67]),  # Am7
    (38, [53, 57, 60, 64, 62 + 12]),  # Dm9
    (46, [53, 58, 62, 65]),  # Bbmaj7
]


def env(n, a, r, sustain=1.0):
    """Linear attack, hold, exponential-ish release over n samples."""
    e = np.full(n, sustain)
    na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    if na:
        e[:na] = np.linspace(0, sustain, na)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e


def lowpass(x, cutoff):
    """One-pole low-pass; ``cutoff`` in Hz (scalar or per-sample array)."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def saw(freq, n, detune=0.0, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((t * freq * (1 + detune) + phase) % 1.0) - 1


def add(track, start, sig):
    i = int(start * SR)
    if i >= len(track):
        return
    sig = sig[: len(track) - i]
    track[i:i + len(sig)] += sig


def pad(total):
    out = np.zeros(int(total * SR))
    bars = int(np.ceil(total / BAR))
    for b in range(0, bars, 2):
        _, notes = CHORDS[(b // 2) % 4]
        length = 2 * BAR + 0.6
        n = int(length * SR)
        chord = np.zeros(n)
        for k, note in enumerate(notes):
            f = midi(note)
            chord += sum(saw(f, n, d, k * 0.13) for d in (-0.004, 0.0, 0.005)) / 3
        sweep = 700 + 900 * np.sin(np.linspace(0, np.pi, n)) ** 2
        chord = lowpass(chord / len(notes), sweep)
        add(out, b * BAR, chord * env(n, 0.9, 1.2) * 0.5)
    return out


def bass(total, start, end):
    out = np.zeros(int(total * SR))
    t = start
    while t < end:
        bar = int(t / BAR)
        root, _ = CHORDS[(bar // 2) % 4]
        for step in (0, 1.5, 2.5, 3):  # a gentle syncopated pulse
            n = int(BEAT * 0.9 * SR)
            f = midi(root)
            tt = np.arange(n) / SR
            sig = np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(4 * np.pi * f * tt)
            add(out, bar * BAR + step * BEAT, sig * env(n, 0.005, 0.25) * 0.3)
        t = (bar + 1) * BAR
    return out


def pluck(freq, length=0.45):
    n = int(length * SR)
    sig = saw(freq, n) * 0.6 + np.sin(2 * np.pi * freq * np.arange(n) / SR) * 0.4
    cutoff = 400 + 4200 * np.exp(-np.arange(n) / (0.07 * SR))
    return lowpass(sig, cutoff) * np.exp(-np.arange(n) / (0.16 * SR))


def arp(total, start, end):
    out = np.zeros(int(total * SR))
    pattern = [0, 1, 2, 3, 2, 1, 2, 3]
    t = start
    while t < end:
        bar = int(t / BAR)
        _, notes = CHORDS[(bar // 2) % 4]
        for i, idx in enumerate(pattern):
            at = bar * BAR + i * BEAT / 2
            if start <= at < end:
                add(out, at, pluck(midi(notes[idx % len(notes)] + 12)) * 0.3)
        t = (bar + 1) * BAR
    return out


def kick():
    n = int(0.35 * SR)
    tt = np.arange(n) / SR
    f = 45 + 110 * np.exp(-tt / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.11)


def noise_hit(length, decay, cutoff, seed, high=False):
    rng = np.random.default_rng(seed)
    n = int(length * SR)
    x = rng.standard_normal(n)
    x = x - lowpass(x, cutoff) if high else lowpass(x, cutoff)
    return x * np.exp(-np.arange(n) / (decay * SR))


def drums(total, start, end, claps_from):
    out = np.zeros(int(total * SR))
    k, hat, clap = kick(), noise_hit(0.08, 0.018, 7000, 1, high=True), noise_hit(0.25, 0.06, 2500, 2)
    b = int(np.ceil(start / BEAT))
    while b * BEAT < end:
        t = b * BEAT
        add(out, t, k * 0.42)
        add(out, t + BEAT / 2, hat * 0.18)
        if t >= claps_from and b % 2 == 1:
            add(out, t, clap * 0.22)
        b += 1
    return out


def riser(length):
    n = int(length * SR)
    rng = np.random.default_rng(3)
    x = lowpass(rng.standard_normal(n), np.linspace(300, 6000, n))
    return x * np.linspace(0, 1, n) ** 2


def impact():
    n = int(2.5 * SR)
    tt = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-tt / 0.08)) / SR) * np.exp(-tt / 0.6)
    shimmer = noise_hit(2.5, 0.5, 9000, 4, high=True) * 0.15
    return boom * 0.9 + shimmer


def whoosh(length=0.7, seed=5):
    n = int(length * SR)
    rng = np.random.default_rng(seed)
    shape = np.sin(np.linspace(0, np.pi, n)) ** 2
    x = lowpass(rng.standard_normal(n), 300 + 3500 * shape)
    return x * shape


def snap():
    """A short wooden tick for a card landing or a logo part drawing in."""
    n = int(0.09 * SR)
    tt = np.arange(n) / SR
    body = np.sin(2 * np.pi * 900 * tt) * np.exp(-tt / 0.02)
    return (body * 0.7 + noise_hit(0.09, 0.006, 3000, 7) * 0.5) * np.exp(-tt / 0.03)


def click():
    n = int(0.06 * SR)
    tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * 2100 * tt) * 0.6 + noise_hit(0.06, 0.004, 5000, 6, high=True)) * np.exp(-tt / 0.012)


def build_audio(total, scene_starts, scenes):
    """``scene_starts``: film time (s) of each scene; ``scenes``: the Scene objects (for their cues)."""
    starts = {s.name: scene_starts[s.name] for s in scenes}
    product = starts["03-cards"]
    outro = starts["10-end"]
    music = pad(total) * 1.1
    music += arp(total, starts["02-origin"] + 0.5, outro + 1.0)
    music += bass(total, product, outro)
    music += drums(total, product, outro, starts["07-themes"])
    # A last held chord under the end card.
    n = int(5.5 * SR)
    chord = sum(saw(midi(f), n, d) for f in (53, 57, 60, 64, 69) for d in (-0.003, 0.004)) / 10
    add(music, outro, lowpass(chord, 1400) * env(n, 0.4, 3.0) * 0.6)
    add(music, outro, impact() * 0.5)

    sfx = np.zeros(int(total * SR))
    add(sfx, max(0.0, starts["01-intro"] + 1.6 - 1.4), riser(1.4) * 0.35)
    add(sfx, starts["01-intro"] + 1.6, impact() * 0.5)
    for s in scenes:
        t0 = starts[s.name]
        for i, ms in enumerate(s.clicks):
            add(sfx, t0 + ms / 1000, click() * 0.35)
        for ms in s.snaps:
            add(sfx, t0 + ms / 1000, snap() * 0.22)
        for i, ms in enumerate(s.whooshes):
            add(sfx, t0 + ms / 1000 - 0.2, whoosh(seed=10 + i) * 0.25)
    return music, sfx


def write_wav(path, x, peak=0.9):
    x = x / max(1e-9, np.max(np.abs(x))) * peak
    data = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
