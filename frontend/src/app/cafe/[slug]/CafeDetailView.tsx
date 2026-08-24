"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  MapPin, ExternalLink, Navigation, Calendar, Quote, Shield, Tag, Star,
  Share2, Check, ChevronRight, ArrowRight, Map as MapIcon, Coffee,
} from "lucide-react";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import MatchaMark from "@/components/MatchaMark";
import FavoriteButton from "@/components/FavoriteButton";
import SuggestModal from "@/components/SuggestModal";
import { Cafe, levelConfig } from "@/data/cafes";
import { cafeUrl } from "@/lib/slug";
import LevelScale from "@/components/LevelScale";

const CafeMiniMap = dynamic(() => import("@/components/CafeMiniMap"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-gray-100 animate-pulse" />,
});

const mapsQuery = (cafe: Cafe) =>
  encodeURIComponent(cafe.address ? `${cafe.name}, ${cafe.address}` : `${cafe.lat},${cafe.lng}`);
const mapsPlaceUrl = (cafe: Cafe) => `https://www.google.com/maps/search/?api=1&query=${mapsQuery(cafe)}`;
const mapsDirectionsUrl = (cafe: Cafe) => `https://www.google.com/maps/dir/?api=1&destination=${mapsQuery(cafe)}`;

const PRICE_LABEL = { "$": "Budget", "$$": "Mid-range", "$$$": "Premium" };

const EASE   = [0.25, 0.46, 0.45, 0.94] as const;
const SPRING = { type: "spring" as const, stiffness: 340, damping: 32 };

const reveal = {
  hidden: { opacity: 0, y: 22 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};
const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

function ShareButton({ cafe, dark }: { cafe: Cafe; dark: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const shareData = { title: `${cafe.name} — MatchaScope`, text: cafe.tagline, url };
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share(shareData); return; } catch { /* user cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable — silently no-op */ }
  };

  return (
    <motion.button
      onClick={handleShare}
      className={`relative flex items-center gap-1.5 px-4 h-10 rounded-full text-[16px] font-semibold ${dark ? "glass-dark" : "glass"}`}
      style={{
        color: dark ? "rgba(255,255,255,0.92)" : "#374151",
        boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.18)" : "0 4px 20px rgba(0,0,0,0.06)",
      }}
      whileHover={{ scale: 1.04, y: -1 }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.15 }}
    >
      {copied ? <Check size={14} /> : <Share2 size={14} />}
      {copied ? "Link copied" : "Share"}
    </motion.button>
  );
}

export default function CafeDetailView({ cafe, related }: { cafe: Cafe; related: Cafe[] }) {
  const level = levelConfig[cafe.level];
  const unsupported = (cafe.level === "A" || cafe.level === "B") && !cafe.evidence;
  const onLight = level.headerText !== "#ffffff";
  const [suggestOpen, setSuggestOpen] = useState(false);

  return (
    <div className="min-h-screen bg-cream-50">
      <Navbar />
      <SuggestModal
        isOpen={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        context={{ name: cafe.name, suburb: cafe.suburb, city: cafe.city }}
      />

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <div
        className="relative pt-16 overflow-hidden"
        style={{ background: `linear-gradient(165deg, ${level.headerBg} 0%, ${level.headerBg} 62%, #fdfcf7 100%)` }}
      >
        {/* Depth vignette — the one thing that makes a flat colour fill read as a
            surface with weight to it, rather than a sticker pasted over the page. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(150% 110% at 10% -15%, transparent 35%, rgba(0,0,0,0.24) 100%)" }}
        />

        {/* Two asymmetric glow blooms, tinted from the level's own colour rather
            than a fixed hue — stays correct whether the level reads dark (A/C) or
            pale (B/D). */}
        <div
          className="absolute -top-40 -left-24 w-[480px] h-[480px] rounded-full pointer-events-none blur-3xl"
          style={{ background: `radial-gradient(circle, ${level.headerBg} 0%, transparent 70%)`, opacity: 0.55 }}
        />
        <div
          className="absolute top-6 -right-28 w-[420px] h-[420px] rounded-full pointer-events-none blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)" }}
        />

        {/* Oversized, near-invisible watermark — texture and scale, not a literal
            illustration; the kind of restrained flourish that reads as considered
            rather than decorative for its own sake. */}
        <Coffee
          size={460}
          strokeWidth={0.55}
          className="absolute -bottom-28 -right-20 pointer-events-none select-none hidden sm:block"
          style={{ color: onLight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.09)", transform: "rotate(-14deg)" }}
          aria-hidden="true"
        />

        <div className="absolute inset-0 pointer-events-none grain-overlay" aria-hidden="true" />

        <motion.div
          className="relative max-w-5xl mx-auto px-5 sm:px-8 pt-10 pb-20"
          initial="hidden"
          animate="show"
          variants={staggerParent}
        >
          {/* Breadcrumb */}
          <motion.nav variants={reveal} className="flex items-center gap-1.5 text-[16px] mb-8 flex-wrap" aria-label="Breadcrumb">
            {[
              { href: "/", label: "MatchaScope" },
              { href: "/map", label: "Map" },
              { href: `/map?city=${cafe.city}`, label: cafe.city },
            ].map((crumb, i) => (
              <span key={crumb.href} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight size={12} style={{ color: onLight ? "#00000055" : "rgba(255,255,255,0.5)" }} />}
                <Link
                  href={crumb.href}
                  className="hover:underline"
                  style={{ color: onLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.72)" }}
                >
                  {crumb.label}
                </Link>
              </span>
            ))}
            <ChevronRight size={12} style={{ color: onLight ? "#00000055" : "rgba(255,255,255,0.5)" }} />
            <span style={{ color: level.headerText }} className="font-medium">{cafe.name}</span>
          </motion.nav>

          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <motion.span
                variants={reveal}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[16px] font-bold uppercase tracking-wider mb-5 ${onLight ? "glass" : "glass-dark"}`}
                style={{ color: level.headerText, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: level.headerText }} />
                {unsupported ? "Under review" : `Level ${cafe.level} · ${level.shortLabel}`}
              </motion.span>

              <motion.h1
                variants={reveal}
                className="font-display font-bold leading-[1.02] mb-3.5 tracking-tight"
                style={{
                  color: level.headerText,
                  fontSize: "clamp(2.5rem, 6.5vw, 4.75rem)",
                  textShadow: onLight ? "none" : "0 4px 32px rgba(0,0,0,0.22)",
                }}
              >
                {cafe.name}
              </motion.h1>

              <motion.p
                variants={reveal}
                className="font-display text-[16px] sm:text-xl italic mb-5 max-w-xl leading-snug"
                style={{ color: onLight ? "rgba(0,0,0,0.62)" : "rgba(255,255,255,0.82)" }}
              >
                {cafe.tagline}
              </motion.p>

              <motion.div variants={reveal} className="flex items-center gap-2.5 flex-wrap">
                {[
                  { icon: MapPin, text: `${cafe.suburb}, ${cafe.city}` },
                  { icon: Tag, text: cafe.type.charAt(0).toUpperCase() + cafe.type.slice(1) },
                  { icon: Star, text: `${cafe.priceRange} · ${PRICE_LABEL[cafe.priceRange]}` },
                ].map(({ icon: MetaIcon, text }) => (
                  <span
                    key={text}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[16px] ${onLight ? "glass" : "glass-dark"}`}
                    style={{ color: onLight ? "rgba(0,0,0,0.68)" : "rgba(255,255,255,0.85)" }}
                  >
                    <MetaIcon size={12} />{text}
                  </span>
                ))}
              </motion.div>
            </div>

            {/* Actions */}
            <motion.div variants={reveal} className="flex items-center gap-2.5 flex-shrink-0">
              <ShareButton cafe={cafe} dark={!onLight} />
              <FavoriteButton id={cafe.id} name={cafe.name} variant={onLight ? "light" : "dark"} />
            </motion.div>
          </div>
        </motion.div>
      </div>

      {/* ── BODY ─────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">

        {/* Left column */}
        <motion.div
          className="space-y-8 min-w-0"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          variants={staggerParent}
        >
          {cafe.description && (
            <motion.p variants={reveal} className="text-lg text-gray-700 leading-relaxed">
              {cafe.description}
            </motion.p>
          )}

          {cafe.specialties.length > 0 && (
            <motion.div variants={reveal}>
              <div className="text-[16px] uppercase tracking-widest text-gray-400 font-semibold mb-3">Specialties</div>
              <div className="flex flex-wrap gap-2">
                {cafe.specialties.map((s) => (
                  <span key={s} className="px-3 py-1.5 rounded-full text-[16px] font-medium" style={{ background: "#e6f4e0", color: "#2e6027" }}>
                    {s}
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          {/* The grade, on the same scale the panel shows, so it is learned once rather
              than twice. A reader who met "D" on the map meets the identical ladder here. */}
          {!unsupported && (
            <motion.div variants={reveal}>
              <LevelScale level={cafe.level} />
            </motion.div>
          )}

          {/* Evidence — the centrepiece. Same states CafeDetailPanel uses, at editorial scale. */}
          <motion.div variants={reveal}>
            <div className="flex items-center gap-2 mb-3">
              <Shield size={16} className="text-matcha-700" />
              <h2 className="text-[16px] uppercase tracking-widest text-gray-400 font-semibold">Transparency Evidence</h2>
            </div>

            {cafe.evidence ? (
              <div className="rounded-3xl border border-matcha-200 overflow-hidden shadow-card">
                <div className="p-7 sm:p-9" style={{ background: "#f2f8f0" }}>
                  <Quote size={28} className="text-matcha-400 mb-3" />
                  <p className="font-display text-xl sm:text-2xl text-gray-800 italic leading-relaxed">
                    &ldquo;{cafe.evidence.quote}&rdquo;
                  </p>
                </div>
                <div className="p-6 space-y-2.5" style={{ borderTop: "1px solid #c2e1b5" }}>
                  <div className="flex items-center gap-2">
                    <ExternalLink size={13} className="text-matcha-600 flex-shrink-0" />
                    <span className="text-[16px] text-gray-500">{cafe.evidence.sourceLabel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar size={13} className="text-matcha-600 flex-shrink-0" />
                    <span className="text-[16px] text-gray-500">Verified {cafe.evidence.verifiedDate}</span>
                  </div>
                  <a
                    href={cafe.evidence.source}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[16px] font-semibold text-matcha-700 mt-1.5 hover:text-matcha-900 transition-colors"
                  >
                    View primary source <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            ) : unsupported ? (
              <div className="rounded-3xl p-7" style={{ background: "#fffbeb", border: "1px solid #fcd34d" }}>
                <p className="text-[16px] font-semibold" style={{ color: "#92400e" }}>Grade withheld — evidence missing</p>
                <p className="text-[16px] mt-2 leading-relaxed" style={{ color: "#b45309" }}>
                  This listing carries a Level {cafe.level} grade but no supporting quote, so we can&apos;t show
                  you proof. Treat it as unverified until we re-check it — MatchaScope never displays a
                  transparency grade it can&apos;t back with a source.
                </p>
              </div>
            ) : (
              <div className="rounded-3xl border border-gray-200 p-7 bg-white">
                <p className="text-[16px] text-gray-500 italic leading-relaxed">
                  No public Japanese-origin disclosure found across website, menu, or official social media.
                </p>
                <p className="text-[16px] text-gray-400 mt-2">
                  Last checked {new Date().toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
                </p>
              </div>
            )}
          </motion.div>

          {/* Suggest an update */}
          <motion.button
            variants={reveal}
            onClick={() => setSuggestOpen(true)}
            className="w-full sm:w-auto px-6 py-3 rounded-xl text-[16px] font-medium text-matcha-700 border border-matcha-200 hover:bg-matcha-50 transition-colors"
          >
            Suggest an update to this listing
          </motion.button>
        </motion.div>

        {/* Right column — location, sticky on desktop */}
        <motion.div
          className="space-y-5 lg:sticky lg:top-24 self-start"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          variants={staggerParent}
        >
          <motion.div variants={reveal} className="rounded-3xl border border-gray-200 overflow-hidden bg-white shadow-card">
            <div className="h-40 w-full">
              <CafeMiniMap lat={cafe.lat} lng={cafe.lng} levelColor={level.color} />
            </div>
            <div className="p-4 flex items-start gap-2.5">
              <MapPin size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <span className="text-[16px] text-gray-600">{cafe.address}</span>
            </div>
            <div className="grid grid-cols-2 border-t border-gray-100">
              <a
                href={mapsPlaceUrl(cafe)} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 py-3 text-[16px] font-semibold text-gray-700 border-r border-gray-100 hover:bg-matcha-50 hover:text-matcha-700 transition-colors"
              >
                <ExternalLink size={13} />Google Maps
              </a>
              <a
                href={mapsDirectionsUrl(cafe)} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 py-3 text-[16px] font-semibold text-gray-700 hover:bg-matcha-50 hover:text-matcha-700 transition-colors"
              >
                <Navigation size={13} />Directions
              </a>
            </div>
          </motion.div>

          <motion.div variants={reveal} className="flex gap-2">
            {cafe.website && (
              <a
                href={`https://${cafe.website}`} target="_blank" rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[16px] font-semibold border border-gray-200 text-gray-700 hover:border-matcha-200 hover:text-matcha-700 hover:bg-matcha-50 transition-colors"
              >
                <ExternalLink size={13} />Website
              </a>
            )}
            {cafe.instagram && (
              <a
                href={`https://instagram.com/${cafe.instagram.replace("@", "")}`} target="_blank" rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[16px] font-semibold border border-gray-200 text-gray-700 hover:border-matcha-200 hover:text-matcha-700 hover:bg-matcha-50 transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/>
                </svg>
                Instagram
              </a>
            )}
          </motion.div>

          <motion.div variants={reveal}>
            <Link
              href={`/map?cafe=${encodeURIComponent(cafe.id)}`}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-[16px] font-semibold text-white transition-transform hover:scale-[1.02]"
              style={{ background: "linear-gradient(135deg, #2e6027 0%, #4d9740 100%)" }}
            >
              <MapIcon size={14} />Open in full map
            </Link>
          </motion.div>
        </motion.div>
      </div>

      {/* ── RELATED ──────────────────────────────────────────────────── */}
      {related.length > 0 && (
        <motion.div
          className="max-w-5xl mx-auto px-5 sm:px-8 pb-16"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          variants={staggerParent}
        >
          <motion.h2 variants={reveal} className="text-[16px] uppercase tracking-widest text-gray-400 font-semibold mb-4">
            More in {cafe.city}
          </motion.h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {related.map((r) => {
              const rc = levelConfig[r.level];
              return (
                <motion.div key={r.id} variants={reveal}>
                  <Link
                    href={cafeUrl(r)}
                    className="group flex flex-col h-full p-4 rounded-2xl border border-gray-200 bg-white hover:border-matcha-200 hover:shadow-card transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[16px] font-bold text-white flex-shrink-0" style={{ background: rc.color }}>
                        {r.level}
                      </div>
                      <ArrowRight size={14} className="text-gray-300 group-hover:text-matcha-600 group-hover:translate-x-0.5 transition-all" />
                    </div>
                    <div className="text-[16px] font-semibold text-gray-800 leading-snug mb-1 line-clamp-2">{r.name}</div>
                    <div className="text-[16px] text-gray-400 mt-auto">{r.suburb}, {r.city}</div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── FOOTER CTA ───────────────────────────────────────────────── */}
      <div className="border-t border-gray-100 py-10 px-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <MatchaMark size={26} />
            <span className="text-[16px] font-semibold text-gray-700">MatchaScope</span>
          </div>
          <Link
            href="/map"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[16px] font-semibold border border-gray-200 text-gray-700 hover:border-matcha-300 hover:text-matcha-700 transition-colors"
          >
            Explore the full map <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}
