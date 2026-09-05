/**
 * Store the passage each promotion was made on.
 *
 * A grade without a quote is not published: the cafe page shows "Under review — grade
 * withheld, evidence missing" instead, which is the right refusal and exactly what
 * happened to all five cafes promoted today. Setting the level and not the evidence
 * writes a claim the site will not stand behind, so the two belong in one step.
 *
 * Every quote here is cut from the crawl journal for that cafe and checked back against
 * it, because the site's guarantee is that a quote is verbatim from the page.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const props = readFileSync("../src/main/resources/application.properties", "utf8");
const prop = (k) => (props.split("\n").find((l) => l.startsWith(k + "=")) || "").slice(k.length + 1).trim();
const [, HOST, PORT, DB] = prop("spring.datasource.url").match(/jdbc:postgresql:\/\/([^:/]+):(\d+)\/([^?]+)/);
const DBUSER = prop("spring.datasource.username"), DBPASS = prop("spring.datasource.password");

const JOURNALS = ["blocked-rendered.jsonl", "recovered-rendered.jsonl", "step2-rendered.jsonl", "shells-rendered.jsonl"];
const page = new Map();
for (const f of JOURNALS) { if (!existsSync(f)) continue;
  for (const l of readFileSync(f, "utf8").split("\n")) { if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r.id && (r.text || "").length > 150) page.set(r.id, r); } catch {} } }

const REGION = /\b(uji|nishio|yame|shizuoka|kagoshima|aichi|kyoto|fukuoka|wazuka|sayama)\b/i;
const CLAIM = new RegExp(
  "\\bjapan(?:ese)?(?:[-\\s]grown|[-\\s]sourced)?\\s+(?:(?!and\\s|or\\s|with\\s)\\w+\\s+){0,2}matcha\\b" +
  "|\\bmatcha\\b[^.!?]{0,90}?\\bfrom\\s+japan\\b" +
  "|\\bmatcha\\b[^.!?]{0,90}?\\b(?:sourced|grown|harvested|imported|milled|produced|shipped|cultivated)\\b[^.!?]{0,30}?\\bjapan\\b", "i");

/**
 * The shortest run of text that carries the disclosure whole.
 *
 * Sentence boundaries are unreliable on a menu, where the disclosure is a price list
 * fragment rather than prose — "Hot Matcha Latte Uji matcha from Japan $6.8" has no full
 * stop anywhere near it. So the window is bounded by characters and then trimmed back to
 * something that reads, rather than split on punctuation that is not there.
 */
function passage(text, pattern) {
  const t = text.replace(/\s+/g, " ").trim();
  const i = t.search(pattern);
  if (i < 0) return null;

  // Where one menu item stops and the next begins.
  //
  // A first attempt bounded the window by characters and by sentence punctuation, and a
  // menu has neither: the quotes came out as "8.00 − 0 + Yame Matcha MontBlanc $18.00 − 0
  // + Strawberry ShortCake $16.00 − 0 + ORDER SUMMARY Your cart is empty". Every word of
  // that is verbatim and most of it belongs to a different cake. A price, a quantity
  // stepper or a cart heading is where the item ends, so those are the edges.
  // A run of shouted words is a navigation strip or a store list, not prose: ohmatcha's
  // disclosure sits directly after "CHATSWOOD CHASE SYDNEY REGENT PLACE HORNSBY
  // WESTFIELD", which is their branch list and reads as noise in front of the quote.
  const EDGE = /A?\$\s?[\d.,]+|\s[−–—+]\s|\d+\s?[−–—]\s?0|📋|⚠️|ORDER SUMMARY|Your cart|Show more|Add to cart|Sold out|(?:\b[A-Z]{3,}\b[ ,]+){2,}/g;

  const before = t.slice(Math.max(0, i - 160), i);
  const after = t.slice(i, Math.min(t.length, i + 200));

  // start: after the last edge that precedes the disclosure
  let lead = 0;
  for (const m of before.matchAll(EDGE)) lead = m.index + m[0].length;
  // ...or after the last sentence end, whichever is nearer the disclosure
  const stop = before.lastIndexOf(". ");
  if (stop + 2 > lead) lead = stop + 2;
  let head = before.slice(Math.max(0, lead)).replace(/^[^A-Za-z0-9"“]+/, "");

  // end: at the first edge or sentence end after it
  const edge = [...after.matchAll(EDGE)][0];
  const dot = after.search(/[.!?](?:\s|$)/);
  // A closing quote followed by a capital starts a new thought without any full stop:
  // "...the most renowned Matcha region 'UJI' There's more to discover." The claim ends
  // at the quote mark; the invitation after it is the site talking about itself.
  const quoted = after.search(/['’"”]\s+[A-Z]/);
  let cut = after.length;
  if (dot > -1) cut = dot + 1;
  if (quoted > -1 && quoted + 1 < cut) cut = quoted + 1;
  if (edge && edge.index < cut) cut = edge.index;
  let tail = after.slice(0, cut).trim();

  const q = (head + tail).replace(/\s+/g, " ").trim().replace(/[\s−–—+]+$/, "");
  return q.length > 200 ? q.slice(0, 200).replace(/\s\S*$/, "") : q;
}

const targets = ["mel-disc-566", "mel-disc-731", "syd-disc-109", "syd-disc-232", "syd-disc-851"];
const MONTH = new Date().toLocaleString("en-AU", { month: "long", year: "numeric" });

const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const plan = [];
for (const id of targets) {
  const p = page.get(id);
  if (!p) { console.log(`  ${id.padEnd(14)} NO JOURNAL TEXT — skipped`); continue; }
  const t = (p.text || "").replace(/\s+/g, " ").trim();
  const q = passage(t, REGION.test(t) ? REGION : CLAIM);
  if (!q || q.length < 20) { console.log(`  ${id.padEnd(14)} could not cut a usable quote — skipped`); continue; }
  if (!t.includes(q)) { console.log(`  ${id.padEnd(14)} quote is not verbatim — skipped`); continue; }
  const url = /^https?:/i.test(p.url) ? p.url : "https://" + p.url;
  plan.push({ id, quote: q, url, date: MONTH });
  console.log(`  ${id.padEnd(14)} "${q}"`);
  console.log(`  ${"".padEnd(14)}  ${url}`);
}

const sql = ["BEGIN;", ...plan.map((p) =>
  `UPDATE cafes SET evidence_quote = ${esc(p.quote)}, evidence_source = ${esc(p.url)}, ` +
  `evidence_source_label = 'Official Website', evidence_verified_date = ${esc(p.date)} WHERE id = ${esc(p.id)};`), "COMMIT;"];
writeFileSync("apply-evidence.sql", sql.join("\n") + "\n");
console.log(`\n${plan.length} of ${targets.length} ready`);
if (!process.argv.includes("--apply")) { console.log("dry run — pass --apply to execute"); process.exit(0); }
console.log(execFileSync("psql", ["-h", HOST, "-p", PORT, "-U", DBUSER, "-d", DB, "-f", "apply-evidence.sql"],
  { env: { ...process.env, PGPASSWORD: DBPASS }, encoding: "utf8" }));
