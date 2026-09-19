"use client";

/**
 * Landing "overture" — the full-height sequence that plays before the existing
 * page. Built to the Marketplace/Directory pattern (search is the CTA, show the
 * inventory, prove the claim) in an Exaggerated Minimalism style: oversized
 * type, high contrast, generous negative space.
 *
 * Every animation here is framer-motion (already a dependency) and every one of
 * them is disabled under prefers-reduced-motion.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  motion,
  useInView,
  useScroll,
  useTransform,
  useSpring,
  useReducedMotion,
  animate,
} from "framer-motion";
import { ArrowRight, MapPin, Quote, ShieldCheck, ExternalLink } from "lucide-react";
import { Cafe, levelConfig } from "@/data/cafes";
import { externalUrl } from "@/lib/links";
// Fallback figures for the first paint, before the live stats arrive. This block
// renders on the server, so it is what a crawler and a reader without JavaScript
// see; hard-coding it meant the front page quoted 96 / 18 / 414 long after the
// database held 98 / 19 / 424. measure-coverage.mjs writes this file, so one run
// moves the fallback and the measurement together.
import coverage from "@/lib/crawl-coverage.json";
import DotHero from "@/components/DotHero";

const EASE_EXPO = [0.16, 1, 0.3, 1] as const;
const EASE_OUT  = [0.25, 0.46, 0.45, 0.94] as const;

interface Props {
  stats: {
    total: number;
    byLevel: Record<string, number>;
    assessable: number;
    sydney: number;
    melbourne: number;
  } | null;
  verified: Cafe[];
}

/* ────────────────────────────────────────────────────────────── primitives ── */

/** Counts up to `value` the first time it scrolls into view. */
// `immediate` is for figures that are above the fold by construction. The -15% viewport
// margin below means an element must sit well inside the screen before it counts, and on a
// 640px phone the hero's own figures land past that line — so the three numbers the hero
// exists to deliver painted as "0 0 0" until the reader scrolled, which reads as broken
// data rather than as an animation waiting its turn. Anything already on the first screen
// should start on mount; the margin still governs everything further down the page.
function Counter({ value, className = "", immediate = false }: { value: number; className?: string; immediate?: boolean }) {
  const ref     = useRef<HTMLSpanElement>(null);
  const inView  = useInView(ref, { once: true, margin: "-15%" });
  const reduce  = useReducedMotion();
  // Seeded with the real figure, not 0.
  //
  // This block renders on the server, and starting the state at 0 meant the markup a
  // crawler or a reader without JavaScript received said "0 say nothing", "0 say where"
  // and "0% of cafes we could read" — the page's three headline findings, all reported as
  // zero. The count-up still runs: the effect below is client-only, so it takes over after
  // hydration and animates from 0 exactly as before.
  const [shown, setShown] = useState(value);
  const start   = immediate || inView;

  useEffect(() => {
    if (!start) return;
    if (reduce) { setShown(value); return; }
    const controls = animate(0, value, {
      duration: 1.5,
      ease: EASE_EXPO,
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [start, value, reduce]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {shown.toLocaleString()}
    </span>
  );
}

/** Reveals its children on scroll, wiping upward from a clipped baseline. */
function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12%" }}
      transition={{ duration: 0.75, ease: EASE_EXPO, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The count, on its own screen.
 *
 * <p>One line of scope and four figures — nothing else. The method paragraph and the
 * percentages used to sit here too, and together they turned a number anyone takes in at a
 * glance into a block of text nobody reads. The method has its own section further down;
 * the bars already carry the proportions the percentages spelt out.
 *
 * <p>The line quotes every cafe found, so the figures under it have to add up to that
 * total — which is why the unread class has a column of its own. Left out, "1,147" would
 * sit over three numbers summing to 447 and the reader would be left to find the missing
 * 700. It is drawn as a different kind of thing, not as a fourth finding: a muted numeral
 * and a hatched track, the standing convention for "no reading taken".
 *
 * <p>Left to right the classes run A, B, C, D — the order the grade scale uses everywhere
 * else — and each column is the same three rows: the count, its share on one shared track,
 * and a label of two or three words.
 */
function Findings({ stats }: { stats: Props["stats"] }) {
  const reduce = useReducedMotion();

  const total     = stats?.total ?? coverage.total;
  const verified  = stats?.byLevel?.A ?? coverage.byLevel.A;
  // Same source as the disclosure card's denominator, so the two can never disagree.
  const read      = stats?.assessable ?? coverage.read;
  const japanOnly = stats?.byLevel?.B ?? coverage.byLevel.B;
  // Read, minus everyone who said something. With `unread`, the four sum to `total`.
  const silent    = Math.max(0, read - verified - japanOnly);
  const unread    = Math.max(0, total - read);

  const HATCH = "repeating-linear-gradient(135deg, rgba(28,43,26,0.34) 0 1.5px, transparent 1.5px 4px)";

  const figures = [
    { key: "A", n: verified,  label: "name the source",     fill: levelConfig.A.headerBg, ink: levelConfig.A.headerBg },
    { key: "B", n: japanOnly, label: "say “Japanese”", fill: levelConfig.B.headerBg, ink: undefined },
    // The same de-emphasis grey the breakdown bar gives this class further down.
    { key: "C", n: silent,    label: "say nothing",         fill: "var(--text-muted)",    ink: undefined },
    // Muted, but gray-500 rather than gray-400: at this size the numeral still has to
    // clear 3:1 against the page.
    { key: "D", n: unread,    label: "have no readable page", fill: HATCH,                  ink: "#6b7280" },
  ];

  return (
    <section
      className="relative sm:min-h-[100dvh] flex flex-col justify-center px-5 py-16 sm:py-20 [@media(max-height:480px)_and_(orientation:landscape)]:py-8"
      aria-label="What the search found"
    >
      <div className="w-full max-w-5xl mx-auto">
        <motion.p
          className="text-center text-[18px] sm:text-[21px] text-gray-500"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
        >
          We found <span className="text-gray-900 font-medium tabular-nums">{total.toLocaleString("en-AU")}</span> cafes:
        </motion.p>

        {/* Two across below lg: four 96px figures do not fit a tablet-width row. */}
        <ul className="mt-8 sm:mt-12 [@media(max-height:480px)_and_(orientation:landscape)]:mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 lg:gap-x-12 sm:gap-y-10 lg:gap-y-0">
          {figures.map((f, i) => (
            // The column owns the in-view trigger and hands it to the track through
            // variants. The fill cannot watch the viewport itself: it starts at
            // scaleX(0), a zero-width box, and the observer never reported the widest
            // one as visible — so the largest class on the card drew nothing.
            <motion.li
              key={f.key}
              className="border-t border-gray-200 pt-6 pb-8 sm:pb-0 sm:pt-8 text-center"
              initial={reduce ? false : "hidden"}
              whileInView="show"
              viewport={{ once: true, margin: "-15%" }}
              variants={{
                hidden: { opacity: 0, y: 14 },
                show:   { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT, delay: i * 0.1 } },
              }}
            >
              <div
                className="font-display font-bold leading-none tracking-tight text-gray-900 text-[3.5rem] min-[390px]:text-[4rem] sm:text-[4.5rem] lg:text-[5.25rem] xl:text-8xl [@media(max-height:480px)_and_(orientation:landscape)]:text-5xl"
                style={f.ink ? { color: f.ink } : undefined}
              >
                <Counter value={f.n} />
              </div>

              {/* All four tracks share one 0–total scale. It sits between the number and
                  the label so the tracks stay level however a label wraps. The fill starts
                  at the left end of its track and grows rightward, the way a gauge reads. */}
              <div aria-hidden className="mt-5 sm:mt-6 relative h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(28,43,26,0.08)" }}>
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full origin-left"
                  style={{ width: `${total ? (f.n / total) * 100 : 0}%`, background: f.fill, minWidth: f.n > 0 ? 3 : 0 }}
                  variants={{
                    hidden: { scaleX: 0 },
                    show:   { scaleX: 1, transition: { duration: 0.9, ease: EASE_EXPO, delay: 0.25 + i * 0.1 } },
                  }}
                />
              </div>

              <p className="mt-3 text-[17px] sm:text-[19px] [@media(max-height:480px)_and_(orientation:landscape)]:text-[14px] text-gray-700">
                {f.label}
              </p>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Two lanes drifting against each other. One lane reads as a ticker; two
 * moving in opposition read as a body of evidence, which is the point.
 */
function VerifiedMarquee({ verified }: { verified: Cafe[] }) {
  const reduce = useReducedMotion();
  const names  = verified.length ? verified.map((c) => c.name) : [];
  if (!names.length) return null;

  const half  = Math.ceil(names.length / 2);
  const lanes = [names.slice(0, half), names.slice(half)];

  return (
    <section
      className="py-sect-tight overflow-hidden"
      style={{ background: "#fdfcf7", borderTop: "1px solid #eee9dc", borderBottom: "1px solid #eee9dc" }}
      aria-label="Cafes with verified disclosure"
    >
      <div className="flex items-center justify-center gap-2.5 mb-8 px-5">
        <ShieldCheck size={16} className="text-matcha-600 flex-shrink-0" />
        <span className="text-[16px] uppercase tracking-[0.18em] text-gray-500 font-semibold text-center">
          {names.length} cafes name the region their matcha comes from
        </span>
      </div>

      <div className="relative space-y-3">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-20 sm:w-40 z-10"
             style={{ background: "linear-gradient(90deg,#fdfcf7 20%,rgba(253,252,247,0))" }} />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-20 sm:w-40 z-10"
             style={{ background: "linear-gradient(270deg,#fdfcf7 20%,rgba(253,252,247,0))" }} />

        {lanes.map((lane, i) => {
          const items = [...lane, ...lane];
          // ~50px/second, derived so the pace holds as more cafes qualify
          const duration = Math.max(60, lane.length * 9);
          return (
            <motion.div
              key={`${i}-${lane.length}`}
              className="flex gap-3 w-max"
              animate={reduce ? {} : { x: i === 0 ? ["0%", "-50%"] : ["-50%", "0%"] }}
              transition={{ duration, repeat: Infinity, ease: "linear" }}
            >
              {items.map((n, k) => (
                <span
                  key={`${n}-${k}`}
                  className="flex-shrink-0 inline-flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full text-[16px] font-medium text-matcha-900 bg-white"
                  style={{ border: "1px solid #e0f0d8", boxShadow: "0 1px 3px rgba(15,32,16,0.04)" }}
                >
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[16px] font-bold text-white flex-shrink-0"
                    style={{ background: "#2e6027", fontSize: 11 }}
                  >
                    A
                  </span>
                  {n}
                </span>
              ))}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

/** The headline finding, scrubbed by the scrollbar; pinned from md up. */
function DisclosureStat({ stats }: { stats: Props["stats"] }) {
  const ref    = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  // Measured from the moment the section appears at the bottom of the viewport,
  // not from the moment it pins. From md up the panel is 100dvh inside a 108vh
  // section, so "start start"→"end end" left only 8vh of travel — every beat
  // fired late, after the reader had already arrived.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });

  // Same definition as the disclosure section further down the page: cafes that
  // say anything about Japanese origin (A + B), over the cafes we could read.
  // Two different figures for one fact would read as an error.
  const named = (stats?.byLevel?.A ?? coverage.byLevel.A) + (stats?.byLevel?.B ?? coverage.byLevel.B);
  const read  = stats?.assessable ?? coverage.read;
  const pct   = Math.round((named / read) * 100);
  const share = named / read;

  // Travel from md up is one section height, and the panel pins at ~0.93 of it
  // (measured). So the arc runs the length of the approach and completes just
  // as the panel settles, rather than finishing halfway up the screen. On a
  // phone the section is shorter, so the same beats simply resolve sooner.
  const scale   = useTransform(scrollYProgress, [0.08, 0.5], [reduce ? 1 : 0.86, 1]);
  const ringLen = useTransform(scrollYProgress, [0.12, 0.6], [0, 1]);
  // dashoffset 1 = empty ring; 1 - share = arc drawn to the true proportion
  const arcOffset = useTransform(scrollYProgress, [0.18, 0.8], [1, 1 - share]);
  const copyY   = useTransform(scrollYProgress, [0.55, 0.85], [reduce ? 0 : 40, 0]);
  const copyOp  = useTransform(scrollYProgress, [0.55, 0.8], [reduce ? 1 : 0, 1]);

  return (
    <section ref={ref} className="relative md:h-[108vh]" aria-label="Disclosure rate">
      {/* From md up the pinned viewport is the point — the number holds the whole
          frame while the arc draws. On a phone that same frame left a screenful
          of empty green above and below the stat, so below md the panel is sized
          by its own content and nothing pins. */}
      <div className="relative flex flex-col items-center justify-center overflow-hidden py-20 md:py-0 md:sticky md:top-0 md:h-[100dvh]"
           style={{ background: "#0f2010" }}>
        {/* Faint field rings */}
        <svg aria-hidden className="absolute inset-0 w-full h-full opacity-[0.13]" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
          {[20, 32, 44].map((r) => (
            <motion.circle
              key={r}
              cx="50" cy="50" r={r}
              fill="none" stroke="#6eb35c" strokeWidth="0.22"
              style={{ pathLength: ringLen }}
            />
          ))}
        </svg>

        {/* The share, drawn: the lit arc is the 17%, the dim ring the rest */}
        <svg
          aria-hidden
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(72vw,420px)] h-[min(72vw,420px)] md:w-[min(78vw,560px)] md:h-[min(78vw,560px)] -rotate-90"
          viewBox="0 0 100 100"
        >
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.1" />
          <motion.circle
            cx="50" cy="50" r="46"
            fill="none"
            stroke="#6eb35c"
            strokeWidth="1.6"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            style={{ strokeDashoffset: arcOffset }}
          />
        </svg>

        <motion.div style={{ scale }} className="text-center px-5">
          <div className="text-[16px] uppercase tracking-[0.2em] text-matcha-300 font-semibold mb-3 md:mb-5">
            The finding
          </div>
          {/* Two clamps rather than one: the phone wants a number sized to the
              shorter panel, the desktop wants it to fill the pinned frame. */}
          <div className="font-display font-bold leading-none text-white flex items-baseline justify-center text-[clamp(4rem,15vw,9.5rem)] md:text-[clamp(5rem,22vw,16rem)]">
            <Counter value={pct} />
            <span className="text-matcha-400 ml-1" style={{ fontSize: "0.42em" }}>%</span>
          </div>
          <div className="font-display text-xl md:text-4xl text-white/90 mt-2 md:mt-3 leading-snug">
            of cafés we could read say
            <br className="md:hidden" /> their matcha is Japanese.
          </div>
        </motion.div>

        <motion.p
          style={{ y: copyY, opacity: copyOp }}
          className="mt-5 md:mt-7 max-w-lg text-center text-[16px] leading-relaxed text-white/60 px-6"
        >
          {/* "The full breakdown is below" was a stage direction: the breakdown is below,
              visibly, and a line of copy spent pointing at the next scroll is a line not
              spent on the finding. */}
          Only {stats?.byLevel?.A ?? coverage.byLevel.A} of them name a region, farm or supplier.
        </motion.p>
      </div>
    </section>
  );
}

/** Every verified cafe, plotted from its real coordinates. */
function ConstellationMap({ verified }: { verified: Cafe[] }) {
  const reduce = useReducedMotion();
  const ref    = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });

  const cities = useMemo(() => {
    const group = (city: string) => {
      const pts = verified.filter((c) => c.city === city);
      if (!pts.length) return null;
      const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
      const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
      const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
      const spanLat = maxLat - minLat || 1;
      const spanLng = maxLng - minLng || 1;
      return {
        city,
        count: pts.length,
        // 6% inset so no dot sits on the frame edge
        dots: pts.map((p) => ({
          id: p.id,
          x: 6 + ((p.lng - minLng) / spanLng) * 88,
          y: 6 + ((maxLat - p.lat) / spanLat) * 88,
        })),
      };
    };
    return [group("Sydney"), group("Melbourne")].filter(Boolean) as {
      city: string; count: number; dots: { id: string; x: number; y: number }[];
    }[];
  }, [verified]);

  return (
    <section className="py-sect px-5 bg-white" aria-label="Where the verified cafes are">
      <div className="max-w-6xl mx-auto">
        <Reveal className="max-w-2xl">
          <div className="text-[16px] uppercase tracking-widest text-gray-500 font-semibold mb-4">
            The map
          </div>
          <h2 className="font-display font-bold text-section text-gray-900">
            Every verified cafe, exactly where it stands.
          </h2>
          <p className="mt-4 text-[16px] text-gray-600 leading-relaxed">
            Each dot is a real cafe you can open, read and check for yourself.
          </p>
        </Reveal>

        {/* Same minmax(0,1fr) guard as the cards above — a long city name must not be able
            to open the mobile track wider than the screen. */}
        <div ref={ref} className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {cities.map((c, ci) => (
            <Reveal key={c.city} delay={ci * 0.12}>
              <Link
                // lands on exactly what the card draws: this city's verified cafes
                href={`/map?city=${encodeURIComponent(c.city)}&level=A`}
                className="group block rounded-3xl p-6 relative overflow-hidden focus-visible:ring-2 focus-visible:ring-matcha-500 outline-none"
                style={{ background: "#0f2010" }}
              >
                <div className="flex items-baseline justify-between mb-4">
                  <span className="font-display text-2xl font-bold text-white">{c.city}</span>
                  <span className="text-[16px] text-matcha-300 font-semibold">
                    {c.count} verified
                  </span>
                </div>

                <div className="relative w-full" style={{ aspectRatio: "4 / 3" }}>
                  <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full overflow-visible">
                    {/* faint grid */}
                    {[25, 50, 75].map((v) => (
                      <g key={v} stroke="rgba(255,255,255,0.06)" strokeWidth="0.3">
                        <line x1={v} y1="0" x2={v} y2="100" />
                        <line x1="0" y1={v} x2="100" y2={v} />
                      </g>
                    ))}
                    {c.dots.map((d, i) => (
                      <motion.circle
                        key={d.id}
                        cx={d.x} cy={d.y} r="1.5"
                        fill="#6eb35c"
                        initial={reduce ? false : { opacity: 0, scale: 0 }}
                        animate={inView ? { opacity: 1, scale: 1 } : {}}
                        transition={{
                          duration: 0.5,
                          ease: EASE_EXPO,
                          delay: reduce ? 0 : ci * 0.15 + i * 0.012,
                        }}
                        style={{ transformOrigin: `${d.x}px ${d.y}px` }}
                      />
                    ))}
                  </svg>
                </div>

                <div className="mt-5 inline-flex items-center gap-1.5 text-[16px] font-semibold text-white">
                  Explore the map
                  <motion.span className="inline-flex" whileHover={{ x: 3 }}>
                    <ArrowRight size={15} />
                  </motion.span>
                </div>

                {/* sheen on hover */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{ background: "radial-gradient(600px circle at 50% 0%, rgba(110,179,92,0.16), transparent 60%)" }}
                />
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Featured listings — the pattern's "inventory" beat. */
function FeaturedCafes({ verified }: { verified: Cafe[] }) {
  const picks = useMemo(
    () => verified.filter((c) => c.evidence?.quote).slice(0, 6),
    [verified],
  );
  if (!picks.length) return null;

  return (
    <section className="py-sect px-5" style={{ background: "#fdfcf7" }} aria-label="Featured verified cafes">
      <div className="max-w-6xl mx-auto">
        <Reveal className="flex flex-wrap items-end justify-between gap-4 mb-12">
          <div className="max-w-xl">
            <div className="text-[16px] uppercase tracking-widest text-gray-500 font-semibold mb-4">
              In their own words
            </div>
            <h2 className="font-display font-bold text-section text-gray-900">
              Proof, not adjectives.
            </h2>
          </div>
          <Link
            href="/map"
            className="inline-flex items-center gap-1.5 text-[16px] font-semibold text-matcha-700 hover:underline focus-visible:ring-2 focus-visible:ring-matcha-500 outline-none rounded"
          >
            See all on the map <ArrowRight size={15} />
          </Link>
        </Reveal>

        {/* grid-cols-1 is load-bearing, not decoration: without it the single mobile track is
            `auto`, which floors at the widest card's min-content — and the name below is
            `truncate`, so its min-content is the whole un-wrapped cafe name. One long name
            ("15cenchi Japanese Cheesecake Darling Square") then set a 454px track inside a
            350px phone, and every card in the column overflowed with it. Tailwind's
            grid-cols-* emits minmax(0,1fr), which is the guard that lets the name truncate
            instead of pushing the column open. */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {picks.map((c, i) => (
            <Reveal key={c.id} delay={i * 0.07}>
              <motion.div
                className="h-full rounded-3xl bg-white p-6 flex flex-col"
                style={{ border: "1px solid #e0f0d8" }}
                whileHover={{ y: -6, boxShadow: "0 18px 48px rgba(15,32,16,0.10)" }}
                transition={{ type: "spring", stiffness: 320, damping: 26 }}
              >
                <div className="flex items-center gap-2.5 mb-4">
                  <span className="w-7 h-7 rounded-full bg-matcha-700 text-white text-[16px] font-bold flex items-center justify-center flex-shrink-0">
                    A
                  </span>
                  <div className="min-w-0">
                    <div className="text-[16px] font-semibold text-gray-900 truncate">{c.name}</div>
                    <div className="flex items-center gap-1 text-[16px] text-gray-500">
                      <MapPin size={11} />{c.suburb}, {c.city}
                    </div>
                  </div>
                </div>

                <Quote size={16} className="text-matcha-400 mb-2" />
                {/* clamped so one long quote can't set the height of the whole row */}
                <p className="text-[16px] text-gray-700 italic leading-relaxed flex-1 line-clamp-5">
                  &ldquo;{c.evidence!.quote}&rdquo;
                </p>
                <div className="mt-4 pt-4" style={{ borderTop: "1px solid #f0f0f0" }}>
                  {externalUrl(c.evidence!.source) ? (
                    <a
                      href={externalUrl(c.evidence!.source)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="group/src inline-flex items-center gap-1.5 text-[16px] text-gray-500 hover:text-matcha-700 focus-visible:ring-2 focus-visible:ring-matcha-500 outline-none rounded"
                    >
                      <ExternalLink size={12} className="flex-shrink-0" />
                      <span className="underline decoration-gray-300 underline-offset-2 group-hover/src:decoration-matcha-500">
                        {c.evidence!.sourceLabel}
                      </span>
                      <span className="text-gray-400">· verified {c.evidence!.verifiedDate}</span>
                    </a>
                  ) : (
                    <span className="text-[16px] text-gray-500">
                      {c.evidence!.sourceLabel} · verified {c.evidence!.verifiedDate}
                    </span>
                  )}
                </div>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────── overture ── */

export default function LandingOverture({ stats, verified }: Props) {
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });

  return (
    <>
      {/* Reading progress */}
      <motion.div
        aria-hidden
        className="fixed top-16 left-0 right-0 h-[2px] origin-left z-[90]"
        style={{ scaleX: progress, background: "linear-gradient(90deg,#2e6027,#6eb35c)" }}
      />
      <DotHero />
      <Findings stats={stats} />
      <VerifiedMarquee verified={verified} />
      <DisclosureStat stats={stats} />
    </>
  );
}

/**
 * The payoff half of the overture. Rendered much further down the page, after
 * the grading system and the method have been explained — evidence lands
 * harder once the reader knows how a grade is earned.
 */
export function LandingProof({ verified }: { verified: Cafe[] }) {
  return (
    <>
      <FeaturedCafes verified={verified} />
      <ConstellationMap verified={verified} />
    </>
  );
}
