import { ImageResponse } from "next/og";
import { fetchCafe } from "@/lib/api";
import { cafeIdFromSlug } from "@/lib/slug";
import { levelConfig } from "@/data/cafes";

/**
 * A branded social-preview card per cafe, generated on request — the same idea as
 * Vercel/Linear/Notion's dynamic OG images. Without this, every shared cafe link
 * (iMessage, Slack, Twitter/X) previewed as bare text; with it, the level grade and
 * evidence are visible before the link is even opened.
 */
export const alt = "MatchaScope transparency grade";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { slug: string } }) {
  const id = cafeIdFromSlug(params.slug);
  const cafe = await fetchCafe(id).catch(() => null);

  if (!cafe) {
    return new ImageResponse(
      (
        <div style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(135deg, #0f2010 0%, #1e3a1a 40%, #2e6027 100%)", color: "#fff", fontSize: 48,
        }}>
          MatchaScope
        </div>
      ),
      { ...size },
    );
  }

  const level = levelConfig[cafe.level];
  const onLight = level.headerText !== "#ffffff";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: `linear-gradient(160deg, ${level.headerBg}f0 0%, ${level.headerBg} 60%, #fdfcf7 100%)`,
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand mark */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: 28, display: "flex", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(140deg, #3c7a32 0%, #2e6027 45%, #6eb35c 100%)",
            }}
          >
            <div style={{ width: 26, height: 13, borderRadius: "13px 13px 2px 2px", background: "#ffffff" }} />
          </div>
          <span style={{ fontSize: 30, fontWeight: 700, color: onLight ? "#1a1a1a" : "#ffffff", letterSpacing: -0.5 }}>
            MatchaScope
          </span>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              alignItems: "center",
              gap: 10,
              padding: "10px 22px",
              borderRadius: 999,
              background: level.headerPill,
              color: level.headerText,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Level {cafe.level} — {level.shortLabel}
          </div>

          <div
            style={{
              display: "flex",
              fontSize: cafe.name.length > 28 ? 58 : 72,
              fontWeight: 800,
              color: level.headerText,
              lineHeight: 1.05,
              maxWidth: 1000,
            }}
          >
            {cafe.name}
          </div>

          <div style={{ display: "flex", fontSize: 30, color: onLight ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.8)" }}>
            {cafe.suburb}, {cafe.city}
          </div>
        </div>

        {/* Footer strip */}
        <div style={{ display: "flex", fontSize: 24, color: onLight ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.6)" }}>
          Evidence-based Japanese matcha transparency ratings
        </div>
      </div>
    ),
    { ...size },
  );
}
