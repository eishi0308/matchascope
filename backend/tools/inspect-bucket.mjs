/** Show the actual page text behind a triage bucket, so a rule can be checked
 *  against real pages instead of trusted because it ran without error. */
import { readFileSync, existsSync } from "node:fs";
const JOURNALS = ["deep-rendered.jsonl","ig-rendered.jsonl","rendered-final.jsonl","nolink-found2.jsonl","retry-blocked.jsonl","ubereats.jsonl","shells-rendered.jsonl"];
const text = new Map();
for (const f of JOURNALS) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.id) text.set(r.id, r); } catch {}
  }
}
const rows = readFileSync("triage-unread.jsonl","utf8").split("\n").filter(Boolean).map(JSON.parse);
const bucket = process.argv[2];
const n = Number(process.argv[3] || 6);
const pick = rows.filter(r => r.bucket === bucket);
// spread the sample across the list rather than taking the head, which is alphabetical
const step = Math.max(1, Math.floor(pick.length / n));
for (let i = 0; i < pick.length && i / step < n; i += step) {
  const r = pick[i], j = text.get(r.id) || {};
  const t = (j.text || "").replace(/\s+/g, " ").trim();
  console.log(`\n── ${r.id}  [${r.level}]  ${r.name}`);
  console.log(`   url   : ${j.url || r.website || "(none)"}`);
  console.log(`   why   : ${r.why}   (${r.chars} chars)`);
  console.log(`   text  : ${t.slice(0, 260)}`);
}
console.log(`\n(${pick.length} in bucket "${bucket}")`);
