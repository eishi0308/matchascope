import type { MetadataRoute } from "next";
import { fetchCafes } from "@/lib/api";
import { cafeUrl, SITE_URL } from "@/lib/slug";

// Regenerate hourly — cafe discovery runs weekly (CafeDiscoveryScheduler) but manual
// regrades happen anytime, and a stale sitemap just means Google re-crawls a page one
// cycle late, never a broken one, so an hour is cheap insurance rather than a real cost.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_URL}/map`, changeFrequency: "daily", priority: 0.9 },
  ];

  let cafes: Awaited<ReturnType<typeof fetchCafes>> = [];
  try {
    cafes = await fetchCafes();
  } catch (err) {
    // A sitemap that fails to build blocks the *entire* file, including the two
    // static entries above — better to ship those than 500 the whole route.
    console.error("[sitemap] fetchCafes failed, shipping static entries only", err);
  }

  const cafeEntries: MetadataRoute.Sitemap = cafes.map((cafe) => ({
    url: `${SITE_URL}${cafeUrl(cafe)}`,
    // Levels A/B carry a dated evidence quote — real content worth re-crawling often.
    // C/D are "nothing found" pages: still worth indexing, just less likely to change.
    changeFrequency: cafe.level === "A" || cafe.level === "B" ? "monthly" : "yearly",
    priority: cafe.level === "A" ? 0.7 : cafe.level === "B" ? 0.6 : 0.4,
  }));

  return [...staticEntries, ...cafeEntries];
}
