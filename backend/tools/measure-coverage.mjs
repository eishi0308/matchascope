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
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

/** Every file a crawl writes its per-cafe outcome to. */
const JOURNALS = [
  "deep-rendered.jsonl",
  "ig-rendered.jsonl",
  "rendered-final.jsonl",
  "nolink-found2.jsonl",
  "retry-blocked.jsonl",
  "ubereats.jsonl",
  // The shell sweep: cafes whose sites answered 200 with an empty frame, re-read in a
  // browser. Last, so where an older run recorded a cafe as simply unfetchable this run's
  // verdict — a shell that a browser could or could not recover — supersedes it.
  "shells-rendered.jsonl",
];

/**
 * What counts as having read a page.
 *
 * A bare character count cannot tell a page from its frame. A Square Online store measured
 * here answered 200 with 77 KB of HTML whose entire visible text was "Home | Tori's", and a
 * rendered shell reaches a few hundred characters of navigation before its content paints —
 * both would clear a 200-character bar while disclosing nothing readable. So the text must
 * also mention the subject: same rule as ScraperService.looksUnread, kept in step with it.
 */
const SHELL_MAX = 150;   // below this the page is its own title
const JS_PLATFORM_MIN = 400; // higher bar once a site builder is fingerprinted
const CONTENT_SIGNAL = /matcha|tencha|gyokuro|sencha|hojicha|tea|origin|sourc|blend/i;

const wasRead = (text) => (text || "").trim().length >= SHELL_MAX && CONTENT_SIGNAL.test(text || "");

function load(path) {
  const out = new Map();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.id) out.set(row.id, row);
    } catch {
      // A half-written last line from an interrupted crawl is not a reason to stop.
    }
  }
  return out;
}

const journals = JOURNALS.map(load);

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
  // Later journals supersede earlier ones: a retry that got through proves the cafe was
  // never absent, only throttled at the time, and a run that reads a page settles it
  // outright. Treating a stale "blocked" as final would keep reporting cafes as unreachable
  // after they had been reached.
  let state = "couldNotFetch";
  for (const journal of journals) {
    const row = journal.get(cafe.id);
    if (!row) continue;
    if (wasRead(row.text)) {
      state = "read";
      break;
    }
    // A fetch that returned text but not readable text is a shell, not a silent cafe.
    state = row.blocked ? "blockedByLogin"
          : (row.text || "").trim().length > 0 ? "unreadShell"
          : "couldNotFetch";
  }
  if (state === "read") read++;
  else if (state === "blockedByLogin") blockedByLogin++;
  else if (state === "unreadShell") unreadShell++;
  else couldNotFetch++;
}

const coverage = {
  measuredOn: new Date().toISOString().slice(0, 10),
  total: cafes.length,
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
