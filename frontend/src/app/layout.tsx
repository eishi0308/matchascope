import type { Metadata } from "next";
import "./globals.css";
import { SITE_URL } from "@/lib/slug";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "MatchaScope — Transparency Map",
  description: "Find cafes that publicly disclose using Japanese matcha. Evidence-based, source-verified transparency ratings across Sydney & Melbourne.",
  keywords: "matcha, japanese matcha, cafe transparency, uji matcha, matcha sydney, matcha melbourne",
  openGraph: {
    title: "MatchaScope — Transparency Map",
    description: "Evidence-backed transparency ratings for matcha cafes across Australia.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="antialiased">{children}</body>
    </html>
  );
}
