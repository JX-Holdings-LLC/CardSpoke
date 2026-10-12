# CardSpoke logo concepts

Ten cleaned-up takes on the current `www/CardSpoke.svg` mark, built in Vixl. Each comes as an
editable `.vixl` source, an outlined `.svg` (text converted to paths, no font needed) and a `.png` preview.

The idea is the same in all of them: the cards are connected by right-angled "spokes", and the C and S
of the wordmark are cards too. The cleanup in all ten:

- **One type family.** The app already uses Inter for `--font-brand`, so the wordmark is set in Inter.
- **One line weight.** Every card outline and spoke uses the same stroke. In the original, the letter
  boxes, the cards and the connectors were three slightly different weights.
- **One grid.** All positions are multiples of a unit equal to 1/10 of the letter-card height. The C
  and S cards are the same size, letters are optically centred in them, and spokes meet each card at
  the middle of an edge.
- **Clearances.** The bottom spoke clears the `p` descender, and nothing nearly touches anything else.
  In the original, the top spoke ran almost flush with the first card's top edge.

| File | Idea |
| --- | --- |
| `01-faithful` | The original layout redrawn on the grid. Closest to today's logo. |
| `02-compact` | The two side cards share the letter cards' proportions and sit within the wordmark's height. Shorter and calmer. |
| `03-linked` | No side cards: one spoke links the C and S cards. The simplest version. |
| `04-deck` | The C and S each sit on a small stack of cards, joined underneath. |
| `05-knockout` | Like 02, but C and S are solid cards with the letters knocked out of them. |
| `06-rounded` | Like 02, with rounded corners and joins and a SemiBold wordmark. Softer. |
| `07-nodes` | Like 02, with a dot at each connection, so it reads as a network or graph. |
| `08-heavy` | Like 02, with double-weight lines and a SemiBold wordmark. Holds up best at 32 px. |
| `09-lockup` | A standalone card-and-spoke icon next to a plain wordmark. |
| `10-app-icon` | That icon on the 1024 px rounded tile used by `desktop/build/icon.svg`. |

## Using one in the app

Variants 01–09 drop in without changing the app. They are black on a transparent background with a
tight viewBox, so the existing `.brand-logo` rules (`height: 64px; width: auto` and the dark mode
`filter: invert(1)`) keep working. Copy the chosen SVG over `www/CardSpoke.svg` (and the root
`CardSpoke.svg`). At 32–36 px (the mobile header) 02, 03, 05 and 08 stay legible, while 01 and 04
get busy.

`10-app-icon` can replace `desktop/build/icon.svg`. `manifest.webmanifest` currently points its
`any maskable` icon at the wide wordmark; a square icon such as the 09/10 glyph would fit that slot better.

## Rebuilding

`source/` holds the generator. With Vixl installed and Inter in `/usr/share/fonts/opentype/inter`
(edit `kit.FONT_DIR` otherwise), run `python3 marketing/logo-concepts/source/build.py`. The geometry
for each variant is in `source/variants.py`. You can also open the `.vixl` files and edit their
layers (`card-*`, `spoke-*`, `letter-*`, `word-*`) directly with the `vixl` CLI.
