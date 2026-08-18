"use client";

import { Heart } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useFavorite } from "@/lib/favorites";

interface Props {
  id: string;
  name: string;
  size?: number;
  /** "light" = sits on a white/pale card (default). "dark" = sits on a colour/gradient
   *  header, where the resting state needs to read against anything from cream to forest. */
  variant?: "light" | "dark";
  className?: string;
}

const SPRING = { type: "spring" as const, stiffness: 500, damping: 18 };

// Six-point burst on save — same idea as the platforms this button is modelled on
// (Twitter/X's like button), scaled down. Skipped entirely under reduced-motion.
const BURST_ANGLES = [0, 60, 120, 180, 240, 300];

export default function FavoriteButton({ id, name, size = 18, variant = "light", className = "" }: Props) {
  const [saved, toggle] = useFavorite(id);
  const reduceMotion = useReducedMotion();

  const restBg   = variant === "dark" ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.05)";
  const hoverBg  = variant === "dark" ? "rgba(0,0,0,0.32)" : "rgba(220,38,38,0.08)";
  const restColor = variant === "dark" ? "rgba(255,255,255,0.85)" : "#9ca3af";

  return (
    <motion.button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from saved cafes` : `Save ${name} to your list`}
      className={`relative flex items-center justify-center rounded-full flex-shrink-0 ${className}`}
      style={{ width: size + 20, height: size + 20 }}
      animate={{ backgroundColor: saved ? "rgba(220,38,38,0.1)" : restBg }}
      whileHover={{ backgroundColor: saved ? "rgba(220,38,38,0.16)" : hoverBg, scale: 1.06 }}
      whileTap={{ scale: 0.88 }}
      transition={{ duration: 0.15 }}
    >
      <motion.span
        key={saved ? "on" : "off"}
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={SPRING}
        className="flex"
      >
        <Heart
          size={size}
          fill={saved ? "#dc2626" : "none"}
          stroke={saved ? "#dc2626" : restColor}
          strokeWidth={2}
        />
      </motion.span>

      {!reduceMotion && (
        <AnimatePresence>
          {saved && (
            <motion.span
              key="burst"
              className="absolute inset-0 pointer-events-none"
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
            >
              {BURST_ANGLES.map((angle) => (
                <motion.span
                  key={angle}
                  className="absolute top-1/2 left-1/2 rounded-full"
                  style={{ width: 3, height: 3, background: "#dc2626" }}
                  initial={{ x: "-50%", y: "-50%", opacity: 1, scale: 1 }}
                  animate={{
                    x: `calc(-50% + ${Math.cos((angle * Math.PI) / 180) * (size + 6)}px)`,
                    y: `calc(-50% + ${Math.sin((angle * Math.PI) / 180) * (size + 6)}px)`,
                    opacity: 0,
                    scale: 0.4,
                  }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                />
              ))}
            </motion.span>
          )}
        </AnimatePresence>
      )}
    </motion.button>
  );
}
