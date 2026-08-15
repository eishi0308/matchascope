"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import {
  motion,
  useInView,
  useScroll,
  useTransform,
  useSpring,
  useMotionValue,
  animate,
} from "framer-motion";
import {
  Leaf, Map, Shield, Search, ArrowRight, CheckCircle2,
  TrendingUp, Eye, FileText, MessageSquarePlus, ExternalLink, Play, User,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import AuthModal from "@/components/AuthModal";
import MatchaMark from "@/components/MatchaMark";
import LandingOverture, { LandingProof } from "@/components/LandingOverture";
import { fetchCafes, fetchStats } from "@/lib/api";
import { Cafe, levelConfig } from "@/data/cafes";

type OvertureStats = {
  total: number;
  byLevel: Record<string, number>;
  assessable: number;
  sydney: number;
  melbourne: number;
} | null;

// ── Constants ──────────────────────────────────────────────────────────────

const EASE = [0.25, 0.46, 0.45, 0.94] as const;
const EASE_EXPO = [0.16, 1, 0.3, 1] as const;
const SPRING = { type: "spring" as const, stiffness: 300, damping: 28 };

// ── Data ──────────────────────────────────────────────────────────────────

// Fallback only — replaced by live Supabase counts on mount. Keep in step with the
// database so a failed fetch never shows numbers that contradict the map.
// `nothing` folds C and D together: from a reader's point of view both mean the
// site disclosed no origin, and the A/B/C/D letters are not introduced this early
// on the page.
// `total` is every cafe found. The rate below is quoted over the cafes whose page was
// actually read, not the cafes that merely list a link — of those that list one, a
// quarter sit behind a login and a further share no longer resolve. `unchecked` is
// everything we could not read, reported on its own rather than folded in as a
// non-disclosure, because "we could not ask" is not the same finding as "they do not say".
const DEFAULT_DISCLOSURE = {
  total: 1147,
  unchecked: 559,
  nothing: 488,
  japanOnly: 14,
  named: 86,
};

// Bar segments and the rows beneath share one source, in one order, so the two
// can never disagree.
// Emphasis palette — one hue plus gray. The two classes that disclose something
// carry the hue; the large majority that disclose nothing recede into gray, because
// the finding is how few disclose, not how many do not. Kept unquantified here so the
// comment cannot drift from the live counts the way a hardcoded share would.
//
// The two meaning-bearing steps are a green and a teal, far enough apart to
// survive the common CVD types. The gray is deliberately below the chroma floor
// — it is de-emphasis, not a category — and its sub-3:1 contrast is relieved by
// the labelled rows beside it, which carry every value in text.
// `named` draws as a gradient in the ring, so its hex is the swatch fallback.
//
// `unchecked` is not a finding and must not be mistaken for one, but it was drawn as a
// 1.5px hairline and that overcorrected: the largest class on the card — very nearly
// half of every cafe found — was the one thing on it nobody could see, and the row
// carried no swatch at all, so the only class without a mark was the biggest. It is
// hatched now instead. Hatching is the standing convention for "no reading taken", so it
// still cannot be read as a result, while its angle carries its true share the way every
// other class's does. Its band is narrower than theirs: in a ring the angle is the
// quantity and the width is free, so the width is what says this is a different kind of
// thing. It is on the ring at all because a ring drawn over 588 of 1,147 cafes silently
// asserts the other 559 do not exist.
//
// The stripes are tuned against the solid arcs beside them: dense enough to read as one
// band at a glance rather than as loose scratches, light enough that they never compete
// with the two classes that carry the finding.
const HATCH = { angle: 45, period: 5.5, weight: 1.9, ink: "rgba(28,43,26,0.34)" };
const DISCLOSURE_ROWS = [
  // Transparent because nothing is painted behind the hatch — both the arc and the
  // swatch draw stripes straight onto the card, so this row has no flat colour of its own.
  { key: "unchecked" as const, label: "No page we could read",     color: "transparent" },
  { key: "nothing" as const,   label: "No origin mentioned",       color: "var(--text-muted)" },
  { key: "japanOnly" as const, label: "“Japanese matcha” only",    color: "#6eb35c" },
  { key: "named" as const,     label: "Named source, with a link", color: "#2e6027" },
];

// Colour fields come from levelConfig's header* values — the same pair the cafe detail
// panel uses — instead of a fourth hardcoded palette. This card set used to carry its own
// hex values, independently wrong in its own way: B was white text on #4d9740 (3.6:1,
// failing WCAG AA), and D's own accent-as-ink was #9ca3af on #eceef0 (2.18:1, also
// failing) — nobody had checked either. `bg` is always the header wash; `accent` is only
// the giant-letter/label/dot/description ink when the card renders on a light background,
// so it has to be headerText (dark), not headerBg — reusing headerBg there would make the
// letter the same colour as the card behind it, which is also why there's no `border`
// field: it used to equal `bg` for the same reason and made B and D's outer border and
// internal divider both invisible. The render derives those from a generic overlay instead.
const LEVEL_CARDS = [
  { level: "A", title: "Verified Japanese Disclosure", desc: "Names a specific Japanese region, farm or supplier — and links to proof.", accent: levelConfig.A.headerBg,   bg: levelConfig.A.headerBg, onDark: levelConfig.A.headerText === "#ffffff" },
  { level: "B", title: "Japanese Matcha Mentioned",    desc: "Says the matcha is Japanese, but not which region, farm or supplier.",    accent: levelConfig.B.headerText, bg: levelConfig.B.headerBg, onDark: levelConfig.B.headerText === "#ffffff" },
  { level: "C", title: "No Origin Disclosure",         desc: "Serves matcha, but says nothing about where it's from.",         accent: levelConfig.C.headerBg,   bg: levelConfig.C.headerBg, onDark: levelConfig.C.headerText === "#ffffff" },
  { level: "D", title: "Insufficient Information",     desc: "Could not verify enough information across website, menu, or social media.",        accent: levelConfig.D.headerText, bg: levelConfig.D.headerBg, onDark: levelConfig.D.headerText === "#ffffff" },
];


const PROBLEM_FACTS = [
  { icon: Shield,   num: "01", tag: "The Law",    phrase: "No law requires cafes to say where their matcha comes from" },
  { icon: FileText, num: "02", tag: "The Menu",   phrase: 'So most menus just say "matcha" — not where it\'s from' },
  { icon: Search,   num: "03", tag: "The Supply", phrase: "Cheaper powder from outside Japan still sold as \"matcha\"" },
  { icon: Eye,      num: "04", tag: "The Result", phrase: "You have no way to know if it's actually from Japan" },
];

const HARM_CARDS = [
  {
    icon: Leaf,
    label: "The Grower",
    text: "Honest farms in Uji and Nishio lose the premium a real harvest earns — undercut by leaf nobody can trace back to them.",
    fromX: -28,
    sourceLabel: "Watch the proof",
    sourceUrl: "https://www.youtube.com/watch?v=qYh1iXaF-jI",
  },
  {
    icon: User,
    label: "You",
    text: "You pay ceremonial-grade prices for matcha that was never verified — and have no way to check if it's real.",
    fromX: 28,
    sourceLabel: null,
    sourceUrl: null,
  },
];

const PRESS_CARDS = [
  {
    source: "ABC News Australia",
    flag: "🇦🇺",
    type: "video" as const,
    accent: "#FF0000",
    headline: "Matcha producers in Japan warn of fake products from China",
    byline: "Filmed in Uji, Kyoto · ABC News AU",
    domain: "youtube.com",
    quote: "Japanese tea producers speak directly on camera about Chinese counterfeits flooding global markets including Australia.",
    url: "https://www.youtube.com/watch?v=qYh1iXaF-jI",
  },
  {
    source: "10 News Australia",
    flag: "🇦🇺",
    type: "video" as const,
    accent: "#00539b",
    headline: "Global Matcha Shortage Leads To Counterfeit Products And Price Hikes",
    byline: "Channel 10 News · Australia",
    domain: "youtube.com",
    quote: "Australian TV networks report a global matcha shortage is directly driving counterfeit products into cafes and retail — consumers are paying premium prices for fake product.",
    url: "https://www.youtube.com/watch?v=1HvXZgyzKMw",
  },
  {
    source: "The Japan Times",
    flag: "🇯🇵",
    type: "article" as const,
    accent: "#c0392b",
    headline: "Government registers 'Japanese tea' under brand protection system",
    byline: "The Japan Times · July 10, 2026",
    domain: "japantimes.co.jp",
    quote: "Japan's agriculture ministry registered 'Japanese tea' under GI protection specifically to combat intellectual property infringement by counterfeit imitation products amid the global matcha boom.",
    url: "https://www.japantimes.co.jp/news/2026/07/10/japan/japanese-tea-brand-protection/",
  },
];

const HOW_IT_WORKS = [
  { icon: Search,   step: "01", title: "We Discover Cafes",        desc: "We search Google's own business listings for matcha-related cafes across Sydney and Melbourne." },
  { icon: FileText, step: "02", title: "We Verify Evidence",       desc: "Every claim is cross-checked against official websites, menu pages, about sections, and public social media. No guessing allowed." },
  { icon: Shield,   step: "03", title: "We Classify Transparently",desc: "Each cafe receives a level A–D based solely on publicly verifiable evidence — never opinion or taste tests." },
  { icon: Eye,      step: "04", title: "You See the Evidence",     desc: "Every listing shows the exact quote, source URL, and verification date. You can check it yourself." },
];

const EVIDENCE_CARDS = [
  {
    cafe: "Cha Cha Matcha",
    suburb: "Surry Hills · Sydney",
    level: "A",
    levelLabel: "Verified Japanese Disclosure",
    accent: "#2e6027",
    badgeBg: "#e6f4e0",
    border: "rgba(46,96,39,0.45)",
    glow: "rgba(46,96,39,0.28)",
    quote: "Our matcha is stone-ground weekly in Uji, Kyoto — sourced directly from the Tanaka family farm. Every batch ships with the harvest date and garden certificate.",
    source: "Official website · About page",
    date: "Jun 2026",
  },
  {
    cafe: "Ceremony Coffee",
    suburb: "Fitzroy · Melbourne",
    level: "B",
    levelLabel: "Japanese Matcha Mentioned",
    accent: "#3a7a30",
    badgeBg: "#eef7e9",
    border: "rgba(58,122,48,0.3)",
    glow: "rgba(58,122,48,0.2)",
    quote: "We exclusively use Japanese ceremonial grade matcha, carefully selected for its vibrant colour, sweetness, and umami depth.",
    source: "Drinks menu · 2026",
    date: "May 2026",
  },
  {
    cafe: "Morning Ritual",
    suburb: "Newtown · Sydney",
    level: "C",
    levelLabel: "No Origin Disclosed",
    accent: "#9ca3af",
    badgeBg: "#f3f4f6",
    border: "rgba(156,163,175,0.2)",
    glow: "rgba(107,114,128,0.1)",
    quote: null,
    source: "Website, menu & Instagram reviewed",
    date: "Jun 2026",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function SplitWords({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          className="inline-block"
          initial={{ opacity: 0, y: 80, rotateX: -20 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ duration: 0.85, delay: delay + i * 0.07, ease: EASE_EXPO }}
        >
          {word}{i < words.length - 1 ? "\u00A0" : ""}
        </motion.span>
      ))}
    </span>
  );
}

function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const ctrl = animate(0, to, {
      duration: 3.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { if (ref.current) ref.current.textContent = `${Math.round(v)}${suffix}`; },
    });
    return ctrl.stop;
  }, [inView, to, suffix]);
  return <span ref={ref}>{`0${suffix}`}</span>;
}

function Reveal({ children, delay = 0, className = "", style }: {
  children: React.ReactNode; delay?: number; className?: string; style?: React.CSSProperties;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} className={className} style={style}
      initial={{ opacity: 0, y: 44 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.72, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

function TiltCard({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const rX = useMotionValue(0);
  const rY = useMotionValue(0);
  const srX = useSpring(rX, { stiffness: 300, damping: 28 });
  const srY = useSpring(rY, { stiffness: 300, damping: 28 });
  const onMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const { left, top, width, height } = ref.current.getBoundingClientRect();
    rY.set(((e.clientX - left) / width - 0.5) * 16);
    rX.set(-((e.clientY - top) / height - 0.5) * 16);
  };
  const onLeave = () => { rX.set(0); rY.set(0); };
  return (
    <motion.div ref={ref} className={className}
      style={{ ...style, rotateX: srX, rotateY: srY, transformStyle: "preserve-3d" }}
      onMouseMove={onMove} onMouseLeave={onLeave}
      whileHover={{ scale: 1.03, transition: SPRING }}
    >
      {children}
    </motion.div>
  );
}

function FactList({ items }: { items: typeof PROBLEM_FACTS }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <div ref={ref} className="grid grid-cols-1 sm:grid-cols-2 gap-x-10">
      {items.map(({ num, phrase }, i) => (
        <motion.div
          key={num}
          className="py-7 flex flex-col gap-3"
          style={{ borderTop: "1px solid #e5e7eb" }}
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: i * 0.09, ease: EASE_EXPO }}
        >
          <span
            className="text-[16px] font-semibold tracking-[0.25em] tabular-nums"
            style={{ color: "#4d9740" }}
          >
            {num}
          </span>
          <p className="text-[16px] font-semibold text-gray-800 leading-snug">{phrase}</p>
        </motion.div>
      ))}
    </div>
  );
}

// ── Menu evidence card — a plausible cafe menu, scanned and stamped ────────

const MENU_ITEMS = [
  { name: "Flat White", price: "$4.80" },
  { name: "Long Black", price: "$4.50" },
  { name: "Matcha Latte", price: "$7.50", flagged: true },
  { name: "Chai Latte", price: "$5.50" },
];

function MenuEvidenceCard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <div ref={ref} className="relative w-full max-w-[560px] mx-auto" style={{ perspective: 1000 }}>
      {/* Coffee ring stain — a little grounded realism */}
      <div
        className="absolute pointer-events-none rounded-full"
        style={{ top: -32, right: -38, width: 122, height: 122, border: "10px solid rgba(120,84,40,0.10)" }}
      />

      <motion.div
        className="relative rounded-2xl overflow-visible"
        style={{ background: "#fdfcf9", boxShadow: "0 40px 90px rgba(0,0,0,0.45), 0 4px 18px rgba(0,0,0,0.2)" }}
        initial={{ opacity: 0, y: 46, rotate: -3 }}
        animate={inView ? { opacity: 1, y: 0, rotate: -1.4 } : {}}
        transition={{ duration: 0.85, ease: EASE_EXPO }}
      >
        <div className="px-10 pt-9 pb-10 rounded-2xl overflow-hidden relative" style={{ border: "1px solid rgba(0,0,0,0.07)" }}>
          <div className="flex items-center justify-between mb-7">
            <span className="text-[16px] uppercase tracking-[0.22em] font-semibold" style={{ color: "#b3ada0" }}>
              Menu — Beverages
            </span>
            <span className="text-[16px] font-semibold" style={{ color: "#d4cfc3" }}>
              Sydney, AU
            </span>
          </div>

          <div className="space-y-1">
            {MENU_ITEMS.map((item, i) => (
              <div
                key={item.name}
                className="relative flex items-center justify-between rounded-lg px-4 -mx-4"
                style={{ paddingTop: 13, paddingBottom: 13 }}
              >
                <span
                  className="text-[20px] font-medium"
                  style={{ color: item.flagged ? "#3a2f22" : "#9c9488", fontWeight: item.flagged ? 700 : 500 }}
                >
                  {item.name}
                </span>
                <span
                  className="text-[18px] tabular-nums"
                  style={{ color: item.flagged ? "#3a2f22" : "#b3ada0", fontWeight: item.flagged ? 700 : 500 }}
                >
                  {item.price}
                </span>

                {item.flagged && (
                  <motion.div
                    className="absolute inset-0 rounded-lg pointer-events-none"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(220,38,38,0.16) 45%, rgba(220,38,38,0.16) 55%, transparent)" }}
                    initial={{ x: "-120%" }}
                    animate={inView ? { x: "120%" } : {}}
                    transition={{ duration: 1.1, delay: 0.9, ease: EASE }}
                  />
                )}
              </div>
            ))}
          </div>

          <p className="text-[16px] leading-relaxed mt-7 italic" style={{ color: "#c7c1b5" }}>
            Iced or hot · oat milk available
          </p>
        </div>

        {/* Ink stamp — snaps in like a rubber stamp hitting paper.
            It hangs off the menu's right edge on purpose, but the overhang is a share of the
            card, and on a phone the card is the screen: -9% put the stamp's edge exactly on
            the viewport boundary at 390px and past it by 430px, so the word it exists to say
            was the part that got cut. The overhang shrinks to a token -2% until there is a
            margin to hang into. */}
        <motion.div
          className="absolute select-none right-[-2%] sm:right-[-9%]"
          style={{
            top: "48%",
            padding: "14px 20px",
            borderRadius: 10,
            border: "4px solid #dc2626",
            color: "#dc2626",
            background: "rgba(253,252,249,0.88)",
            transform: "rotate(-11deg)",
          }}
          initial={{ opacity: 0, scale: 2.4, rotate: 4 }}
          animate={inView ? { opacity: 0.92, scale: 1, rotate: -11 } : {}}
          transition={{ duration: 0.45, delay: 1.55, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <div className="text-center leading-none">
            <div className="font-black tracking-[0.08em]" style={{ fontSize: "18px" }}>ORIGIN</div>
            <div className="font-black tracking-[0.04em]" style={{ fontSize: "18px" }}>NOT LISTED</div>
          </div>
        </motion.div>
      </motion.div>

      <motion.p
        className="text-center mt-10"
        style={{ fontSize: "16px", color: "rgba(255,255,255,0.3)" }}
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : {}}
        transition={{ duration: 0.6, delay: 2.0 }}
      >
        Illustrative example — a typical Australian cafe menu
      </motion.p>
    </div>
  );
}

// ── Problem chain — causal sequence with a drawing connector ───────────────

function ChainStep({ item, isLast }: { item: typeof PROBLEM_FACTS[number]; isLast: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const Icon = item.icon;

  return (
    <div ref={ref} className="flex gap-6 sm:gap-8">
      {/* Rail — badge + drawing connector to the next step */}
      <div className="flex flex-col items-center flex-shrink-0">
        <motion.div
          className="w-14 h-14 rounded-full flex items-center justify-center relative flex-shrink-0"
          initial={{ scale: 0.7, opacity: 0, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.03)" }}
          animate={inView ? {
            scale: 1, opacity: 1,
            borderColor: "rgba(109,191,94,0.55)",
            backgroundColor: "rgba(77,151,64,0.14)",
          } : {}}
          style={{ borderWidth: 1.5, borderStyle: "solid" }}
          transition={{ duration: 0.55, ease: EASE_EXPO }}
        >
          <Icon size={18} style={{ color: "#7dd56f" }} />
          <motion.span
            className="absolute inset-0 rounded-full pointer-events-none"
            initial={{ boxShadow: "0 0 0 0 rgba(125,213,111,0)" }}
            animate={inView ? { boxShadow: ["0 0 0 0 rgba(125,213,111,0.45)", "0 0 0 14px rgba(125,213,111,0)"] } : {}}
            transition={{ duration: 1.1, delay: 0.15 }}
          />
        </motion.div>

        {!isLast && (
          <div className="w-px flex-1 my-1 relative" style={{ minHeight: 52, background: "rgba(255,255,255,0.1)" }}>
            <motion.div
              className="absolute inset-x-0 top-0 origin-top"
              style={{ background: "linear-gradient(180deg, #4d9740, #7dd56f)", height: "100%" }}
              initial={{ scaleY: 0 }}
              animate={inView ? { scaleY: 1 } : {}}
              transition={{ duration: 0.65, delay: 0.4, ease: EASE }}
            />
          </div>
        )}
      </div>

      {/* Content */}
      <motion.div
        className={isLast ? "pb-2 pt-2" : "pb-12 sm:pb-14 pt-2"}
        initial={{ opacity: 0, x: -18 }}
        animate={inView ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.55, delay: 0.12, ease: EASE_EXPO }}
      >
        <span className="block text-[16px] font-bold uppercase tracking-[0.25em] mb-2" style={{ color: "#6abf5e" }}>
          {item.tag}
        </span>
        <p
          className="font-semibold leading-snug whitespace-normal sm:whitespace-nowrap"
          style={{ fontSize: "clamp(1.15rem, 2.6vw, 1.75rem)", color: "rgba(255,255,255,0.92)", letterSpacing: "-0.01em" }}
        >
          {item.phrase}
        </p>
      </motion.div>
    </div>
  );
}

// ── Harm split — who actually pays for the silence ─────────────────────────

function HarmCard({ card, index }: { card: typeof HARM_CARDS[number]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const Icon = card.icon;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: card.fromX }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.7, ease: EASE_EXPO }}
    >
      <div className="flex items-center gap-4 mb-6">
        <motion.div
          className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 relative"
          style={{ borderWidth: 1.5, borderStyle: "solid", borderColor: "rgba(109,191,94,0.55)", background: "rgba(77,151,64,0.14)" }}
        >
          <Icon size={22} style={{ color: "#7dd56f" }} />
          <motion.span
            className="absolute inset-0 rounded-full pointer-events-none"
            initial={{ boxShadow: "0 0 0 0 rgba(125,213,111,0)" }}
            animate={inView ? { boxShadow: ["0 0 0 0 rgba(125,213,111,0.45)", "0 0 0 14px rgba(125,213,111,0)"] } : {}}
            transition={{ duration: 1.1, delay: 0.15 }}
          />
        </motion.div>
        <span className="text-[16px] font-bold uppercase tracking-[0.25em]" style={{ color: "#6abf5e" }}>
          {String(index).padStart(2, "0")} — {card.label}
        </span>
      </div>
      <p
        className="font-semibold leading-snug"
        style={{ fontSize: "clamp(1.2rem, 2.3vw, 1.45rem)", color: "rgba(255,255,255,0.92)", letterSpacing: "-0.01em", maxWidth: "26rem" }}
      >
        {card.text}
      </p>
      {card.sourceUrl && (
        <motion.a
          href={card.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-5 text-[16px] font-semibold"
          style={{ color: "#7dd56f", textDecoration: "none" }}
          whileHover={{ x: 4 }}
          transition={{ duration: 0.18 }}
        >
          {card.sourceLabel}
          <ExternalLink size={14} />
        </motion.a>
      )}
    </motion.div>
  );
}

function PressRow({ card }: { card: typeof PRESS_CARDS[number] }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      className="group cursor-pointer"
      style={{ borderBottom: "1px solid #e5e7eb" }}
      onClick={() => setOpen((v) => !v)}
      whileHover={{ backgroundColor: "rgba(0,0,0,0.015)" }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-center gap-5 sm:gap-8 py-7 sm:py-9">
        {/* Source icon */}
        <div className="flex-shrink-0">
          {card.type === "video" ? (
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "#FF0000" }}>
              <Play size={16} fill="white" className="text-white ml-0.5" />
            </div>
          ) : (
            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: card.accent + "14" }}>
              <FileText size={16} style={{ color: card.accent }} />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            {/* The flag leads the byline, before the masthead. Emoji are font-dependent
                glyphs rather than assets, so this mark is the platform's to draw, not
                ours — it will not take colour, weight or size from the type around it,
                and it renders differently across Apple, Windows and Android. It is here
                because the country is the first thing worth knowing about a source.
                aria-hidden because the masthead beside it already names the outlet, and
                "flag of Australia" read aloud mid-byline adds nothing a listener needs. */}
            {card.flag && (
              <span aria-hidden className="text-[16px] leading-none">{card.flag}</span>
            )}
            <span className="text-[16px] font-semibold text-gray-400 uppercase tracking-wide">{card.source}</span>
          </div>
          <h3 className="font-semibold text-gray-900 leading-snug" style={{ fontSize: "clamp(1rem, 2.5vw, 1.2rem)" }}>
            &ldquo;{card.headline}&rdquo;
          </h3>
        </div>

        {/* Arrow / expand toggle */}
        <motion.div
          className="flex-shrink-0 text-gray-300"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.25 }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </motion.div>
      </div>

      {/* Expandable detail */}
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="overflow-hidden"
      >
        <div className="pb-8 pl-16 sm:pl-[4.75rem] pr-4">
          <p className="text-[16px] text-gray-500 leading-relaxed mb-5 max-w-2xl">
            {card.quote}
          </p>
          <motion.a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[16px] font-semibold"
            style={{ color: card.accent, textDecoration: "none" }}
            whileHover={{ x: 4 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            {card.type === "video" ? "Watch video" : "Read article"}
            <ArrowRight size={14} />
          </motion.a>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Origin-disclosure donut ────────────────────────────────────────────────

// One geometry for the whole drawing. Every arc length, the leader-line anchor
// and the centre figure derive from the live counts, so the picture cannot
// drift from the numbers printed beside it.
// `hatch` is the band width for the one class that is not a finding — narrower than
// `stroke`, so it can carry its true share without being read as one of the three.

const BAR_EASE = "cubic-bezier(.25,.8,.3,1)";
// The emphasis hue, validated against the de-emphasis grey (deutan ΔE 26.3)
const ACCENT = "#2e6027";

// Reading order along the bar: the largest absence first, the finding last, so
// the eye travels from "nobody could ask" to "these ones answered".
const BAR_ORDER = ["unchecked", "nothing", "japanOnly", "named"] as const;

// Per-segment entrance. Each segment grows its own width from nothing.
const SEGMENT_MOTION: Record<string, { duration: number; delay: number }> = {
  named:     { duration: 0.55, delay: 0.12 },
  japanOnly: { duration: 0.45, delay: 0.38 },
  nothing:   { duration: 1.10, delay: 0.55 },
  unchecked: { duration: 1.10, delay: 0.95 },
};

/** True once the node has scrolled into view. Fires on first intersection only. */
function useFirstIntersection<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** Eased 0→1 ramp the counts multiply through. */
function useCountProgress(run: boolean, delay: number, duration = 900) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    let t0 = 0;
    const timer = window.setTimeout(() => {
      const step = (t: number) => {
        if (!t0) t0 = t;
        const x = Math.min((t - t0) / duration, 1);
        setP(1 - Math.pow(1 - x, 3)); // ease-out-cubic
        if (x < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [run, delay, duration]);
  return p;
}

/**
 * How many cafes disclose an origin, shown as one whole split three ways.
 *
 * The ring and the rows read from the same array in the same order, so a segment
 * can never be a different size from the count beside it. Percentages are derived
 * from the counts rather than written down, so they stay true as the data moves.
 */
function DisclosureBlock({ data }: { data: typeof DEFAULT_DISCLOSURE }) {
  // The ring and the rate are over cafes that could be checked. A cafe with no page
  // to read has not withheld its origin — it was never asked — and counting it as a
  // non-disclosure would attribute silence to the cafe that belongs to the method.
  // Two bases, and they are not interchangeable. The ring and its rows cover every cafe
  // found, so nothing is left off the drawing. The rate above it is over the cafes that
  // could actually be read, because a cafe nobody could ask has not declined to answer.
  const checked = data.nothing + data.japanOnly + data.named || 1;
  const everyCafe = checked + data.unchecked;
  const rows = DISCLOSURE_ROWS.map((r) => ({
    ...r,
    count: data[r.key],
    pct: (data[r.key] / everyCafe) * 100,
  }));
  const get = (key: string) => rows.find((r) => r.key === key)!;

  // Derived, never written down, so the headline cannot drift from the rows.
  // Odds rather than a percentage: "1 in 7" is a rate a reader can carry out of the
  // page and apply to the next cafe they walk into, which "17%" is not.
  // Denominator is the cafes whose page we could read, not every cafe found. Over
  // all 1,147 this would read 1 in 13, but that rate can only be true if the 559 we
  // could not reach are all silent — and we do not know that. The narrower claim is
  // the one the evidence supports.
  // Numerator is `named` alone: the japanOnly row says only "Japanese matcha", which
  // is the headline's "won't tell you where" restated as a claim, so it does not
  // count as telling you — even though it still counts as disclosure on the bar.
  const odds = Math.round(checked / (data.named || 1));

  const num = (n: number) => n.toLocaleString("en-AU");

  const [wrapRef, seen] = useFirstIntersection<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  // Reduced motion lands on the final frame at once, without waiting to scroll.
  const drawn = reduced || seen;
  const progress = useCountProgress(seen && !reduced, 1000);
  const p = reduced ? 1 : progress;
  const counting = p < 1;

  const [hovered, setHovered] = useState<string | null>(null);

  // One scale for the whole block. Outside the SVG nothing drops below 18px and
  // nothing goes past weight 500 — where something needs to recede it is muted
  // rather than shrunk, so every line stays comfortably readable.
  const TYPE = {
    // The one line a reader must leave with, so it is sized to be read before
    // the chart is: statement weight, not caption weight.
    statement:  {
      fontSize: "clamp(1.75rem, 3.4vw, 2.5rem)",
      fontWeight: 600,
      lineHeight: 1.15,
      letterSpacing: "-0.025em",
      color: "var(--text-primary)",
    },
    subline:    { fontSize: "1.25rem",  fontWeight: 400, color: "var(--text-secondary)" },
    // Secondary, not tertiary. --text-tertiary (#9ca3af) sits at 2.5:1 on this card —
    // under the 4.5:1 floor — and the two lines wearing this style are the denominator
    // the chart is quoted over and the control that opens the audit trail. Methodology
    // that cannot be read is methodology that may as well not be published, and a
    // control that recedes below the readability floor is one nobody will find.
    // --text-secondary clears AA at 4.8:1 and still sits well behind the statement.
    caption:    { fontSize: "1.125rem", fontWeight: 400, color: "var(--text-secondary)" },
    rowLabel:   { fontSize: "20px",     fontWeight: 400, color: "var(--text-primary)" },
    rowPercent: { fontSize: "18px",     fontWeight: 400, color: "var(--text-secondary)" },
    rowCount:   { fontSize: "21px",     fontWeight: 500, color: "var(--text-primary)" },
  } as const;

  return (
    <div
      ref={wrapRef}
      style={{
        fontFamily: "var(--font-inter-tight)",
        fontVariantNumeric: "tabular-nums",
        background: "var(--surface-2)",
        border: "0.5px solid var(--border)",
        borderRadius: 14,
        padding: "2rem 2.25rem",
      }}
    >
      {/* This read "Where the other 83% leaves you", which was a transition rather than a
          finding: it pointed at the chart instead of saying anything, and 83% is the
          complement of the 17% on the screen before, so the card opened by asking the
          reader to subtract their way back to a number they had just been shown.
          It states the rate directly now, and closes the headline three screens up —
          "most cafes won't tell you where" / "1 in 7 tells you". */}
      <p style={TYPE.statement}>
        <span style={{ color: ACCENT }}>1 in {odds}</span> tells you.
      </p>
      {/* The denominator, and nothing else. A "Why 588 and not 1,147?" disclosure used to
          sit under this line, defending the gap between the two figures. It is gone because
          the gap is gone: the page no longer claims to have read 1,147, so there is nothing
          left to excuse. The 559 we could not reach was never a finding about cafes anyway —
          it is a limit of the crawl, and a survey that footnotes its own tooling at the
          reader is asking to be graded on effort. It stays where it belongs: an unfilled,
          labelled segment on the bar below, visible without being argued. */}
      <p className="mt-3" style={TYPE.caption}>
        Of the {num(checked)} cafés we could read, across Sydney and Melbourne.
      </p>

      <div
        className="flex flex-wrap items-center"
        style={{
          gap: 36,
          marginTop: 28,
          paddingTop: 32,
          borderTop: "0.5px solid var(--border)",
        }}
      >
        {/* Part-to-whole with four long-named classes, two of them close in size
            (559 vs 488) — the case a ring reads worst. A horizontal stacked bar
            puts every class on one axis where the eye compares lengths directly,
            and the rows beneath carry every value as text. */}
        <div className="w-full min-w-0">
          <div
            role="img"
            aria-label={
              `Of ${num(everyCafe)} cafés found: ${num(data.unchecked)} had no page we ` +
              `could read, ${num(data.nothing)} published nothing about origin, ` +
              `${num(data.japanOnly)} say only that the matcha is Japanese, and ` +
              `${num(data.named)} name a source and link to it.`
            }
            className="flex w-full"
            style={{ height: 46, gap: 2, borderRadius: 6 }}
          >
            {BAR_ORDER.map((key, i) => {
              const row = get(key);
              const dim = hovered !== null && hovered !== key;
              return (
                <div
                  key={key}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                  className="relative h-full"
                  style={{
                    // The width is the datum. Grown from zero on first sight, in
                    // draw order, so the shape assembles rather than appearing.
                    flexGrow: drawn ? row.count : 0,
                    flexBasis: 0,
                    minWidth: drawn ? 3 : 0,
                    opacity: dim ? 0.45 : 1,
                    background:
                      key === "unchecked"
                        ? `repeating-linear-gradient(${HATCH.angle + 90}deg,` +
                          ` transparent 0 3px, ${HATCH.ink} 3px 5px)`
                        : key === "nothing"
                          ? "var(--text-muted)"
                          : key === "japanOnly"
                            ? "#6eb35c"
                            : "#2e6027",
                    boxShadow:
                      key === "unchecked" ? "inset 0 0 0 1px var(--border-strong)" : undefined,
                    borderTopLeftRadius:     i === 0 ? 5 : 0,
                    borderBottomLeftRadius:  i === 0 ? 5 : 0,
                    borderTopRightRadius:    i === BAR_ORDER.length - 1 ? 5 : 0,
                    borderBottomRightRadius: i === BAR_ORDER.length - 1 ? 5 : 0,
                    transition: reduced
                      ? "opacity .2s ease"
                      : `flex-grow 1.1s ${BAR_EASE} ${SEGMENT_MOTION[key].delay}s,` +
                        " opacity .25s ease",
                  }}
                >
                  {/* Per-mark tooltip. A stacked bar is read by comparing lengths;
                      the exact figure has to be reachable without leaving the mark. */}
                  {hovered === key && (
                    <div
                      role="status"
                      className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none z-20"
                      style={{
                        bottom: "calc(100% + 10px)",
                        background: "var(--text-primary)",
                        color: "var(--surface-1)",
                        padding: "7px 11px",
                        borderRadius: 8,
                        fontSize: 16,
                        boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
                      }}
                    >
                      {row.label} · {num(row.count)} · {row.pct.toFixed(1)}%
                    </div>
                  )}

                  {/* Labelled inline only where the text provably fits; the rest
                      are carried by the rows, never clipped. */}
                  {row.pct >= 18 && (
                    <span
                      className="absolute inset-0 flex items-center justify-center px-2"
                      style={{
                        fontSize: 17,
                        fontWeight: 500,
                        color: key === "unchecked" ? "var(--text-secondary)" : "#ffffff",
                        opacity: drawn ? 1 : 0,
                        transition: reduced ? undefined : `opacity .4s ease ${0.9 + i * 0.1}s`,
                      }}
                    >
                      {row.pct.toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div
            className="flex items-baseline justify-between"
            style={{ marginTop: 10, fontSize: 17, color: "var(--text-tertiary)" }}
          >
            <span>every cafe we found</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{num(everyCafe)}</span>
          </div>
        </div>

        <div className="flex-1" style={{ minWidth: 260 }}>
          {/* Rows — legend, direct labels and table view in one. */}
          <div className="mt-6">
            {rows.map((r, i) => (
              <div
                key={r.key}
                className="flex items-center gap-3 px-2 py-3.5"
                onMouseEnter={() => setHovered(r.key)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  borderTop: i === 0 ? "none" : "0.5px solid var(--border)",
                  background: hovered === r.key ? "var(--surface-1)" : "transparent",
                  opacity: drawn ? 1 : 0,
                  transform: drawn ? "translateY(0)" : "translateY(8px)",
                  transition: reduced
                    ? "background .25s ease"
                    : `opacity .5s ${BAR_EASE} ${0.9 + i * 0.12}s,` +
                      ` transform .5s ${BAR_EASE} ${0.9 + i * 0.12}s,` +
                      " background .25s ease",
                }}
              >
                {/* The swatch carries the arc's own treatment, hatch included, so the row
                    and the band are recognisably the same thing. The unread class used to
                    be the only row with no mark at all, which left the largest class on
                    the card as the one a reader had nothing to match against. At 10px the
                    stripes need a tighter period than the arc to still read as stripes. */}
                <span
                  aria-hidden="true"
                  className="shrink-0"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 1,
                    boxShadow:
                      r.key === "unchecked"
                        ? "inset 0 0 0 0.5px var(--border-strong)"
                        : undefined,
                    background:
                      r.key === "named"
                        ? "#2e6027"
                        : r.key === "unchecked"
                          ? `repeating-linear-gradient(${HATCH.angle + 90}deg,` +
                            ` transparent 0 1.6px, ${HATCH.ink} 1.6px 2.9px)`
                          : r.color,
                    opacity: r.key === "nothing" ? 0.3 : 1,
                  }}
                />
                <span className="min-w-0 flex-1" style={TYPE.rowLabel}>
                  {r.label}
                </span>

                {/* The rate, one decimal — an integer would round 0.5% to 1%
                    and overstate the smallest share. */}
                <span
                  className="shrink-0 whitespace-nowrap text-right"
                  style={TYPE.rowPercent}
                >
                  {r.pct.toFixed(1)}%
                </span>
                <span
                  className="shrink-0 whitespace-nowrap text-right"
                  style={{
                    ...TYPE.rowCount,
                    width: 66,
                    // The one row worth drawing the eye to keeps the accent.
                    ...(r.key === "named" ? { color: ACCENT } : null),
                  }}
                  aria-hidden={counting || undefined}
                >
                  {num(Math.round(r.count * p))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <Reveal>
      <span className="inline-flex items-center gap-2 text-matcha-700 text-[16px] font-bold tracking-[0.22em] uppercase mb-5">
        <Icon size={10} />{text}
      </span>
    </Reveal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [authOpen, setAuthOpen] = useState(false);
  const [disclosure, setDisclosure] = useState(DEFAULT_DISCLOSURE);
  // Live figures for the overture that plays above the original page
  const [overtureStats, setOvertureStats] = useState<OvertureStats>(null);
  const [verified, setVerified] = useState<Cafe[]>([]);
  const { scrollY } = useScroll();

  useEffect(() => {
    // Level A only — 86 rows, enough for the marquee, the plotted map and the
    // quoted cards, without pulling all 1,147 onto the landing page.
    fetchCafes({ level: "A" }).then(setVerified).catch(() => {/* section self-hides */});
  }, []);

  useEffect(() => {
    fetchStats().then((s) => {
      // The unreadable rows sit inside C and D, so they come out of "nothing found"
      // rather than being added on top of the total.
      const nothing = (s.byLevel.C ?? 0) + (s.byLevel.D ?? 0) - s.unassessable;
      setDisclosure({
        total: s.total,
        unchecked: s.unassessable,
        nothing: Math.max(0, nothing),
        japanOnly: s.byLevel.B ?? 0,
        named: s.byLevel.A ?? 0,
      });
      setOvertureStats({
        total: s.total,
        byLevel: s.byLevel,
        assessable: s.assessable,
        sydney: s.sydney,
        melbourne: s.melbourne,
      });
    }).catch(() => {/* keep defaults */});
  }, []);
  const heroY = useTransform(scrollY, [0, 700], [0, -140]);
  const heroOpacity = useTransform(scrollY, [0, 480], [1, 0]);

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      <Navbar />

      {/* ── OVERTURE ─ new full-height sequence, plays before the original page ─ */}
      <LandingOverture stats={overtureStats} verified={verified} />

      {/* ── STATS ──────────────────────────────────────────────────────── */}
      {/* Top padding is small: the 17% statement above hands straight over to
          its own breakdown, so a full section break here reads as a dead gap. */}
      <section className="pt-14 pb-16 sm:pt-16 sm:pb-24 px-5 bg-white">
        <div className="max-w-4xl mx-auto">
          {/* Editorial lead-in */}
          <div className="mb-20">
            <motion.div
              className="flex items-center justify-center gap-3 mb-8"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              <div style={{ width: 40, height: 1, background: "#2e6027" }} />
              {/* Was "How it works" — but the section under it is the breakdown of the
                  finding, and the actual how-it-works (Steps 01–04, "How we verify every
                  cafe") is its own section further down. Two sections claiming the same
                  label is why the copy beneath this one kept drifting back into method. */}
              <span className="uppercase tracking-[0.2em] font-semibold" style={{ fontSize: "16px", color: "#2e6027" }}>
                The breakdown
              </span>
              <div style={{ width: 40, height: 1, background: "#2e6027" }} />
            </motion.div>

            <motion.h2
              className="text-center font-bold leading-[1.1] tracking-tight"
              style={{ fontSize: "clamp(1.75rem, 5vw, 3.25rem)", color: "#1c2b1a" }}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.72, delay: 0.08, ease: EASE }}
            >
              {/* This read "We scan each cafe's official website and show you exactly what
                  they claim about their matcha sourcing", followed by "No opinions, no
                  guesses — just their own words." Both sentences were the hero's opening
                  paragraph again in different words, which is the worst kind of repetition:
                  it looks like an edit nobody finished. The method is stated once, up top.
                  This heading now does the job this position actually needs — naming what
                  the chart underneath is — so the reader arrives at the bar already knowing
                  what is being counted. */}
              Every cafe we found, sorted by{" "}
              <span style={{ color: "#2e6027" }}>what it told us</span>.
            </motion.h2>
          </div>

          {/* Origin disclosure — one whole, split three ways */}
          <DisclosureBlock data={disclosure} />
        </div>
      </section>

      {/* ── WHY TRANSPARENCY ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ background: "#1a2318" }}>
        {/* Layered ambient glows */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(77,151,64,0.12), transparent 70%)",
        }} />
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: "radial-gradient(ellipse 40% 40% at 85% 90%, rgba(77,151,64,0.08), transparent)",
        }} />
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: "radial-gradient(ellipse 35% 35% at 10% 60%, rgba(77,151,64,0.05), transparent)",
        }} />
        {/* Subtle noise texture via repeating gradient */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }} />

        <div className="relative px-5">

          {/* Top section — headline & subline */}
          <div className="max-w-5xl mx-auto pt-24 sm:pt-28 pb-16 sm:pb-20">

            {/* Eyebrow pill */}
            <motion.div
              className="flex justify-center mb-12"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              <span
                className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full uppercase tracking-[0.22em] font-semibold"
                style={{ fontSize: "16px", color: "#6abf5e", background: "rgba(77,151,64,0.1)", border: "1px solid rgba(77,151,64,0.2)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#6abf5e" }} />
                The Problem
              </span>
            </motion.div>

            {/* Massive headline */}
            <motion.h2
              className="text-center font-bold leading-[1.0]"
              style={{ fontSize: "clamp(2.5rem, 7vw, 5.5rem)", color: "#f5f5f0", letterSpacing: "-0.035em" }}
              initial={{ opacity: 0, y: 36 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: 0.08, ease: EASE }}
            >
              &ldquo;Matcha.&rdquo; That&rsquo;s the whole label.
              <br />
              You read{" "}
              <span className="italic" style={{ color: "#6abf5e" }}>&ldquo;Japan&rdquo;</span> anyway.
            </motion.h2>

            {/* Subline */}
            <motion.p
              className="text-center mx-auto mt-10"
              style={{ fontSize: "clamp(1.05rem, 2.5vw, 1.35rem)", color: "rgba(255,255,255,0.45)", maxWidth: "44rem", lineHeight: 1.75 }}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.72, delay: 0.18, ease: EASE }}
            >
              No law requires a country, a farm, or a grade on the label — so most cafes just leave it
              blank, and you fill the gap yourself. Sometimes that assumption is right. Often, no one
              — not even the cafe — actually knows.
            </motion.p>
          </div>

          {/* Menu evidence card — the omission, made visible */}
          <div className="max-w-5xl mx-auto pb-16 sm:pb-20">
            <MenuEvidenceCard />
          </div>

          {/* Divider line */}
          <div className="max-w-6xl mx-auto">
            <motion.div
              style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.1) 20%, rgba(255,255,255,0.1) 80%, transparent)" }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.2, ease: EASE }}
            />
          </div>

          {/* Facts — a causal chain, not a list */}
          <div className="max-w-5xl mx-auto py-16 sm:py-20">
            {PROBLEM_FACTS.map((item, i) => (
              <ChainStep key={item.num} item={item} isLast={i === PROBLEM_FACTS.length - 1} />
            ))}
          </div>

          {/* Harm split — who actually pays for the silence */}
          <div className="max-w-4xl mx-auto pb-16 sm:pb-20">
            <div className="text-center mb-16 sm:mb-20">
              <span
                className="block uppercase tracking-[0.22em] font-semibold mb-5"
                style={{ fontSize: "16px", color: "#7dd56f" }}
              >
                Who Pays For The Silence
              </span>
              <h3
                className="font-bold leading-[1.08] mx-auto"
                style={{ fontSize: "clamp(1.9rem, 4.2vw, 3rem)", color: "#f5f5f0", letterSpacing: "-0.025em", maxWidth: "28rem" }}
              >
                Farmers earn less. You pay more.
              </h3>
            </div>
            <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-y-16 sm:gap-y-0 sm:gap-x-16">
              <div
                className="hidden sm:block absolute left-1/2 top-1 bottom-1 w-px -translate-x-1/2"
                style={{ background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.14) 12%, rgba(255,255,255,0.14) 88%, transparent)" }}
              />
              {HARM_CARDS.map((card, i) => (
                <HarmCard key={card.label} card={card} index={i + 1} />
              ))}
            </div>
          </div>

        </div>
      </section>

      {/* ── PRESS PROOF ────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-5" style={{ background: "#ffffff" }}>
        <div className="max-w-5xl mx-auto">

          {/* Eyebrow */}
          <Reveal>
            <div className="flex items-center justify-center gap-3 mb-6">
              <div style={{ width: 40, height: 1, background: "#d1d5db" }} />
              <span className="uppercase tracking-[0.22em] font-semibold" style={{ fontSize: "16px", color: "#9ca3af" }}>
                As reported by
              </span>
              <div style={{ width: 40, height: 1, background: "#d1d5db" }} />
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <h2
              className="text-center font-bold leading-[1.1] tracking-tight mb-16 sm:mb-20"
              style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)", color: "#1c2b1a" }}
            >
              This isn&apos;t speculation.<br className="hidden sm:block" /> Global newsrooms are already reporting it.
            </h2>
          </Reveal>

          {/* Press list — clean stacked rows */}
          <div className="flex flex-col">
            {PRESS_CARDS.map((card, i) => (
              <Reveal key={card.source} delay={i * 0.08}>
                <PressRow card={card} />
              </Reveal>
            ))}
          </div>

        </div>
      </section>

      {/* ── TRANSPARENCY LEVELS ──────────────────────────────────────── */}
      <section className="relative py-20 sm:py-28 px-5 overflow-hidden" style={{ background: "#ffffff" }}>
        {/* Subtle background grid */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.4]" style={{
          backgroundImage: "linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }} />

        <div className="relative max-w-6xl mx-auto">

          {/* Header */}
          <div className="text-center mb-24 sm:mb-32">
          <Reveal>
              <div className="flex items-center justify-center gap-3 mb-10">
                <div style={{ width: 40, height: 1, background: "#2e6027" }} />
                <span className="uppercase tracking-[0.22em] font-semibold" style={{ fontSize: "16px", color: "#2e6027" }}>
                  Classification System
                </span>
                <div style={{ width: 40, height: 1, background: "#2e6027" }} />
              </div>
            </Reveal>
            <Reveal delay={0.05}>
              <h2
                className="font-bold leading-[1.0] tracking-tight mb-8"
                style={{ fontSize: "clamp(2.5rem, 6vw, 4.5rem)", color: "#1c2b1a", letterSpacing: "-0.035em" }}
              >
                <span style={{ color: "#2e6027" }}>4</span> levels of<br /> transparency
              </h2>
            </Reveal>
            <Reveal delay={0.1}>
              <div className="flex justify-center">
                <span
                  className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full font-semibold"
                  style={{ fontSize: "16px", color: "#2e6027", background: "rgba(46,96,39,0.08)", border: "1px solid rgba(46,96,39,0.18)" }}
                >
                  <CheckCircle2 size={13} strokeWidth={2.5} />
                  Publicly verifiable evidence only — never taste, never guesswork
                </span>
              </div>
            </Reveal>
          </div>

          {/* 2×2 Level grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
            {LEVEL_CARDS.map((card, i) => (
              <Reveal key={card.level} delay={i * 0.08}>
                <motion.div
                  className="relative rounded-3xl overflow-hidden h-full"
                  style={{
                    background: card.bg,
                    // card.border used to equal card.bg for B and D (both derived from the same
                    // headerBg), which made this outer border and the divider below it identical
                    // to the fill they sit on — invisible, same failure as the accent-as-ink bug.
                    // A generic light-on-dark / dark-on-light overlay works for any bg lightness,
                    // so nothing here needs a fifth per-level hex just for a hairline.
                    border: `1px solid ${card.onDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)"}`,
                    boxShadow: card.onDark ? "0 1px 3px rgba(0,0,0,0.12)" : "0 1px 3px rgba(0,0,0,0.04)",
                  }}
                  whileHover={{
                    y: -6,
                    borderColor: card.onDark ? "rgba(255,255,255,0.32)" : card.accent,
                    boxShadow: card.onDark
                      ? `0 24px 60px ${card.accent}55, 0 4px 16px rgba(0,0,0,0.22)`
                      : `0 24px 60px ${card.accent}15, 0 4px 16px rgba(0,0,0,0.06)`,
                  } as any}
                  transition={SPRING}
                >
                  <div className="p-8 sm:p-10">
                    {/* Giant letter + label */}
                    <div className="flex items-start justify-between mb-8">
                      <div className="flex items-center gap-5">
                        <span
                          className="font-bold leading-none"
                          style={{ fontSize: "clamp(3.5rem, 6vw, 5rem)", color: card.onDark ? "#ffffff" : card.accent, letterSpacing: "-0.04em", lineHeight: 0.85 }}
                        >
                          {card.level}
                        </span>
                        <div>
                          {/* onDark:false's 0.7 opacity was tuned against D's very pale bg (9.6:1 at
                              0.85, still fine much lower). B is a darker bg than D, and at that same
                              0.7 its label dropped to 3.74:1 against B's own background — under the
                              4.5:1 floor for 16px text. 0.85 clears both (B 5.1:1, D 9.6:1). */}
                          <div
                            className="text-[16px] font-bold tracking-[0.2em] uppercase mb-1.5"
                            style={{ color: card.onDark ? "rgba(255,255,255,0.78)" : card.accent, opacity: card.onDark ? 1 : 0.85 }}
                          >
                            Level {card.level}
                          </div>
                          <h3 className="font-bold" style={{ fontSize: "clamp(1.1rem, 2vw, 1.3rem)", color: card.onDark ? "#ffffff" : "#111827" }}>
                            {card.title}
                          </h3>
                        </div>
                      </div>
                      {/* Status dot. Same 0.7 -> 0.85 reasoning as the label above: it's a non-text
                          UI indicator (WCAG 1.4.11, 3:1 floor against its background), and B's dot
                          was 2.47:1 at 0.5 opacity. 0.65 clears both (B 3.4:1, D 5.1:1). */}
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0 mt-2"
                        style={{ background: card.onDark ? "#ffffff" : card.accent, opacity: card.onDark ? 0.55 : 0.65 }}
                      />
                    </div>

                    {/* Divider */}
                    {/* Same card.border bug as the outer border above: this was invisible on
                        B and D because it matched their own background exactly. */}
                    <div className="h-px mb-6" style={{ background: card.onDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)" }} />

                    {/* Description. This was a hardcoded #6b7280 for every onDark:false card,
                        which was never checked against either background it actually renders
                        on: 1.9:1 on B's green, 3.9:1 on D's pale gray — both under the 4.5:1
                        floor for body text, B badly so. card.accent (headerText) at 0.8 opacity
                        clears both: B 4.62:1, D 8.27:1. */}
                    <p
                      className="leading-relaxed"
                      style={{ fontSize: "clamp(1rem, 1.8vw, 1.1rem)", color: card.onDark ? "rgba(255,255,255,0.82)" : card.accent, opacity: card.onDark ? undefined : 0.8 }}
                    >
                      {card.desc}
                    </p>
                  </div>
                </motion.div>
              </Reveal>
            ))}
          </div>

          {/* Legal commitment */}
          <Reveal delay={0.3}>
            <motion.div
              className="mt-16 sm:mt-20 rounded-3xl py-10 px-8 sm:px-12 flex flex-col sm:flex-row items-start gap-6 bg-white"
              style={{ border: "1px solid #d4edcc", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #e6f4e0, #d4edcc)" }}>
                <Shield size={22} className="text-matcha-700" />
              </div>
              <div>
                <p className="font-bold text-gray-900 mb-2" style={{ fontSize: "clamp(1.05rem, 2vw, 1.25rem)" }}>
                  Legal commitment: We never say &ldquo;fake&rdquo; or &ldquo;bad&rdquo;.
                </p>
                <p className="text-gray-500 leading-relaxed" style={{ fontSize: "clamp(1rem, 1.8vw, 1.1rem)" }}>
                  We only report what cafes publicly disclose — or don&apos;t. &ldquo;No disclosure found&rdquo; is a factual observation, not an accusation. Every classification can be independently verified.
                </p>
              </div>
            </motion.div>
          </Reveal>

        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 sm:py-28 px-5" style={{ background: "#ffffff" }}>
        <div className="max-w-6xl mx-auto">

          {/* Header */}
          <div className="text-center mb-24 sm:mb-32">
            <Reveal>
              <div className="flex items-center justify-center gap-3 mb-10">
                <div style={{ width: 40, height: 1, background: "#2e6027" }} />
                <span className="uppercase tracking-[0.22em] font-semibold" style={{ fontSize: "16px", color: "#2e6027" }}>
                  Process
                </span>
                <div style={{ width: 40, height: 1, background: "#2e6027" }} />
              </div>
            </Reveal>
            <Reveal delay={0.05}>
              <h2
                className="font-bold leading-[1.0] tracking-tight mb-8"
                style={{ fontSize: "clamp(2.5rem, 6vw, 4.5rem)", color: "#1c2b1a", letterSpacing: "-0.035em" }}
              >
                How we verify<br /> every cafe
              </h2>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="text-gray-400 max-w-2xl mx-auto leading-relaxed" style={{ fontSize: "clamp(1.05rem, 2.5vw, 1.3rem)" }}>
                A strict, repeatable process with zero guesswork.
              </p>
            </Reveal>
          </div>

          {/* Steps — alternating layout */}
          <div className="flex flex-col gap-0">
            {HOW_IT_WORKS.map((item, i) => {
              const Icon = item.icon;
              const isLast = i === HOW_IT_WORKS.length - 1;
              return (
                <Reveal key={item.step} delay={i * 0.08}>
                  <div className="relative flex items-stretch gap-8 sm:gap-14">
                    {/* Timeline rail */}
                    <div className="flex flex-col items-center flex-shrink-0">
                      <motion.div
                        className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center flex-shrink-0"
                        style={{ background: "#f2f8f0", border: "1px solid #d4edcc" }}
                        whileHover={{ scale: 1.1, background: "#e6f4e0", transition: SPRING }}
                      >
                        <Icon size={24} style={{ color: "#2e6027" }} />
                      </motion.div>
                      {!isLast && (
                        <motion.div
                          className="w-px flex-1 my-1"
                          style={{ background: "linear-gradient(to bottom, #d4edcc, #e5e7eb)" }}
                          initial={{ scaleY: 0, originY: 0 }}
                          whileInView={{ scaleY: 1 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
                        />
                      )}
                    </div>

                    {/* Content */}
                    <div className={`pb-16 sm:pb-20 ${isLast ? "pb-0 sm:pb-0" : ""}`}>
                      <span
                        className="font-bold tabular-nums block mb-3"
                        style={{ fontSize: "clamp(1rem, 1.2vw, 1.05rem)", color: "#2e6027", letterSpacing: "0.15em" }}
                      >
                        STEP {item.step}
                      </span>
                      <h3
                        className="font-bold text-gray-900 mb-4"
                        style={{ fontSize: "clamp(1.3rem, 2.5vw, 1.75rem)", letterSpacing: "-0.02em" }}
                      >
                        {item.title}
                      </h3>
                      <p className="text-gray-500 leading-relaxed max-w-lg" style={{ fontSize: "clamp(1rem, 1.8vw, 1.15rem)" }}>
                        {item.desc}
                      </p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>

        </div>
      </section>

      {/* ── PROOF ─ real evidence, then the map, right before the ask ──── */}
      <LandingProof verified={verified} />

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-20 px-5 max-w-7xl mx-auto">
        <Reveal>
          <div className="relative rounded-3xl p-10 sm:p-14 text-center overflow-hidden"
            style={{ background: "linear-gradient(145deg, #0a1a0b 0%, #1e4a1a 55%, #2d6025 100%)" }}
          >
            {[
              { x: "8%",  y: "25%", size: 280, color: "#2e6027", dur: 7, d: 0 },
              { x: "85%", y: "65%", size: 220, color: "#4d9740", dur: 9, d: 2 },
            ].map((orb, i) => (
              <motion.div key={i} className="absolute rounded-full pointer-events-none"
                style={{ width: orb.size, height: orb.size, left: orb.x, top: orb.y, background: orb.color, filter: "blur(72px)", opacity: 0.3, transform: "translate(-50%, -50%)" }}
                animate={{ scale: [1, 1.22, 0.93, 1.1, 1], opacity: [0.3, 0.38, 0.22, 0.32, 0.3] }}
                transition={{ duration: orb.dur, repeat: Infinity, ease: "easeInOut", delay: orb.d }}
              />
            ))}

            <div className="relative z-10">
              <motion.div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-8"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}
                animate={{ rotate: [0, 6, -4, 3, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              >
                <MessageSquarePlus size={28} className="text-matcha-300" />
              </motion.div>

              <h2
                className="font-bold leading-[1.0] tracking-tight text-white mb-8"
                style={{ fontSize: "clamp(2.5rem, 6vw, 4.5rem)", letterSpacing: "-0.035em" }}
              >
                Know a cafe we missed?
              </h2>
              <p
                className="max-w-2xl mx-auto mb-10 leading-relaxed"
                style={{ fontSize: "clamp(1.05rem, 2.5vw, 1.3rem)", color: "rgba(255,255,255,0.5)" }}
              >
                Suggest a cafe or submit sourcing evidence. If the evidence checks out, they&apos;ll be added and classified.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}>
                  <Link href="/map" className="inline-flex items-center gap-2.5 px-8 py-4 rounded-full font-semibold text-[16px] text-white"
                    style={{ background: "linear-gradient(135deg, #3a7a30, #6eb35c)", boxShadow: "0 0 44px rgba(110,179,92,0.38), 0 4px 20px rgba(0,0,0,0.3)" }}
                  >
                    <Map size={16} />Open the Map
                  </Link>
                </motion.div>
                <motion.button onClick={() => setAuthOpen(true)}
                  className="inline-flex items-center gap-2.5 px-8 py-4 rounded-full font-semibold text-[16px] border"
                  style={{ color: "rgba(255,255,255,0.72)", borderColor: "rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)" }}
                  whileHover={{ scale: 1.05, borderColor: "rgba(255,255,255,0.3)", color: "rgba(255,255,255,0.95)" } as any}
                  whileTap={{ scale: 0.96 }}
                >
                  Suggest a Cafe<ArrowRight size={14} />
                </motion.button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }} className="py-10 px-5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <MatchaMark size={28} />
            <span className="text-[16px] font-semibold text-gray-700">MatchaScope</span>
          </div>
          <p className="text-[16px] text-gray-400">© 2026 MatchaScope. All classifications based on publicly verifiable evidence.</p>
          <div className="flex gap-5">
            {["Privacy", "Terms", "Contact"].map((l) => (
              <span key={l} className="text-[16px] text-gray-400 hover:text-matcha-700 cursor-pointer transition-colors">{l}</span>
            ))}
          </div>
        </div>
      </footer>

      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} defaultTab="signup" />
    </div>
  );
}
