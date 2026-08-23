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
 * How long to keep waiting for a client-side build, and what "finished" means.
 *
 * Waiting for a byte count cannot tell a shell's navigation from its content. Measured on
 * a Square Online store: body text crossed 200 characters at 3.3s carrying only the nav,
 * and the product list — the only place the origins are stated — did not paint until 4.3s.
 * A 200-character threshold returns the chrome and calls the cafe silent. So instead of a
 * threshold, wait for the text to stop growing: sample it, and accept it once it has held
 * steady, which is the only signal that the build has actually finished.
 */
const QUIESCE_SAMPLE_MS = 400;
const QUIESCE_STABLE_SAMPLES = 3;
const QUIESCE_MAX_MS = 15_000;

/** Words that mean the page we came for actually rendered, not just its frame. */
const CONTENT_SIGNAL = /matcha|tencha|gyokuro|sencha|hojicha|tea|origin|sourc|blend/i;

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
  // Ordering paths. Square, Wix and Squarespace put the whole catalogue — and with it
  // every origin the cafe states — behind /s/order, /store or /catalog, none of which
  // contain a word this function used to score.
  if (/(\/s\/|order|store|catalog|catalogue|item)/.test(u)) score += 4;
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
 * poll or stream analytics. So: wait for load, then wait for the text to stop changing.
 *
 * <p>Text is read from every frame, not just the main document: a store embedded in an
 * iframe is invisible to document.body.innerText. And the page is scrolled first, because
 * a virtualised product grid only builds the rows it has been asked to show.
 */
async function readAllFrames(page) {
  const parts = [];
  for (const frame of page.frames()) {
    try {
      parts.push(await frame.evaluate(() => (document.body?.innerText || "")));
    } catch {
      // A frame that navigated mid-read is not worth failing the page for.
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function settle(page) {
  const deadline = Date.now() + QUIESCE_MAX_MS;
  let last = -1, stable = 0;
  while (Date.now() < deadline) {
    let now;
    try {
      now = (await readAllFrames(page)).length;
    } catch {
      break;
    }
    stable = now === last ? stable + 1 : 0;
    last = now;
    // Hold only once the text has stopped growing AND says something on our subject —
    // a shell's nav is stable from the first sample and would otherwise end the wait.
    if (stable >= QUIESCE_STABLE_SAMPLES && now > 0) {
      const text = await readAllFrames(page);
      if (CONTENT_SIGNAL.test(text) || stable >= QUIESCE_STABLE_SAMPLES * 3) break;
    }
    await page.waitForTimeout(QUIESCE_SAMPLE_MS);
  }
}

async function visibleText(page) {
  await settle(page);
  // Lazy grids build on scroll; do it after the first settle so the page has a layout.
  try {
    await page.evaluate(async () => {
      for (let y = 0; y < 6; y++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(QUIESCE_SAMPLE_MS);
  } catch {
    // Scrolling is an optimisation; never fail the read over it.
  }
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("script,style,noscript,svg")) el.remove();
  }).catch(() => {});
  return readAllFrames(page);
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
      // Zero-score links are kept as fill rather than dropped. Scoring is there to order
      // a large site's links, not to refuse a small one: a four-link site has budget to
      // spare, and dropping its unscored links is how a catalogue at /s/order stayed
      // unread. Ranking still puts the promising paths first.
      .map((href) => ({ href, score: linkScore(href) }))
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
