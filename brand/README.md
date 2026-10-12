# CardSpoke brand

The CardSpoke logo, its square icon, and every file the app and outside uses need. Everything here is built
from the editable masters in `master/` by `build.py`, using [Vixl](https://github.com/jxburros/Vixl).

## The logo

![CardSpoke wordmark](wordmark/svg/logo-full-color.svg)

The wordmark is cards joined by spokes. The C and the S of the name sit in cards, and two small cards
feed into them through right-angled spokes. It matches the app's own type and line style:

- **Type:** Inter Bold with letter spacing of -0.03em, the app's heading style (`--font-brand`).
- **Lines:** one weight everywhere, square corners and joins, like the app's 2 px button borders.
- **Grid:** the unit is a tenth of a letter card's height. Small cards are 0.55 of a letter card, and
  spokes meet each card at the middle of an edge.

## The icon

![CardSpoke icon](app-icons/icon-tile.svg)

The square icon reuses the wordmark's two small cards exactly: same size, line weight, position and
connecting spoke, with the C and S set inside them. On the app icon tile it is white on `#111111`, the
app's `theme_color`, and stays inside the middle 60% so the Android circle crop and the iOS/macOS rounded
mask never cut into it. The favicon version fills 86% of the tile, because browser tabs never crop.

## Colors

| Use | Color |
| --- | --- |
| Logo on light backgrounds | `#000000` |
| Logo on dark backgrounds | `#ffffff` |
| Icon tile, app `theme_color` | `#111111` |

The logo is one color. Use the black or the white version, never a tint, gradient or second color. In
the app, dark mode inverts the black header logo with `filter: invert(1)`, so a colored logo would come
out in the wrong color.

## Which file to use

| Need | File |
| --- | --- |
| Website, docs, slides (light background) | `wordmark/svg/logo-mono-black.svg` |
| Dark background | `wordmark/svg/logo-mono-white.svg` or `wordmark/png/logo-on-dark-*.png` |
| Print | `wordmark/pdf/logo-mono-black.pdf` |
| Raster logo at a set width | `wordmark/png/logo-*-{256,512,1024}w@{1,2,3}x.png` |
| Link previews (Open Graph, 1200 x 630) | `wordmark/social/og-image.png` |
| Profile picture, avatar | `mark/social/avatar.png` |
| Square mark without a tile | `mark/svg/logo-mono-black.svg`, `mark/svg/logo-mono-white.svg` |
| App store and launcher icons | `app-icons/apple-icon-*.png`, `app-icons/android-*.png`, `app-icons/windows-tile-*.png` |
| Favicons | `app-icons/favicon.svg`, `app-icons/favicon.ico`, `app-icons/favicon-*.png` |

`wordmark/usage.html` and `mark/usage.html` are the usage sheets: each variant with a note on where it
belongs. Each package also keeps an editable `.vixl` per variant in `source/`.

## Clear space and minimum size

- Keep clear space of at least a quarter of the logo's height on every side. The package files already
  include it. The header file `CardSpoke.svg` is trimmed tight because the header supplies its own padding.
- Don't use the wordmark below 24 px tall; use the icon instead. The icon holds up down to 16 px.

## Don't

- Don't redraw, re-space or re-letter the logo. Rebuild it from the masters.
- Don't stretch it, rotate it, outline it, or add shadows or effects.
- Don't put the icon on a busy photo without its tile.
- Don't use the wide wordmark as a square app or launcher icon. Launchers crop it.

## Where the app uses it

| File | Used by |
| --- | --- |
| `CardSpoke.svg`, `www/CardSpoke.svg` | The header logo and the README |
| `www/favicon.svg`, `www/favicon.ico` | Browser tab |
| `www/apple-touch-icon.png` | iOS "Add to Home Screen" |
| `www/icon-192.png`, `www/icon-512.png` | `manifest.webmanifest`, the installable web app (maskable) |
| `desktop/build/icon.svg` | Desktop app icon; `npm run icon` in `desktop/` renders `icon.png` and `icons/` |

## Rebuilding

With Vixl installed (see its README; an editable checkout works), run:

```bash
python3 brand/build.py
cd desktop && npm run icon
```

`build.py` regenerates `wordmark/`, `mark/` and `app-icons/` and replaces the app files listed above.
To change the design itself, edit the masters: open `master/*.vixl` with Vixl, or regenerate them from
the design code with `python3 marketing/logo-concepts/source/masters.py`. The concepts that led here are
in [marketing/logo-concepts](../marketing/logo-concepts/README.md).
