# Site share card and icons

Sources for the images Next.js serves from `src/app/`:

| Source | Becomes |
|---|---|
| `og.html` | `src/app/opengraph-image.png` (link previews for every page except cafe pages, which draw their own) |
| `og.html#dark` | Dark version, not used |
| `apple-icon.svg` | `src/app/apple-icon.png` |
| `src/app/icon.svg` is its own source | `src/app/favicon.ico` (16, 32 and 48px) |

## The numbers go stale

The card says "Only 1 in 10" and "We checked 1,147", and the bar widths are the level counts
on 15 Sep 2026 (A 100, B 19, C 491, D 537). Nothing updates them. When the counts move
enough to make either sentence wrong, edit `og.html` and render it again.

## Rendering

Rendered with headless Chrome at 2x, then scaled to 1200×630:

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=2 \
  --virtual-time-budget=8000 --window-size=1200,630 \
  --screenshot=og@2x.png "file://$PWD/og.html"
sips -Z 1200 og@2x.png --out ../../src/app/opengraph-image.png
```

X lays its own domain label over the bottom-left corner of the card, so keep that corner empty.
