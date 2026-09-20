"use client";

import { motion } from "framer-motion";

/* Chapter marks and captions — the landing page's two label tiers.

   This replaced six eyebrow treatments, and then replaced its own first draft.
   That draft kept the words: a hairline across the column, "02" at the left,
   "THE PROBLEM" at the right. It failed twice over.

   Visually, justify-between across a 1900px column leaves two 12px fragments
   marooned at opposite ends of a very long line. That is not a composition, it
   is two orphans, and no amount of type polish fixes a layout whose parts drift
   further apart the wider the screen gets.

   Editorially, the words were the weaker half. A label earns its place only
   when the heading beneath it is broad enough to need naming; when the heading
   is already short and concrete, the label just says it again with less force.
   Every chapter here fails that test — "The Problem" sits above "'Matcha.'
   That's the whole label. You read 'Japan' anyway.", which is the problem,
   stated far better than the word "problem" states it. "Classification System"
   sits above "4 levels of transparency". "Process" above "How we verify every
   cafe". Each label was an abstraction announcing a concrete sentence.

   What survives is the one thing the words never carried: position. A numeral
   alone is the oldest chapter mark there is, it reads as deliberate at any
   width because it is a single object, and running 01 through 06 down the page
   tells the reader how far through the argument they are.

     <ChapterMark n="02" tone="dark" className="text-center mb-10" />
     <Kicker tone="dark">Why It Happens</Kicker>

   Kicker is the other tier — words, no number — and it is for the places that
   genuinely need naming rather than numbering: the press strip ("As reported
   by", over logos that would otherwise be unexplained), and headings that sit
   inside a chapter rather than opening one. */

const EASE = [0.16, 1, 0.3, 1] as const;

type Tone = "light" | "dark" | "muted";

/* One ink per surface, so a section picks a tone and never a colour. Each is
   checked against the background it runs on: 7.5:1 for light on white, 9:1 for
   dark on #1a2318, 7.4:1 for muted on cream. Muted was #9ca3af, which measured
   2.5:1 and failed AA outright — survivable while these labels were 16px, not
   at the 12px they are now. */
const INK: Record<Tone, string> = {
  light: "#2e6027",
  dark:  "#7dd56f",
  muted: "#4b5563",
};

export default function ChapterMark({
  n,
  tone = "light",
  className = "",
}: {
  /** "01" … "06", in reading order down the page. */
  n: string;
  tone?: Tone;
  /** Alignment and spacing belong to the section, so they come from here. */
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      {/* Set at chapter scale, not label scale. At 12px a bare numeral reads as
          debris left on the page; at this size it reads as an opening, and it
          is still a quarter of the headline it introduces. The display serif
          and lining figures are the ones the rest of the page counts in.

          aria-hidden because it is a sighted reader's sense of position, not
          content: a screen reader announcing "two" before each heading adds a
          stray number to the document and tells nobody anything. The heading
          below carries the meaning, and the heading levels carry the structure. */}
      <span
        aria-hidden="true"
        className="font-display font-bold tabular-nums"
        style={{ fontSize: "clamp(22px, 2.1vw, 30px)", lineHeight: 1, color: INK[tone] }}
      >
        {n}
      </span>
    </motion.div>
  );
}

export function Kicker({
  children,
  tone = "light",
  className = "",
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`block uppercase font-semibold ${className}`}
      style={{ fontSize: "12px", letterSpacing: "0.18em", lineHeight: 1, color: INK[tone] }}
    >
      {children}
    </span>
  );
}
