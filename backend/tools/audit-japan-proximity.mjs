/**
 * "Japanese" appearing on a cafe page is not evidence about the matcha.
 *
 * Level B means "says the matcha is Japanese". The retry pass surfaced four pages that
 * contain the word and disclose nothing: a Japanese-style potato salad, a cozy corner of
 * Japan, a Korean-Japanese fusion menu, and a shabu shabu restaurant. Each describes the
 * kitchen, not the tea. A rule that only asks whether the word is present cannot tell
 * those from a real disclosure, so this measures how far apart the two words sit.
 */
import { readFileSync, existsSync } from "node:fs";

const TEA = /\b(matcha|tencha|gyokuro|sencha|hojicha|houjicha|green tea)\b/gi;
const JP  = /\b(japan|japanese|nihon)\b/gi;

/** Closest gap, in characters, between any tea word and any Japan word. */
function closestGap(text) {
  const t = text.replace(/\s+/g, " ");
  const teas = [...t.matchAll(TEA)].map((m) => m.index);
  const jps  = [...t.matchAll(JP)].map((m) => m.index);
  if (!teas.length || !jps.length) return null;
  let best = Infinity, at = null;
  for (const a of teas) for (const b of jps) {
    const d = Math.abs(a - b);
    if (d < best) { best = d; at = Math.min(a, b); }
  }
  return { gap: best, snippet: t.slice(Math.max(0, at - 50), at + 130).trim() };
}

const files = process.argv.slice(2);
for (const f of files) {
  if (!existsSync(f)) continue;
  console.log(`\n=== ${f} ===`);
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const t = (r.text || "");
    if (!JP.test(t)) { JP.lastIndex = 0; continue; }
    JP.lastIndex = 0;
    const c = closestGap(t);
    const verdict = c === null ? "NO TEA WORD ON PAGE — cannot be about matcha"
      : c.gap <= 60 ? `adjacent (${c.gap}ch) — plausible disclosure`
      : `${c.gap}ch apart — the two words are unrelated`;
    console.log(`  ${(r.id || "?").padEnd(14)} ${verdict}`);
    if (c) console.log(`      ...${c.snippet.slice(0, 150)}...`);
  }
}
