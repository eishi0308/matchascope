/**
 * Find cafes graded C or D on a page that was never actually read.
 *
 * A site built in the browser answers 200 with a shell. One measured cafe returned 77 KB of
 * HTML whose entire visible text was "Home | Tori's" — 13 characters — while its shop page
 * named four Japanese growing regions. Graded on the shell it reads as a cafe that discloses
 * nothing; in fact nothing was read. Those two findings share a label today, and every cafe
 * on Square, Wix, Squarespace or Shopify is a candidate for the same mistake.
 *
 * This pass isolates them cheaply. It re-fetches each C/D site the way the Java crawler does
 * — one static request, no browser — and keeps only the ones whose text is too short or too
 * off-subject to have been read. Cafes that genuinely said nothing have real page text and
 * are left alone, so no browser time is spent on them.
 *
 * The output is render.mjs's input format, so the two chain directly:
 *
 *   node find-shells.mjs shells.json                 # triage
 *   node render.mjs shells.json shells.jsonl 4       # read them properly
 *   curl -X POST '.../api/cafes/regrade-rendered?dryRun=true' --data-binary @shells.jsonl
 *
 * Run the regrade as a dry run first: promoting these raises the A/B counts, and the
 * disclosure rate quoted across the site is computed from them.
 */
import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const outPath = process.argv[2] || "shells.json";
const CONCURRENCY = Number(process.argv[3]) || 6;
const TIMEOUT_MS = 12_000;

/** Same rule as ScraperService.looksUnread and measure-coverage.mjs. Keep the three in step. */
const SHELL_MAX = 150;
const JS_PLATFORM_MIN = 400;
const CONTENT_SIGNAL = /matcha|tencha|gyokuro|sencha|hojicha|tea|origin|sourc|blend/i;

/** Site builders that assemble the page in the browser — named in the shell's own markup. */
const JS_PLATFORM = /editmysite|squarespace|wix\.com|wixstatic|shopify|stores\.jp|weebly|bigcartel/i;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

/** Strip markup the way the crawler does: script, style and chrome carry no sourcing text. */
function visibleText(html) {
  return html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function inspect(cafe) {
  const url = cafe.website.startsWith("http") ? cafe.website : `https://${cafe.website}`;
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: control.signal, redirect: "follow" });
    if (!res.ok) return { ...cafe, url, verdict: "fetch-failed", status: res.status };
    const html = await res.text();
    const text = visibleText(html);
    const platform = html.match(JS_PLATFORM)?.[0]?.toLowerCase() ?? null;
    const readable = text.length >= SHELL_MAX && CONTENT_SIGNAL.test(text)
      && !(platform && text.length < JS_PLATFORM_MIN);
    return {
      ...cafe, url, platform, chars: text.length,
      // "said-nothing" is a real finding and stays graded as it is. Only shells are queued.
      verdict: readable ? "said-nothing" : "shell",
    };
  } catch (e) {
    return { ...cafe, url, verdict: "fetch-failed", error: String(e.message || e).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

const cafes = [];
for (let offset = 0; ; offset += 500) {
  const url =
    `${SUPABASE_URL}/rest/v1/cafes?select=id,name,level,website` +
    `&level=in.(C,D)&website=not.is.null&order=id.asc&offset=${offset}&limit=500`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  const batch = await res.json();
  if (!Array.isArray(batch) || batch.length === 0) break;
  cafes.push(...batch.filter((c) => c.website && c.website.trim()));
  if (batch.length < 500) break;
}
console.log(`${cafes.length} cafes at C or D with a website`);

const results = [];
let done = 0;
const queue = [...cafes];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const cafe = queue.shift();
      results.push(await inspect(cafe));
      if (++done % 25 === 0) console.log(`  ${done}/${cafes.length}`);
    }
  })
);

const shells = results.filter((r) => r.verdict === "shell");
const saidNothing = results.filter((r) => r.verdict === "said-nothing");
const failed = results.filter((r) => r.verdict === "fetch-failed");

const byPlatform = {};
for (const s of shells) byPlatform[s.platform ?? "unknown"] = (byPlatform[s.platform ?? "unknown"] ?? 0) + 1;

console.log(`\nshells (queued to render): ${shells.length}`);
console.log(`said nothing (left alone) : ${saidNothing.length}`);
console.log(`fetch failed              : ${failed.length}`);
console.log("shells by platform        :", byPlatform);

writeFileSync(outPath, JSON.stringify(shells.map(({ id, url }) => ({ id, url })), null, 2) + "\n");
writeFileSync(outPath.replace(/\.json$/, "") + "-detail.json", JSON.stringify(results, null, 2) + "\n");
console.log(`\nwrote ${outPath} — feed straight to: node render.mjs ${outPath} shells.jsonl 4`);
