"use client";

import dynamic from "next/dynamic";
import { useRouter, usePathname } from "next/navigation";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Search, SlidersHorizontal, X, ChevronDown, Check, MapPin, List, Map, AlertTriangle, RefreshCw, Heart } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import Navbar from "@/components/Navbar";
import CafeDetailPanel from "@/components/CafeDetailPanel";
import LevelFilter from "@/components/LevelFilter";
import FavoriteButton from "@/components/FavoriteButton";
import { useFavoriteIds } from "@/lib/favorites";
import { Cafe, levelConfig, TransparencyLevel, City, CafeType } from "@/data/cafes";
import { fetchCafes, fetchStats } from "@/lib/api";

const MapClient = dynamic(() => import("@/components/MapClient"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-cream-100">
      <div className="flex flex-col items-center gap-3">
        <motion.div
          className="w-10 h-10 rounded-full border-2 border-matcha-500 border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
        />
        <motion.span
          className="text-[16px] text-gray-500"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        >
          Loading map…
        </motion.span>
      </div>
    </div>
  ),
});

type CityFilter  = City | "All";

const ALL_LEVELS: TransparencyLevel[] = ["A", "B", "C", "D"];

const CITY_OPTS: { value: CityFilter; label: string }[] = [
  { value: "All",       label: "All Cities" },
  { value: "Sydney",    label: "Sydney" },
  { value: "Melbourne", label: "Melbourne" },
];
const TYPE_OPTS: { value: CafeType | "All"; label: string }[] = [
  { value: "All",       label: "All Types" },
  { value: "specialty", label: "Specialty" },
  { value: "dessert",   label: "Dessert" },
  { value: "cafe",      label: "Cafe" },
  { value: "chain",     label: "Chain" },
];

const SPRING = { type: "spring" as const, stiffness: 300, damping: 28 };
const EASE   = [0.25, 0.46, 0.45, 0.94] as const;

/**
 * 0.04s per child is a pleasant ripple over a dozen rows and a 46-second timeline over
 * 1,147 of them — every one of which framer still has to schedule. The whole list is
 * never on screen at once, so the ripple only ever needs to cover the first screenful.
 */
const listVariants = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.012 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show:   { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 420, damping: 28 } },
};

export default function MapPage() {
  const router = useRouter();
  const pathname = usePathname();
  const favoriteIds = useFavoriteIds();

  const [cafes,        setCafes]       = useState<Cafe[]>([]);
  const [loading,      setLoading]     = useState(true);
  const [loadError,    setLoadError]   = useState(false);
  const [reloadTick,   setReloadTick]  = useState(0);
  const [discovering,  setDiscovering] = useState(false);
  const [query,        setQuery]       = useState("");
  // Empty array = no level filter (all levels shown)
  const [levelFilter,  setLevelFilter] = useState<TransparencyLevel[]>([]);
  const [cityFilter,   setCityFilter]  = useState<CityFilter>("All");
  const [typeFilter,   setTypeFilter]  = useState<CafeType | "All">("All");
  const [savedOnly,    setSavedOnly]   = useState(false);
  const [selectedCafe, setSelectedCafe] = useState<Cafe | null>(null);
  const [pendingCafeId, setPendingCafeId] = useState<string | null>(null);
  const [sidebarOpen,  setSidebarOpen]  = useState(true);
  const [isMobile,     setIsMobile]    = useState(false);
  const [mobileView,   setMobileView]  = useState<"list" | "map">("map");
  const reduceMotion = useReducedMotion();

  /**
   * How many rows are actually built.
   *
   * The list rendered every match — 1,147 motion components mounted on the way into list
   * view and unmounted on the way out, measured at 4.5s and 3.3s of blocked main thread on
   * a throttled phone. Nobody can see past the first screenful, so only that is built, and
   * the rest arrive as the reader scrolls toward them.
   */
  const PAGE_SIZE = 24;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Seed search and level filter from the URL so the landing page's search box
  // and its "Verified only" chip land on actual results
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) setQuery(q);

    const levels = (params.get("level") ?? "")
      .split(",")
      .map((l) => l.trim().toUpperCase())
      .filter((l): l is TransparencyLevel => (ALL_LEVELS as string[]).includes(l));
    if (levels.length) setLevelFilter(ALL_LEVELS.filter((l) => levels.includes(l)));

    // ?city= drives the city filter, not the text search — only the filter
    // recentres the map, so a text search alone leaves you looking at Sydney
    const city = params.get("city");
    const match = CITY_OPTS.find(
      (o) => o.value !== "All" && o.value.toLowerCase() === city?.trim().toLowerCase(),
    );
    if (match) setCityFilter(match.value);

    // ?cafe= deep-links a single cafe (shared from a permalink page, or the browser
    // back button) — held here until the cafe list has actually loaded, below.
    const cafeId = params.get("cafe");
    if (cafeId) setPendingCafeId(cafeId);
  }, []);

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const load = async () => {
      setLoadError(false);
      try {
        const [cafesData, stats] = await Promise.all([fetchCafes(), fetchStats()]);
        if (cancelled) return;
        setCafes(cafesData);
        setDiscovering(stats.discovering);

        if (stats.discovering) {
          pollInterval = setInterval(async () => {
            try {
              const [newCafes, newStats] = await Promise.all([fetchCafes(), fetchStats()]);
              setCafes(newCafes);
              setDiscovering(newStats.discovering);
              if (!newStats.discovering) clearInterval(pollInterval!);
            } catch {}
          }, 5000);
        }
      } catch (err) {
        console.error("[Map load error]", err);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; if (pollInterval) clearInterval(pollInterval); };
  }, [reloadTick]);

  // Resolve a ?cafe= deep link once the list it needs to search is actually loaded
  useEffect(() => {
    if (!pendingCafeId || cafes.length === 0) return;
    const match = cafes.find((c) => c.id === pendingCafeId);
    if (match) setSelectedCafe(match);
    setPendingCafeId(null);
  }, [pendingCafeId, cafes]);

  // Everything except the level filter — so level counts stay stable while toggling levels
  const baseFiltered = useMemo(() => cafes.filter((c) => {
    const q = query.toLowerCase();
    return (
      (!q || c.name.toLowerCase().includes(q) || c.suburb.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.specialties.some((s) => s.toLowerCase().includes(q))) &&
      (cityFilter === "All" || c.city === cityFilter) &&
      (typeFilter === "All" || c.type === typeFilter) &&
      (!savedOnly || favoriteIds.has(c.id))
    );
  }), [cafes, query, cityFilter, typeFilter, savedOnly, favoriteIds]);

  const filtered = useMemo(
    () => (levelFilter.length === 0 ? baseFiltered : baseFiltered.filter((c) => levelFilter.includes(c.level))),
    [baseFiltered, levelFilter],
  );

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    baseFiltered.forEach((c) => counts[c.level]++);
    return counts;
  }, [baseFiltered]);

  const toggleLevel = (lvl: TransparencyLevel) =>
    setLevelFilter((prev) =>
      ALL_LEVELS.filter((l) => (l === lvl ? !prev.includes(l) : prev.includes(l))),
    );

  const activeFilters =
    (levelFilter.length > 0 ? 1 : 0) + [cityFilter, typeFilter].filter((f) => f !== "All").length + (savedOnly ? 1 : 0);
  const clearAll = () => { setLevelFilter([]); setCityFilter("All"); setTypeFilter("All"); setQuery(""); setSavedOnly(false); };

  // Keeps the URL in step with the selection so a cafe can be shared/back-buttoned to —
  // not just held in React state, which vanished the instant you copied the address bar.
  const syncCafeParam = useCallback((cafe: Cafe | null) => {
    const params = new URLSearchParams(window.location.search);
    if (cafe) params.set("cafe", cafe.id); else params.delete("cafe");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname]);

  // A new result set is a new list: start again from the top of the window rather than
  // keeping a deep one from the previous filter.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [levelFilter, cityFilter, typeFilter, query, savedOnly]);

  // Grow the window as the sentinel below the last row comes into view. rootMargin gives
  // it a screen of warning so rows exist before they are scrolled to.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((n) => (n >= filtered.length ? n : n + PAGE_SIZE));
        }
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, visibleCount, mobileView]);

  // On mobile list view, tapping a cafe switches to map view then opens detail
  const handleSelectCafe = (cafe: Cafe | null) => {
    setSelectedCafe(cafe);
    syncCafeParam(cafe);
    if (cafe && isMobile && mobileView === "list") {
      setMobileView("map");
    }
  };

  // Shared list panel content (used in desktop sidebar + mobile full-screen list)
  const renderListContent = (compact = false) => (
    <div className={compact ? "w-full" : "w-[300px]"}>
      {/* Level legend */}
      <motion.div
        className="p-4 border-b border-gray-100"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.4, ease: EASE }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[16px] uppercase tracking-widest text-gray-400 font-semibold whitespace-nowrap">
            Transparency
          </span>
          <AnimatePresence>
            {levelFilter.length > 0 && (
              <motion.button
                onClick={() => setLevelFilter([])}
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
        <div className="space-y-1.5">
          {ALL_LEVELS.map((lvl) => {
            const cfg = levelConfig[lvl];
            const active = levelFilter.includes(lvl);
            const dimmed = levelFilter.length > 0 && !active;
            return (
              <motion.button
                key={lvl}
                onClick={() => toggleLevel(lvl)}
                aria-pressed={active}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left"
                animate={{
                  background: active ? cfg.bg : "transparent",
                  outline: active ? `1.5px solid ${cfg.color}30` : "1.5px solid transparent",
                  opacity: dimmed ? 0.5 : 1,
                }}
                whileHover={{ background: active ? cfg.bg : "#f9fafb", opacity: 1 } as any}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[16px] font-bold text-white flex-shrink-0"
                  style={{ background: cfg.color }}
                >
                  {lvl}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-medium text-gray-700 truncate">{cfg.shortLabel}</div>
                </div>
                <motion.span
                  className="text-[16px] font-bold px-1.5 py-0.5 rounded-md"
                  style={{ background: cfg.bg, color: cfg.color }}
                  key={levelCounts[lvl]}
                  initial={{ scale: 1.25 }}
                  animate={{ scale: 1 }}
                  transition={SPRING}
                >
                  {levelCounts[lvl]}
                </motion.span>
                <span
                  className="w-4 h-4 rounded-md flex-shrink-0 flex items-center justify-center"
                  style={{
                    background: active ? cfg.color : "transparent",
                    border: active ? `1.5px solid ${cfg.color}` : "1.5px solid #e5e7eb",
                  }}
                >
                  <AnimatePresence>
                    {active && (
                      <motion.span
                        className="flex"
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.4, opacity: 0 }}
                        transition={SPRING}
                      >
                        <Check size={11} strokeWidth={3.5} color="#ffffff" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      {/* Cafe list */}
      <div className="p-3">
        <div className="text-[16px] uppercase tracking-widest text-gray-400 font-semibold mb-3 px-1">
          Results ({filtered.length})
        </div>

        <AnimatePresence mode="wait">
          {filtered.length === 0 ? (
            <motion.div
              key="empty"
              className="text-center py-10"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {discovering && cafes.length === 0 ? (
                <>
                  <motion.div
                    className="w-8 h-8 rounded-full border-2 border-matcha-500 border-t-transparent mx-auto mb-3"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                  />
                  <p className="text-[16px] font-medium text-matcha-700">Discovering cafes…</p>
                  <p className="text-[16px] text-gray-400 mt-1">Searching Google Maps & analysing menus</p>
                </>
              ) : savedOnly ? (
                <>
                  <Heart size={22} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-[16px] text-gray-400">No saved cafes yet.</p>
                  <p className="text-[16px] text-gray-400 mt-1">Tap the heart on any cafe to keep it here.</p>
                </>
              ) : (
                <>
                  <div className="text-2xl mb-2">🍵</div>
                  <p className="text-[16px] text-gray-400">No cafes match your filters.</p>
                </>
              )}
            </motion.div>
          ) : (
            <motion.div
              key={`${levelFilter.join("")}-${cityFilter}-${typeFilter}-${query}`}
              className="space-y-1.5"
              variants={listVariants}
              initial="hidden"
              animate="show"
            >
              {filtered.slice(0, visibleCount).map((cafe) => {
                const cfg = levelConfig[cafe.level];
                const isSelected = selectedCafe?.id === cafe.id;
                return (
                  // A div, not a button — it now has a real <button> (the favourite
                  // heart) nested inside it, and buttons can't nest in valid HTML.
                  // role="button" + keyboard handling keeps it as accessible as before.
                  <motion.div
                    key={cafe.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectCafe(isSelected ? null : cafe)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelectCafe(isSelected ? null : cafe);
                      }
                    }}
                    className="w-full flex items-start gap-3 p-3 rounded-xl text-left cursor-pointer"
                    variants={itemVariants}
                    animate={{
                      background: isSelected ? "#f2f8f0" : "transparent",
                      outline: isSelected ? "1.5px solid #c2e1b5" : "1.5px solid transparent",
                    }}
                    whileHover={{ background: isSelected ? "#f2f8f0" : "#fafafa" } as any}
                    whileTap={{ scale: 0.98 }}
                    transition={{ duration: 0.12 }}
                  >
                    <motion.div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[16px] font-bold text-white flex-shrink-0 mt-0.5"
                      style={{ background: cfg.color }}
                      whileHover={{ scale: 1.1 }}
                      transition={SPRING}
                    >
                      {cafe.level}
                    </motion.div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[16px] font-semibold text-gray-800 truncate">{cafe.name}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <MapPin size={10} className="text-gray-400" />
                        <span className="text-[16px] text-gray-400">{cafe.suburb}, {cafe.city}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0 self-center -mr-1.5">
                      <FavoriteButton id={cafe.id} name={cafe.name} size={13} />
                      {isMobile && <Map size={13} className="text-gray-300" />}
                    </div>
                  </motion.div>
                );
              })}

              {/* Grows the window as it is approached. Also the "there is more" line —
                  a count with nothing under it reads as a list that failed to load. */}
              {visibleCount < filtered.length && (
                <div ref={sentinelRef} className="py-4 text-center text-[15px] text-gray-400">
                  {filtered.length - visibleCount} more…
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-cream-50">
        <div className="flex flex-col items-center gap-3">
          <motion.div
            className="w-10 h-10 rounded-full border-2 border-matcha-500 border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
          />
          <span className="text-[16px] text-gray-400">Loading cafes…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-cream-50">
      <Navbar />

      {/* ── TOOLBAR ──────────────────────────────────────────────────── */}
      <motion.div
        className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 mt-16"
        style={{
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(0,0,0,0.07)",
        }}
        initial={{ y: -56, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.55, ease: EASE }}
      >
        {/* Row 1: search + mobile count */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search cafes, suburbs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-gray-100 text-[16px] text-gray-700 placeholder:text-gray-400 outline-none focus:bg-white focus:ring-2 focus:ring-matcha-200 transition-all"
            />
            <AnimatePresence>
              {query && (
                <motion.button
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  transition={SPRING}
                  whileTap={{ scale: 0.85 }}
                >
                  <X size={14} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Count — visible only on mobile in this row */}
          <motion.span
            key={filtered.length}
            className="sm:hidden text-[16px] text-gray-400 whitespace-nowrap"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {filtered.length} cafe{filtered.length !== 1 ? "s" : ""}
          </motion.span>
        </div>

        {/* Row 2: filters (horizontal scroll on mobile) */}
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-0.5 sm:pb-0">
          <LevelFilter
            selected={levelFilter}
            onChange={setLevelFilter}
            counts={levelCounts}
            total={baseFiltered.length}
          />

          {[
            { val: cityFilter,  opts: CITY_OPTS,  set: setCityFilter  as (v: string) => void },
            { val: typeFilter,  opts: TYPE_OPTS,  set: setTypeFilter  as (v: string) => void },
          ].map((f, i) => (
            <motion.div key={i} className="relative flex-shrink-0" whileHover={{ scale: 1.02 }} transition={SPRING}>
              <select
                value={f.val}
                onChange={(e) => f.set(e.target.value)}
                className="appearance-none pl-3.5 pr-8 py-2 sm:py-2.5 rounded-xl bg-gray-100 text-[16px] text-gray-700 outline-none focus:ring-2 focus:ring-matcha-200 cursor-pointer transition-all"
                style={f.val !== "All" ? { background: "#e6f4e0", color: "#2e6027" } : {}}
              >
                {f.opts.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </motion.div>
          ))}

          <motion.button
            onClick={() => setSavedOnly((v) => !v)}
            aria-pressed={savedOnly}
            className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 sm:py-2.5 rounded-xl text-[16px] font-medium transition-colors"
            style={savedOnly ? { background: "#fee2e2", color: "#dc2626" } : { background: "#f3f4f6", color: "#374151" }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            transition={SPRING}
          >
            <Heart size={13} fill={savedOnly ? "#dc2626" : "none"} />
            Saved{favoriteIds.size > 0 ? ` (${favoriteIds.size})` : ""}
          </motion.button>

          <AnimatePresence>
            {activeFilters > 0 && (
              <motion.button
                onClick={clearAll}
                className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[16px] font-medium"
                style={{ background: "#fee2e2", color: "#dc2626" }}
                initial={{ opacity: 0, scale: 0.8, x: -8 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8, x: -8 }}
                transition={SPRING}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <X size={13} />Clear ({activeFilters})
              </motion.button>
            )}
          </AnimatePresence>

          {/* Count — desktop only */}
          <motion.span
            key={filtered.length}
            className="hidden sm:block text-[16px] text-gray-400 ml-auto whitespace-nowrap"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {filtered.length} cafe{filtered.length !== 1 ? "s" : ""}
          </motion.span>

          <AnimatePresence>
            {discovering && (
              <motion.div
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[16px] font-medium"
                style={{ background: "#e6f4e0", color: "#2e6027" }}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.2 }}
              >
                <motion.div
                  className="w-2 h-2 rounded-full bg-matcha-600"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
                Discovering…
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* ── ERROR BANNER ─────────────────────────────────────────────── */}
      {/* A failed fetch used to just set cafes to [] — indistinguishable from "no
          cafes match your search". This says what actually happened and offers a way out. */}
      <AnimatePresence>
        {loadError && (
          <motion.div
            className="flex-shrink-0 flex items-center gap-3 px-4 py-3"
            style={{ background: "#fef2f2", borderBottom: "1px solid #fecaca" }}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
            <span className="text-[16px] text-red-700 flex-1">
              Couldn&apos;t load cafes — the connection to our database failed.
            </span>
            <motion.button
              onClick={() => setReloadTick((t) => t + 1)}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[16px] font-semibold text-white"
              style={{ background: "#dc2626" }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.95 }}
            >
              <RefreshCw size={12} />Retry
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MAIN ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">

        {isMobile ? (
          /* ── MOBILE LAYOUT: full-screen Map or full-screen List ─── */
          <>
            {/* Map always rendered as base layer — z-[1] creates stacking context to scope Leaflet's internal z-indices */}
            <div className="absolute inset-0 z-[1]">
              <MapClient
                cafes={filtered}
                selectedCafe={selectedCafe}
                onSelectCafe={handleSelectCafe}
                city={cityFilter}
                isMobile
              />
            </div>

            {/* List overlay — slides up over the map */}
            <AnimatePresence>
              {mobileView === "list" && (
                <motion.div
                  key="mobile-list"
                  className="absolute inset-0 z-[30] bg-white overflow-y-auto"
                  style={{ paddingBottom: "88px" }}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 24 }}
                  transition={{ duration: 0.28, ease: EASE }}
                >
                  {renderListContent(true)}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bottom toggle pill — Map / List switcher */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[40] pointer-events-none">
              {/*
                A two-position switch, so it is built like one. The count that used to ride
                beside "List" made that half of the control visibly wider than "Map", which
                broke the symmetry the sliding pill depends on and left the two options
                looking like different kinds of thing. The number is still on screen, in the
                toolbar, where it belongs with the filters that change it.

                The pill is one element moved between the two halves by layoutId rather than
                a positioned bar animating left and right: framer measures both positions and
                transforms between them, so it moves on the compositor instead of laying the
                control out again on every frame.
              */}
              <motion.div
                className="pointer-events-auto relative grid grid-cols-2 p-1 rounded-full"
                style={{
                  background: "rgba(15,15,15,0.86)",
                  backdropFilter: "blur(20px) saturate(140%)",
                  WebkitBackdropFilter: "blur(20px) saturate(140%)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  boxShadow: "0 10px 34px rgba(0,0,0,0.32), 0 2px 8px rgba(0,0,0,0.22)",
                }}
                initial={{ opacity: 0, y: 16, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.3, ...SPRING }}
                role="group"
                aria-label="Switch between list and map"
              >
                {([
                  { key: "list", label: "List", Icon: List },
                  { key: "map",  label: "Map",  Icon: Map  },
                ] as const).map(({ key, label, Icon }) => {
                  const active = mobileView === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setMobileView(key)}
                      aria-pressed={active}
                      // 44px min height: the old 40px sat under every platform's touch floor.
                      className="relative flex items-center justify-center gap-2 px-7 rounded-full text-[16px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                      style={{ minHeight: 44, WebkitTapHighlightColor: "transparent" }}
                    >
                      {active && (
                        <motion.span
                          layoutId="view-toggle-pill"
                          className="absolute inset-0 rounded-full bg-white"
                          style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.20)" }}
                          transition={reduceMotion ? { duration: 0 } : SPRING}
                        />
                      )}
                      <span
                        className="relative z-10 flex items-center gap-2 transition-colors duration-200"
                        style={{ color: active ? "#111111" : "rgba(255,255,255,0.72)" }}
                      >
                        <Icon size={15} strokeWidth={2.4} />
                        {label}
                      </span>
                    </button>
                  );
                })}
              </motion.div>
            </div>

            {/* Cafe detail panel (bottom sheet) */}
            <CafeDetailPanel cafe={selectedCafe} onClose={() => handleSelectCafe(null)} />
          </>
        ) : (
          /* ── DESKTOP LAYOUT: sidebar + map side by side ─────────── */
          <>
            {/* Sidebar */}
            <motion.div
              className="flex-shrink-0 overflow-y-auto border-r border-gray-100 bg-white"
              animate={{ width: sidebarOpen ? 300 : 0 }}
              transition={SPRING}
            >
              {renderListContent(false)}
            </motion.div>

            {/* Sidebar toggle */}
            <motion.button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="absolute bottom-6 z-[60] flex items-center gap-1.5 px-3 py-2 rounded-r-xl text-[16px] font-medium bg-white border border-l-0 border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm"
              animate={{ left: sidebarOpen ? 300 : 0 }}
              transition={SPRING}
              whileHover={{ paddingRight: "14px" }}
              whileTap={{ scale: 0.96 }}
            >
              <SlidersHorizontal size={13} />
              {sidebarOpen ? "Hide" : "List"}
            </motion.button>

            {/* Map */}
            <div className="flex-1 relative overflow-hidden">
              <MapClient
                cafes={filtered}
                selectedCafe={selectedCafe}
                onSelectCafe={handleSelectCafe}
                city={cityFilter}
              />

              {/* Legend — only when sidebar is closed */}
              <AnimatePresence>
                {!sidebarOpen && (
                  <motion.div
                    className="absolute bottom-5 right-5 z-[50]"
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                    transition={{ duration: 0.22, ease: EASE }}
                  >
                    <div
                      className="rounded-2xl overflow-hidden"
                      style={{
                        background: "rgba(255,255,255,0.94)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "1px solid rgba(0,0,0,0.07)",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)",
                      }}
                    >
                      {ALL_LEVELS.map((lvl, i) => {
                        const cfg = levelConfig[lvl];
                        const active = levelFilter.includes(lvl);
                        const dimmed = levelFilter.length > 0 && !active;
                        return (
                          <motion.button
                            key={lvl}
                            onClick={() => toggleLevel(lvl)}
                            aria-pressed={active}
                            className={`flex items-center gap-2.5 w-full px-3.5 py-2.5 text-left ${i < 3 ? "border-b border-gray-100" : ""}`}
                            animate={{ background: active ? cfg.bg : "transparent", opacity: dimmed ? 0.5 : 1 }}
                            whileHover={{ background: active ? cfg.bg : "#f9fafb", opacity: 1 } as any}
                            whileTap={{ scale: 0.97 }}
                            transition={{ duration: 0.1 }}
                          >
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: cfg.color }} />
                            <span className="text-[16px] whitespace-nowrap text-gray-600">
                              <span className="font-bold" style={{ color: cfg.color }}>{lvl}</span>
                              {" — "}{cfg.shortLabel}
                            </span>
                            <span className="ml-auto pl-3 text-[16px] font-semibold tabular-nums" style={{ color: cfg.color }}>
                              {levelCounts[lvl]}
                            </span>
                            <motion.span
                              className="flex-shrink-0"
                              animate={{ opacity: active ? 1 : 0, scale: active ? 1 : 0.6 }}
                              transition={SPRING}
                            >
                              <Check size={12} strokeWidth={3.5} color={cfg.color} />
                            </motion.span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Cafe detail panel (right panel) */}
            <CafeDetailPanel cafe={selectedCafe} onClose={() => handleSelectCafe(null)} />
          </>
        )}
      </div>
    </div>
  );
}
