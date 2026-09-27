/**
 * Record how much of the dataset a crawl actually managed to read.
 *
 * The disclosure rate has to be divided by something, and the obvious candidate — cafes
 * that list a website or a profile — is wrong. Listing a link and that link yielding a
 * page are different things: a quarter of the set sits behind an Instagram login and a
 * further share no longer resolves at all. Dividing by links understates the finding.
 *
 * The database has no per-cafe record of whether its page was readable, and inferring one
 * from the presence of a link is exactly the mistake being avoided, so the figure is
 * measured here from the crawl journals and written where the frontend can import it.
 *
 * Re-run after any crawl that reads new pages:
 *   node measure-coverage.mjs
 */
import { writeFileSync } from "node:fs";
import { loadJournals, readState } from "./crawl-read.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const journals = loadJournals();

const cafes = [];
for (let offset = 0; ; offset += 500) {
  const url =
    `${SUPABASE_URL}/rest/v1/cafes?select=id,level&order=id.asc&offset=${offset}&limit=500`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const batch = await res.json();
  if (!Array.isArray(batch) || batch.length === 0) break;
  cafes.push(...batch);
  if (batch.length < 500) break;
}

let read = 0;
let blockedByLogin = 0;
let couldNotFetch = 0;
let unreadShell = 0;

for (const cafe of cafes) {
  // A cafe graded A or B is quoting words off a page, so it was read by definition.
  if (cafe.level === "A" || cafe.level === "B") {
    read++;
    continue;
  }
  const state = readState(journals, cafe.id);
  if (state === "read") read++;
  else if (state === "blockedByLogin") blockedByLogin++;
  else if (state === "unreadShell") unreadShell++;
  else couldNotFetch++;
}

// Level counts travel with the coverage figures.
//
// The landing page falls back to hard-coded numbers until the live stats arrive, and
// because that fallback renders server-side it is what a crawler or a reader without
// JavaScript sees. Those numbers were 96 / 18 / 414 while the database held 98 / 19 / 424,
// so the first paint quoted a finding four grades out of date. Writing them here means one
// run of this tool keeps the fallback and the measurement in step, instead of the fallback
// drifting quietly every time a cafe is regraded.
const byLevel = { A: 0, B: 0, C: 0, D: 0 };
for (const cafe of cafes) if (cafe.level in byLevel) byLevel[cafe.level]++;

const coverage = {
  measuredOn: new Date().toISOString().slice(0, 10),
  total: cafes.length,
  byLevel,
  read,
  blockedByLogin,
  couldNotFetch,
  // Fetched successfully, rendered nothing readable. Held apart from both "read" and
  // "couldNotFetch": these are the cafes a browser pass can still recover.
  unreadShell,
};

writeFileSync(
  new URL("../../frontend/src/lib/crawl-coverage.json", import.meta.url),
  JSON.stringify(coverage, null, 2) + "\n"
);
console.log(coverage);
