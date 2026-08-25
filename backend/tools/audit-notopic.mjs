/**
 * Is "a page with no tea word on it" actually evidence that a cafe disclosed nothing?
 *
 * Only sometimes, and the exceptions are not rare. Inspecting six pages by hand turned up
 * four separate ways the bucket lies, so each one is counted here rather than estimated.
 */
import { readFileSync, existsSync } from "node:fs";
const JOURNALS = ["deep-rendered.jsonl","ig-rendered.jsonl","rendered-final.jsonl","nolink-found2.jsonl","retry-blocked.jsonl","ubereats.jsonl","shells-rendered.jsonl"];
const J = new Map();
for (const f of JOURNALS) { if (!existsSync(f)) continue;
  for (const l of readFileSync(f,"utf8").split("\n")) { if(!l.trim())continue; try{const r=JSON.parse(l); if(r.id)J.set(r.id,r);}catch{} } }
const rows = readFileSync("triage-unread.jsonl","utf8").split("\n").filter(Boolean).map(JSON.parse);

const SOCIAL = /instagram\.com|facebook\.com|fb\.com|tiktok\.com/i;
const ERRORSIG = /404 not found|403 forbidden|500 internal|error 404|nginx\/[\d.]|apache\/[\d.]|page not found|site can.?t be reached|this page (?:isn.?t|is not) available/i;

/** A page whose text is a navigation bar and nothing else cannot say anything. */
function navOnly(t) {
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 25) return true;
  const lower = words.filter((w) => /^[a-z][a-z'’-]{2,}$/.test(w)).length;
  // real prose runs well over half lowercase words; a nav strip barely reaches a third
  if (lower / words.length < 0.34) return true;
  // the same nav rendered twice is the other tell
  const head = t.slice(0, 60);
  return head.length === 60 && t.indexOf(head, 60) !== -1;
}

const report = {};
for (const key of ["no-topic-real", "no-topic-thin"]) {
  const set = rows.filter((r) => r.bucket === key);
  const out = { total: set.length, social: 0, errorPage: 0, navOnly: 0, usable: 0, ids: [] };
  for (const r of set) {
    const j = J.get(r.id) || {};
    const t = (j.text || "").replace(/\s+/g, " ").trim();
    const url = j.url || r.website || "";
    if (SOCIAL.test(url))       { out.social++;    continue; }
    if (ERRORSIG.test(t))       { out.errorPage++; continue; }
    if (navOnly(t))             { out.navOnly++;   continue; }
    out.usable++; out.ids.push(r.id);
  }
  report[key] = out;
}
for (const [k, v] of Object.entries(report)) {
  console.log(`\n=== ${k}  (${v.total}) ===`);
  console.log(`  social profile, not the cafe's own site : ${String(v.social).padStart(4)}`);
  console.log(`  page is an error / 404 / server default : ${String(v.errorPage).padStart(4)}`);
  console.log(`  text is navigation only, no body        : ${String(v.navOnly).padStart(4)}`);
  console.log(`  genuinely a content page with no tea    : ${String(v.usable).padStart(4)}   <- the only defensible ones`);
}
const total = Object.values(report).reduce((a, v) => a + v.usable, 0);
console.log(`\nsafe to treat as "the cafe published nothing about tea": ${total} of ${report["no-topic-real"].total + report["no-topic-thin"].total}`);
import { writeFileSync } from "node:fs";
writeFileSync("notopic-usable.json", JSON.stringify(
  [...report["no-topic-real"].ids, ...report["no-topic-thin"].ids], null, 2));
console.log("wrote notopic-usable.json");
