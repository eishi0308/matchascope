import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { fetchCafe, fetchCafes } from "@/lib/api";
import { buildCafeSlug, cafeIdFromSlug, cafeUrl, SITE_URL } from "@/lib/slug";
import { levelConfig } from "@/data/cafes";
import CafeDetailView from "./CafeDetailView";

// Pre-render every cafe at build time so the very first crawl already has full pages
// to index, not just routes that resolve on demand.
export async function generateStaticParams() {
  try {
    const cafes = await fetchCafes();
    return cafes.map((cafe) => ({ slug: buildCafeSlug(cafe) }));
  } catch {
    // Build-time Supabase hiccup shouldn't fail the whole build — pages still render
    // on-demand for every slug (dynamicParams defaults to true).
    return [];
  }
}

// Cafes get regraded and new ones get discovered outside of a frontend deploy
// (CafeDiscoveryScheduler runs weekly) — an hour keeps pages from going stale for long
// without hitting Supabase on every single request.
export const revalidate = 3600;

interface PageProps {
  params: { slug: string };
}

// There are only two cities, but ~1150 cafe pages — without caching, each page's
// "related cafes" strip would re-run a full paginated Supabase query for its city
// at build time (1150 redundant fetches for 2 actual answers). unstable_cache backs
// this with Next's persistent Data Cache, so every page in a city shares one fetch.
const getCafesByCity = unstable_cache(
  (city: string) => fetchCafes({ city }),
  ["cafes-by-city"],
  { revalidate: 3600 },
);

async function loadCafe(slug: string) {
  const id = cafeIdFromSlug(slug);
  try {
    return await fetchCafe(id);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const cafe = await loadCafe(params.slug);
  if (!cafe) return { title: "Cafe not found | MatchaScope" };

  const level = levelConfig[cafe.level];
  const canonical = `${SITE_URL}${cafeUrl(cafe)}`;
  const title = `${cafe.name} — ${level.shortLabel} Matcha Sourcing | MatchaScope`;
  const description = cafe.evidence
    ? `"${cafe.evidence.quote}" — ${cafe.name} in ${cafe.suburb}, ${cafe.city}. ${level.description}`
    : `${cafe.name} in ${cafe.suburb}, ${cafe.city}. ${level.description} Evidence-based matcha transparency rating from MatchaScope.`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${cafe.name} — ${level.shortLabel}`,
      description,
      url: canonical,
      siteName: "MatchaScope",
      type: "website",
      locale: "en_AU",
    },
    twitter: {
      card: "summary_large_image",
      title: `${cafe.name} — ${level.shortLabel}`,
      description,
    },
  };
}

export default async function CafePage({ params }: PageProps) {
  const cafe = await loadCafe(params.slug);
  if (!cafe) notFound();

  // A slug that resolves to the right id but a stale human-readable half (renamed
  // cafe, corrected suburb) still 200s — but we redirect crawlers/visitors to the
  // canonical spelling so only one URL per cafe ever gets indexed or shared.
  const canonicalSlug = buildCafeSlug(cafe);
  if (canonicalSlug !== params.slug) {
    const { redirect } = await import("next/navigation");
    redirect(`/cafe/${canonicalSlug}`);
  }

  let related: Awaited<ReturnType<typeof fetchCafes>> = [];
  try {
    const cityCafes = await getCafesByCity(cafe.city);
    related = cityCafes
      .filter((c) => c.id !== cafe.id)
      .sort((a, b) => {
        // Same suburb first, then by transparency level (A best)
        const suburbRank = Number(a.suburb === cafe.suburb) - Number(b.suburb === cafe.suburb);
        if (suburbRank !== 0) return -suburbRank;
        return a.level.localeCompare(b.level);
      })
      .slice(0, 4);
  } catch {
    related = [];
  }

  const region = cafe.city === "Sydney" ? "NSW" : cafe.city === "Melbourne" ? "VIC" : undefined;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CafeOrCoffeeShop",
    name: cafe.name,
    url: `${SITE_URL}${cafeUrl(cafe)}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: cafe.address,
      addressLocality: cafe.suburb,
      addressRegion: region,
      addressCountry: "AU",
    },
    geo: { "@type": "GeoCoordinates", latitude: cafe.lat, longitude: cafe.lng },
    priceRange: cafe.priceRange,
    servesCuisine: "Matcha",
    ...(cafe.website || cafe.instagram
      ? {
          sameAs: [
            cafe.website ? `https://${cafe.website}` : null,
            cafe.instagram ? `https://instagram.com/${cafe.instagram.replace("@", "")}` : null,
          ].filter(Boolean),
        }
      : {}),
  };

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <CafeDetailView cafe={cafe} related={related} />
    </>
  );
}
