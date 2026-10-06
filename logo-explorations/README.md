# CardSpoke logo explorations

Logo studies built with [Vixl](https://github.com/jxburros/Vixl) 0.21. Each logo has an editable
Vixl master (`.vixl`), a vector export (`.svg`, with text converted to outlines) and a PNG preview.
Open `gallery.html` to see them all side by side with the brief each one answers.

| File | Round | Idea |
| --- | --- | --- |
| `00-original` | — | `CardSpoke.svg` imported into Vixl, for comparison |
| `01-recreation` | Recreation | The original rebuilt as layers (Arimo, metric-compatible with Arial), checked by overlay |
| `02a`–`02c-refined*` | Refined | Same concept: 5:7 cards, one stroke weight, rounded routed wires, ports; ink, accent and reverse versions |
| `02d-refined-mark` | Refined | Square app mark: one card, one wire, one card |
| `03-card-tree` | Same vibe | Parent card branching to child cards (the hierarchy is the product) |
| `04-nested-local` | Same vibe | Cards inside cards with your data at the centre; terminal-style wordmark |
| `05-hub-spokes` | Same vibe | Six cards on spokes around a hub, built with `radial-repeat` |
| `06-cs-cards` | Same vibe | C and S as two overlapping cards joined by a wire |
| `07-card-wheel` | Radical | Bright spoked wheel of coloured cards |
| `08-hand-of-cards` | Radical | A fanned hand of index cards with a serif wordmark |
| `09-index-tab` | Radical | The name on a soft tabbed index card |
| `10-brutalist` | Radical | Stacked heavy type with a hard-shadowed card slab |
| `11-tree-wired` (+ `-mark`) | Round two | Card tree in navy and amber, wired into the framed C and S (03 × 02c/d) |
| `12-tabbed-cs` (+ `-mark`) | Round two | C and S as tabbed index cards in mint (06 × 09) |
| `13-name-card-tree` (+ `-mark`) | Round two | The name on a navy tabbed card that branches into child cards (09 × 03 × 02) |

Shortlisted after round one: 02c, 02d, 03, 06 and 09.

## Rebuilding

The scripts in `build/` regenerate every file. They need Vixl on your `PATH` and in the
active Python environment, plus network access the first time so Vixl can download the
Google Fonts each logo uses (they are cached and embedded in the masters afterwards).

```bash
pip install -e /path/to/Vixl
cd logo-explorations/build
python 01_recreation.py
python 02_refined.py
python 03_reinterpretations.py
python 04_radical.py
python 05_shortlist.py
```

To edit a logo by hand, use the master: for example
`vixl -p 02b-refined-accent.vixl layers`, then `vixl -p 02b-refined-accent.vixl render --out preview.png`.
