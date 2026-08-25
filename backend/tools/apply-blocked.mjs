/**
 * Write back what the 403 cafes disclosed once the crawler stopped being refused.
 *
 * A region word is only evidence when it belongs to the tea. nikushiki.com.au names
 * Kagoshima twice and has no tea word anywhere on the page — it is a wagyu restaurant,
 * and the prefecture is attached to the beef. So the region has to sit within 40
 * characters of a tea word to count, which is the same relation the grader requires.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const props = readFileSync("../src/main/resources/application.properties", "utf8");
const prop = (k) => (props.split("\n").find((l) => l.startsWith(k + "=")) || "").slice(k.length + 1).trim();
const [, HOST, PORT, DB] = prop("spring.datasource.url").match(/jdbc:postgresql:\/\/([^:/]+):(\d+)\/([^?]+)/);
const DBUSER = prop("spring.datasource.username"), DBPASS = prop("spring.datasource.password");

const rows = readFileSync("blocked-rendered.jsonl", "utf8").split("\n").filter(Boolean).map(JSON.parse);
const cur = new Map(readFileSync("triage-unread.jsonl", "utf8").split("\n").filter(Boolean).map(JSON.parse).map((r) => [r.id, r]));

const SHELL = 150;
const SIG = /matcha|tencha|gyokuro|sencha|hojicha|tea|origin|sourc|blend/i;
const REGION = /\b(uji|nishio|yame|shizuoka|kagoshima|aichi|kyoto|fukuoka|mie|kyushu|wazuka|sayama)\b/gi;
const TEA = /\b(matcha|tencha|gyokuro|sencha|hojicha|green tea)\b/gi;
const CLAIM = new RegExp(
  "\\bjapan(?:ese)?(?:[-\\s]grown|[-\\s]sourced)?\\s+(?:(?!and\\s|or\\s|with\\s)\\w+\\s+){0,2}matcha\\b" +
  "|\\bmatcha\\b[^.!?]{0,90}?\\bfrom\\s+japan\\b" +
  "|\\bmatcha\\b[^.!?]{0,90}?\\b(?:sourced|grown|harvested|imported|milled|produced|shipped|cultivated)\\b[^.!?]{0,30}?\\bjapan\\b", "i");

/** Nearest gap between a named region and a tea word, or null when either is absent. */
function regionBelongsToTea(t) {
  REGION.lastIndex = 0; TEA.lastIndex = 0;
  const regs = [...t.matchAll(REGION)], teas = [...t.matchAll(TEA)].map((m) => m.index);
  if (!regs.length || !teas.length) return null;
  for (const g of regs) if (Math.min(...teas.map((i) => Math.abs(i - g.index))) <= 40) return g[0];
  return null;
}

const rank = { A: 0, B: 1, C: 2, D: 3 };
const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const plan = [];
for (const r of rows) {
  const t = (r.text || "").replace(/\s+/g, " ").trim();
  if (t.length < SHELL || !SIG.test(t)) continue;
  const region = regionBelongsToTea(t);
  const level = region ? "A" : CLAIM.test(t) ? "B" : "C";
  const now = cur.get(r.id)?.level;
  if (now && rank[level] < rank[now]) plan.push({ id: r.id, from: now, to: level, why: region ? `region "${region}" beside the tea` : level === "B" ? "japanese matcha claim" : "page read, no origin", url: r.url });
}

console.log(`${plan.length} promotions\n`);
for (const p of plan) console.log(`  ${p.id.padEnd(14)} ${p.from} -> ${p.to}   ${p.why.padEnd(30)} ${(p.url || "").slice(0, 34)}`);

const sql = ["BEGIN;", ...plan.map((p) => `UPDATE cafes SET level = ${esc(p.to)} WHERE id = ${esc(p.id)};`), "COMMIT;"];
writeFileSync("apply-blocked.sql", sql.join("\n") + "\n");
if (!process.argv.includes("--apply")) { console.log("\ndry run — pass --apply to execute"); process.exit(0); }
const env = { ...process.env, PGPASSWORD: DBPASS };
console.log("\n" + execFileSync("psql", ["-h", HOST, "-p", PORT, "-U", DBUSER, "-d", DB, "-f", "apply-blocked.sql"], { env, encoding: "utf8" }));
