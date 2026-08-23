"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, ExternalLink, MapPin, Navigation, Calendar, Quote, Shield, Tag, Star, Maximize2 } from "lucide-react";
import { motion, AnimatePresence, useDragControls, useMotionValue, useTransform } from "framer-motion";
import { Cafe, levelConfig } from "@/data/cafes";
import { cafeUrl } from "@/lib/slug";
import FavoriteButton from "./FavoriteButton";
import SuggestModal from "./SuggestModal";

/**
 * Google Maps links. Searching by name + address lands on the business listing
 * (hours, photos, reviews) rather than an anonymous dropped pin, and falls back
 * to coordinates when a listing has no address. These are universal links, so
 * they open the Google Maps app on phones that have it.
 */
const mapsQuery = (cafe: Cafe) =>
  encodeURIComponent(cafe.address ? `${cafe.name}, ${cafe.address}` : `${cafe.lat},${cafe.lng}`);

const mapsPlaceUrl = (cafe: Cafe) =>
  `https://www.google.com/maps/search/?api=1&query=${mapsQuery(cafe)}`;

const mapsDirectionsUrl = (cafe: Cafe) =>
  `https://www.google.com/maps/dir/?api=1&destination=${mapsQuery(cafe)}`;

interface Props {
  cafe: Cafe | null;
  onClose: () => void;
}

const PRICE_LABEL = { "$": "Budget", "$$": "Mid-range", "$$$": "Premium" };

const SPRING = { type: "spring" as const, stiffness: 340, damping: 32 };
const EASE   = [0.25, 0.46, 0.45, 0.94] as const;

const contentVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.12 } },
};
const rowVariants = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 380, damping: 28 } },
};

// Shared scrollable content for both mobile and desktop
function PanelContent({
  cafe,
  onClose,
}: {
  cafe: Cafe;
  onClose: () => void;
}) {
  const level = levelConfig[cafe.level];

  // Levels A and B assert a public disclosure. Without evidence to point at, that
  // assertion is unsupported — surface it as such rather than badging it "Verified".
  const unsupported = (cafe.level === "A" || cafe.level === "B") && !cafe.evidence;

  // The header used to be cafe.coverColor with white text hardcoded regardless of how
  // light that colour was — fine for A and B, unreadable for C and 2.5:1 / 1.5:1 for D.
  // headerBg/headerText/headerPill are the per-level pair that keeps contrast safe (see
  // levelConfig), so every white-on-header element below derives from headerText rather
  // than assuming white — including the close button and location line, which had the
  // same bug for the same reason (a fixed black/20 circle and white/70 text both nearly
  // vanish on D's pale background).
  const onLight = level.headerText !== "#ffffff";
  const closeBg = onLight ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.2)";
  const closeBgHover = onLight ? "rgba(0,0,0,0.14)" : "rgba(0,0,0,0.35)";
  // A literal rgba, not element opacity: the location line already animates its own
  // opacity in (0 -> 1) on mount, and framer-motion drives that through the same CSS
  // opacity property a plain style.opacity would use, so the two would fight and the
  // static value would lose once the entrance animation finished.
  const headerTextMuted = onLight ? `${level.headerText}b8` : "rgba(255,255,255,0.72)";
  const [suggestOpen, setSuggestOpen] = useState(false);

  return (
    <>
      <SuggestModal
        isOpen={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        context={{ name: cafe.name, suburb: cafe.suburb, city: cafe.city }}
      />

      {/* Coloured header */}
      <motion.div
        className="relative h-36 sm:h-40 flex flex-col justify-end p-5 flex-shrink-0"
        style={{ background: `linear-gradient(160deg, ${level.headerBg}dd 0%, ${level.headerBg} 100%)` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        {/* Close + save */}
        <div className="absolute top-4 right-4 flex items-center gap-1.5">
          <FavoriteButton id={cafe.id} name={cafe.name} size={15} variant={onLight ? "light" : "dark"} />
          <motion.button
            onClick={onClose}
            className="p-1.5 rounded-full transition-colors"
            style={{ background: closeBg }}
            whileHover={{ scale: 1.1, rotate: 90, backgroundColor: closeBgHover }}
            whileTap={{ scale: 0.9 }}
            transition={SPRING}
          >
            <X size={16} style={{ color: level.headerText }} />
          </motion.button>
        </div>

        {/* Level badge */}
        <div className="flex items-center gap-2 mb-2">
          <motion.span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[16px] font-bold uppercase tracking-wider"
            style={{ background: level.headerPill, color: level.headerText }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, ...SPRING }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: level.headerText }} />
            {unsupported ? "Under review" : `Level ${cafe.level} — ${level.shortLabel}`}
          </motion.span>
        </div>

        <motion.h2
          className="font-display text-xl font-bold leading-snug"
          style={{ color: level.headerText }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.4, ease: EASE }}
        >
          {cafe.name}
        </motion.h2>
        <motion.div
          className="flex items-center gap-1.5 mt-1"
          style={{ color: headerTextMuted }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.18, duration: 0.35, ease: EASE }}
        >
          <MapPin size={12} color={headerTextMuted} />
          <span className="text-[16px]">{cafe.suburb}, {cafe.city}</span>
        </motion.div>
      </motion.div>

      {/* Staggered content */}
      <motion.div
        className="p-5 space-y-5"
        variants={contentVariants}
        initial="hidden"
        animate="show"
      >
        {/* Description */}
        {cafe.description && (
          <motion.p className="text-[16px] text-gray-600 leading-relaxed" variants={rowVariants}>
            {cafe.description}
          </motion.p>
        )}

        {/* Meta tags */}
        <motion.div className="flex flex-wrap gap-2" variants={rowVariants}>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-[16px] text-gray-600">
            <Tag size={11} />
            {cafe.type.charAt(0).toUpperCase() + cafe.type.slice(1)}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-[16px] text-gray-600">
            <Star size={11} />
            {cafe.priceRange} — {PRICE_LABEL[cafe.priceRange]}
          </span>
        </motion.div>

        {/* Specialties */}
        <motion.div variants={rowVariants}>
          <div className="text-[16px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Specialties</div>
          <div className="flex flex-wrap gap-1.5">
            {cafe.specialties.map((s, i) => (
              <motion.span
                key={s}
                className="px-2.5 py-1 rounded-full text-[16px] font-medium"
                style={{ background: "#e6f4e0", color: "#2e6027" }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.24 + i * 0.04, type: "spring", stiffness: 400, damping: 24 }}
                whileHover={{ scale: 1.06, transition: { type: "spring", stiffness: 400, damping: 20 } }}
              >
                {s}
              </motion.span>
            ))}
          </div>
        </motion.div>

        {/* Evidence panel */}
        <motion.div variants={rowVariants}>
          <div className="flex items-center gap-2 mb-2">
            <Shield size={14} className="text-matcha-700" />
            <div className="text-[16px] uppercase tracking-widest text-gray-400 font-semibold">Transparency Evidence</div>
          </div>

          {cafe.evidence ? (
            <motion.div
              className="rounded-2xl border border-matcha-200 overflow-hidden"
              whileHover={{ boxShadow: "0 4px 20px rgba(46,96,39,0.1)" } as any}
              transition={{ duration: 0.2 }}
            >
              <div className="p-4" style={{ background: "#f2f8f0" }}>
                <Quote size={16} className="text-matcha-400 mb-2" />
                <p className="text-[16px] text-gray-700 italic leading-relaxed">"{cafe.evidence.quote}"</p>
              </div>
              <div className="p-4 space-y-2" style={{ borderTop: "1px solid #c2e1b5" }}>
                <div className="flex items-center gap-2">
                  <ExternalLink size={12} className="text-matcha-600 flex-shrink-0" />
                  <span className="text-[16px] text-gray-500">{cafe.evidence.sourceLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={12} className="text-matcha-600 flex-shrink-0" />
                  <span className="text-[16px] text-gray-500">Verified {cafe.evidence.verifiedDate}</span>
                </div>
                <motion.a
                  href={cafe.evidence.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[16px] font-medium text-matcha-700 mt-1"
                  whileHover={{ x: 3, color: "#1e4a1a" } as any}
                  transition={{ duration: 0.15 }}
                >
                  View source <ExternalLink size={11} />
                </motion.a>
              </div>
            </motion.div>
          ) : unsupported ? (
            <div className="rounded-2xl p-4" style={{ background: "#fffbeb", border: "1px solid #fcd34d" }}>
              <p className="text-[16px] font-semibold" style={{ color: "#92400e" }}>
                Grade withheld — evidence missing
              </p>
              <p className="text-[16px] mt-1.5 leading-relaxed" style={{ color: "#b45309" }}>
                This listing carries a Level {cafe.level} grade but no supporting quote, so we
                cannot show you proof. Treat it as unverified until we re-check it. We never
                display a transparency grade we cannot back with a source.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
              <p className="text-[16px] text-gray-400 italic">
                No public Japanese-origin disclosure found across website, menu, or official social media.
              </p>
              <p className="text-[16px] text-gray-400 mt-2">
                Last checked: {new Date().toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
              </p>
            </div>
          )}
        </motion.div>

        {/* Address — the block itself is the way out to Google Maps */}
        <motion.div variants={rowVariants}>
          <div className="text-[16px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Address</div>
          <div className="rounded-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-start gap-2.5 p-3.5">
              <MapPin size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <span className="text-[16px] text-gray-600">{cafe.address}</span>
            </div>
            <div className="grid grid-cols-2 border-t border-gray-200">
              <motion.a
                href={mapsPlaceUrl(cafe)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${cafe.name} in Google Maps`}
                className="flex items-center justify-center gap-1.5 py-2.5 text-[16px] font-semibold text-gray-700 border-r border-gray-200"
                whileHover={{ backgroundColor: "#f2f8f0", color: "#2e6027" } as any}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
              >
                <ExternalLink size={13} />
                Google Maps
              </motion.a>
              <motion.a
                href={mapsDirectionsUrl(cafe)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Directions to ${cafe.name} in Google Maps`}
                className="flex items-center justify-center gap-1.5 py-2.5 text-[16px] font-semibold text-gray-700"
                whileHover={{ backgroundColor: "#f2f8f0", color: "#2e6027" } as any}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.15 }}
              >
                <Navigation size={13} />
                Directions
              </motion.a>
            </div>
          </div>
        </motion.div>

        {/* External links */}
        <motion.div className="flex gap-2 pt-1" variants={rowVariants}>
          {cafe.website && (
            <motion.a
              href={`https://${cafe.website}`}
              target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[16px] font-semibold border border-gray-200 text-gray-700"
              whileHover={{ scale: 1.03, borderColor: "#c2e1b5", color: "#2e6027", backgroundColor: "#f2f8f0" } as any}
              whileTap={{ scale: 0.97 }}
              transition={SPRING}
            >
              <ExternalLink size={13} />Website
            </motion.a>
          )}
          {cafe.instagram && (
            <motion.a
              href={`https://instagram.com/${cafe.instagram.replace("@", "")}`}
              target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[16px] font-semibold border border-gray-200 text-gray-700"
              whileHover={{ scale: 1.03, borderColor: "#c2e1b5", color: "#2e6027", backgroundColor: "#f2f8f0" } as any}
              whileTap={{ scale: 0.97 }}
              transition={SPRING}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                <circle cx="12" cy="12" r="4"/>
                <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/>
              </svg>
              Instagram
            </motion.a>
          )}
        </motion.div>

        {/* Permalink — the shareable, indexable page for this cafe */}
        <motion.div variants={rowVariants}>
          <Link
            href={cafeUrl(cafe)}
            className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-[16px] font-medium text-gray-700 border border-gray-200 hover:border-matcha-200 hover:text-matcha-700 hover:bg-matcha-50 transition-colors"
          >
            <Maximize2 size={13} />View full page
          </Link>
        </motion.div>

        {/* Suggest update */}
        <motion.button
          onClick={() => setSuggestOpen(true)}
          className="w-full py-2.5 rounded-xl text-[16px] font-medium text-matcha-700 border border-matcha-200"
          variants={rowVariants}
          whileHover={{ scale: 1.02, backgroundColor: "#f2f8f0" } as any}
          whileTap={{ scale: 0.98 }}
          transition={SPRING}
        >
          Suggest an update to this listing
        </motion.button>
      </motion.div>
    </>
  );
}

/** Past either of these the sheet is going away: a deliberate pull, or a quick flick. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 520;

export default function CafeDetailPanel({ cafe, onClose }: Props) {
  const [isMobile, setIsMobile] = useState(false);

  // The sheet carried a drag handle and no drag behaviour — it looked grabbable and was
  // not, so the only way out was the close button. Framer's own drag listener is off
  // here and the gesture is started by hand, because the sheet's body scrolls: letting
  // the listener see every touch would turn "scroll the page" into "throw the sheet
  // away" the moment a finger moved down.
  const dragControls = useDragControls();
  const sheetY       = useMotionValue(0);
  const scrollRef    = useRef<HTMLDivElement>(null);
  const gestureOwned = useRef(false);

  // The backdrop thins out as the sheet is pulled down, so the gesture reads as
  // dismissing rather than as the sheet coming loose from the screen.
  const backdropOpacity = useTransform(sheetY, [0, 400], [1, 0.15], { clamp: true });

  /**
   * Where a downward pull means "dismiss" rather than "scroll".
   *
   * Deciding that mid-gesture does not work: the scrolling body carries touch-action
   * pan-y, so the browser claims the gesture on the first move and stops delivering
   * pointermove — a handler watching for downward travel is never called again. The
   * decision has to be made on touch-down, from where the finger landed.
   *
   * So the coloured header is the grab area, which is also where a thumb reaches for
   * first, and is only live while the content sits at its top — once someone has
   * scrolled into the listing they are reading it, and a pull is a scroll.
   */
  const HEADER_GRAB_PX = 170;

  const maybeStartDrag = (e: React.PointerEvent) => {
    if (gestureOwned.current) return;
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) return;
    // Never swallow a press meant for the close button, the heart, or a link.
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    if (e.clientY - el.getBoundingClientRect().top < HEADER_GRAB_PX) {
      gestureOwned.current = true;
      dragControls.start(e);
    }
  };

  const endGesture = () => { gestureOwned.current = false; };

  useEffect(() => {
    if (!cafe) return;
    sheetY.set(0);
    gestureOwned.current = false;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cafe, onClose, sheetY]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <AnimatePresence>
      {cafe && (
        isMobile ? (
          <>
            {/* Backdrop */}
            <motion.div
              key="panel-backdrop"
              className="fixed inset-0 z-[70] bg-black/30"
              style={{ opacity: backdropOpacity }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={onClose}
            />

            {/* Bottom sheet */}
            <motion.div
              key={`mobile-${cafe.id}`}
              className="fixed bottom-0 left-0 right-0 z-[80] bg-white rounded-t-3xl overflow-hidden flex flex-col"
              // 88vh let the sheet climb to the underside of the fixed h-16 navbar, so the
              // two read as one slab and there was nothing to show the page was still there
              // behind it. Capped against the navbar plus a deliberate gap instead, in dvh
              // so a phone's collapsing browser chrome cannot eat it.
              style={{
                maxHeight: "calc(100dvh - 4rem - 1.5rem)",
                boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
                y: sheetY,
              }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={SPRING}
              role="dialog"
              aria-modal="true"
              aria-label={`${cafe.name} details`}
              drag="y"
              dragListener={false}
              dragControls={dragControls}
              // Upward travel is pinned to zero: this sheet has one resting place, and a
              // rubber-banding top edge would promise a taller state that does not exist.
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.55 }}
              onDragEnd={(_, info) => {
                gestureOwned.current = false;
                if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) onClose();
              }}
            >
              {/* Drag handle. Its own hit area is deliberately taller than the 4px bar it
                  draws — a grab target the size of the graphic would miss most thumbs. */}
              <div
                className="flex justify-center items-center flex-shrink-0 cursor-grab active:cursor-grabbing"
                style={{ touchAction: "none", height: 32 }}
                onPointerDown={(e) => { gestureOwned.current = true; dragControls.start(e); }}
                aria-hidden="true"
              >
                {/* 56x6 on a 32px-tall strip. The old 40x4 bar sat at 2.5:1 against white,
                    under the 3:1 floor a control has to meet to read as a control at all,
                    and its grab area was barely taller than the graphic. */}
                <div className="rounded-full" style={{ width: 56, height: 6, background: "#8b939d" }} />
              </div>

              <div
                ref={scrollRef}
                className="overflow-y-auto flex-1"
                style={{ overscrollBehavior: "contain", touchAction: "pan-y" }}
                onPointerDown={maybeStartDrag}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
              >
                <PanelContent cafe={cafe} onClose={onClose} />
              </div>
            </motion.div>
          </>
        ) : (
          /* Desktop right panel */
          <motion.div
            key={`desktop-${cafe.id}`}
            className="h-full flex-shrink-0 flex border-l border-gray-100"
            style={{ width: "clamp(320px, 38%, 460px)" }}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={SPRING}
          >
            <div className="flex-1 bg-white overflow-y-auto" style={{ boxShadow: "-8px 0 40px rgba(0,0,0,0.08)" }}>
              <PanelContent cafe={cafe} onClose={onClose} />
            </div>
          </motion.div>
        )
      )}
    </AnimatePresence>
  );
}
