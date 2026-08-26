/**
 * Find the Instagram profile of a cafe that Google Places has no link for.
 *
 * Google Places returns a websiteUri when the business gave Google one, and returns
 * nothing about Instagram ever. 430 of the cafes in this dataset therefore carry no link
 * at all and were recorded as "nowhere to look" — but OFFSET in Surry Hills, one of them,
 * runs an Instagram whose bio reads "Premium Matcha from Uji". The absence was Google's,
 * not the cafe's.
 *
 * So: search for the profile, then prove it belongs to this cafe before believing it.
 * Attribution is the whole risk here — publishing one cafe's sourcing claim under another
 * cafe's name is worse than leaving it unrated — so a candidate is only accepted when a
 * distinctive word from the business name appears in the profile itself, and a second
 * signal (the suburb, or that word again in the handle) agrees.
 *
 * Usage: node find-instagram.mjs <input.json> <output.jsonl> [concurrency]
 *   input.json  [{ "id", "name", "suburb", "city" }, ...]
 */
import { chromium } from "playwright";
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const [, , inputPath, outputPath, concurrencyArg] = process.argv;
const CONCURRENCY = Number(concurrencyArg) || 2;
const NAV_TIMEOUT = 25_000;

/** Instagram's own routes, and the aggregator accounts that rank for any cafe search. */
const NOT_A_PROFILE = new Set([
  "p", "reel", "reels", "explore", "explore", "stories", "tv", "s", "accounts", "about",
  "developer", "legal", "directory", "popular", "topics", "locations", "web", "api",
  "instagram", "meta", "threads",
]);

/** Words too common to identify a business by. */
const GENERIC = new Set([
  "cafe", "café", "coffee", "the", "restaurant", "bar", "tea", "matcha", "house", "co",
  "and", "shop", "kitchen", "eatery", "bakery", "dessert", "sydney", "melbourne", "au",
  "australia", "roasters", "roastery", "espresso", "brew", "sweets", "store", "food",
]);

const fold = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The words that actually distinguish this business from any other, deduplicated.
 *
 * <p>Three characters, not four: the brand is often the short part ("ASV bakehouse"),
 * and dropping it leaves only the generic half to match on — which is how @melbourne.
 * bakehouse came back as a match for a cafe in Northcote.
 */
function distinctiveTokens(name) {
  const words = fold(name).split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w));
  return [...new Set(words)];
}

/**
 * Brave throttles a client that searches without pausing, and a throttled response is an
 * empty one — indistinguishable from a cafe that genuinely has no profile. Retrying once
 * after a longer wait separates the two, so a rate limit does not get recorded as an
 * absence.
 */
async function searchHandles(page, cafe, attempt = 1) {
  const q = encodeURIComponent(`${cafe.name} ${cafe.suburb || ""} ${cafe.city} instagram`);
  await page.goto(`https://search.brave.com/search?q=${q}`, {
    timeout: NAV_TIMEOUT,
    waitUntil: "load",
  });
  await page.waitForTimeout(1200);

  const blocked = await page.evaluate(() =>
    /captcha|unusual traffic|verify you are|not a robot/i.test(document.body?.innerText || "")
  );
  if ((blocked || (await page.evaluate(() => document.querySelectorAll("a").length)) < 5)
      && attempt < 3) {
    await page.waitForTimeout(4000 * attempt);
    return searchHandles(page, cafe, attempt + 1);
  }

  const handles = await page.evaluate(() => {
    const found = [];
    for (const a of document.querySelectorAll("a[href]")) {
      const m = (a.href || "").match(/instagram\.com\/([A-Za-z0-9_.]+)/);
      if (m) found.push(m[1]);
    }
    return found;
  });
  const seen = new Set();
  return handles
    .map((h) => h.replace(/\.$/, ""))
    .filter((h) => h && !NOT_A_PROFILE.has(h.toLowerCase()) && h.length > 2)
    .filter((h) => (seen.has(h.toLowerCase()) ? false : seen.add(h.toLowerCase())))
    .slice(0, 4);
}

async function readProfile(page, handle) {
  await page.goto(`https://www.instagram.com/${handle}/`, {
    timeout: NAV_TIMEOUT,
    waitUntil: "load",
  });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    for (const el of document.querySelectorAll("script,style,noscript,svg")) el.remove();
    return (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  });
}

/**
 * Does this profile belong to this cafe?
 *
 * <p>Name agreement alone is not enough, and the failures are not subtle. Searching for
 * "Boom Boom Tea, Glen Waverley" returns @boomboomalbury — a wine bar 600km away in
 * regional NSW that shares one word. "ASV bakehouse, Northcote" returns
 * @melbourne.bakehouse, matched on the word "bakehouse" alone because the brand itself is
 * three letters. Both would have published a stranger's sourcing claim under this cafe's
 * name, which is worse than leaving the cafe unrated.
 *
 * <p>So the profile must place itself in this cafe's suburb. Cafes overwhelmingly put
 * their address in their bio, and a suburb is specific in a way a business name is not.
 * This rejects real profiles that omit their location, and that is the intended trade:
 * a cafe we failed to find stays honestly unrated, a cafe we misattribute becomes a
 * false published claim.
 */
function attribution(cafe, handle, profileText) {
  const tokens = distinctiveTokens(cafe.name);
  if (tokens.length === 0) return { ok: false, why: "no distinctive words in the name" };

  const bio = fold(profileText);
  const h = fold(handle.replace(/[._]/g, " "));
  const suburb = fold(cafe.suburb);

  const inBio = tokens.filter((t) => bio.includes(t));
  const inHandle = tokens.filter((t) => h.includes(t));
  if (inBio.length === 0 && inHandle.length === 0) {
    return { ok: false, why: "business name absent from profile and handle" };
  }

  // Strongest signal: the profile says where it is, and it is here.
  if (suburb.length >= 3 && bio.includes(suburb)) {
    return { ok: true, why: `suburb + name${inHandle.length ? " + handle" : ""}` };
  }

  // Failing that, a handle that spells out the whole business name is its own evidence:
  // @forknpath carries both halves of "Fork & Path". One word is not enough — "Boom Boom
  // Tea" reduces to a single token, and @boomboomalbury satisfies it while being a wine
  // bar in another state.
  if (tokens.length >= 2 && inHandle.length === tokens.length) {
    return { ok: true, why: "whole name spelled out in the handle" };
  }

  return {
    ok: false,
    why: suburb.length < 3
      ? "no suburb on record, and the handle does not carry the full name"
      : `profile does not place itself in ${cafe.suburb}, and the handle is only a partial match`,
  };
}

const all = JSON.parse(readFileSync(inputPath, "utf8"));
const done = new Set();
if (existsSync(outputPath)) {
  for (const line of readFileSync(outputPath, "utf8").split("\n")) {
    if (line.trim()) try { done.add(JSON.parse(line).id); } catch {}
  }
}
const queue = all.filter((c) => !done.has(c.id));
console.error(`${all.length} cafes, ${done.size} already searched, ${queue.length} to go`);

const browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled"] });
let index = 0;
let found = 0;

async function worker() {
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      + "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    locale: "en-AU",
    viewport: { width: 1280, height: 900 },
  });
  await ctx.addInitScript(() =>
    Object.defineProperty(navigator, "webdriver", { get: () => undefined })
  );
  await ctx.route("**/*", (r) => {
    const t = r.request().resourceType();
    return t === "image" || t === "font" || t === "media" ? r.abort() : r.continue();
  });
  const page = await ctx.newPage();

  while (index < queue.length) {
    const cafe = queue[index++];
    const at = index;
    const row = { id: cafe.id, name: cafe.name, suburb: cafe.suburb, handle: null, text: "" };
    try {
      const candidates = await searchHandles(page, cafe);
      row.candidates = candidates;
      for (const handle of candidates) {
        let text = "";
        try {
          text = await readProfile(page, handle);
        } catch {
          continue;
        }
        const verdict = attribution(cafe, handle, text);
        if (verdict.ok) {
          row.handle = handle;
          row.text = text;
          row.matchedOn = verdict.why;
          break;
        }
        row.lastReject = `${handle}: ${verdict.why}`;
      }
    } catch (e) {
      row.error = String(e.message || e).slice(0, 120);
    }
    if (row.handle) found++;
    appendFileSync(outputPath, JSON.stringify(row) + "\n");
    if (at % 20 === 0 || at === queue.length) {
      console.error(`  ${at}/${queue.length} — ${found} profiles attributed`);
    }
    await page.waitForTimeout(2500); // Brave rate-limits an impatient client.
  }
  await ctx.close();
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await browser.close();
console.error(`done: ${found} of ${queue.length} cafes matched to a profile`);
