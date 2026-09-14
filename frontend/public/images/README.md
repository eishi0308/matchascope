# Images

Static images that ship with the site. Anything in this folder is served as-is at
`/images/...`, so only put files here that are meant to be public.

## What goes where

| Kind | Location | Why |
|---|---|---|
| Real photos of named places (e.g. Uji tea fields) | `images/photos/` | Few, fixed, committed to git |
| Screenshots of this site (e.g. How it works, step 04) | `images/screenshots/` | Few, fixed, committed to git |
| Drawn illustrations (e.g. empty states) | `images/illustrations/` | Few, fixed, committed to git |
| Tab icon, Apple icon, share images | `src/app/icon.svg`, `src/app/apple-icon.png`, `opengraph-image.tsx` | Next.js picks these up by file name, not from here |
| Per-cafe evidence screenshots | Supabase Storage | Around 100 files that change with each crawl, kept out of git |
| Press video thumbnails | Loaded from `i.ytimg.com` | Not copied; allowed in `next.config.js` |

## Not allowed

- **Stock photos of matcha drinks, whisks or bowls.** Next to a cafe name they read as a verdict on that cafe's matcha, which nothing here can verify.
- **Google Maps / Places photos.** Google's terms do not allow storing them, and their URLs expire.
- **Photos copied from news articles.** Link to the article instead.

## File names

Lowercase, hyphens, no spaces, English only. Say what is in it and where.

```
photos/uji-tea-fields-shaded-rows.jpg
screenshots/cafe-page-evidence-box.png
illustrations/saved-empty-state.svg
```

## Sizes

| Kind | Export at | Format | Keep under |
|---|---|---|---|
| Photo | 2000px on the long side | JPG, quality 80 | 400 KB |
| Screenshot | 1600px wide (2x) | PNG | 300 KB |
| Illustration | vector | SVG | 50 KB |

`next/image` converts these to WebP/AVIF at the size each screen needs, so export once at
the size above rather than making small versions by hand.

## Using an image

Always `next/image`, never a plain `<img>`:

```tsx
import Image from "next/image";

<Image
  src="/images/photos/uji-tea-fields-shaded-rows.jpg"
  alt="Shaded tea rows in Uji, Kyoto Prefecture"
  width={2000}
  height={1250}
  sizes="(min-width: 768px) 420px, 100vw"
/>
```

- `alt` says what is in the image. Purely decorative images get `alt=""`.
- `priority` only on an image at the very top of a page.

## Credits

Every image not made for this site needs a row here and a visible credit where it is shown.

| File | Author | Source | License |
|---|---|---|---|
