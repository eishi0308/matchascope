/**
 * Classify every cafe the crawl has not managed to read, into the reason it failed.
 *
 * "Unreadable" has been one bucket, and that has hidden the fact that the reasons are
 * not equally fixable. A cafe whose own site is a live restaurant page that simply never
 * mentions tea has told us something; a cafe whose domain no longer resolves has not.
 * Grading both as "could not assess" understates the finding and overstates the excuse.
 *
 * Reads the same journals as measure-coverage.mjs, in the same precedence order, so the
 * two tools can never disagree about who was read.
 *
 *   node triage-unread.mjs            # report only
 *   node triage-unread.mjs --write    # also emit triage-unread.jsonl
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

// Same list and order as measure-coverage.mjs. Later files supersede earlier ones.
const JOURNALS = [
  "deep-rendered.jsonl",
  "ig-rendered.jsonl",
  "rendered-final.jsonl",
  "nolink-found2.jsonl",
  "retry-blocked.jsonl",
  "ubereats.jsonl",
  "shells-rendered.jsonl",
  "step2-rendered.jsonl",
];

const SHELL_MAX = 150;
const CONTENT_SIGNAL = /matcha|tencha|gyokuro|sencha|hojicha|tea|origin|sourc|blend/i;
const wasRead = (t) => (t || "").trim().length >= SHELL_MAX && CONTENT_SIGNAL.test(t || "");

/**
 * A page that exists but is not open yet. These are the ones inside "no tea mentioned"
 * that must NOT be read as a cafe declining to say anything, because there is nothing
 * on the page to decline with.
 */
const PLACEHOLDER = new RegExp([
  "coming soon", "under construction", "site is under", "launching soon", "opening soon",
  "website is being", "check back soon", "we're building", "we are building",
  "domain (?:is )?for sale", "buy this domain", "parked (?:free )?(?:by|at)", "godaddy",
  "default web page", "apache2? (?:ubuntu|debian) default", "welcome to nginx",
  "index of /", "future home of", "this domain", "account suspended",
  "bandwidth limit exceeded", "temporarily unavailable", "maintenance mode",
  "squarespace.*coming soon", "wix.*coming soon", "start building your website",
].join("|"), "i");

/** Evidence that the page really is a live business page, tea or not. */
const REAL_PAGE = new RegExp([
  "menu", "opening hours", "open(?:s)? (?:daily|mon|tue|wed|thu|fri|sat|sun)",
  "book (?:a )?(?:table|now)", "order (?:online|now)", "contact us", "about us",
  "breakfast", "lunch", "dinner", "coffee", "espresso", "cake", "pastry", "brunch",
  "delivery", "takeaway", "gift card", "our story", "follow us",
].join("|"), "i");

function load(path) {
  const out = new Map();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const row = JSON.parse(line); if (row.id) out.set(row.id, row); } catch { /* partial last line */ }
  }
  return out;
}
const journals = JOURNALS.map(load);

const cafes = [];
for (let offset = 0; ; offset += 500) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cafes?select=id,name,level,city,suburb,website&order=id.asc&offset=${offset}&limit=500`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  const batch = await res.json();
  if (!Array.isArray(batch) || batch.length === 0) break;
  cafes.push(...batch);
  if (batch.length < 500) break;
}

const rows = [];
for (const cafe of cafes) {
  if (cafe.level === "A" || cafe.level === "B") { rows.push({ ...cafe, bucket: "read", why: "graded from quoted text" }); continue; }

  // Any journal that once returned readable text settles it. A later retry that timed
  // out does not un-read a page whose text we still hold — mel-disc-1079 was read on an
  // early pass and errored on a retry, and taking the last word marked it unread.
  // For the failure reason, though, the most recent attempt is the relevant one.
  let last = null, sawAny = false, everRead = false;
  for (const j of journals) {
    const r = j.get(cafe.id);
    if (!r) continue;
    sawAny = true; last = r;
    if (wasRead(r.text)) everRead = true;
  }

  if (everRead) { rows.push({ ...cafe, bucket: "read", why: "page text mentions the subject" }); continue; }

  if (!sawAny) { rows.push({ ...cafe, bucket: "never-attempted", why: "no journal has ever recorded this cafe" }); continue; }

  const text = (last.text || "").trim();
  if (last.blocked)      { rows.push({ ...cafe, bucket: "login-wall", why: "instagram/facebook wall", chars: text.length }); continue; }
  if (last.error)        { rows.push({ ...cafe, bucket: "fetch-error", why: String(last.error).split("\n")[0].slice(0, 90), chars: text.length }); continue; }
  if (text.length === 0) { rows.push({ ...cafe, bucket: "no-page", why: "fetched nothing at all", chars: 0 }); continue; }
  if (text.length < SHELL_MAX) { rows.push({ ...cafe, bucket: "shell", why: `only ${text.length} chars rendered`, chars: text.length }); continue; }

  // Substantial text, no tea word anywhere. Split the ones that are a real page from
  // the ones that are a placeholder, because only the first kind is a finding.
  const placeholder = PLACEHOLDER.test(text);
  const real = REAL_PAGE.test(text);
  rows.push({
    ...cafe,
    bucket: placeholder ? "placeholder" : real ? "no-topic-real" : "no-topic-thin",
    why: placeholder ? (text.match(PLACEHOLDER)?.[0] || "placeholder") : real ? (text.match(REAL_PAGE)?.[0] || "real page") : "no business signal either",
    chars: text.length,
  });
}

const tally = {};
for (const r of rows) tally[r.bucket] = (tally[r.bucket] || 0) + 1;
const order = ["read", "no-topic-real", "no-topic-thin", "placeholder", "shell", "login-wall", "fetch-error", "no-page", "never-attempted"];
console.log(`total cafes: ${rows.length}\n`);
for (const k of order) if (tally[k]) console.log(`  ${k.padEnd(16)} ${String(tally[k]).padStart(5)}`);
const unread = rows.length - (tally.read || 0);
console.log(`\n  ${"read".padEnd(16)} ${String(tally.read || 0).padStart(5)}`);
console.log(`  ${"unread".padEnd(16)} ${String(unread).padStart(5)}`);

if (process.argv.includes("--write")) {
  writeFileSync("triage-unread.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log("\nwrote triage-unread.jsonl");
}
