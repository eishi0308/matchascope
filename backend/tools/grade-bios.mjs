/**
 * What a matched Instagram bio actually discloses.
 *
 * A bio is short and written for regulars, so most of it is hours and an address. The
 * three things worth reading out of it, in descending strength:
 *
 *   region beside the tea   "Premium Matcha from Uji"          -> A
 *   japanese matcha claim   "Japanese ceremonial matcha"       -> B
 *   a named supplier        "Matcha from @yumicha.aus"         -> no promotion
 *
 * The third is a real sourcing statement and still not a Japanese origin: @yumicha.aus is
 * an Australian supplier, and the grader has always refused to read a reseller's name as
 * a country. It is recorded, not promoted — following the handle to whatever that supplier
 * says would be inference, which is the one thing this dataset does not do.
 *
 * Instagram's own footer is cut before anything is read. It lists every interface language
 * including 日本語, and an audit that forgot to strip it counted 128 cafes as mentioning
 * Japan on the strength of Instagram's language menu.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const CHROME = /Meta About Blog Jobs Help API Privacy Terms[\s\S]*$/;
const REGION = /\b(uji|nishio|yame|shizuoka|kagoshima|aichi|kyoto|fukuoka|wazuka|sayama|yamecha)\b/gi;
const TEA = /\b(matcha|tencha|gyokuro|sencha|hojicha|houjicha|green tea)\b/gi;
const CLAIM = new RegExp(
  "\\bjapan(?:ese)?(?:[-\\s]grown|[-\\s]sourced)?\\s+(?:(?!and\\s|or\\s|with\\s)\\w+\\s+){0,2}matcha\\b" +
  "|\\bmatcha\\b[^.!?\\n]{0,90}?\\bfrom\\s+japan\\b" +
  "|\\bmatcha\\b[^.!?\\n]{0,90}?\\b(?:sourced|grown|harvested|imported|milled|produced|shipped|cultivated)\\b[^.!?\\n]{0,30}?\\bjapan\\b", "i");
const SUPPLIER = /\b(?:matcha|tea)\b[^.\n]{0,28}?\b(?:from|by|supplied by|sourced from)\b[^.\n]{0,20}?@([A-Za-z0-9._]{3,30})/i;

function regionBesideTea(t) {
  REGION.lastIndex = 0; TEA.lastIndex = 0;
  const regs = [...t.matchAll(REGION)], teas = [...t.matchAll(TEA)].map((m) => m.index);
  if (!regs.length || !teas.length) return null;
  for (const g of regs) if (Math.min(...teas.map((i) => Math.abs(i - g.index))) <= 40) return g[0];
  return null;
}

// One row per cafe. A cafe can appear in more than one journal — a smoke test and the
// full run, say — and counting it twice would inflate every figure below.
const files = process.argv.slice(2).filter(existsSync);
const byId = new Map();
for (const f of files)
  for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r.id && r.handle) byId.set(r.id, r); } catch {}
  }
const rows = [...byId.values()];

const out = { A: [], B: [], supplier: [], nothing: [] };
for (const r of rows) {
  const t = (r.text || "").replace(CHROME, "").replace(/\s+/g, " ").trim();
  const region = regionBesideTea(t);
  const sup = t.match(SUPPLIER);
  if (region) out.A.push({ ...r, why: region, snip: t.slice(Math.max(0, t.search(REGION) - 60), t.search(REGION) + 90) });
  else if (CLAIM.test(t)) out.B.push({ ...r, snip: t.slice(Math.max(0, t.search(CLAIM) - 60), t.search(CLAIM) + 90) });
  else if (sup) out.supplier.push({ ...r, handle2: sup[1], snip: t.slice(Math.max(0, sup.index - 40), sup.index + 80) });
  else out.nothing.push(r);
}

console.log(`${rows.length} bios matched to a cafe\n`);
console.log(`  names a region beside the tea -> A : ${out.A.length}`);
out.A.forEach((x) => console.log(`      ${x.id.padEnd(14)} @${String(x.handle).padEnd(24)} "${x.snip.slice(0, 92)}"`));
console.log(`  japanese matcha claim         -> B : ${out.B.length}`);
out.B.forEach((x) => console.log(`      ${x.id.padEnd(14)} @${String(x.handle).padEnd(24)} "${x.snip.slice(0, 92)}"`));
console.log(`  names a supplier (recorded, not promoted) : ${out.supplier.length}`);
out.supplier.forEach((x) => console.log(`      ${x.id.padEnd(14)} @${String(x.handle).padEnd(24)} -> @${x.handle2}`));
console.log(`  says nothing about tea sourcing   : ${out.nothing.length}`);
writeFileSync("bio-grades.json", JSON.stringify(out, null, 2));
