import { Cafe } from "@/data/cafes";

/**
 * Every cafe gets a real, permanent, shareable URL: /cafe/{human-slug}--{id}.
 *
 * The id is the canonical lookup key (it never changes and is already URL-safe —
 * see backend Cafe.java, ids look like "syd-disc-014"). The human part exists only
 * for readability and SEO — it is never trusted for lookup, so a stale or hand-edited
 * slug still resolves. The two are joined with "--" because a plain "-" collides with
 * both slugify()'s own dashes and the dashes already inside real ids; "--" never
 * appears in either half, so splitting is unambiguous.
 */
const SEPARATOR = "--";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function buildCafeSlug(cafe: Pick<Cafe, "id" | "name" | "suburb">): string {
  const human = slugify(`${cafe.name}-${cafe.suburb}`) || "cafe";
  return `${human}${SEPARATOR}${cafe.id}`;
}

export function cafeIdFromSlug(slugParam: string): string {
  const idx = slugParam.lastIndexOf(SEPARATOR);
  return idx === -1 ? slugParam : slugParam.slice(idx + SEPARATOR.length);
}

export function cafeUrl(cafe: Pick<Cafe, "id" | "name" | "suburb">): string {
  return `/cafe/${buildCafeSlug(cafe)}`;
}

/**
 * Canonical site origin for absolute URLs (sitemap, OpenGraph, JSON-LD, share links).
 * Set NEXT_PUBLIC_SITE_URL in production — this fallback only matters for local dev
 * and unconfigured previews, where absolute URLs are non-critical.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || "https://matchascope.com"
);
