"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, Info, Heart, ChevronRight, Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AuthModal from "./AuthModal";

/**
 * Sign-in and Get started are hidden.
 *
 * There is no session-aware UI behind them: nothing on the site reads auth state, and
 * saving a cafe already works without an account because favourites live in
 * localStorage. Two buttons that lead to a sign-up for a feature that does not gate
 * anything are asking visitors to do work for nothing.
 *
 * Kept behind a switch rather than deleted, so the whole entry point comes back by
 * setting this to true once accounts actually carry something.
 */
const SHOW_AUTH = false;
import MatchaMark from "./MatchaMark";
import { useFavoriteIds } from "@/lib/favorites";

const NAV_LINKS = [
  { href: "/map",           icon: Map,   label: "Explore Map" },
  { href: "/saved",         icon: Heart, label: "Saved" },
  { href: "/#how-it-works", icon: Info,  label: "How it Works" },
];

/**
 * The bar is three zones — lockup, links, one action — and all three are fixed.
 *
 * Two earlier versions of this got it wrong in opposite directions. First the
 * action zone was left empty when Sign in / Get started were hidden, and
 * `justify-between` centred the link row between the logo and a zero-width
 * element: measured, 118px right of true page centre at every width, with
 * 985px of dead space beside it at 2560.
 *
 * Then, fixing that, the rows were filtered by pathname so a link never pointed
 * at the page you were on. That made the menu change shape as you moved through
 * the site — Saved vanished the moment you opened Saved — which is worse than
 * the problem it solved. A navigation menu is a map of the site, and a map that
 * redraws itself depending on where you stand is not a map.
 *
 * So: the same two links and the same action on every page, always. The current
 * page is marked with aria-current instead of being removed.
 */
const DESK_LINKS = NAV_LINKS.filter((l) => l.href !== "/map");

// "Explore the map", not "Explore Map": the landing page's own hero button says
// the former, and two spellings of one action on one screen looks unfinished.
const CTA = { ...NAV_LINKS[0], label: "Explore the map" };

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

export default function Navbar() {
  const [scrolled,        setScrolled]        = useState(false);
  const [authOpen,        setAuthOpen]        = useState(false);
  const [authTab,         setAuthTab]         = useState<"login" | "signup">("login");
  const [mobileMenuOpen,  setMobileMenuOpen]  = useState(false);
  const pathname = usePathname();
  const isMap = pathname === "/map";
  const savedCount = useFavoriteIds().size;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false); }, [pathname]);

  const openLogin  = () => { setAuthTab("login");  setAuthOpen(true); };
  const openSignup = () => { setAuthTab("signup"); setAuthOpen(true); };

  const light = false;

  const CtaIcon = CTA.icon;

  return (
    <>
      <motion.nav
        className="fixed top-0 left-0 right-0 z-[100]"
        animate={
          scrolled || isMap || mobileMenuOpen
            ? { backgroundColor: "rgba(255,255,255,0.95)", borderBottomColor: "rgba(0,0,0,0.07)" }
            : { backgroundColor: "rgba(0,0,0,0)",          borderBottomColor: "rgba(0,0,0,0)" }
        }
        transition={{ duration: 0.3, ease: EASE }}
        style={{
          backdropFilter:         scrolled || isMap || mobileMenuOpen ? "blur(20px)" : "none",
          WebkitBackdropFilter:   scrolled || isMap || mobileMenuOpen ? "blur(20px)" : "none",
          borderBottom: "1px solid",
          boxShadow:    scrolled || isMap ? "0 1px 20px rgba(0,0,0,0.06)" : "none",
        }}
      >
        {/* This was full-bleed, so the lockup hugged the window's corner rather than
            the page's. Measured on a 2688px screen that put the lockup 688px left of
            where the content column starts and the action 688px right of where it
            ends — the bar stopped belonging to the site under it. Same max-w-7xl and
            px-5 as the sections, so the logo and the action now sit exactly on the
            page's own left and right edges at every width.

            No justify-between: the links belong beside the lockup, and the action is
            pushed right by its own ml-auto. That way an empty third zone can never
            drag the link row toward the middle again. */}
        <div className="px-5">
        {/* Spacing rhythm is 2:1 — 56px from the brand to the links, 28px between
            the links. It was 36 and 24, close enough that the lockup and the nav
            read as one run-on group instead of two things. Stripe sits at roughly
            40/24, Vercel at 32/20; the ratio is what matters, not the absolute. */}
        <div className="max-w-7xl mx-auto flex items-center gap-9 lg:gap-14 h-16">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group" onClick={() => setMobileMenuOpen(false)}>
            <motion.div
              whileHover={{ scale: 1.09, y: -1 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 18 }}
            >
              <MatchaMark size={34} />
            </motion.div>
            {/* One line, no descriptor.
                "TRANSPARENCY MAP" used to sit under the name at 16px uppercase.
                Two problems, and removing the line settles both at once. It was
                #8cc47c at 2.04:1 on white, well under the 4.5:1 floor for text
                that size. And uppercase at 16px with letter-spacing measured
                191px wide against roughly 150px for the name above it, so the
                descriptor was the widest thing in the lockup — the subordinate
                line was the dominant one, and no size that clears the site's
                16px floor fixes that.
                A tagline is not navigation. The bar carries the name; the page
                underneath carries the pitch, in the first sentence of the hero. */}
            <div className="leading-none">
              <span className="font-bold text-[20px] tracking-tight transition-colors duration-300"
                style={{ color: light ? "#fff" : "#1a1a1a" }}
              >
                MatchaScope
              </span>
            </div>
          </Link>

          {/* Desktop nav links — grouped against the lockup, not floating */}
          <div className="hidden md:flex items-center gap-7">
            {/* No icons on the text links. A heart beside "Saved" is arguable, but an
                ⓘ beside "How it Works" states nothing the word does not, and two
                decorative glyphs on two links is the noisiest thing in the bar. The
                action keeps its icon, which now reads as chosen rather than as the
                house style. */}
            {/* No wrapper, no sliding underline. The underline animated from 0 to
                100% width on every hover, and it spanned the count badge as well as
                the word. None of the reference navs animate a rule under a text
                link — Stripe, Vercel, Notion and ProPublica all just darken it, and
                a colour shift costs no layout work and reads calmer.
                h-11 gives each link a 44px target. It was py-1, about 26px, under
                every touch-target guideline for something people tap on a phone. */}
            {DESK_LINKS.map(({ href, label }) => {
              const current = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  // Marked, not removed. The link stays put; only its weight changes.
                  aria-current={current ? "page" : undefined}
                  className="group/nav flex h-11 items-center gap-1.5 text-[16px] transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-matcha-500 focus-visible:ring-offset-2 outline-none rounded"
                  style={{
                    color: light ? "rgba(255,255,255,0.85)" : current ? "#1a1a1a" : "#374151",
                    fontWeight: current ? 600 : 500,
                  }}
                >
                  <span className="group-hover/nav:text-matcha-700 transition-colors duration-200">
                    {label}
                  </span>
                  {href === "/saved" && savedCount > 0 && (
                    <span
                      className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full font-semibold leading-none"
                      style={{ background: "#2e6027", color: "#fff", fontSize: "11px" }}
                    >
                      {savedCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Desktop actions — ml-auto is what holds the right edge */}
          <div className="hidden md:flex items-center gap-2.5 ml-auto">
            {/* Flat fill, no gradient, no coloured glow. Every nav CTA in the
                reference set is a flat block — Stripe, Vercel, Linear, Notion,
                ProPublica, Our World in Data. A gradient with a tinted drop shadow
                is the one detail here that dates the bar.
                #2e6027 carries white at 7.45:1; the hover at #3a7a30 is 5.24:1, so
                both states clear AA rather than only the resting one. */}
            <motion.div whileTap={{ scale: 0.97 }}>
              <Link
                href={CTA.href}
                aria-current={pathname === CTA.href ? "page" : undefined}
                // Both states as classes. An inline `background` would beat the
                // hover class on specificity and the hover would silently do nothing.
                className="flex h-11 items-center gap-2 px-5 rounded-full text-[16px] font-semibold text-white bg-[#2e6027] hover:bg-[#3a7a30] transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-matcha-500 focus-visible:ring-offset-2 outline-none"
              >
                <CtaIcon size={16} />
                {CTA.label}
              </Link>
            </motion.div>

            {SHOW_AUTH && (<>
            <motion.button
              onClick={openLogin}
              className="px-4 py-2 rounded-full text-[16px] font-medium transition-colors duration-300"
              style={{ color: light ? "rgba(255,255,255,0.9)" : "#374151" }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
            >
              Sign in
            </motion.button>
            <motion.button
              onClick={openSignup}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[16px] font-semibold text-white"
              style={{
                background: "linear-gradient(135deg, #2e6027, #4d9740)",
                boxShadow: "0 2px 12px rgba(46,96,39,0.35)",
              }}
              whileHover={{ scale: 1.06, boxShadow: "0 4px 20px rgba(46,96,39,0.5)" } as any}
              whileTap={{ scale: 0.96 }}
            >
              Get started
              <motion.span
                animate={{ x: [0, 2, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              >
                <ChevronRight size={14} />
              </motion.span>
            </motion.button>
            </>)}
          </div>

          {/* Mobile: hamburger button */}
          <motion.button
            className="md:hidden p-2 rounded-xl -mr-1 ml-auto"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            whileTap={{ scale: 0.9 }}
            aria-label="Toggle menu"
            style={{ color: light ? "rgba(255,255,255,0.9)" : "#374151" }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={mobileMenuOpen ? "x" : "menu"}
                initial={{ opacity: 0, rotate: -90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 90 }}
                transition={{ duration: 0.15 }}
                style={{ display: "block" }}
              >
                {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>
        </div>

        {/* Mobile dropdown menu — absolute so it overlays content without shifting toolbar */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              className="md:hidden absolute top-16 left-0 right-0 border-b border-gray-100 px-5 pb-5"
              style={{
                background: "rgba(255,255,255,0.97)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                zIndex: 99,
              }}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              <div className="pt-3 space-y-1">
                {NAV_LINKS.map(({ href, icon: Icon, label }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl text-[16px] font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  >
                    <Icon size={16} className="text-matcha-600" />
                    {label}
                    {href === "/saved" && savedCount > 0 && (
                      <span
                        className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full font-semibold leading-none"
                        style={{ background: "#dc2626", color: "#fff", fontSize: "11px" }}
                      >
                        {savedCount}
                      </span>
                    )}
                  </Link>
                ))}
              </div>

              {SHOW_AUTH && (
              <div className="pt-3 mt-2 border-t border-gray-100 flex gap-2">
                <button
                  onClick={() => { openLogin(); setMobileMenuOpen(false); }}
                  className="flex-1 py-2.5 rounded-xl text-[16px] font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  Sign in
                </button>
                <button
                  onClick={() => { openSignup(); setMobileMenuOpen(false); }}
                  className="flex-1 py-2.5 rounded-xl text-[16px] font-semibold text-white"
                  style={{ background: "linear-gradient(135deg, #2e6027, #4d9740)" }}
                >
                  Get started
                </button>
              </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>

      {SHOW_AUTH && <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} defaultTab={authTab} />}
    </>
  );
}
