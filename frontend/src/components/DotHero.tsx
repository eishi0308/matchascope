"use client";

/**
 * Landing hero: every cafe we found, as one dot.
 *
 * First screen — 1,147 grey dots; the ones that say where their matcha is from light up.
 * One screen of scroll then tells the rest in three beats: the dots sort into a waffle per
 * city (the share, at a glance), pour into their real places on two maps drawn at one shared
 * scale, and hand over to a search that lights up the matching dots.
 *
 * The field is a canvas driven by a small imperative engine (below): 1,147 animated marks
 * would be far too many React nodes. React renders the text, which is also what a crawler
 * or a reader without JavaScript gets.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchCafePoints, type CafePoint } from "@/lib/api";
import { cafeUrl } from "@/lib/slug";
import coverage from "@/lib/crawl-coverage.json";

type Level = "A" | "B" | "C" | "D";
type CityKey = "Sydney" | "Melbourne";
type Ring = [number, number][];
type Geo = Record<CityKey, { coast: Ring[]; water: Ring[][] }>;

// Server-rendered figures, so the first paint says 119, not 0.
const TOTAL0 = coverage.total;
const SAID0 = coverage.byLevel.A + coverage.byLevel.B;

export default function DotHero() {
  const root = useRef<HTMLElement>(null);
  const router = useRouter();

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    Promise.all([
      fetchCafePoints(),
      fetch("/data/landing-geo.json").then((r) => r.json() as Promise<Geo>),
      document.fonts.ready,
    ])
      .then(([cafes, geo]) => {
        if (cancelled) return;
        stop = startEngine(el, cafes.filter((c) => c.city === "Sydney" || c.city === "Melbourne"), geo, (url) => router.push(url));
      })
      // Without the data the headline still stands; drop the scroll travel so there's no empty screen to scroll through.
      .catch(() => { if (!cancelled) el.classList.add("dh-static"); });
    return () => { cancelled = true; stop?.(); };
  }, [router]);

  return (
    <section ref={root} id="dot-hero" className="dot-hero" aria-label="Every cafe we found">
      <div className="dh-stage" data-dh="stage">
        <canvas className="dh-field" data-dh="field" role="img"
          aria-label={`${TOTAL0.toLocaleString("en-AU")} dots, one per cafe. ${SAID0} are green: those cafes say where their matcha is from.`} />

        <header className="dh-copy dh-intro" data-dh="copy">
          <span className="dh-pill"><i />Sydney &amp; Melbourne</span>
          <h1 className="dh-h1">
            <span className="dh-ln">Most cafes</span>{" "}
            <em className="dh-ln">won’t tell you</em>
            <br className="dh-wide" />
            <span className="dh-ln"> where the matcha</span>{" "}
            <span className="dh-ln">comes from.</span>
          </h1>
          <p className="dh-count">
            <b data-dh="count">{SAID0}</b> of <span data-dh="total">{TOTAL0.toLocaleString("en-AU")}</span> cafes say where theirs is from.
          </p>
        </header>

        <div className="dh-legend dh-intro-late" data-dh="legend" aria-hidden="true">
          <span><i style={{ background: "#2e6027" }} />Names the source</span>
          <span><i style={{ background: "#6eb35c" }} />Says “Japanese”</span>
          {/* Level C and D by the map page's own names: "say nothing" below counts cafes
              whose pages we could read (328), a different number from level C (491). */}
          <span><i style={{ background: "#b8b4a8" }} />No disclosure</span>
          <span><i style={{ background: "#e0ddd3" }} />Unknown</span>
          <span className="dh-hint" data-dh="hint">Hover any dot</span>
        </div>

        <div className="dh-end" data-dh="end">
          <h2>Now check <em>yours.</em></h2>
          <div className="dh-searchrow">
            <div className="dh-search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input data-dh="q" type="search" autoComplete="off" spellCheck={false} placeholder="Search a cafe or suburb" aria-label="Search cafes by name or suburb" />
              <div className="dh-results" data-dh="results" role="listbox" />
            </div>
            <Link className="dh-go" href="/map">Explore the full map <span aria-hidden="true">→</span></Link>
          </div>
          <p className="dh-meta" data-dh="meta">Every dot is a real cafe.</p>
        </div>

        <div className="dh-city" data-dh="city-Sydney"><b>Sydney</b><span /></div>
        <div className="dh-city" data-dh="city-Melbourne"><b>Melbourne</b><span /></div>
        <div data-dh="marks" />
        {/* The coastlines and water come from OpenStreetMap (ODbL), which asks for this credit wherever they're shown. */}
        <a className="dh-credit" data-dh="credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Map data © OpenStreetMap contributors</a>
      </div>
      <div className="dh-tip" data-dh="tip" role="tooltip" />
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────── engine ── */

interface Dot {
  c: CafePoint; url: string; lvl: Level; said: boolean; rgb: number[]; slot: number; delay: number;
  name: string; sub: string; city: CityKey;
  gx: number; gy: number; bx: number; by: number; mx: number; my: number; pour: number; far: number; farPx: number;
  onMap: boolean; appearAt: number; litAt: number; x: number; y: number; r: number; alpha: number;
}
interface Panel { x: number; y: number; w: number; h: number; X: (lo: number) => number; Y: (la: number) => number; coast: Path2D; water: Path2D[] }
interface Frame { la: [number, number]; lo: [number, number] }

const LEVEL: Record<Level, { color: string; chip: string; bg: string; ink: string; text: string }> = {
  A: { color: "#2e6027", chip: "Names the source", bg: "#e6f1e1", ink: "#2e6027", text: "Names where its matcha comes from on its own site." },
  B: { color: "#6eb35c", chip: "Says “Japanese”", bg: "#eef6e9", ink: "#3a7a30", text: "Mentions Japanese matcha, but gives no sourcing specifics." },
  C: { color: "#b8b4a8", chip: "No disclosure", bg: "#f2f0ea", ink: "#57534e", text: "Serves matcha with no public information about where it’s from." },
  D: { color: "#e0ddd3", chip: "Unknown", bg: "#f4f3ee", ink: "#6b7280", text: "Not enough public information to classify." },
};
const RANK: Record<Level, number> = { A: 0, B: 1, C: 2, D: 3 };
const CITIES: CityKey[] = ["Sydney", "Melbourne"];

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (t: number) => t * t * (3 - 2 * t);
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string));
const quant = (arr: number[], q: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))]; };

function rng(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Some evidence rows hold a whole scraped menu. Show the sentence that names a place — the part
// that is actually evidence — and when there isn't one, say what the grade means instead.
const REGION = /(uji|kyoto|nishio|aichi|kagoshima|shizuoka|yame|fukuoka|japan(ese)?)/i, MATCHA = /matcha/i;
function excerpt(text: string | null): string | null {
  if (!text) return null;
  const parts = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+|\s+[|•·]\s+/).filter((x) => /[a-z]{3,}\s+[a-z]{3,}/i.test(x));
  const hit = parts.find((x) => REGION.test(x)) || parts.find((x) => MATCHA.test(x));
  if (!hit) return null;
  const s = hit.trim().replace(/^[^A-Za-z0-9"“‘']+/, "");
  if (s.length <= 150) return s;
  const at = REGION.test(s) ? s.search(REGION) : s.search(MATCHA);
  let a = Math.max(0, at - 55), b = Math.min(s.length, at + 85);
  if (a > 0) a = s.indexOf(" ", a) + 1;
  if (b < s.length) b = s.lastIndexOf(" ", b);
  return (a > 0 ? "…" : "") + s.slice(a, b).replace(/[,;:\s]+$/, "") + (b < s.length ? "…" : "");
}

function startEngine(root: HTMLElement, cafes: CafePoint[], geo: Geo, go: (url: string) => void): () => void {
  const q = <T extends HTMLElement>(name: string) => root.querySelector(`[data-dh="${name}"]`) as T;
  const stage = q<HTMLDivElement>("stage"), canvas = q<HTMLCanvasElement>("field"), ctx = canvas.getContext("2d")!;
  const copy = q("copy"), legend = q("legend"), end = q("end"), tip = q("tip"), marksEl = q("marks"), credit = q("credit");
  const input = q<HTMLInputElement>("q"), results = q("results"), meta = q("meta"), countEl = q("count");
  const cityEls = { Sydney: q("city-Sydney"), Melbourne: q("city-Melbourne") } as Record<CityKey, HTMLElement>;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canHover = matchMedia("(hover: hover)").matches;
  const rand = rng(1147);
  const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* Data → dots */
  const N = cafes.length;
  const SAID = cafes.filter((c) => c.level === "A" || c.level === "B").length;
  const GREY = hex(LEVEL.C.color), MAPGREY: Record<"C" | "D", number[]> = { C: hex("#8c877a"), D: hex("#b9b4a6") };
  const slots = shuffle(Array.from({ length: N }, (_, i) => i));
  const dots: Dot[] = cafes.map((c, i) => ({
    c, url: cafeUrl(c), lvl: c.level as Level, said: c.level === "A" || c.level === "B", rgb: hex(LEVEL[c.level as Level].color),
    slot: slots[i], delay: rand(), name: norm(c.name), sub: norm(c.suburb), city: c.city as CityKey,
    gx: 0, gy: 0, bx: 0, by: 0, mx: 0, my: 0, pour: 0, far: 0, farPx: 0,
    onMap: true, appearAt: 0, litAt: Infinity, x: 0, y: 0, r: 0, alpha: 1,
  }));
  shuffle(dots.filter((d) => d.said)).forEach((d, k, arr) => { d.litAt = 1250 + (k / arr.length) * 1500 + rand() * 80; });
  const drawOrder = [...dots].sort((a, b) => RANK[b.lvl] - RANK[a.lvl]); // greys first, greens on top
  const INTRO_END = reduced ? 0 : 1250 + 1500 + 600;

  q("total").textContent = N.toLocaleString("en-AU");
  countEl.textContent = reduced ? String(SAID) : "0";
  canvas.setAttribute("aria-label", `${N.toLocaleString("en-AU")} dots, one per cafe. ${SAID} are green: those cafes say where their matcha is from.`);
  for (const c of CITIES) {
    const inCity = cafes.filter((x) => x.city === c), said = inCity.filter((x) => x.level === "A" || x.level === "B").length;
    cityEls[c].querySelector("span")!.innerHTML = `${inCity.length} cafes · <em>${said} say where</em>`;
  }
  root.classList.add("dh-live");

  // Frame each city around where its cafes are (3rd–97th percentile, padded), so the dense middle
  // isn't a speck in an empty box. Cafes outside the frame are counted on the map, not hidden silently.
  const FRAME = {} as Record<CityKey, Frame>, HUB = {} as Record<CityKey, { la: number; lo: number }>;
  for (const c of CITIES) {
    const inCity = cafes.filter((x) => x.city === c), la = inCity.map((x) => x.lat), lo = inCity.map((x) => x.lng);
    const la0 = quant(la, .03), la1 = quant(la, .97), lo0 = quant(lo, .03), lo1 = quant(lo, .97);
    const pla = (la1 - la0) * .12, plo = (lo1 - lo0) * .12;
    FRAME[c] = { la: [la0 - pla, la1 + pla], lo: [lo0 - plo, lo1 + plo] };
    HUB[c] = { la: quant(la, .5), lo: quant(lo, .5) };
  }
  const inFrame = (x: CafePoint) => { const f = FRAME[x.city as CityKey]; return x.lat >= f.la[0] && x.lat <= f.la[1] && x.lng >= f.lo[0] && x.lng <= f.lo[1]; };
  const kmOf = (f: Frame) => { const mid = (f.la[0] + f.la[1]) / 2 * Math.PI / 180; return { w: (f.lo[1] - f.lo[0]) * 111.32 * Math.cos(mid), h: (f.la[1] - f.la[0]) * 110.57 }; };

  /* Layout */
  let W = 0, H = 0, DPR = 1, mobile = false, rGrid = 4, rBlock = 4;
  let rMap: Record<Level, number> = { A: 3.8, B: 3.4, C: 2.6, D: 2.3 };
  let panels = {} as Record<CityKey, Panel>, blockLabels = {} as Record<CityKey, { x: number; y: number }>;

  function layout() {
    W = stage.clientWidth; H = stage.clientHeight; mobile = W < 700;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    q("hint").textContent = canHover ? "Hover any dot" : "Tap any dot";

    // 1. Grid: the largest pitch that fits every cafe between the headline and the legend.
    const top = copy.offsetTop + copy.offsetHeight + (mobile ? 24 : 36);
    const legendGap = mobile ? 18 : 24, bottomPad = mobile ? 28 : 40;
    const side = mobile ? 22 : Math.max(56, (W - 1180) / 2);
    const fw = W - side * 2, fh = Math.max(140, H - top - legend.offsetHeight - legendGap - bottomPad);
    let g = { cols: 1, rows: N, pitch: 0 };
    for (let cols = 8; cols <= 90; cols++) {
      const rows = Math.ceil(N / cols), pitch = Math.min(fw / cols, fh / rows, mobile ? 14 : 22);
      if (pitch > g.pitch + 1e-6) g = { cols, rows, pitch };
    }
    const ox = (W - g.cols * g.pitch) / 2 + g.pitch / 2, oy = top + (fh - g.rows * g.pitch) / 2 + g.pitch / 2;
    const lastShift = (g.cols - (N - (g.rows - 1) * g.cols)) * g.pitch / 2;
    rGrid = clamp(g.pitch * .26, 1.8, 5.2);
    const gcx = W / 2, gcy = oy + g.rows * g.pitch / 2, gmax = Math.hypot(g.cols * g.pitch / 2, g.rows * g.pitch / 2);
    for (const d of dots) {
      const row = Math.floor(d.slot / g.cols), col = d.slot % g.cols;
      d.gx = ox + col * g.pitch + (row === g.rows - 1 ? lastShift : 0);
      d.gy = oy + row * g.pitch;
      d.appearAt = 200 + (Math.hypot(d.gx - gcx, d.gy - gcy) / gmax) * 750 + d.delay * 90;
    }
    legend.style.top = `${oy - g.pitch / 2 + g.rows * g.pitch + legendGap}px`;

    // 2. Blocks: each city's cafes as a waffle, ordered by what they say, so the share that
    //    names a source reads as a band across the top. Centred on the screen: the headline is gone by now.
    const byCity = {} as Record<CityKey, Dot[]>;
    for (const c of CITIES) byCity[c] = dots.filter((d) => d.city === c).sort((a, b) => RANK[a.lvl] - RANK[b.lvl] || a.slot - b.slot);
    const labelH = mobile ? 40 : 50;
    const areaTop = 64 + (mobile ? 20 : 36), areaH = H - areaTop - (mobile ? 28 : 48);
    const place = (list: Dot[], cols: number, pitch: number, x0: number, y0: number) =>
      list.forEach((d, i) => { d.bx = x0 + (i % cols) * pitch + pitch / 2; d.by = y0 + Math.floor(i / cols) * pitch + pitch / 2; d.pour = i / list.length; });
    if (!mobile) {
      const rows = g.rows, cS = Math.ceil(byCity.Sydney.length / rows), cM = Math.ceil(byCity.Melbourne.length / rows), gapCols = 4;
      const pitch = Math.min(g.pitch, fw / (cS + cM + gapCols), (areaH - labelH) / rows);
      const x0 = (W - (cS + cM + gapCols) * pitch) / 2, y0 = areaTop + labelH + (areaH - labelH - rows * pitch) / 2;
      place(byCity.Sydney, cS, pitch, x0, y0);
      place(byCity.Melbourne, cM, pitch, x0 + (cS + gapCols) * pitch, y0);
      blockLabels = { Sydney: { x: x0, y: y0 - labelH + 4 }, Melbourne: { x: x0 + (cS + gapCols) * pitch, y: y0 - labelH + 4 } };
      rBlock = clamp(pitch * .26, 1.8, 5.2);
    } else {
      const cols = g.cols, rS = Math.ceil(byCity.Sydney.length / cols), rM = Math.ceil(byCity.Melbourne.length / cols);
      const pitch = Math.min(g.pitch, (areaH - labelH * 2 - 12) / (rS + rM));
      const x0 = (W - cols * pitch) / 2, used = (rS + rM) * pitch + labelH * 2 + 12;
      const y0 = areaTop + Math.max(0, (areaH - used) / 2) + labelH, y1 = y0 + rS * pitch + 12 + labelH;
      place(byCity.Sydney, cols, pitch, x0, y0);
      place(byCity.Melbourne, cols, pitch, x0, y1);
      blockLabels = { Sydney: { x: x0, y: y0 - labelH + 2 }, Melbourne: { x: x0, y: y1 - labelH + 2 } };
      rBlock = clamp(pitch * .26, 1.4, 4);
    }

    // 3. Maps: both cities at one shared scale, so their sizes compare honestly.
    end.style.visibility = "hidden"; end.classList.add("dh-on");
    const mTop = end.offsetTop + end.offsetHeight + (mobile ? 26 : 40);
    end.style.visibility = "";
    // On a phone the maps stop higher, so "+N further out" and the map credit get a line each.
    const gap = mobile ? 22 : 90, mBottom = H - 46;
    const S = kmOf(FRAME.Sydney), M = kmOf(FRAME.Melbourne);
    const box = {} as Record<CityKey, { x: number; y: number; w: number; h: number }>;
    if (!mobile) {
      const availW = Math.min(W - side * 2, 1260) - gap, availH = mBottom - mTop - labelH;
      const s = Math.min(availW / (S.w + M.w), availH / Math.max(S.h, M.h)), tall = Math.max(S.h, M.h);
      const x0 = (W - (S.w + M.w) * s - gap) / 2, y0 = mTop + labelH + (availH - tall * s) / 2;
      box.Sydney = { x: x0, y: y0 + (tall - S.h) * s / 2, w: S.w * s, h: S.h * s };
      box.Melbourne = { x: x0 + S.w * s + gap, y: y0 + (tall - M.h) * s / 2, w: M.w * s, h: M.h * s };
      rMap = { A: 3.8, B: 3.4, C: 2.6, D: 2.3 };
    } else {
      const availW = W - 40, availH = mBottom - mTop - labelH * 2 - gap;
      const s = Math.min(availW / Math.max(S.w, M.w), availH / (S.h + M.h));
      const y0 = mTop + labelH + Math.max(0, (availH - (S.h + M.h) * s) / 2);
      box.Sydney = { x: (W - S.w * s) / 2, y: y0, w: S.w * s, h: S.h * s };
      box.Melbourne = { x: (W - M.w * s) / 2, y: y0 + S.h * s + gap + labelH, w: M.w * s, h: M.h * s };
      rMap = { A: 2.8, B: 2.5, C: 1.9, D: 1.7 };
    }
    for (const c of CITIES) {
      const b = box[c], f = FRAME[c];
      const X = (lo: number) => b.x + (lo - f.lo[0]) / (f.lo[1] - f.lo[0]) * b.w;
      const Y = (la: number) => b.y + (f.la[1] - la) / (f.la[1] - f.la[0]) * b.h;
      const trace = (path: Path2D, ring: Ring) => ring.forEach(([lo, la], i) => (i ? path.lineTo(X(lo), Y(la)) : path.moveTo(X(lo), Y(la))));
      const coast = new Path2D();
      for (const line of geo[c]?.coast || []) trace(coast, line);
      // One path per water body: filled together, overlapping bodies (Port Jackson contains
      // Sydney Harbour) cancel out under even-odd and the harbour vanishes.
      const water = (geo[c]?.water || []).map((poly) => { const p = new Path2D(); for (const ring of poly) { trace(p, ring); p.closePath(); } return p; });
      panels[c] = { ...b, X, Y, coast, water };
    }
    const maxFar = {} as Record<CityKey, number>;
    for (const d of dots) {
      const p = panels[d.city];
      d.onMap = inFrame(d.c);
      d.mx = p.X(d.c.lng); d.my = p.Y(d.c.lat);
      d.farPx = Math.hypot(p.X(HUB[d.city].lo) - d.mx, p.Y(HUB[d.city].la) - d.my);
      maxFar[d.city] = Math.max(maxFar[d.city] || 0, d.onMap ? d.farPx : 0);
    }
    for (const d of dots) d.far = clamp(d.farPx / (maxFar[d.city] || 1));
    dodge(dots.filter((d) => d.onMap));

    marksEl.innerHTML = "";
    for (const c of CITIES) {
      const p = panels[c], outside = cafes.filter((x) => x.city === c && !inFrame(x)).length;
      if (outside) {
        const span = document.createElement("span"); span.className = "dh-far"; span.textContent = `+${outside} further out`;
        span.style.left = `${p.x + p.w}px`; span.style.top = `${p.y + p.h + 6}px`; span.style.transform = "translateX(-100%)";
        marksEl.appendChild(span);
      }
    }
  }

  // 473 cafes share a spot with another within ~100m (many are geocoded to their suburb), so at map
  // scale they stack into one dot. Relax them apart until none overlap, each held to its true spot
  // by a spring: clusters then show how many cafes they really hold.
  function dodge(list: Dot[]) {
    const home = list.map((d) => [d.mx, d.my]), cell = (rMap.A + 1) * 2;
    list.forEach((d, i) => { d.mx += Math.cos(i * 2.39996) * .01; d.my += Math.sin(i * 2.39996) * .01; });
    for (let it = 0; it < 60; it++) {
      const grid = new Map<string, number[]>();
      list.forEach((d, i) => { const k = `${Math.floor(d.mx / cell)},${Math.floor(d.my / cell)}`; const b = grid.get(k); if (b) b.push(i); else grid.set(k, [i]); });
      let moved = 0;
      list.forEach((a, i) => {
        const gx = Math.floor(a.mx / cell), gy = Math.floor(a.my / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (const j of grid.get(`${gx + ox},${gy + oy}`) || []) {
          if (j <= i) continue;
          const b = list[j], min = rMap[a.lvl] + rMap[b.lvl] + .9;
          let dx = b.mx - a.mx, dy = b.my - a.my, dist = Math.hypot(dx, dy);
          if (dist >= min) continue;
          if (dist < 1e-6) { dx = Math.cos(j); dy = Math.sin(j); dist = 1; }
          const push = (min - dist) / 2 / dist;
          a.mx -= dx * push; a.my -= dy * push; b.mx += dx * push; b.my += dy * push; moved++;
        }
      });
      list.forEach((d, i) => { d.mx += (home[i][0] - d.mx) * .02; d.my += (home[i][1] - d.my) * .02; });
      if (!moved) break;
    }
  }

  /* Scroll — one screen of travel, three beats: sort by city, pour into the map from the middle out, then search. */
  let P = 0, t0 = 0, raf = 0;
  const target = () => { const travel = root.offsetHeight - stage.offsetHeight; return travel > 0 ? clamp(-root.getBoundingClientRect().top / travel) : 0; };
  const beat1 = (d: Dot) => reduced ? (P > .3 ? 1 : 0) : easeInOut(clamp((P - .03 - d.pour * .12 - d.delay * .03) / .26));
  const beat2 = (d: Dot) => reduced ? (P > .62 ? 1 : 0) : easeInOut(clamp((P - .47 - d.far * .16) / .3));

  function overlays() {
    const out = 1 - smooth(clamp(P / .18));
    copy.style.opacity = String(out); copy.style.transform = `translateY(${-(1 - out) * 40}px)`;
    legend.style.visibility = out < .02 ? "hidden" : "visible";
    if (!legend.classList.contains("dh-intro-late")) legend.style.opacity = String(out);
    const lab = smooth(clamp((P - .24) / .12)), move = reduced ? (P > .62 ? 1 : 0) : easeInOut(clamp((P - .47) / .34));
    for (const c of CITIES) {
      const a = blockLabels[c], b = { x: panels[c].x, y: panels[c].y - (mobile ? 38 : 48) };
      cityEls[c].style.opacity = String(lab);
      cityEls[c].style.transform = `translate(${lerp(a.x, b.x, move)}px, ${lerp(a.y, b.y, move)}px)`;
    }
    const marks = String(smooth(clamp((P - .84) / .14)));
    for (const m of Array.from(marksEl.children) as HTMLElement[]) m.style.opacity = marks;
    credit.style.opacity = marks; credit.style.visibility = Number(marks) > .02 ? "visible" : "hidden";
    const inn = smooth(clamp((P - .74) / .22));
    end.style.opacity = String(inn); end.style.transform = `translateY(${(1 - inn) * 26}px)`;
    end.classList.toggle("dh-on", inn > .02);
    if (inn < .5 && document.activeElement === input) input.blur();
    if (root.getBoundingClientRect().bottom < innerHeight * .55) results.classList.remove("dh-show");
  }

  /* Drawing */
  let hover: Dot | null = null, pinned = false, matches: Set<Dot> | null = null, activeRes = -1;
  type Halo = { x: number; y: number; r: number; L: number; rest?: number };

  // Fade a map out at its frame, so the water runs off into the page instead of stopping at a ruled
  // line. It erases, so it runs before any dot is drawn. It also runs outside the clip and reaches a
  // little past the frame: inside the clip, the frame's antialiased last row survives as a hairline.
  function feather(p: Panel) {
    const F = Math.min(mobile ? 24 : 40, p.w / 4, p.h / 4), o = 2;
    ctx.save(); ctx.globalCompositeOperation = "destination-out"; ctx.globalAlpha = 1;
    const fade = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      [1, .84, .5, .16, 0].forEach((a, i) => g.addColorStop(i / 4, `rgba(0,0,0,${a})`)); // 1 − smoothstep
      ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
    };
    fade(p.x, 0, p.x + F, 0, p.x - o, p.y - o, F + o, p.h + 2 * o);
    fade(p.x + p.w, 0, p.x + p.w - F, 0, p.x + p.w - F, p.y - o, F + o, p.h + 2 * o);
    fade(0, p.y, 0, p.y + F, p.x - o, p.y - o, p.w + 2 * o, F + o);
    fade(0, p.y + p.h, 0, p.y + p.h - F, p.x - o, p.y + p.h - F, p.w + 2 * o, F + o);
    ctx.restore();
  }

  function draw(now: number) {
    const elapsed = reduced ? 1e9 : now - t0;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const coast = smooth(clamp((P - .62) / .3));
    if (coast > 0) {
      ctx.save(); ctx.globalAlpha = coast; ctx.lineJoin = "round"; ctx.lineCap = "round";
      for (const c of CITIES) {
        const p = panels[c];
        ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
        ctx.fillStyle = "#d0dccb"; for (const w of p.water) ctx.fill(w, "evenodd");
        ctx.strokeStyle = "rgba(38, 64, 35, .36)"; ctx.lineWidth = 1; ctx.stroke(p.coast);
        ctx.restore();
        feather(p);
      }
      ctx.restore();
    }

    let lit = 0;
    const halos: Halo[] = [];
    for (const d of drawOrder) {
      const s1 = beat1(d), s2 = beat2(d);
      const a = reduced ? 1 : easeOut(clamp((elapsed - d.appearAt) / 460));
      const L = d.said ? (reduced ? 1 : clamp((elapsed - d.litAt) / 420)) : 0;
      if (d.said && L > .5) lit++;
      const x = lerp(lerp(d.gx, d.bx, s1), d.mx, s2), y = lerp(lerp(d.gy, d.by, s1), d.my, s2);
      // In flight, greys dip and greens hold, so the sort reads as the greens rising to the top.
      const flight = Math.sin(Math.PI * s1) * (1 - s2);
      let r = lerp(lerp(rGrid, rBlock, s1), rMap[d.lvl], s2) * (a < 1 ? .4 + .6 * a : 1) * (d.said ? 1 + .12 * flight : 1 - .38 * flight);
      let alpha = d.onMap ? 1 : 1 - s2;
      if (matches && s2 > .9) { if (matches.has(d)) r *= 1.7; else alpha *= .13; }
      d.x = x; d.y = y; d.r = r; d.alpha = alpha * a;
      if (d.alpha <= .01) continue;

      const k = d.said ? easeOut(L) : 1;
      const rgb = d.said ? GREY.map((gv, i) => Math.round(lerp(gv, d.rgb[i], k))) : d.rgb.map((v, i) => Math.round(lerp(v, MAPGREY[d.lvl as "C" | "D"][i], s2)));
      if (d.said && L > 0 && L < 1) halos.push({ x, y, r, L });
      if (d.lvl === "A" && L >= 1 && s1 < 1) halos.push({ x, y, r, L: 1, rest: 1 - s1 });
      ctx.globalAlpha = d.alpha;
      ctx.beginPath(); ctx.arc(x, y, r * (1 + .5 * Math.sin(Math.PI * L) * (1 - s1)), 0, 7);
      ctx.fillStyle = `rgb(${rgb})`; ctx.fill();
      if (d.said && s2 > 0) { ctx.globalAlpha = d.alpha * s2; ctx.lineWidth = 1; ctx.strokeStyle = "#fdfcf7"; ctx.stroke(); }
    }
    // A bloom as each cafe that says where switches on, then a faint resting glow on the first screen.
    for (const h of halos) {
      const R = h.rest ? h.r * 2.7 : h.r * (1.6 + 3.2 * h.L), o = h.rest ? .16 * h.rest : .42 * (1 - h.L);
      const gr = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, R);
      gr.addColorStop(0, `rgba(110, 179, 92, ${o})`); gr.addColorStop(1, "rgba(110, 179, 92, 0)");
      ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(h.x, h.y, R, 0, 7); ctx.fill();
    }
    if (hover && hover.alpha > .2) {
      const R = Math.max(hover.r * 2.1, 6);
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(hover.x, hover.y, R + 3.5, 0, 7); ctx.fillStyle = "rgba(253, 252, 247, .96)"; ctx.fill();
      ctx.beginPath(); ctx.arc(hover.x, hover.y, R, 0, 7); ctx.fillStyle = `rgb(${hover.rgb})`; ctx.fill();
      ctx.beginPath(); ctx.arc(hover.x, hover.y, R + 3.5, 0, 7); ctx.strokeStyle = "rgba(17, 24, 39, .85)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    countEl.textContent = String(reduced ? SAID : lit);
    return elapsed;
  }

  function frame(now: number) {
    const goal = target();
    P = reduced ? goal : P + (goal - P) * .17;
    if (Math.abs(goal - P) < .0004) P = goal;
    overlays();
    const elapsed = draw(now);
    if (hover && !pinned) placeTip(hover);
    raf = elapsed < INTRO_END || P !== goal ? requestAnimationFrame(frame) : 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  /* Tooltip */
  function pick(cx: number, cy: number) {
    const rect = canvas.getBoundingClientRect(), x = cx - rect.left, y = cy - rect.top;
    let best: Dot | null = null, bd = Infinity;
    for (const d of dots) {
      if (d.alpha < .3) continue;
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bd) { bd = dist; best = d; }
    }
    return best && bd <= Math.max(mobile ? 16 : 11, best.r * 2.6) ? best : null;
  }
  function tipHTML(d: Dot) {
    const L = LEVEL[d.lvl], quote = d.lvl === "A" ? excerpt(d.c.quote) : null;
    const body = quote ? `<blockquote>“${esc(quote)}”</blockquote>` : `<p>${L.text}</p>`;
    return `<span class="dh-chip" style="background:${L.bg};color:${L.ink}"><i style="background:${L.color}"></i>${L.chip}</span>
      <h4>${esc(d.c.name)}</h4><div class="dh-where">${esc(d.c.suburb)}, ${d.city}</div>${body}
      <a class="dh-open" href="${d.url}" data-go>${d.lvl === "A" ? "See the evidence" : "Open cafe page"} →</a>`;
  }
  function placeTip(d: Dot) {
    const rect = canvas.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    const x = rect.left + d.x, y = rect.top + d.y;
    let left: number, top: number;
    if (mobile) { left = (innerWidth - tw) / 2; top = y + 22; if (top + th > innerHeight - 12) top = y - th - 22; }
    else { left = x + 20; top = y - 26; if (left + tw > innerWidth - 16) left = x - 20 - tw; }
    tip.style.left = `${clamp(left, 16, innerWidth - tw - 16)}px`;
    tip.style.top = `${clamp(top, 76, innerHeight - th - 12)}px`;
  }
  function setHover(d: Dot | null, touch = false) {
    if (d === hover && pinned === touch) return;
    hover = d; pinned = touch && !!d;
    if (d) { tip.innerHTML = tipHTML(d); tip.classList.toggle("dh-touch", touch); placeTip(d); tip.classList.add("dh-show"); canvas.style.cursor = "pointer"; }
    else { tip.classList.remove("dh-show", "dh-touch"); canvas.style.cursor = ""; }
    kick(); draw(performance.now());
  }

  /* Search */
  function highlight(text: string, needle: string) {
    const i = norm(text).indexOf(needle);
    return i < 0 ? esc(text) : esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + needle.length)) + "</mark>" + esc(text.slice(i + needle.length));
  }
  const rows = () => Array.from(results.querySelectorAll<HTMLElement>(".dh-res"));
  function renderResults(list: Dot[], needle: string) {
    activeRes = list.length ? 0 : -1;
    // Few rows, then a way to the rest: a taller list covered the very dots the search lights up.
    const show = mobile ? 3 : 4;
    results.innerHTML = list.slice(0, show).map((d, i) => `<div class="dh-res${i === 0 ? " dh-active" : ""}" role="option" data-i="${dots.indexOf(d)}">
        <span class="dh-d" style="background:${LEVEL[d.lvl].color}"></span>
        <span class="dh-t"><div class="dh-nm">${highlight(d.c.name, needle)}</div><div class="dh-sb">${highlight(d.c.suburb, needle)} · ${d.city}</div></span>
        <span class="dh-lv">${LEVEL[d.lvl].chip}</span></div>`).join("")
      + (list.length > show ? `<a class="dh-more" href="/map" data-go>${list.length - show} more on the map →</a>` : "");
    results.classList.toggle("dh-show", list.length > 0);
  }
  function activate(i: number) {
    const rs = rows(); if (!rs.length) return;
    activeRes = (i + rs.length) % rs.length;
    rs.forEach((r, k) => r.classList.toggle("dh-active", k === activeRes));
    rs[activeRes].scrollIntoView({ block: "nearest" });
    const d = dots[Number(rs[activeRes].dataset.i)]; if (d.onMap) setHover(d);
  }

  /* Events */
  const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
    t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts));
  };
  const offs: (() => void)[] = [];
  on(canvas, "pointermove", (e: PointerEvent) => { if (e.pointerType !== "touch") setHover(pick(e.clientX, e.clientY)); });
  on(canvas, "pointerleave", (e: PointerEvent) => { if (e.pointerType !== "touch") setHover(null); });
  on(canvas, "click", (e: PointerEvent) => {
    const d = pick(e.clientX, e.clientY);
    if (e.pointerType === "touch" || !canHover) { setHover(d, true); return; }
    if (d) go(d.url);
  });
  on(document, "pointerdown", (e: PointerEvent) => { if (pinned && !tip.contains(e.target as Node) && e.target !== canvas) setHover(null); });
  on(root, "click", (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-go]");
    if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute("href")!); }
  });
  on(input, "input", () => {
    const needle = norm(input.value.trim());
    if (!needle) { matches = null; results.classList.remove("dh-show"); meta.textContent = "Every dot is a real cafe."; setHover(null); kick(); return; }
    const list = dots.filter((d) => d.name.includes(needle) || d.sub.includes(needle))
      .sort((a, b) => (a.name.startsWith(needle) ? 0 : 1) - (b.name.startsWith(needle) ? 0 : 1) || RANK[a.lvl] - RANK[b.lvl] || a.c.name.localeCompare(b.c.name));
    matches = new Set(list);
    const said = list.filter((d) => d.said).length;
    meta.innerHTML = list.length ? `${list.length} ${list.length === 1 ? "cafe" : "cafes"} · <span class="dh-said">${said} say where</span>` : "No cafe by that name yet.";
    renderResults(list, needle);
    kick(); draw(performance.now());
  });
  on(input, "keydown", (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); activate(activeRes + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activate(activeRes - 1); }
    else if (e.key === "Enter" && activeRes >= 0) go(dots[Number(rows()[activeRes].dataset.i)].url);
    else if (e.key === "Escape") { input.value = ""; input.dispatchEvent(new Event("input")); }
  });
  on(results, "pointermove", (e: PointerEvent) => { const row = (e.target as HTMLElement).closest<HTMLElement>(".dh-res"); if (row) activate(rows().indexOf(row)); });
  on(results, "click", (e: MouseEvent) => { const row = (e.target as HTMLElement).closest<HTMLElement>(".dh-res"); if (row) go(dots[Number(row.dataset.i)].url); });
  on(input, "focus", () => { if (input.value) results.classList.add("dh-show"); });
  let blurTimer = 0;
  on(input, "blur", () => { blurTimer = window.setTimeout(() => results.classList.remove("dh-show"), 150); });
  on(window, "scroll", () => { if (hover && !pinned) setHover(null); kick(); }, { passive: true });
  on(window, "resize", () => { layout(); kick(); });
  on(legend, "animationend", () => { legend.classList.remove("dh-intro-late"); legend.style.opacity = String(1 - smooth(clamp(P / .18))); });

  layout();
  t0 = performance.now();
  overlays();
  kick();

  return () => {
    offs.forEach((off) => off());
    if (raf) cancelAnimationFrame(raf);
    clearTimeout(blurTimer);
    root.classList.remove("dh-live");
  };
}
