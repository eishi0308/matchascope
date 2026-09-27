"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { levelConfig, TransparencyLevel } from "@/data/cafes";

const LEVELS: TransparencyLevel[] = ["A", "B", "C", "D"];
const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };
const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const PANEL_W = 300;

/** Short enough to sit on one line next to the count — levelConfig's own labels overflow. */
const BLURB: Record<TransparencyLevel, string> = {
  A: "Origin stated publicly",
  B: "Japan mentioned",
  C: "No origin given",
  D: "Not enough info",
};

const GAP = 8;
const MARGIN = 8;

interface Props {
  selected: TransparencyLevel[];
  onChange: (next: TransparencyLevel[]) => void;
  /** Counts per level, ignoring the level filter itself — so numbers stay stable while toggling. */
  counts: Record<string, number>;
  total: number;
}

/** Keeps selection in canonical A→D order regardless of click order. */
const order = (levels: TransparencyLevel[]) => LEVELS.filter((l) => levels.includes(l));

export default function LevelFilter({ selected, onChange, counts, total }: Props) {
  const [open, setOpen]     = useState(false);
  const [cursor, setCursor] = useState(0); // 0 = "All levels", 1–4 = A–D
  const [pos, setPos]       = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(PANEL_W, window.innerWidth - MARGIN * 2);
    setPos({
      top: r.bottom + GAP,
      left: Math.min(Math.max(r.left, MARGIN), window.innerWidth - width - MARGIN),
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  // Outside click / tap closes
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  const toggle = (lvl: TransparencyLevel) =>
    onChange(order(selected.includes(lvl) ? selected.filter((l) => l !== lvl) : [...selected, lvl]));

  const close = () => { setOpen(false); triggerRef.current?.focus(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape")            { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown")    { e.preventDefault(); setCursor((c) => (c + 1) % 5); }
    else if (e.key === "ArrowUp")      { e.preventDefault(); setCursor((c) => (c + 4) % 5); }
    else if (e.key === "Home")         { e.preventDefault(); setCursor(0); }
    else if (e.key === "End")          { e.preventDefault(); setCursor(4); }
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cursor === 0 ? onChange([]) : toggle(LEVELS[cursor - 1]);
    } else if (/^[abcd]$/i.test(e.key)) {
      e.preventDefault();
      const lvl = e.key.toUpperCase() as TransparencyLevel;
      setCursor(LEVELS.indexOf(lvl) + 1);
      toggle(lvl);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const active  = selected.length > 0;
  const summary = selected.length === 0
    ? "All Levels"
    : selected.length === 1
      ? `${selected[0]} — ${levelConfig[selected[0]].verdict}`
      : `${selected.length} Levels`;

  const row = (
    key: string,
    idx: number,
    isSelected: boolean,
    onClick: () => void,
    chip: React.ReactNode,
    title: string,
    sub: string,
    count: number,
    accent: string,
  ) => (
    <motion.button
      key={key}
      role="option"
      aria-selected={isSelected}
      onClick={onClick}
      onPointerEnter={() => setCursor(idx)}
      className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left outline-none"
      animate={{ background: isSelected ? "#f4f9f1" : cursor === idx ? "#f7f7f7" : "transparent" }}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.12 }}
    >
      {chip}
      <div className="flex-1 min-w-0">
        <div className="text-[16px] font-semibold text-gray-800 truncate leading-tight">{title}</div>
        <div className="text-[16px] text-gray-400 truncate leading-tight mt-0.5">{sub}</div>
      </div>
      <span className="text-[16px] font-semibold tabular-nums text-gray-400 flex-shrink-0">{count}</span>
      <span
        className="w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center"
        style={{
          background: isSelected ? accent : "transparent",
          border: isSelected ? `1.5px solid ${accent}` : "1.5px solid #e5e7eb",
        }}
      >
        <AnimatePresence>
          {isSelected && (
            <motion.span
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={SPRING}
              className="flex"
            >
              <Check size={13} strokeWidth={3.5} color="#ffffff" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  );

  return (
    <div className="relative flex-shrink-0">
      <motion.button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 pl-3 pr-2.5 py-2 sm:py-2.5 rounded-xl text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-matcha-200 cursor-pointer whitespace-nowrap"
        animate={{
          background: active ? "#e6f4e0" : open ? "#ececec" : "#f3f4f6",
          color:      active ? "#2e6027" : "#374151",
        }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        transition={SPRING}
      >
        {/* Stacked colour dots for the current selection */}
        <AnimatePresence initial={false}>
          {active && (
            <motion.span
              className="flex items-center"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              {selected.map((lvl, i) => (
                <motion.span
                  key={lvl}
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    background: levelConfig[lvl].color,
                    boxShadow: "0 0 0 1.5px #e6f4e0",
                    marginLeft: i === 0 ? 0 : -4,
                    zIndex: 10 - i,
                  }}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={SPRING}
                />
              ))}
            </motion.span>
          )}
        </AnimatePresence>

        <span className="font-medium">{summary}</span>

        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="flex">
          <ChevronDown size={13} className={active ? "text-matcha-700" : "text-gray-400"} />
        </motion.span>
      </motion.button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={panelRef}
              role="listbox"
              aria-multiselectable
              aria-label="Transparency levels"
              tabIndex={-1}
              onKeyDown={onKeyDown}
              className="fixed z-[1000] rounded-2xl overflow-hidden outline-none"
              style={{
                top: pos.top,
                left: pos.left,
                width: Math.min(PANEL_W, typeof window !== "undefined" ? window.innerWidth - MARGIN * 2 : PANEL_W),
                background: "rgba(255,255,255,0.97)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(0,0,0,0.07)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.14), 0 4px 12px rgba(0,0,0,0.06)",
                transformOrigin: "top left",
              }}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
                <span className="text-[16px] uppercase tracking-widest text-gray-400 font-semibold">
                  Transparency
                </span>
                <AnimatePresence>
                  {active && (
                    <motion.button
                      onClick={() => onChange([])}
                      className="text-[16px] font-medium text-matcha-700 hover:underline"
                      initial={{ opacity: 0, x: 6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 6 }}
                      transition={{ duration: 0.15 }}
                    >
                      Reset
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>

              <div className="px-1.5 pb-1.5">
                {row(
                  "all",
                  0,
                  !active,
                  () => onChange([]),
                  <span className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center bg-white border border-gray-200">
                    <span className="grid grid-cols-2 gap-[2px]">
                      {LEVELS.map((l) => (
                        <span key={l} className="w-1.5 h-1.5 rounded-full" style={{ background: levelConfig[l].color }} />
                      ))}
                    </span>
                  </span>,
                  "All Levels",
                  "No level filter",
                  total,
                  "#2e6027",
                )}

                <div className="my-1 mx-2.5 h-px bg-gray-100" />

                {LEVELS.map((lvl, i) => {
                  const cfg = levelConfig[lvl];
                  return row(
                    lvl,
                    i + 1,
                    selected.includes(lvl),
                    () => toggle(lvl),
                    <span
                      className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[16px] font-bold text-white"
                      style={{ background: cfg.color }}
                    >
                      {lvl}
                    </span>,
                    cfg.verdict,
                    BLURB[lvl],
                    counts[lvl] ?? 0,
                    cfg.color,
                  );
                })}
              </div>

              <div className="px-3.5 py-2 border-t border-gray-100 bg-white/60">
                <span className="text-[16px] text-gray-400">
                  Select as many levels as you like — <kbd className="font-semibold text-gray-500">A</kbd>–
                  <kbd className="font-semibold text-gray-500">D</kbd> to toggle.
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
