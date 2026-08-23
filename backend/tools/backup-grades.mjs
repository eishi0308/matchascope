/**
 * Capture every cafe's grading state as a runnable SQL restore, before a regrade.
 *
 * A regrade rewrites level, cover colour and the whole evidence block in place. There is no
 * undo, and the same fields feed the disclosure rate quoted across the site, so a run that
 * turns out to be wrong has to be reversible by more than memory. This writes the current
 * state as UPDATE statements wrapped in a transaction — the same shape as the backups taken
 * before the earlier regrades in this directory.
 *
 * Usage:  node backup-grades.mjs ../data/backup_before_<name>.sql "<one-line reason>"
 */
import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const outPath = process.argv[2];
const reason = process.argv[3] || "regrade";
if (!outPath) {
  console.error('usage: node backup-grades.mjs <out.sql> "<reason>"');
  process.exit(1);
}

/** Postgres string literal, or NULL. Single quotes double up; nothing else needs escaping here. */
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const FIELDS = [
  "id", "level", "cover_color", "evidence_quote", "evidence_source",
  "evidence_source_label", "evidence_verified_date", "description", "tagline",
];

const cafes = [];
for (let offset = 0; ; offset += 500) {
  const url =
    `${SUPABASE_URL}/rest/v1/cafes?select=${FIELDS.join(",")}&order=id.asc&offset=${offset}&limit=500`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  const batch = await res.json();
  if (!Array.isArray(batch)) {
    console.error("unexpected response:", JSON.stringify(batch).slice(0, 200));
    process.exit(1);
  }
  if (batch.length === 0) break;
  cafes.push(...batch);
  if (batch.length < 500) break;
}

const lines = [
  `-- Grading state before: ${reason}`,
  `-- Captured ${new Date().toISOString().slice(0, 10)}. Restores level and every evidence field.`,
  "BEGIN;",
];
for (const c of cafes) {
  lines.push(
    `UPDATE cafes SET level=${lit(c.level)}, cover_color=${lit(c.cover_color)}, ` +
      `evidence_quote=${lit(c.evidence_quote)}, evidence_source=${lit(c.evidence_source)}, ` +
      `evidence_source_label=${lit(c.evidence_source_label)}, ` +
      `evidence_verified_date=${lit(c.evidence_verified_date)}, ` +
      `description=${lit(c.description)}, tagline=${lit(c.tagline)} WHERE id=${lit(c.id)};`
  );
}
lines.push("COMMIT;");

writeFileSync(outPath, lines.join("\n") + "\n");

const byLevel = {};
for (const c of cafes) byLevel[c.level] = (byLevel[c.level] ?? 0) + 1;
console.log(`backed up ${cafes.length} cafes -> ${outPath}`);
console.log("levels at capture:", byLevel);
