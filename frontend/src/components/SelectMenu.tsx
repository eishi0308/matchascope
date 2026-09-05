"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";

/**
 * A single-choice filter that draws its own menu.
 *
 * These were native <select> elements. The trigger was styled, but the list a select
 * opens is drawn by the operating system and cannot be styled at all — on macOS that is
 * a dark grey panel with a blue highlight, sitting beside a light, rounded, matcha-green
 * toolbar. The control immediately to its left, LevelFilter, already opened a real
 * listbox in the site's own language, so the bar was showing two different answers to the
 * same question depending on which filter you pressed.
 *
 * Everything here is deliberately the same as LevelFilter: the same trigger shape and
 * colours, the same portalled panel, the same spring, the same keys. A second popover
 * implementation that merely looked similar would drift the first time either changed.
 *
 * Portalled rather than absolutely positioned, because the filter bar is a horizontal
 * scroller — `overflow-x-auto` clips its own children, so a menu anchored inside it would
 * be cut off at the bar's edge and would scroll away from its trigger.
 */

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };
const EASE = [0.25, 0.46, 0.45, 0.94] as const;
const GAP = 8;
const MARGIN = 8;
const MIN_W = 190;

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export default function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  label,
  neutralValue,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  /** Names the control for a screen reader — "City", "Type". Never rendered. */
  label: string;
  /** The option that counts as "no filter applied", so the trigger can go quiet. */
  neutralValue: T;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Type-ahead: "mel" jumps to Melbourne, the way a real select does.
  const typed = useRef({ buf: "", at: 0 });

  const active = value !== neutralValue;
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selectedIndex]?.label ?? "";

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(MIN_W, Math.min(r.width, window.innerWidth - MARGIN * 2));
    setPos({
      top: r.bottom + GAP,
      left: Math.min(Math.max(r.left, MARGIN), window.innerWidth - width - MARGIN),
      width,
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  // The bar scrolls sideways and the page scrolls down; a fixed panel has to follow.
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Open onto the current choice, not the top of the list.
  useEffect(() => {
    if (!open) return;
    setCursor(selectedIndex);
    panelRef.current?.focus();
  }, [open, selectedIndex]);

  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const pick = (i: number) => { onChange(options[i].value); close(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = options.length;
    if (e.key === "Escape")             { e.preventDefault(); close(); }
    else if (e.key === "Tab")           { close(); }
    else if (e.key === "ArrowDown")     { e.preventDefault(); setCursor((c) => (c + 1) % n); }
    else if (e.key === "ArrowUp")       { e.preventDefault(); setCursor((c) => (c - 1 + n) % n); }
    else if (e.key === "Home")          { e.preventDefault(); setCursor(0); }
    else if (e.key === "End")           { e.preventDefault(); setCursor(n - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(cursor); }
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      e.preventDefault();
      const now = Date.now();
      typed.current.buf = now - typed.current.at > 700 ? e.key : typed.current.buf + e.key;
      typed.current.at = now;
      const q = typed.current.buf.toLowerCase();
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(q));
      if (hit > -1) setCursor(hit);
    }
  };

  const optionId = (i: number) => `${label.replace(/\s+/g, "-").toLowerCase()}-opt-${i}`;

  return (
    <div className="relative flex-shrink-0">
      <motion.button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          // A closed combobox opens on the same keys that move a native select.
          if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
            e.preventDefault(); setOpen(true);
          }
        }}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current}`}
        className="flex items-center gap-2 pl-3.5 pr-2.5 h-10 sm:h-11 rounded-xl text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-matcha-200 cursor-pointer whitespace-nowrap"
        animate={{
          background: active ? "#e6f4e0" : open ? "#ececec" : "#f3f4f6",
          color:      active ? "#2e6027" : "#374151",
        }}
        whileHover={reduce ? undefined : { scale: 1.02 }}
        whileTap={reduce ? undefined : { scale: 0.97 }}
        transition={SPRING}
      >
        {current}
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING}
          style={{ display: "flex" }}
        >
          <ChevronDown size={14} style={{ opacity: 0.65 }} />
        </motion.span>
      </motion.button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={panelRef}
              role="listbox"
              aria-label={label}
              aria-activedescendant={optionId(cursor)}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              className="fixed z-[1000] rounded-2xl overflow-hidden outline-none p-1.5"
              style={{
                top: pos.top,
                left: pos.left,
                width: pos.width,
                background: "rgba(255,255,255,0.97)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(0,0,0,0.07)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.14), 0 4px 12px rgba(0,0,0,0.06)",
                transformOrigin: "top left",
              }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: reduce ? 0 : 0.18, ease: EASE }}
            >
              {options.map((o, i) => {
                const isSelected = o.value === value;
                const isCursor = i === cursor;
                return (
                  <button
                    key={o.value}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    type="button"
                    // Pointer, not mouse: the cursor should follow a finger dragging down
                    // the list as well as a mouse moving over it.
                    onPointerEnter={() => setCursor(i)}
                    onClick={() => pick(i)}
                    className="w-full flex items-center justify-between gap-3 h-11 px-3 rounded-xl text-[16px] text-left transition-colors"
                    style={{
                      background: isCursor ? (isSelected ? "#e6f4e0" : "#f3f4f6") : "transparent",
                      color: isSelected ? "#2e6027" : "#374151",
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >
                    {o.label}
                    {/* The tick is what says "selected"; the tint only says "your cursor
                        is here", and the two have to stay separable or a keyboard user
                        cannot tell what is chosen from what is merely highlighted. */}
                    <Check
                      size={16}
                      style={{ opacity: isSelected ? 1 : 0, flex: "none" }}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
