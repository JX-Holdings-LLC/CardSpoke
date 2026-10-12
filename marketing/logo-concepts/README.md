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

## Round 2

Variations on the four favorites (02, 03, 05, 09), in `round-2/`. The last version in each family
(`-app`) matches the app's look: the wordmark uses the app's heading style (Inter Bold, letter
spacing -0.03em) and the lines are heavier and square-cornered, like the app's 2 px button borders.

| File | Idea |
| --- | --- |
| `02a-compact-over` | The long spoke runs above the wordmark instead of below it. |
| `02b-compact-single` | One side card instead of two. |
| `02c-compact-row` | The side cards grow toward the C and share one bottom edge. |
| `02d-compact-app` | 02 matched to the app. |
| `03a-linked-under` | The link runs below the boxes. |
| `03b-linked-nodes` | Dots where the spoke meets each card. |
| `03c-linked-heavy` | Double-weight lines and a SemiBold wordmark. |
| `03d-linked-app` | 03 matched to the app. |
| `05a-knockout-linked` | Solid C and S cards joined by one spoke (03 + 05). |
| `05b-knockout-solid` | The side cards are solid too. |
| `05c-knockout-shadow` | Outlined cards lifted on solid offset shadows. |
| `05d-knockout-app` | 05 matched to the app. |
| `09a-lockup-stacked` | The icon above the wordmark. |
| `09b-lockup-two-weight` | Card in Bold, Spoke in Regular. |
| `09c-lockup-mini` | A simpler two-card icon for favicon sizes. |
| `09d-lockup-app` | 09 matched to the app. |

Rebuild round 2 with `python3 marketing/logo-concepts/source/build2.py`; the geometry is in `source/variants2.py`.

## Round 3: square marks from 2d

2d (`round-2/02d-compact-app`) is the chosen wordmark. `round-3/` holds six square versions of it.
Each comes as `NAME.svg` (black on transparent, 1024 x 1024) and `NAME-tile.svg` (white on a
full-bleed `#111111` square, the app's theme color). On the tile the mark stays inside the middle
60%, which is the maskable-icon safe zone, so the Android circle crop and the iOS/macOS rounded mask
never cut into it.

| File | Idea |
| --- | --- |
| `s1-ladder` | C over S, a small card feeding each: 2d stacked into a square. |
| `s2-ladder-solid` | The ladder with solid letter cards; the letters stay readable at 32 px. |
| `s3-diagonal` | Only C and S, stepped, joined by one spoke. |
| `s4-cluster` | Only the C card, fed by the two side cards. |
| `s5-cards-only` | The ladder with no letters and heavier lines, for 16 px favicons. |
| `s6-two-line` | The full 2d wordmark on two lines, for avatars and social profiles. |
| `s3b-logo-cards` | **Chosen.** s3 rebuilt from 2d's two small side cards: the same boxes, line weight, position and connecting line as in the wordmark, with C and S set inside them. Also exported as `s3b-logo-cards-favicon.svg`, the tile with the mark filling 86% of it, for browser tabs (which never crop). |

Rebuild with `python3 marketing/logo-concepts/source/build3.py`; the geometry is in `source/variants3.py`.

## The chosen logo

2d is the wordmark and s3b is the icon. They are in use in the app, and the logo package built from them is in
[`brand/`](../../brand/README.md). `source/masters.py` writes their editable masters to `brand/master/`, and
`brand/build.py` builds the package and the app's logo and icon files from those masters.
