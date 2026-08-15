import { supabase } from "./supabase";
import { Cafe } from "@/data/cafes";
import coverage from "./crawl-coverage.json";

function rowToCafe(row: Record<string, unknown>): Cafe {
  const evidence =
    row.evidence_quote
      ? {
          quote: row.evidence_quote as string,
          source: row.evidence_source as string,
          sourceLabel: row.evidence_source_label as string,
          verifiedDate: row.evidence_verified_date as string,
        }
      : null;

  return {
    id: row.id as string,
    name: row.name as string,
    city: row.city as Cafe["city"],
    suburb: row.suburb as string,
    address: row.address as string,
    lat: row.lat as number,
    lng: row.lng as number,
    level: row.level as Cafe["level"],
    type: row.type as Cafe["type"],
    tagline: row.tagline as string,
    description: row.description as string,
    evidence,
    instagram: row.instagram as string | undefined,
    website: row.website as string | undefined,
    priceRange: row.price_range as Cafe["priceRange"],
    specialties: Array.isArray(row.specialties)
      ? row.specialties as string[]
      : typeof row.specialties === "string" && (row.specialties as string).length > 0
        ? (row.specialties as string).split(",").map((s) => s.trim())
        : [],
  };
}

export async function fetchCafes(params?: {
  city?: string;
  level?: string;
}): Promise<Cafe[]> {
  const PAGE = 1000;
  const allRows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from("cafes")
      .select("*")
      .order("name")
      .range(from, from + PAGE - 1);

    if (params?.city && params.city !== "All") query = query.eq("city", params.city);
    if (params?.level && params.level !== "All") query = query.eq("level", params.level);

    const { data, error } = await query;
    if (error) {
      console.error("[Supabase fetchCafes error]", error);
      throw new Error(error.message);
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log("[Supabase] fetchCafes returned", allRows.length, "rows");
  return allRows.map(rowToCafe);
}

export async function fetchCafe(id: string): Promise<Cafe> {
  const { data, error } = await supabase
    .from("cafes")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return rowToCafe(data);
}

export async function fetchStats(): Promise<{
  total: number;
  byLevel: Record<string, number>;
  assessable: number;
  unassessable: number;
  sydney: number;
  melbourne: number;
  discovering: boolean;
}> {
  const PAGE = 1000;
  const allRows: { level: string; city: string; website: string | null }[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("cafes")
      .select("level, city, website")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const byLevel: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  let sydney = 0;
  let melbourne = 0;

  for (const row of allRows) {
    byLevel[row.level] = (byLevel[row.level] ?? 0) + 1;
    if (row.city === "Sydney") sydney++;
    if (row.city === "Melbourne") melbourne++;
  }

  // Holding a link is not the same as having been read, and the gap is large: of the
  // cafes listing a website or a profile, a quarter sat behind a login and a further
  // share no longer resolve at all. Counting those as checked inflates the base the
  // disclosure rate is quoted over, so the measured figure is used instead.
  const assessable = Math.min(coverage.read, allRows.length);

  return {
    total: allRows.length,
    byLevel,
    assessable,
    unassessable: allRows.length - assessable,
    sydney,
    melbourne,
    discovering: false,
  };
}

/**
 * Whether this cafe lists anywhere to look at all.
 *
 * <p>Kept for filtering, not for counting. The disclosure rate is quoted over
 * crawl-coverage.json — what was actually read — because listing a link and having that
 * link yield a page turned out to be very different things.
 *
 * <p>A cafe with no website has not declined to disclose its origin — nobody has been
 * able to ask. Counting those as "discloses nothing" overstates the finding, since the
 * same bucket would hold cafes we checked and cafes we could not reach.
 *
 * <p>Instagram and Facebook both used to sit on this list, on the measured grounds that
 * every profile the crawler tried returned a login wall. That was true of the crawler and
 * not of the platforms: opened in a real browser, 135 of 154 Instagram bios read, and all
 * 44 Facebook pages did. Cafes were promoted to Level A on what they said there. A page we
 * can open is a place we can look, so it counts.
 *
 * <p>What remains is what carries no sourcing claim by construction: a delivery listing is
 * a menu with prices, and no cafe has ever stated a tea's origin on one.
 */
const UNCHECKABLE_HOSTS = ["ubereats.com", "doordash.com", "menulog.com.au"];

export function hasCheckableSource(website: string | null | undefined): boolean {
  if (!website || !website.trim()) return false;
  const host = website.toLowerCase();
  return !UNCHECKABLE_HOSTS.some((h) => host.includes(h));
}
