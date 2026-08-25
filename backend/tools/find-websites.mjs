/**
 * Find a website for the cafes that have none.
 *
 * 430 of 1,147 cafes carry no website, no social profile and no evidence source. They are
 * not cafes whose link broke — nobody ever recorded one, so the crawler has never had an
 * address to try. Every one of them has a street address, which is enough for a Places
 * text search to identify the business and hand back the site it publishes.
 *
 * Cost. places.websiteUri sits in the Enterprise tier, so every call here bills at
 * "Places API Text Search Enterprise": 1,000 events free per month, then $35.00/1000.
 * The field mask is the two fields actually needed and nothing else — Google prices a
 * request at the highest tier any field in the mask belongs to, and a stray reviews or
 * rating field would push the whole call up a bracket for no benefit.
 *
 * The ceiling below is a hard stop in this script. It is not connected to ApiBudgetGuard,
 * which meters the Places *Photo* SKU and would not see these requests at all.
 *
 *   node find-websites.mjs --limit 20              # probe, measures the hit rate
 *   node find-websites.mjs --limit 430             # the rest
 */
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const KEY = (readFileSync("../src/main/resources/application.properties", "utf8")
  .split("\n").find((l) => l.startsWith("google.places.api.key=")) || "").split("=")[1]?.trim();
if (!KEY) { console.error("no google.places.api.key in application.properties"); process.exit(1); }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("supabase env missing"); process.exit(1); }

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 20;
if (!Number.isFinite(LIMIT) || LIMIT < 1 || LIMIT > 1000) {
  console.error("--limit must be 1..1000; 1000 is the monthly free allowance for this SKU");
  process.exit(1);
}
const OUT = "found-websites.jsonl";

// Only what is needed. id to prove which business answered, websiteUri because that is
// the whole point of the lookup.
const FIELD_MASK = "places.id,places.websiteUri,places.displayName";

const done = new Set();
if (existsSync(OUT)) {
  for (const l of readFileSync(OUT, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { done.add(JSON.parse(l).id); } catch {}
  }
}

// The cafes with nothing to crawl, straight from the database rather than a cached list.
const targets = [];
for (let offset = 0; ; offset += 500) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cafes?select=id,name,address,lat,lng,level` +
    `&or=(website.is.null,website.eq.)&order=id.asc&offset=${offset}&limit=500`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  const batch = await res.json();
  if (!Array.isArray(batch) || !batch.length) break;
  targets.push(...batch);
  if (batch.length < 500) break;
}

const queue = targets.filter((t) => !done.has(t.id)).slice(0, LIMIT);
console.log(`${targets.length} cafes have no website; ${done.size} already looked up; querying ${queue.length} now`);
console.log(`ceiling for this run: ${LIMIT} requests (Enterprise SKU, 1,000 free per month)\n`);

let spent = 0, withSite = 0, noResult = 0, noSite = 0, failed = 0;
for (const c of queue) {
  if (spent >= LIMIT) break;
  const body = {
    textQuery: `${c.name}, ${c.address}`,
    maxResultCount: 1,
    ...(Number.isFinite(c.lat) && Number.isFinite(c.lng)
      ? { locationBias: { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: 200 } } }
      : {}),
  };
  let row;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify(body),
    });
    spent++;
    if (!res.ok) {
      const t = await res.text();
      row = { id: c.id, name: c.name, ok: false, status: res.status, error: t.slice(0, 200) };
      failed++;
      if (res.status === 429 || res.status === 403) { console.error(`\nstopping: HTTP ${res.status} — ${t.slice(0, 160)}`); appendFileSync(OUT, JSON.stringify(row) + "\n"); break; }
    } else {
      const j = await res.json();
      const place = j.places?.[0];
      if (!place)                 { row = { id: c.id, name: c.name, ok: true, website: null, why: "no place matched" }; noResult++; }
      else if (!place.websiteUri) { row = { id: c.id, name: c.name, ok: true, website: null, placeId: place.id, matched: place.displayName?.text, why: "place has no website" }; noSite++; }
      else                        { row = { id: c.id, name: c.name, ok: true, website: place.websiteUri, placeId: place.id, matched: place.displayName?.text }; withSite++; }
    }
  } catch (e) {
    spent++; failed++;
    row = { id: c.id, name: c.name, ok: false, error: String(e).slice(0, 160) };
  }
  appendFileSync(OUT, JSON.stringify(row) + "\n");
  process.stdout.write(`\r  ${spent}/${queue.length} — ${withSite} with a site`);
  await new Promise((r) => setTimeout(r, 120));
}

console.log(`\n\nrequests spent : ${spent}`);
console.log(`  website found        : ${withSite}   (${spent ? (withSite / spent * 100).toFixed(0) : 0}% hit rate)`);
console.log(`  place found, no site : ${noSite}`);
console.log(`  no place matched     : ${noResult}`);
console.log(`  request failed       : ${failed}`);
console.log(`\nestimated cost if outside the free allowance: $${(spent * 0.035).toFixed(2)}`);
