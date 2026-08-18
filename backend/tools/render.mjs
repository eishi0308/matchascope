/**
 * Read cafe sites that Jsoup cannot.
 *
 * Most cafe sites now ship an empty HTML shell and build the page in the browser, so a
 * fetch-and-parse crawler sees nothing where a reader sees a sourcing statement. Across a
 * sample of the Level C bucket that accounted for 74% of the failures. This renders each
 * site in a real (headless) browser, waits for the client-side build to settle, and emits
 * the visible text — the same input the Java grader already takes, so nothing about how a
 * cafe is judged changes, only whether its words could be read at all.
 *
 * Usage:  node render.mjs <input.json> <output.jsonl> [concurrency]
 *   input.json   [{ "id": "...", "url": "https://..." }, ...]
 *   output.jsonl { "id", "url", "text", "pages", "error" } per line, flushed as it goes
 *                so an interrupted run keeps everything it had already read.
 */
import { chromium } from "playwright";
import { readFileSync, appendFileSync, existsSync, readFileSync as read } from "node:fs";

const [, , inputPath, outputPath, concurrencyArg] = process.argv;
if (!inputPath || !outputPath) {
  console.error("usage: node render.mjs <input.json> <output.jsonl> [concurrency]");
  process.exit(1);
}

const CONCURRENCY = Number(concurrencyArg) || 4;
const PAGE_TIMEOUT = 20_000;
const SETTLE_MS = 1_200;
const MAX_SUBPAGES = 10;

/**
 * How likely a link is to lead to a sourcing statement.
 *
 * Four pages taken in document order was too few and in the wrong order. Tea Drop states
 * "shade-grown ... in Kagoshima Prefecture" on an individual product page, several links
 * down a shop index — the crawl never reached it, and the cafe stayed at Level C until the
 * page was fetched by hand. Ranking by what the URL promises, rather than where it happens
 * to sit in the navigation, puts the pages that carry origin claims first.
 */
function linkScore(href) {
  const u = href.toLowerCase();
  let score = 0;
  if (/(sourcing|origin|provenance|farm|grower|supplier)/.test(u)) score += 10;
  if (/(matcha|tencha|gyokuro)/.test(u)) score += 8;
  if (/(about|our-story|story|philosophy|who-we-are)/.test(u)) score += 6;
  if (/(product|products|collections|shop)/.test(u)) score += 4;
  if (/(menu|drinks|tea|beverage)/.test(u)) score += 3;
  if (/(blog|news|journal)/.test(u)) score += 1;
  // Deep product pages carry the specifics; index pages carry the names.
  if (/\/products\/[a-z0-9-]{4,}/.test(u)) score += 5;
  return score;
}

const SKIP = /(mailto:|tel:|\.pdf|\.jpg|\.png|\.webp|instagram\.com|facebook\.com|#)/i;

/** Domains that resolve to a registrar's placeholder rather than to a cafe. */
const PARKED = /(godaddy|sedoparking|parkingcrew|bodis|afternic|domain(?:name)?s? for sale)/i;

/**
 * Instagram truncates a long bio behind an inline "…more" toggle, and the truncation can
 * land mid-word ("Uji matc… more") — which is exactly the kind of text a sourcing claim
 * lives in. A plain click on the toggle silently no-ops: an unauthenticated session shows
 * a login overlay that intercepts the pointer event without Playwright's actionability
 * check ever seeing it as blocked. Escape dismisses that overlay first; the "more" span is
 * matched on exact text so this never fires on "Show more posts…", a different element
 * later in the same page.
 */
async function expandInstagramBio(page) {
  if (!/instagram\.com/.test(page.url())) return;
  try {
    // The login overlay mounts client-side, after "load" already fired — pressing Escape
    // immediately dismisses nothing, the overlay appears a moment later, and it silently
    // eats the click. A short settle wait first is what fixes that race.
    await page.waitForTimeout(1000);
    await page.keyboard.press("Escape");
    await page.locator("span").filter({ hasText: /^more$/ }).first().click({ timeout: 2000 });
    await page.waitForTimeout(400);
  } catch {
    // No toggle to expand (short bio, or the DOM shifted) — read whatever is already there.
  }
}

/**
 * Text as a reader sees it.
 *
 * <p>The wait matters more than the extraction. "domcontentloaded" fires before the
 * client-side build runs — and on a site that redirects, evaluating there throws because
 * the execution context is torn down mid-call. "networkidle" never arrives on sites that
 * poll or stream analytics. So: wait for load, then wait for text to actually appear,
 * and settle for whatever is there if it never does.
 */
async function visibleText(page) {
  try {
    await page.waitForFunction(
      () => (document.body?.innerText || "").trim().length > 200,
      { timeout: SETTLE_MS * 4 }
    );
  } catch {
    // A genuinely short page is not an error; take what rendered.
  }
  return page.evaluate(() => {
    for (const el of document.querySelectorAll("script,style,noscript,svg")) el.remove();
    return (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  });
}

async function readSite(browser, { id, url }) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  // Images and fonts cost seconds per page and carry no text.
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    return type === "image" || type === "font" || type === "media"
      ? route.abort()
      : route.continue();
  });

  const collected = [];
  const visited = new Set();
  try {
    const page = await context.newPage();
    const start = url.startsWith("http") ? url : `https://${url}`;
    await page.goto(start, { timeout: PAGE_TIMEOUT, waitUntil: "load" });
    await expandInstagramBio(page);
    const home = await visibleText(page);
    visited.add(page.url());

    // A registrar placeholder is not a cafe with nothing to say; it is no site at all.
    if (PARKED.test(home) || /\/lander(\?|$)/.test(page.url())) {
      return { id, url, text: "", pages: 0, error: "parked domain" };
    }
    collected.push(home);

    const origin = new URL(page.url()).origin;
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)
    );
    const candidates = [...new Set(links)]
      .filter((href) => href.startsWith(origin) && !SKIP.test(href))
      .map((href) => ({ href, score: linkScore(href) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUBPAGES)
      .map((c) => c.href);

    for (const href of candidates) {
      if (visited.has(href)) continue;
      visited.add(href);
      try {
        await page.goto(href, { timeout: PAGE_TIMEOUT, waitUntil: "load" });
        collected.push(await visibleText(page));
      } catch {
        // One unreachable subpage must not cost us the pages that did load.
      }
    }
    return { id, url, text: collected.join(" ").replace(/\s+/g, " ").trim(), pages: visited.size };
  } catch (e) {
    return { id, url, text: "", pages: 0, error: String(e.message || e).slice(0, 160) };
  } finally {
    await context.close();
  }
}

const all = JSON.parse(readFileSync(inputPath, "utf8"));

// Resume: anything already written is not read again.
const done = new Set();
if (existsSync(outputPath)) {
  for (const line of read(outputPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      done.add(JSON.parse(line).id);
    } catch {}
  }
}
const queue = all.filter((c) => !done.has(c.id));
console.error(`${all.length} sites, ${done.size} already read, ${queue.length} to go`);

const browser = await chromium.launch();
let index = 0;
let ok = 0;

async function worker() {
  while (index < queue.length) {
    const mine = queue[index++];
    const at = index;
    const result = await readSite(browser, mine);
    appendFileSync(outputPath, JSON.stringify(result) + "\n");
    if (result.text.length > 200) ok++;
    if (at % 25 === 0 || at === queue.length) {
      console.error(`  ${at}/${queue.length} — ${ok} with readable text`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await browser.close();
console.error(`done: ${ok} of ${queue.length} yielded readable text`);
