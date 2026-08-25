/**
 * For every cafe that has not been read: what resource did we have, and what happened
 * when we tried it. Writes a browsable CSV alongside the summary.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const JOURNALS = ["deep-rendered.jsonl","ig-rendered.jsonl","rendered-final.jsonl","nolink-found2.jsonl",
  "retry-blocked.jsonl","ubereats.jsonl","shells-rendered.jsonl","step2-rendered.jsonl","recovered-rendered.jsonl"];
const J = new Map();
for (const f of JOURNALS) { if (!existsSync(f)) continue;
  for (const l of readFileSync(f, "utf8").split("\n")) { if (!l.trim()) continue; try { const r = JSON.parse(l); if (r.id) J.set(r.id, r); } catch {} } }

const U = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = new Map();
for (let o = 0; ; o += 500) {
  const r = await fetch(`${U}/rest/v1/cafes?select=id,name,city,suburb,website,level&order=id.asc&offset=${o}&limit=500`,
    { headers: { apikey: K, Authorization: `Bearer ${K}` } });
  const b = await r.json(); if (!Array.isArray(b) || !b.length) break;
  b.forEach((c) => db.set(c.id, c)); if (b.length < 500) break;
}

const rows = readFileSync("triage-unread.jsonl", "utf8").split("\n").filter(Boolean).map(JSON.parse);
const SOCIAL = /instagram\.com|facebook\.com|tiktok\.com/i;
const DELIVERY = /ubereats|doordash|menulog|deliveroo/i;

/** What we actually had to look at. */
function resource(c, j) {
  const url = j?.url || c.website || "";
  if (!url) return "nothing recorded";
  if (SOCIAL.test(url)) return "social profile only";
  if (DELIVERY.test(url)) return "delivery listing only";
  return "own website";
}

const REASON = {
  "no-page":       "the link fetched nothing — dead host, DNS failure or 404",
  "login-wall":    "Instagram/Facebook demanded a login",
  "fetch-error":   "the request timed out or errored",
  "shell":         "the page rendered, but produced almost no text",
  "placeholder":   "the page exists but is not open yet (coming soon / parked)",
  "no-topic-real": "a real page was read, and it never mentions tea",
  "no-topic-thin": "text came back, but no tea word and no sign of a business page",
};

const out = [];
const grid = {};
for (const r of rows) {
  if (r.bucket === "read") continue;
  const c = db.get(r.id) || {};
  const j = J.get(r.id);
  const res = resource(c, j);
  grid[r.bucket] ??= {};
  grid[r.bucket][res] = (grid[r.bucket][res] || 0) + 1;
  out.push({ id: r.id, name: c.name, city: c.city, level: c.level, resource: res,
    reason: REASON[r.bucket] || r.bucket, bucket: r.bucket, url: j?.url || c.website || "" });
}

const RES = ["own website", "social profile only", "delivery listing only", "nothing recorded"];
const order = ["no-page", "login-wall", "fetch-error", "shell", "placeholder", "no-topic-real", "no-topic-thin"];
console.log(`${out.length} cafes not read\n`);
console.log("what we had  →".padEnd(16) + RES.map((r) => r.padStart(21)).join("") + "     total");
for (const b of order) {
  if (!grid[b]) continue;
  const t = RES.reduce((a, r) => a + (grid[b][r] || 0), 0);
  console.log(b.padEnd(16) + RES.map((r) => String(grid[b][r] || "·").padStart(21)).join("") + String(t).padStart(10));
}
const tot = RES.map((r) => order.reduce((a, b) => a + ((grid[b] || {})[r] || 0), 0));
console.log("".padEnd(16) + tot.map((n) => String(n).padStart(21)).join("") + String(out.length).padStart(10));

const csv = ["id,name,city,level,resource,reason,url",
  ...out.map((r) => [r.id, r.name, r.city, r.level, r.resource, r.reason, r.url]
    .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))];
writeFileSync("why-unread.csv", csv.join("\n") + "\n");
console.log(`\nwrote why-unread.csv (${out.length} rows)`);
