/**
 * Find a cafe's Instagram by guessing its handle, then proving the profile is really it.
 *
 * Google Places returns a website only when the business gave Google one, and never
 * returns Instagram at all. 430 cafes here carry no link of either kind and were recorded
 * as "nowhere to look" — yet OFFSET in Surry Hills, one of them, runs a profile whose bio
 * reads "Premium Matcha from Uji". The gap was Google's, not the cafes'.
 *
 * Searching for the profiles worked and did not scale: Brave answers a few dozen queries
 * and then asks the client to prove it is human, and a blocked search looks exactly like a
 * cafe with no profile. Guessing touches only Instagram, which served 154 profiles without
 * complaint.
 *
 * The guess is never the evidence. A handle built out of the cafe's own name matches that
 * name by construction, so attribution rests entirely on the bio: the profile must name
 * the business AND place itself in the right suburb. That is what stops @offset — whoever
 * that is — being published as a Surry Hills cafe's sourcing claim.
 *
 * Usage: node guess-instagram.mjs <input.json> <output.jsonl> [concurrency]
 *   input.json  [{ "id", "name", "suburb", "city" }, ...]
 */
import { chromium } from "playwright";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [, , inputPath, outputPath, concurrencyArg] = process.argv;
const CONCURRENCY = Number(concurrencyArg) || 4;
const NAV_TIMEOUT = 20_000;

/** Words that identify a category, not a business. */
const GENERIC = new Set([
  "cafe", "coffee", "the", "restaurant", "bar", "tea", "house", "co", "and", "shop",
  "kitchen", "eatery", "bakery", "dessert", "desserts", "au", "australia", "roasters",
  "roastery", "espresso", "sweets", "store", "food", "bakehouse", "patisserie", "grocery",
]);

const fold = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (s) => fold(s).split(" ").filter(Boolean);

/** The words that distinguish this business, in order, deduplicated. */
function nameTokens(name) {
  return [...new Set(words(name).filter((w) => w.length >= 3 && !GENERIC.has(w)))];
}

/**
 * Handles worth trying, most likely first.
 *
 * Australian cafes overwhelmingly follow one of a few shapes: the bare brand, the brand
 * joined to its suburb, or the brand with a country or category suffix. "&" is written
 * as either "and" or a bare "n" ("Fork & Path" runs @forknpath), so both are generated.
 */
function candidateHandles(cafe) {
  const raw = words(cafe.name);
  const tokens = nameTokens(cafe.name);
  if (tokens.length === 0) return [];

  // Accounts are usually named for the brand, not the whole trading name: "OFFSET Matcha
  // & Brew" runs @offset.surryhills, so the leading word has to be tried on its own as
  // well as the full string.
  const brandN = raw.map((w) => (w === "and" ? "n" : w)).filter((w) => !GENERIC.has(w)).join("");
  const bases = [
    ...new Set(
      [tokens[0], tokens.slice(0, 2).join(""), tokens.join(""), brandN].filter(
        (b) => b && b.length >= 3
      )
    ),
  ];

  // Kept deliberately short. Every extra shape is another Instagram fetch for every one
  // of hundreds of cafes, and Instagram starts serving login walls when pushed — so a
  // longer list does not just cost time, it costs the hit rate of the guesses that matter.
  const suburb = words(cafe.suburb).join("");
  const lead = bases[0];
  const full = bases[bases.length - 1];

  // The whole trading name, generics and all.
  //
  // Stripping the category word is right for the brand shapes above, and wrong on its
  // own: "May & Mac Cafe" runs @maynmaccafe, and every shape here tried "maynmac" while
  // the live handle simply kept the word. A cafe that puts "Cafe" in its name very often
  // puts it in its handle too, so the unstripped join is worth one fetch.
  const whole = raw.map((w) => (w === "and" ? "n" : w)).join("");

  const out = [];
  if (suburb) out.push(`${lead}.${suburb}`, `${lead}${suburb}`);
  out.push(lead);
  if (full !== lead) out.push(full);
  if (whole !== full && whole !== lead) out.push(whole);
  if (suburb && full !== lead) out.push(`${full}.${suburb}`);

  return [...new Set(out)].filter((h) => h.length >= 3 && h.length <= 30).slice(0, 6);
}

const MISSING = /page (isn'?t|not) available|sorry, this page|user not found/i;

/**
 * A profile stating that it trades in another country.
 *
 * Only used on the name-only attribution route, where nothing else checks location.
 * Deliberately narrow: a mention of Japan or Italy is normal on an Australian cafe's bio
 * and must not disqualify it, so this looks for the things a business writes about its
 * own address — a foreign state or postcode format, a foreign dialling pattern, or a
 * country named the way an address names one.
 */
const ELSEWHERE = new RegExp([
  "\\b(?:United States|USA|U\\.S\\.A)\\b",
  "\\b(?:California|Texas|Florida|New York|Ontario|Quebec)\\b",
  "\\bCA\\s?\\d{5}\\b",
  "\\(\\d{3}\\)\\s?\\d{3}-\\d{4}",
  "\\b(?:Brasil|Brazil)\\b",
  "\\bRestaurante\\b",
  "\\bAv\\.\\s+[A-Z]",
  "\\b(?:United Kingdom|London|Manchester)\\b",
  "\\b(?:Singapore|Malaysia|Kuala Lumpur|Auckland|Toronto|Vancouver)\\b",
].join("|"), "i");

/**
 * Instagram serves the bio to an anonymous client most of the time and a login wall the
 * rest of the time, for the same profile minutes apart. Read as ordinary page text a wall
 * looks like a profile that fails to mention the cafe — which is a rejection, and a
 * permanent one, for a profile that would have matched. So it is detected and retried.
 */
const LOGIN_WALL = /log into instagram|mobile number, username or email|create new account/i;

async function readProfile(page, handle, attempt = 1) {
  await page.goto(`https://www.instagram.com/${handle}/`, {
    timeout: NAV_TIMEOUT,
    waitUntil: "load",
  });
  await page.waitForTimeout(1200);
  const text = await page.evaluate(() => {
    for (const el of document.querySelectorAll("script,style,noscript,svg")) el.remove();
    return (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  });

  if (LOGIN_WALL.test(text) && !MISSING.test(text) && attempt < 2) {
    await page.waitForTimeout(2500);
    return readProfile(page, handle, attempt + 1);
  }
  return text;
}

/**
 * Believe this profile is this cafe only if its own text says so.
 *
 * The handle proves nothing here — it was generated from the cafe's name. The bio has to
 * carry the business name and put itself in the right suburb. Cafes that leave their
 * suburb out of their bio are missed; that is the correct way to be wrong, because the
 * alternative is publishing a stranger's sourcing claim under this cafe's name.
 */
const PRIVATE = /this (profile|account) is private/i;

/**
 * Something in the bio that says this account sells food or drink.
 *
 * <p>A cafe name is not unique to cafes. "Haus Espresso" in Richmond matched @hausrichmond
 * — a gym, "Elite fitness, focused work & world-class recovery under one roof" — and
 * "La Petite Tour" matched a French clothing label, "Vente de vêtements à la classe
 * française". Both agreed on the name and the suburb and were still the wrong business.
 * Every record in this dataset is a cafe, so a profile that never mentions anything
 * edible is not the one being looked for.
 */
const FOOD_SIGNAL = new RegExp(
  "\\b(cafe|café|coffee|espresso|matcha|tea|latte|brew|roast\\w*|bakery|baked|pastry|"
    + "patisserie|dessert\\w*|sweets|cake\\w*|bread|kitchen|restaurant|dining|eatery|menu|"
    + "brunch|breakfast|lunch|milktea|boba|gelato|ice cream|mochi|donut\\w*|waffle\\w*|"
    + "sushi|ramen|noodle\\w*|pho|drinks?)\\b",
  "i"
);

/**
 * Suburbs short enough or common enough to match by accident.
 *
 * <p>One record carries the literal string "and" in its suburb column. Three characters
 * clears a length check, and "and" appears in almost every bio ever written — it matched
 * "matcha and milkshake" and attributed a stranger's account to a cafe.
 */
const UNUSABLE_SUBURB = new Set([
  "and", "the", "of", "in", "at", "st", "rd", "ave", "n/a", "na", "null", "none",
]);

/**
 * The words the cafe wrote, with Instagram's own furniture removed.
 *
 * <p>Matching against the raw page was circular and produced nonsense. Instagram echoes
 * the handle back in its boilerplate — "Already follow sticksnstraws? Log in to see their
 * photos" — and the handle was generated from the cafe's name, so the name "appeared in
 * the profile" for accounts that had no bio at all. Every private profile matched itself.
 * The footer ("Meta About Blog Jobs Help API Privacy Terms Locations…") supplied more
 * stray vocabulary on top.
 *
 * <p>So: cut the header, cut everything from the post list or footer onward, and delete
 * the handle itself. What remains is what the account holder typed.
 */
export function extractBio(profileText, handle) {
  let t = profileText
    .replace(/^\s*Log In Sign Up\s*/i, "")
    .replace(/^\s*See everyday moments.*?Log into Instagram\s*/i, "");

  for (const marker of [
    "Show more posts from",
    "Meta About Blog Jobs",
    "Already follow",
    "Related accounts",
  ]) {
    const at = t.indexOf(marker);
    if (at > 0) t = t.slice(0, at);
  }

  return t
    .replace(new RegExp(handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ")
    .replace(/[\d.,]+[KkMm]?\s*(followers|following|posts)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function attribution(cafe, profileText, handle) {
  if (!profileText || MISSING.test(profileText)) return { ok: false, why: "no such profile" };
  if (LOGIN_WALL.test(profileText)) return { ok: false, why: "blocked by login wall", blocked: true };
  if (PRIVATE.test(profileText)) return { ok: false, why: "profile is private — nothing to verify against" };

  const bioText = extractBio(profileText, handle);
  if (bioText.length < 12) return { ok: false, why: "profile has no readable bio" };

  if (!FOOD_SIGNAL.test(bioText)) {
    return { ok: false, why: "profile is not a food or drink business" };
  }

  const bio = fold(bioText);
  const tokens = nameTokens(cafe.name);
  const rawSuburb = words(cafe.suburb).join(" ");
  const suburb = UNUSABLE_SUBURB.has(rawSuburb) || rawSuburb.length < 4 ? "" : rawSuburb;

  const named = tokens.filter((t) => bio.includes(t));
  if (named.length === 0) return { ok: false, why: "profile does not name this business" };

  // A suburb that is just the city name proves nothing: every Melbourne business says
  // Melbourne, which is how a personal account reading "Resident of Melbourne Australia, a
  // Father, a Scotch lover" came back as a gelato shop.
  const suburbIsCity = suburb === fold(cafe.city);
  if (suburb.length >= 3 && !suburbIsCity && bio.includes(suburb)) {
    return { ok: true, why: `bio names the business and places it in ${cafe.suburb}` };
  }

  // A bio with no address at all is common — @forknpath gives opening hours and its coffee
  // roaster and never says Northcote. Two distinct words of the business name, both found
  // in the profile's own text, carry it instead. Checked against the bio and not the
  // handle: the handle was built from the name, so matching it proves nothing. "Boom Boom
  // Tea" reduces to one distinct word and so cannot reach this bar, which is why
  // @boomboomalbury stays rejected.
  if (tokens.length >= 2 && named.length === tokens.length) {
    // ...unless the profile says outright that it is somewhere else. This route has no
    // location test of its own, which is how @tokyodeli — "6522 Bolsa Ave, Huntington
    // Beach, CA, United States" — was attributed to a cafe in Elsternwick, and a
    // "Restaurante Japones" on Av. Carlos Drummond de Andrade to one in Melbourne. Both
    // carry the whole trading name, because the name is the thing two businesses on
    // opposite sides of the world are most likely to share. Requiring positive proof of
    // Australia would be too strict — plenty of real bios give hours and nothing else —
    // but a bio that names another country has already answered the question.
    if (ELSEWHERE.test(bioText)) {
      return { ok: false, why: `profile places itself outside Australia (${bioText.match(ELSEWHERE)[0]})` };
    }
    return { ok: true, why: "profile text carries the whole business name" };
  }

  return {
    ok: false,
    why: suburb.length < 3
      ? "no usable suburb, and the name is not distinctive enough alone"
      : `bio does not place it in ${cafe.suburb}, and the name only partly matches`,
  };
}

// The attribution rules are importable on their own, so they can be replayed against
// stored profile text without going near Instagram. Only crawl when run directly.
const runDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (runDirectly) {
const all = JSON.parse(readFileSync(inputPath, "utf8"));
const done = new Set();
if (existsSync(outputPath)) {
  for (const line of readFileSync(outputPath, "utf8").split("\n")) {
    if (line.trim()) try { done.add(JSON.parse(line).id); } catch {}
  }
}
const queue = all.filter((c) => !done.has(c.id));
console.error(`${all.length} cafes, ${done.size} already tried, ${queue.length} to go`);

const browser = await chromium.launch();
let index = 0;
let found = 0;

/**
 * Instagram tolerates a steady trickle and shuts the door on a burst — and once it does,
 * every profile reads as a login wall, so a run that keeps going records hundreds of real
 * accounts as absent. Consecutive walls are treated as the signal they are: back off until
 * pages start rendering again, rather than spending the rest of the queue on nothing.
 */
let consecutiveWalls = 0;
async function respectRateLimit(page) {
  if (consecutiveWalls < 6) return;
  const pause = Math.min(300, 60 * Math.ceil(consecutiveWalls / 6));
  console.error(`  ${consecutiveWalls} walls in a row — pausing ${pause}s`);
  await page.waitForTimeout(pause * 1000);
  consecutiveWalls = 0;
}

async function worker() {
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    locale: "en-AU",
    viewport: { width: 1280, height: 900 },
  });
  await ctx.route("**/*", (r) => {
    const t = r.request().resourceType();
    return t === "image" || t === "font" || t === "media" ? r.abort() : r.continue();
  });
  const page = await ctx.newPage();

  while (index < queue.length) {
    const cafe = queue[index++];
    const at = index;
    const row = { id: cafe.id, name: cafe.name, suburb: cafe.suburb, handle: null, text: "" };
    const tried = [];
    try {
      for (const handle of candidateHandles(cafe)) {
        let text = "";
        try {
          text = await readProfile(page, handle);
        } catch {
          continue;
        }
        const verdict = attribution(cafe, text, handle);
        tried.push(`${handle}: ${verdict.why}`);
        if (verdict.blocked) {
          row.blocked = (row.blocked || 0) + 1;
          consecutiveWalls++;
        } else {
          consecutiveWalls = 0;
        }
        if (verdict.ok) {
          row.handle = handle;
          row.text = text;
          row.matchedOn = verdict.why;
          break;
        }
      }
    } catch (e) {
      row.error = String(e.message || e).slice(0, 120);
    }
    row.tried = tried.slice(-6);
    await respectRateLimit(page);
    await page.waitForTimeout(1500); // a steady trickle, not a burst
    if (row.handle) found++;
    appendFileSync(outputPath, JSON.stringify(row) + "\n");
    if (at % 20 === 0 || at === queue.length) {
      console.error(`  ${at}/${queue.length} — ${found} profiles attributed`);
    }
  }
  await ctx.close();
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await browser.close();
console.error(`done: ${found} of ${queue.length} cafes matched to a profile`);
}
