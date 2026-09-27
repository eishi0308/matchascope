/**
 * Whether a crawl ever managed to read a cafe's page, and how it failed when it didn't.
 *
 * This was measure-coverage.mjs's private opinion until a second tool needed the same
 * answer. Two copies of "what counts as read" would not stay equal for long, and the cost
 * of them disagreeing is specific: the landing page divides by the figure this rule
 * produces, and a grade audit that used a slightly different rule would propose moving
 * exactly the cafes the two rules disagreed about.
 *
 * The state is not a boolean because the failures are not alike — a login wall is a cafe we
 * may yet read, an empty frame is one a browser pass can still recover, and a dead host is
 * neither. Only "read" means the page's own words were in hand.
 */
import { readFileSync, existsSync } from "node:fs";

/** Every file a crawl writes its per-cafe outcome to, oldest first. */
export const JOURNALS = [
  "deep-rendered.jsonl",
  "ig-rendered.jsonl",
  "rendered-final.jsonl",
  "nolink-found2.jsonl",
  "retry-blocked.jsonl",
  "ubereats.jsonl",
  // The shell sweep: cafes whose sites answered 200 with an empty frame, re-read in a
  // browser. Last, so where an older run recorded a cafe as simply unfetchable this run's
  // verdict — a shell that a browser could or could not recover — supersedes it.
  "shells-rendered.jsonl",
  // The error-and-stub retry: cafes whose first attempt timed out, errored, or
  // rendered under the shell threshold, given one more pass in a browser.
  "step2-rendered.jsonl",
  // Sites recovered by Places lookup for cafes that had no link recorded at all.
  "recovered-rendered.jsonl",
  // The 403 sweep: cafes whose sites refused a crawler pinned to Chrome/120.
  "blocked-rendered.jsonl",
];

/**
 * What counts as having read a page.
 *
 * A bare character count cannot tell a page from its frame. A Square Online store measured
 * here answered 200 with 77 KB of HTML whose entire visible text was "Home | Tori's", and a
 * rendered shell reaches a few hundred characters of navigation before its content paints —
 * both would clear a 200-character bar while disclosing nothing readable. So the text must
 * also mention the subject: same rule as ScraperService.looksUnread, kept in step with it.
 */
const SHELL_MAX = 150;   // below this the page is its own title
const CONTENT_SIGNAL = /matcha|tencha|gyokuro|sencha|hojicha|tea|origin|sourc|blend/i;

export const wasRead = (text) =>
  (text || "").trim().length >= SHELL_MAX && CONTENT_SIGNAL.test(text || "");

export function load(path) {
  const out = new Map();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.id) out.set(row.id, row);
    } catch {
      // A half-written last line from an interrupted crawl is not a reason to stop.
    }
  }
  return out;
}

export const loadJournals = () => JOURNALS.map(load);

/**
 * The outcome for one cafe: "read", "blockedByLogin", "unreadShell" or "couldNotFetch".
 *
 * Later journals supersede earlier ones: a retry that got through proves the cafe was never
 * absent, only throttled at the time, and a run that reads a page settles it outright.
 * Treating a stale "blocked" as final would keep reporting cafes as unreachable after they
 * had been reached.
 */
export function readState(journals, id) {
  let state = "couldNotFetch";
  for (const journal of journals) {
    const row = journal.get(id);
    if (!row) continue;
    if (wasRead(row.text)) return "read";
    // A fetch that returned text but not readable text is a shell, not a silent cafe.
    state = row.blocked ? "blockedByLogin"
          : (row.text || "").trim().length > 0 ? "unreadShell"
          : "couldNotFetch";
  }
  return state;
}
