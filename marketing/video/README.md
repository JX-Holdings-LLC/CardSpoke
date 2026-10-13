# CardSpoke promo video

A one-minute marketing film for CardSpoke, made with [Vixl](https://github.com/jxburros/Vixl), the
layered-image and animation engine. It tells how CardSpoke came about: a place to keep notes the way
one person thinks, as cards that hold other cards; then opened up for everyone, and simple enough that
anyone can reshape it with themes and plugins. Your information, your way.

It shows the real app: every product shot is a screenshot of `www/` running in headless Chromium with a
demo dataset, and every cursor move and highlight is placed from the measured position of the UI
element it points at.

**[`cardspoke-promo.mp4`](cardspoke-promo.mp4)**: 1920×1080, 30 fps, about 62 s, AAC audio.

## The look

The film follows the logo and the app's cards ([brand guide](../../brand/README.md)): black on white
paper, square corners, one line weight, right-angled spokes between cards, and Inter Bold headings at
-0.03em. The app window is drawn as a card with a tab, stacked on a second card like the logo's small
cards. Labels are black blocks with white capitals, like the app's selected view toggle. There are no
tints, glows or gradients; the end card is the one dark frame, on the app icon's `#111111`. The logo
is drawn from `brand/master/wordmark.vixl` itself: its cards and spokes draw on in reading order, then
the letters rise into place.

## The cut

| # | Scene | Length | What it shows |
| --- | --- | --- | --- |
| 1 | `01-intro` | 5.0 s | The logo draws itself card by card, spoke by spoke. "Your information, your way." |
| 2 | `02-origin` | 7.0 s | "It started as a place for my own notes." Scattered notes snap into a tree of cards joined by spokes |
| 3 | `03-cards` | 8.0 s | Click through Novel → Characters → Mara Quinn; the breadcrumb trail |
| 4 | `04-links` | 6.5 s | Zoom onto `[[Act I]]` links; related cards |
| 5 | `05-search` | 5.5 s | Typing "tide", one real screenshot per keystroke, then the results |
| 6 | `06-you` | 5.0 s | "If it helped me, it could help you." One card branches out to many |
| 7 | `07-themes` | 7.0 s | "Simple enough to make your own." Wipes from light to dark mode, then the Forest and Cyberpunk themes |
| 8 | `08-plugins` | 9.0 s | The permission prompt, the Kanban Board plugin, the three plugin kinds, then the Create tab: "Or build your own." |
| 9 | `09-yours` | 7.0 s | Kept on your device: no account, no server, offline, PIN encryption, export; desktop and phone |
| 10 | `10-end` | 6.0 s | Logo, tagline, web app address |

Shots join with 400 ms crossfades.

## Folder

| Path | What it is |
| --- | --- |
| `cardspoke-promo.mp4` | The finished film |
| `capture/` | `capture.mjs` drives the app with Playwright; `dataset.mjs` is the demo dataset |
| `shots/` | The captured screenshots and `boxes.json` (UI element positions) |
| `build/` | Python that writes the scenes (`kit.py`, `scenes.py`), the soundtrack (`score.py`) and the film (`make_film.py`) |
| `scenes/*.vixl` | One editable Vixl master per scene, with its keyframe timeline |
| `film-spec.json` | The `film-export` request: shot order, crossfades and the two-track audio mix |

`audio/` (the synthesised music and effects), `sheets/` (contact sheets) and `build/.logo/` (the logo's
letters rendered from the brand master) are regenerated and not committed.

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
- **The app window** is a card: a group of shapes with the screenshots clipped to its viewport; zooms
  scale the whole group about a pivot on the element being shown.
- **The logo** is read from `brand/master/wordmark.vixl`: its card and spoke paths are copied into the
  scene and drawn on with `trim_end`, and its letters are rendered from the same master without them.
  Change the logo there and rebuild; the film follows.
- **Plugins** in the capture are the real sample packages: the Kanban Board app plugin is installed and
  approved through the app's own permission dialog. The demo dataset's `todo`/`doing`/`done` tags fill
  its columns.
- **Sound** is synthesised in numpy (`score.py`): a 120 BPM pad, bass, arpeggio and drums, plus
  clicks, keystrokes, card snaps and whooshes placed at the times each scene records.
- **Assembly** is Vixl's `film-plan` / `film-export` workflow.

The demo dataset is fictional. Fonts: Inter and JetBrains Mono (SIL Open Font License).
