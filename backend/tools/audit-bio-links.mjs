/**
 * Instagram bios carry the cafe's real website. We recorded the profile as the page and
 * never followed the link out of it.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
const JOURNALS = ["deep-rendered.jsonl","ig-rendered.jsonl","rendered-final.jsonl","nolink-found2.jsonl","retry-blocked.jsonl","ubereats.jsonl","shells-rendered.jsonl"];
const J = new Map();
for (const f of JOURNALS) { if (!existsSync(f)) continue;
  for (const l of readFileSync(f,"utf8").split("\n")) { if(!l.trim())continue; try{const r=JSON.parse(l); if(r.id)J.set(r.id,r);}catch{} } }
const rows = readFileSync("triage-unread.jsonl","utf8").split("\n").filter(Boolean).map(JSON.parse);
const SOCIAL = /instagram\.com|facebook\.com|fb\.com|tiktok\.com/i;

// Instagram renders its own footer on every profile; anything after it is Meta's, not
// the cafe's. Cut it before looking for a domain or every profile "links" to meta.com.
const CHROME = /Meta About Blog Jobs Help API Privacy Terms[\s\S]*$/;
// A bare domain in bio text: "liarliarcafe.com", "www.bicyclethievescafe.com.au"
const DOMAIN = /\b(?:www\.)?([a-z0-9][a-z0-9-]{1,60}\.(?:com|com\.au|net\.au|co|cafe|au|net|org|shop|store|menu|site|xyz|space))\b/gi;
const IGNORE = /^(instagram|facebook|meta|threads|linktr|linktree|bit|tinyurl|goo|maps|google|apple|youtube|tiktok|twitter|x|whatsapp|gmail|hotmail|outlook|yahoo|icloud|wa|fb|ig)\./i;

const found = [];
let socialTotal = 0, noDomain = 0, sameAsRecorded = 0;
for (const r of rows) {
  if (r.bucket === "read") continue;
  const j = J.get(r.id) || {};
  const url = j.url || r.website || "";
  if (!SOCIAL.test(url)) continue;
  socialTotal++;
  const bio = (j.text || "").replace(CHROME, "").replace(/\s+/g, " ");
  const hits = [...new Set((bio.match(DOMAIN) || []).map((d) => d.replace(/^www\./i, "").toLowerCase()))]
    .filter((d) => !IGNORE.test(d));
  if (!hits.length) { noDomain++; continue; }
  const recorded = (r.website || "").toLowerCase();
  const fresh = hits.filter((d) => !recorded.includes(d));
  if (!fresh.length) { sameAsRecorded++; continue; }
  found.push({ id: r.id, name: r.name, level: r.level, bucket: r.bucket, profile: url, sites: fresh });
}
console.log(`cafes whose recorded page is a social profile : ${socialTotal}`);
console.log(`  bio contains no website at all             : ${noDomain}`);
console.log(`  bio site is the one already recorded       : ${sameAsRecorded}`);
console.log(`  bio names a site we have NOT read          : ${found.length}   <- recoverable`);
const byBucket = {};
for (const f of found) byBucket[f.bucket] = (byBucket[f.bucket] || 0) + 1;
console.log("\n  by current bucket:", JSON.stringify(byBucket));
console.log("\n  sample:");
for (const f of found.slice(0, 8)) console.log(`    ${f.id.padEnd(14)} [${f.level}] ${f.name.slice(0,30).padEnd(31)} -> ${f.sites.join(", ")}`);
writeFileSync("bio-sites.json", JSON.stringify(found, null, 2));
console.log(`\nwrote bio-sites.json (${found.length} cafes)`);
