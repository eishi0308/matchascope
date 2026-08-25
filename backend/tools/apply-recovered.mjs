/**
 * Write back what the Places recovery found: a website for cafes that had none, and the
 * grade their newly-readable page supports.
 *
 * Corroboration is not optional. Places matched "Rucccii Preston", a cafe in Preston,
 * Victoria, to Roccia — a tile retailer in Preston, Lancashire, 17,000km away, whose page
 * says "Preston" twenty-five times. A location bias of 200m did not stop it, because the
 * suburb name in the query text was enough on its own. So a recovered site is only
 * accepted when the page corroborates the cafe: its name appears, or the domain is
 * Australian, or the page names the cafe's own suburb or city.
 *
 *   node apply-recovered.mjs           # dry run, prints the SQL
 *   node apply-recovered.mjs --apply   # execute
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const props = readFileSync("../src/main/resources/application.properties", "utf8");
const prop = (k) => (props.split("\n").find((l) => l.startsWith(k + "=")) || "").slice(k.length + 1).trim();
const JDBC = prop("spring.datasource.url");
const DBUSER = prop("spring.datasource.username");
const DBPASS = prop("spring.datasource.password");
if (!JDBC) { console.error("no datasource in application.properties"); process.exit(1); }
// jdbc:postgresql://host:port/db?params  ->  psql pieces
const m = JDBC.match(/jdbc:postgresql:\/\/([^:/]+):(\d+)\/([^?]+)/);
if (!m) { console.error("could not parse datasource url"); process.exit(1); }
const [, HOST, PORT, DB] = m;

const found = readFileSync("found-websites.jsonl", "utf8").split("\n").filter(Boolean).map(JSON.parse);
const crawled = new Map(readFileSync("recovered-rendered.jsonl", "utf8").split("\n").filter(Boolean).map(JSON.parse).map((r) => [r.id, r]));
const cafes = new Map(readFileSync("triage-unread.jsonl", "utf8").split("\n").filter(Boolean).map(JSON.parse).map((r) => [r.id, r]));

const SHELL = 150;
const SIG = /matcha|tencha|gyokuro|sencha|hojicha|tea|origin|sourc|blend/i;
const REGION = /\b(uji|nishio|yame|shizuoka|kagoshima|aichi|kyoto|fukuoka|mie|kyushu|wazuka|sayama)\b/i;
const CLAIM = new RegExp(
  "\\bjapan(?:ese)?(?:[-\\s]grown|[-\\s]sourced)?\\s+(?:(?!and\\s|or\\s|with\\s)\\w+\\s+){0,2}matcha\\b" +
  "|\\bmatcha\\b[^.!?]{0,90}?\\bfrom\\s+japan\\b" +
  "|\\bmatcha\\b[^.!?]{0,90}?\\b(?:sourced|grown|harvested|imported|milled|produced|shipped|cultivated)\\b[^.!?]{0,30}?\\bjapan\\b", "i");
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const accepted = [], rejected = [];
for (const f of found) {
  if (!f.website) continue;
  if (/instagram\.com|facebook\.com|tiktok\.com/i.test(f.website)) { rejected.push({ ...f, why: "social profile, not a website" }); continue; }
  const page = crawled.get(f.id);
  const text = (page?.text || "").replace(/\s+/g, " ").trim();
  const cafe = cafes.get(f.id) || {};

  const nameOnPage = norm(f.name).length >= 6 && norm(text).includes(norm(f.name).slice(0, 7));

  // An Australian signal, not just an Australian-sounding suburb. The first version of
  // this guard accepted a suburb name on its own and let Roccia straight through: the
  // cafe is in Preston, Victoria, the tile shop is in Preston, Lancashire, and the page
  // says "Preston" twenty-five times. Corroborating a suburb collision with the same
  // suburb is circular, so a suburb now only counts alongside evidence of the country.
  const auDomain = /\.au(\/|$)/i.test(f.website);
  const auOnPage = /\bAustralia\b|\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b|\+61\b|\bA\$/.test(text);
  const australian = auDomain || auOnPage;
  const placeOnPage = [cafe.suburb, cafe.city].filter(Boolean)
    .some((p) => norm(p).length >= 5 && norm(text).includes(norm(p)));

  if (!nameOnPage && !(australian && placeOnPage) && !auDomain) {
    rejected.push({ ...f, why: "page does not corroborate this cafe", chars: text.length });
    continue;
  }
  const readable = text.length >= SHELL && SIG.test(text);
  const region = text.match(REGION);
  const level = region ? "A" : CLAIM.test(text) ? "B" : readable ? "C" : null;
  accepted.push({ ...f, level, readable, chars: text.length,
    corroborated: nameOnPage ? "name on page" : auDomain ? ".au domain" : "suburb + AU signal",
    quote: level && level !== "C" ? text.slice(Math.max(0, text.search(region ? REGION : CLAIM) - 90), text.search(region ? REGION : CLAIM) + 110).trim() : null });
}

console.log(`accepted ${accepted.length}, rejected ${rejected.length}\n`);
for (const r of rejected) console.log(`  REJECT ${r.id.padEnd(14)} ${r.why.padEnd(34)} ${r.website.slice(0, 46)}`);
console.log();
for (const a of accepted) console.log(`  keep   ${a.id.padEnd(14)} ${String(a.level || "no grade change").padEnd(16)} ${a.corroborated.padEnd(14)} ${a.website.slice(0, 44)}`);

const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sql = [];
sql.push("BEGIN;");
for (const a of accepted) sql.push(`UPDATE cafes SET website = ${esc(a.website.replace(/^https?:\/\//i, ""))} WHERE id = ${esc(a.id)};`);
// Level promotions only. A page read for the first time that discloses nothing is a C,
// which is a real finding, but a demotion is never applied from here.
for (const a of accepted) {
  if (!a.level) continue;
  const cur = cafes.get(a.id)?.level;
  const rank = { A: 0, B: 1, C: 2, D: 3 };
  if (cur && rank[a.level] < rank[cur]) sql.push(`UPDATE cafes SET level = ${esc(a.level)} WHERE id = ${esc(a.id)};`);
}
// The one step-1 correction: a real page was read and it says nothing about origin, which
// is "No Origin Disclosure", not "Insufficient Information".
sql.push(`UPDATE cafes SET level = 'C' WHERE id = 'syd-disc-116' AND level = 'D';`);
sql.push("COMMIT;");

writeFileSync("apply-recovered.sql", sql.join("\n") + "\n");
console.log(`\n${sql.length - 2} statements written to apply-recovered.sql`);

if (!process.argv.includes("--apply")) { console.log("\ndry run — pass --apply to execute"); process.exit(0); }

const ids = [...accepted.map((a) => a.id), "syd-disc-116"];
const backup = `SELECT id, level, website FROM cafes WHERE id IN (${ids.map(esc).join(",")});`;
writeFileSync("backup-query.sql", backup + "\n");
const env = { ...process.env, PGPASSWORD: DBPASS };
const run = (file) => execFileSync("psql", ["-h", HOST, "-p", PORT, "-U", DBUSER, "-d", DB, "-f", file], { env, encoding: "utf8" });
console.log("\n--- state before ---");
console.log(run("backup-query.sql"));
writeFileSync("rollback-recovered.sql", "-- rerun the SELECT above to confirm; restore by hand if needed\n");
console.log("--- applying ---");
console.log(run("apply-recovered.sql"));
console.log("--- state after ---");
console.log(run("backup-query.sql"));
