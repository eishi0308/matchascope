"use client";

import { motion, useReducedMotion } from "framer-motion";
import { TransparencyLevel, levelConfig } from "@/data/cafes";

const ORDER: TransparencyLevel[] = ["A", "B", "C", "D"];

/**
 * The whole scale, with this cafe's place on it marked.
 *
 * A lone badge reading "Level D" only means something to a reader who already knows the
 * scale runs A to D and which end is the good one, and nothing on the page said so. The
 * evidence on labelled scales is consistent: fully labelled beats partially labelled on
 * reliability and validity, and the gap is widest for the readers least familiar with the
 * scheme, which here is everyone arriving for the first time. Every graded system built
 * for the public shows the ladder rather than the rung.
 *
 * Direction is carried by the rail beneath, not by the letters. Tinting each letter with
 * its own level colour was the obvious way to show that A is the good end, and it does not
 * survive being measured: on their own tints B, C and D all fall under 4.5:1, and the four
 * backgrounds are not even monotonic in lightness, so the "ramp" would run darker at B than
 * at A. The rail is decoration and can be as pale as it likes, because the grade is already
 * carried three ways that do not depend on it: the letter, the position, and the sentence.
 */
export default function LevelScale({
  level,
  size = "md",
  showMeaning = true,
  className = "",
}: {
  level: TransparencyLevel;
  size?: "sm" | "md";
  showMeaning?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const cfg = levelConfig[level];

  // Nothing here drops below the 16px this site holds itself to elsewhere. The first
  // version set the grade's own name at 13px and its meaning at 14px, which made the one
  // thing the reader came for the smallest text in the panel.
  const dim =
    size === "sm"
      ? { box: 34, font: 17, gap: 6, grow: 1.26, label: 17, meaning: 16 }
      : { box: 40, font: 20, gap: 7, grow: 1.25, label: 19, meaning: 17 };

  const activeBox = Math.round(dim.box * dim.grow);

  return (
    <div className={className}>
      <div
        className="flex items-center"
        style={{ gap: dim.gap, minHeight: activeBox }}
        role="img"
        aria-label={`Transparency level ${level} of A to D, where A discloses most: ${cfg.shortLabel}. ${cfg.description}`}
      >
        <div className="flex flex-col" style={{ gap: 5 }}>
          <div className="flex items-center" style={{ gap: dim.gap }}>
            {ORDER.map((l) => {
              const active = l === level;
              const box = active ? activeBox : dim.box;
              return (
                <div key={l} className="relative flex-none" style={{ width: box, height: box }}>
                  {active && (
                    <motion.span
                      layoutId={`level-scale-${level}`}
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background: levelConfig[l].headerBg,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.16)",
                      }}
                      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span
                    className="absolute inset-0 grid place-items-center rounded-xl font-bold"
                    style={{
                      fontSize: active ? Math.round(dim.font * 1.12) : dim.font,
                      // 4.83:1 on white. The first version used #9aa0a6 at 2.64:1, which is
                      // a legibility failure on characters that carry the scale itself.
                      color: active ? levelConfig[l].headerText : "#6b7280",
                      border: active ? "none" : "1.5px solid #e2e4e7",
                      background: active ? "transparent" : "#ffffff",
                    }}
                  >
                    {l}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Which way is up. Purely decorative, so it is free to be subtle. */}
          <span
            aria-hidden="true"
            className="rounded-full"
            style={{
              height: 3,
              background: "linear-gradient(90deg, #2e6027 0%, #6eb35c 34%, #9ca3af 70%, #e5e7eb 100%)",
            }}
          />
        </div>

        <span className="ml-1 font-bold" style={{ fontSize: dim.label, color: "#1f2937" }}>
          {cfg.shortLabel}
        </span>
      </div>

      {showMeaning && (
        <p className="mt-2.5 leading-snug text-pretty" style={{ fontSize: dim.meaning, color: "#4b5563" }}>
          {cfg.description}
        </p>
      )}
    </div>
  );
}
