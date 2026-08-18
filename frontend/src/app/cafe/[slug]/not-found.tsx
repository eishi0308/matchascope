import Link from "next/link";
import { MapPin, ArrowRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import MatchaMark from "@/components/MatchaMark";

export default function CafeNotFound() {
  return (
    <div className="min-h-screen bg-cream-50">
      <Navbar />
      <div className="flex flex-col items-center justify-center text-center px-5 pt-16" style={{ minHeight: "100vh" }}>
        <div className="mb-6 opacity-90">
          <MatchaMark size={56} />
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
          We couldn&apos;t find that cafe
        </h1>
        <p className="text-[16px] text-gray-500 max-w-md mb-8 leading-relaxed">
          Its listing may have moved, been merged, or the link is out of date.
          Every cafe we&apos;ve graded is still on the map.
        </p>
        <Link
          href="/map"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[16px] font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #2e6027 0%, #4d9740 100%)", boxShadow: "0 4px 16px rgba(46,96,39,0.35)" }}
        >
          <MapPin size={14} />Browse the map <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
