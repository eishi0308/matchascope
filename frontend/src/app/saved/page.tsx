"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Heart, MapPin, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Navbar from "@/components/Navbar";
import FavoriteButton from "@/components/FavoriteButton";
import { useFavoriteIds } from "@/lib/favorites";
import { Cafe, levelConfig } from "@/data/cafes";
import { fetchCafes } from "@/lib/api";
import { cafeUrl } from "@/lib/slug";

const EASE = [0.25, 0.46, 0.45, 0.94] as const;
const SPRING = { type: "spring" as const, stiffness: 300, damping: 28 };

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 380, damping: 30 } },
};

export default function SavedPage() {
  const favoriteIds = useFavoriteIds();

  const [cafes, setCafes]     = useState<Cafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Same fetch /map already makes — filtered down client-side to whatever's saved,
  // rather than re-fetching per id. useFavoriteIds() re-renders this on every
  // toggle (its own custom event), so the list updates immediately either way.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchCafes();
        if (!cancelled) setCafes(data);
      } catch (err) {
        console.error("[Saved page load error]", err);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saved = useMemo(
    () => cafes.filter((c) => favoriteIds.has(c.id)),
    [cafes, favoriteIds],
  );

  return (
    <div className="min-h-screen bg-cream-50">
      <Navbar />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-28 pb-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mb-10"
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-red-50 flex-shrink-0">
              <Heart size={16} fill="#dc2626" stroke="#dc2626" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-display font-semibold text-gray-900">
              Your Saved Cafes
            </h1>
          </div>
          <p className="text-[16px] text-gray-500 max-w-lg">
            {loading
              ? "Loading your list…"
              : saved.length === 0
                ? "Nothing here yet — cafes you save from the map show up on this page."
                : `${saved.length} cafe${saved.length === 1 ? "" : "s"} you've kept for later.`}
          </p>
        </motion.div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <motion.div
              className="w-10 h-10 rounded-full border-2 border-matcha-500 border-t-transparent"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
            />
          </div>
        )}

        {/* Error */}
        {!loading && loadError && (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
            <p className="text-[16px] text-gray-500">Couldn&apos;t load your saved cafes right now.</p>
            <p className="text-[16px] text-gray-400">Try refreshing the page.</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !loadError && saved.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5, ease: EASE }}
            className="flex flex-col items-center justify-center text-center py-24 px-6 rounded-3xl bg-white shadow-card"
          >
            <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-5">
              <Heart size={26} className="text-gray-300" />
            </div>
            <h2 className="text-xl font-display font-semibold text-gray-800 mb-1.5">No saved cafes yet</h2>
            <p className="text-[16px] text-gray-400 max-w-xs mb-6">
              Tap the heart on any cafe on the map to keep it here for later.
            </p>
            <Link href="/map">
              <motion.span
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-[16px] font-semibold text-white"
                style={{ background: "linear-gradient(135deg, #2e6027, #4d9740)", boxShadow: "0 4px 16px rgba(46,96,39,0.35)" }}
                whileHover={{ scale: 1.04, boxShadow: "0 6px 24px rgba(46,96,39,0.45)" } as any}
                whileTap={{ scale: 0.97 }}
              >
                Explore the map
                <ArrowRight size={14} />
              </motion.span>
            </Link>
          </motion.div>
        )}

        {/* Grid */}
        {!loading && !loadError && saved.length > 0 && (
          <motion.div
            variants={gridVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            <AnimatePresence mode="popLayout">
              {saved.map((cafe) => {
                const cfg = levelConfig[cafe.level];
                return (
                  <motion.div
                    key={cafe.id}
                    variants={cardVariants}
                    exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
                    layout
                    whileHover={{ y: -3 }}
                    transition={SPRING}
                    className="relative rounded-2xl bg-white shadow-card hover:shadow-card-hover transition-shadow overflow-hidden"
                  >
                    {/* Sits outside the Link below — a <button> can't nest inside an <a> */}
                    <div className="absolute top-3 right-3 z-10">
                      <FavoriteButton id={cafe.id} name={cafe.name} size={14} />
                    </div>

                    <Link href={cafeUrl(cafe)} className="block p-5 pr-14">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-[16px] font-bold text-white mb-3"
                        style={{ background: cfg.color }}
                      >
                        {cafe.level}
                      </div>

                      <h3 className="text-[16px] font-semibold text-gray-900 mb-1 truncate">{cafe.name}</h3>
                      <div className="flex items-center gap-1 mb-2">
                        <MapPin size={11} className="text-gray-400 flex-shrink-0" />
                        <span className="text-[16px] text-gray-400 truncate">{cafe.suburb}, {cafe.city}</span>
                      </div>
                      {cafe.tagline && (
                        <p className="text-[16px] text-gray-500 line-clamp-2 mb-3">{cafe.tagline}</p>
                      )}

                      <span
                        className="inline-flex text-[16px] font-medium px-2.5 py-1 rounded-full"
                        style={{ background: cfg.bg, color: cfg.color }}
                      >
                        {cfg.shortLabel}
                      </span>
                    </Link>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}
