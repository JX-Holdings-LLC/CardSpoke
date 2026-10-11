# CardSpoke promo video

A one-minute marketing film for CardSpoke, made with [Vixl](https://github.com/jxburros/Vixl), the
layered-image and animation engine. It shows the real app: every product shot is a screenshot of
`www/` running in headless Chromium with a demo dataset, and every cursor move and highlight is
placed from the measured position of the UI element it points at.

**[`cardspoke-promo.mp4`](cardspoke-promo.mp4)**: 1920×1080, 30 fps, about 61 s, AAC audio.

## The cut

| # | Scene | Length | What it shows |
| --- | --- | --- | --- |
| 1 | `01-intro` | 5.0 s | The CardSpoke mark draws itself box by box, spoke by spoke. "Think in cards." |
| 2 | `02-shape` | 6.5 s | Scattered notes snap into a card tree joined by spokes |
| 3 | `03-cards` | 8.0 s | Click through Novel → Characters → Mara Quinn; the breadcrumb trail |
| 4 | `04-links` | 6.5 s | Zoom onto `[[Act I]]` links; related cards |
| 5 | `05-search` | 6.0 s | Typing "tide", one real screenshot per keystroke, then the highlighted results |
| 6 | `06-themes` | 7.0 s | Wipes from light to dark mode, then the Forest and Cyberpunk theme plugins |
| 7 | `07-local` | 7.0 s | Local-first: no account, no server, export to JSON, Markdown, TXT, CSV; PIN encryption |
| 8 | `08-plugins` | 6.5 s | The plugin gallery and the three plugin layers |
| 9 | `09-everywhere` | 6.0 s | Desktop window and phone layout side by side |
| 10 | `10-end` | 6.0 s | Logo, tagline, repository link |

Shots join with 400 ms crossfades.

## Folder

| Path | What it is |
| --- | --- |
| `cardspoke-promo.mp4` | The finished film |
| `capture/` | `capture.mjs` drives the app with Playwright; `dataset.mjs` is the demo dataset |
| `shots/` | The captured screenshots, the white logo render, and `boxes.json` (UI element positions) |
| `build/` | Python that writes the scenes (`kit.py`, `scenes.py`), the soundtrack (`score.py`) and the film (`make_film.py`) |
| `scenes/*.vixl` | One editable Vixl master per scene, with its keyframe timeline |
| `film-spec.json` | The `film-export` request: shot order, crossfades and the two-track audio mix |

`audio/` (the synthesised music and effects) and `sheets/` (contact sheets) are regenerated and not committed.

## Rebuild

Needs Node with this repo's dev dependencies, Python 3.11+ with Vixl installed
(`pip install -e path/to/Vixl`), and ffmpeg on `PATH`. The first build downloads Inter and
JetBrains Mono from Google Fonts.

```bash
npm ci
node marketing/video/capture/capture.mjs     # shots/*.png and shots/boxes.json
cd marketing/video/build
python build.py                              # scenes/*.vixl and sheets/*.png
python make_film.py                          # audio/*.wav, film-spec.json, cardspoke-promo.mp4
```

`capture.mjs` uses `CHROMIUM_PATH` or `/opt/pw-browsers/chromium` when set or present, and serves the
plugin gallery's manifest from `sample-plugins/` so it runs offline. Rebuild the capture after a UI
change: the scenes read `boxes.json`, so the cursor and highlights follow the new layout.

To look at or tweak one scene:

```bash
python build.py 04-links                                         # rebuild one scene and its sheet
vixl -p ../scenes/04-links.vixl render --time 1.4s --out frame.png
vixl -p ../scenes/04-links.vixl timeline-sheet --out sheet.png --count 12
```

## How it is made

- **Scenes** are ordinary Vixl documents: shapes, text, imported screenshots, groups and clipping,
  animated with keyframes (`translate-x/y`, `scale`, `opacity`, `trim_end` for draw-ons, `width` for
  the theme wipes, `stroke` colour) and per-word `text-animate` reveals.
- **The browser window** is a group of shapes with the screenshots clipped to its viewport; zooms
  scale the whole group about a pivot on the element being shown.
- **The logo** draws on as vectors traced from `CardSpoke.svg` (its four boxes and nine spokes), then
  the wordmark, rendered from the same SVG, fades in over them.
- **Sound** is synthesised in numpy (`score.py`): a 120 BPM pad, bass, arpeggio and drums, plus
  clicks, keystrokes and whooshes placed at the times each scene records.
- **Assembly** is Vixl's `film-plan` / `film-export` workflow.

The demo dataset is fictional. Fonts: Inter and JetBrains Mono (SIL Open Font License).
