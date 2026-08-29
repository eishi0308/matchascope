"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import { LocateFixed } from "lucide-react";
import { Cafe } from "@/data/cafes";
import Basemap from "./Basemap";

// Fix leaflet default icon in Next.js
function fixLeafletIcon() {
  // @ts-ignore
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  });
}

const MAP_POS_KEY = "matcha_map_position";

function saveMapPosition(center: L.LatLng, zoom: number) {
  sessionStorage.setItem(MAP_POS_KEY, JSON.stringify({ lat: center.lat, lng: center.lng, zoom }));
}

function loadMapPosition(): { lat: number; lng: number; zoom: number } | null {
  try {
    const raw = sessionStorage.getItem(MAP_POS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const LEVEL_COLORS: Record<string, string> = {
  A: "#2e6027",
  B: "#6eb35c",
  C: "#9ca3af",
  D: "#d1d5db",
};

/**
 * Beacon colour for the selected pin. Deliberately NOT the level colour: ~90%
 * of cafes are level C, so a level-tinted halo would be grey almost every time.
 * Red is the one hue the level palette (greens + greys) never uses, so it can't
 * be mistaken for a grade — and the pin body keeps its level colour regardless.
 */
const SIGNAL = "#e11d48";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function pinHtml(level: string, color: string, size: number, isSelected: boolean) {
  return `
    <div style="
      width:${size}px;
      height:${size}px;
      background:${color};
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      display:flex;
      align-items:center;
      justify-content:center;
      box-shadow:${isSelected
        ? `0 0 0 3px ${SIGNAL}, 0 6px 20px rgba(0,0,0,0.34)`
        : "0 4px 16px rgba(0,0,0,0.28)"};
      border:${isSelected ? "3px" : "2.5px"} solid #ffffff;
    ">
      <span style="
        transform:rotate(45deg);
        font-size:${isSelected ? 16 : 13}px;
        font-weight:800;
        color:white;
        font-family:system-ui,sans-serif;
        letter-spacing:-0.5px;
      ">${level}</span>
    </div>
  `;
}

/**
 * The selected cafe keeps its level colour — selection is carried by scale, a
 * white ring, a one-shot ripple and a name chip, while every other pin drops
 * back to 40% so only one pin on the map is at full strength.
 */
function createCustomIcon(level: string, isSelected: boolean, name: string) {
  const color = LEVEL_COLORS[level] || "#9ca3af";
  const size  = isSelected ? 46 : 36;

  const html = isSelected
    ? `<div style="position:relative;width:${size}px;height:${size}px;--ms-ring:${SIGNAL};">
         <span class="ms-ripple"></span>
         <span class="ms-ripple ms-ripple--2"></span>
         ${pinHtml(level, color, size, true)}
         <span class="ms-label">${escapeHtml(name)}</span>
       </div>`
    : pinHtml(level, color, size, false);

  return L.divIcon({
    html,
    // Dimming is done in CSS off this class, not baked into each icon, so
    // selecting a cafe doesn't rebuild all ~1100 markers.
    className: isSelected ? "ms-selected" : "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

// Unselected pins have exactly four variants — build each once and share it.
const iconCache = new Map<string, L.DivIcon>();

function getIcon(level: string, isSelected: boolean, name: string) {
  if (isSelected) return createCustomIcon(level, true, name);
  let icon = iconCache.get(level);
  if (!icon) {
    icon = createCustomIcon(level, false, name);
    iconCache.set(level, icon);
  }
  return icon;
}

/** Puts the map into "something is selected" mode so CSS can dim the context. */
function SelectionMode({ active }: { active: boolean }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().classList.toggle("ms-has-selection", active);
  }, [map, active]);
  return null;
}

function FlyTo({ cafe, isMobile }: { cafe: Cafe | null; isMobile: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!cafe) return;
    // Don't zoom back out if the user has already zoomed in past 15
    const zoom = Math.max(map.getZoom(), 15);
    const target = L.latLng(cafe.lat, cafe.lng);

    // On mobile the bottom sheet covers the lower half, so aim the pin high;
    // on desktop the panel is a flex sibling, so the container itself shrinks
    // and the true centre is already the visible centre.
    const center = isMobile
      ? map.unproject(map.project(target, zoom).add([0, map.getSize().y * 0.22]), zoom)
      : target;

    map.flyTo(center, zoom, { duration: 0.8 });
  }, [cafe, map, isMobile]);
  return null;
}

/**
 * The detail panel and the sidebar resize the map's container. Leaflet doesn't
 * notice on its own, so it keeps drawing at the old width — which parks the
 * cafe you just selected underneath the panel describing it.
 */
function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false, pan: false }));
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

// Saves position on every pan/zoom, and flies to city center when city filter changes
function MapStateTracker({ city }: { city: string }) {
  const map = useMap();
  const prevCity = useRef(city);

  useEffect(() => {
    const handler = () => saveMapPosition(map.getCenter(), map.getZoom());
    map.on("moveend", handler);
    return () => { map.off("moveend", handler); };
  }, [map]);

  useEffect(() => {
    if (city !== prevCity.current) {
      if (city !== "All") {
        const center = CITY_CENTERS[city];
        if (center) map.flyTo(center, 13, { duration: 0.8 });
      }
      prevCity.current = city;
    }
  }, [city, map]);

  return null;
}

/**
 * "Where am I" on the map.
 *
 * Permission is asked for on the tap, never on load: a prompt that appears before anyone
 * has asked for anything is the fastest way to get it denied permanently, and a denial is
 * expensive because browsers remember it. Every outcome is spoken aloud rather than
 * failing quietly, because a button that does nothing twice is a button nobody presses a
 * third time — and the commonest outcome, a standing denial, cannot be fixed from inside
 * the page, so it has to say where the setting lives.
 */
type LocateState = "idle" | "locating" | "found" | "error";

function LocateControl({ isMobile }: { isMobile: boolean }) {
  const map = useMap();
  const [state, setState] = useState<LocateState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const alive = useRef(true);
  const btnRef = useRef<HTMLDivElement>(null);

  // Set on mount, not only cleared on unmount: React runs effects twice in development,
  // so a ref that is only ever cleared stays cleared after the second mount and every
  // callback guarded by it silently does nothing.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Leaflet treats a click inside the map as a map click and would start a drag or a
  // zoom under the button, so this subtree is taken out of its hands.
  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  const locate = useCallback(() => {
    // Geolocation is refused outright outside a secure context, which is a footgun in
    // local development over a LAN address rather than localhost.
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setState("error");
      setMessage("This browser cannot share a location.");
      return;
    }
    if (!window.isSecureContext) {
      setState("error");
      setMessage("Location needs a secure (https) connection.");
      return;
    }

    // Already have a fix: re-centre rather than spend another lookup on it.
    if (state === "found" && pos) {
      map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
      return;
    }

    setState("locating");
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!alive.current) return;
        const next = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
        setPos(next);
        setState("found");
        map.flyTo([next.lat, next.lng], Math.max(map.getZoom(), 15), { duration: 0.9 });
      },
      (err) => {
        if (!alive.current) return;
        setState("error");
        setMessage(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked. Turn it on for this site in your browser settings."
            : err.code === err.TIMEOUT
            ? "Finding you took too long. Try again."
            : "Could not work out where you are."
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }, [map, state, pos]);

  // The error is worth reading once, not forever.
  useEffect(() => {
    if (state !== "error") return;
    const t = setTimeout(() => { if (alive.current) { setState("idle"); setMessage(null); } }, 6000);
    return () => clearTimeout(t);
  }, [state]);

  const label =
    state === "locating" ? "Finding your location"
    : state === "found"  ? "Centre on your location"
    : "Show your location";

  return (
    <>
      {pos && (
        <>
          {/* Accuracy first, so the dot sits on top of its own margin of error. */}
          <Circle
            center={[pos.lat, pos.lng]}
            radius={pos.accuracy}
            pathOptions={{ color: "#1a73e8", weight: 1, opacity: 0.35, fillColor: "#1a73e8", fillOpacity: 0.12 }}
          />
          <Marker
            position={[pos.lat, pos.lng]}
            zIndexOffset={2000}
            icon={L.divIcon({
              className: "ms-here",
              html: '<span class="ms-here-pulse"></span><span class="ms-here-dot"></span>',
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            })}
          />
        </>
      )}

      <div
        ref={btnRef}
        className="leaflet-top leaflet-right"
        style={{ pointerEvents: "none", top: "auto", bottom: isMobile ? 96 : 24, right: 8 }}
      >
        <div className="leaflet-control" style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          {message && (
            <div
              role="status"
              aria-live="polite"
              className="max-w-[15rem] rounded-xl px-3 py-2 text-[15px] leading-snug"
              style={{ background: "rgba(15,15,15,0.9)", color: "#fff", backdropFilter: "blur(8px)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}
            >
              {message}
            </div>
          )}
          <button
            type="button"
            onClick={locate}
            aria-label={label}
            title={label}
            className="grid place-items-center rounded-full bg-white outline-none focus-visible:ring-2 focus-visible:ring-matcha-500 active:scale-95 transition-transform"
            style={{
              width: 44, height: 44,
              border: "1px solid rgba(0,0,0,0.10)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.20)",
              color: state === "found" ? "#1a73e8" : "#374151",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {state === "locating" ? (
              <span className="ms-locating" aria-hidden="true" />
            ) : (
              <LocateFixed size={20} strokeWidth={2.2} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </>
  );
}

interface Props {
  cafes: Cafe[];
  selectedCafe: Cafe | null;
  onSelectCafe: (cafe: Cafe | null) => void;
  city: string;
  isMobile?: boolean;
}

const CITY_CENTERS: Record<string, [number, number]> = {
  All: [-33.88, 151.21],
  Sydney: [-33.8688, 151.2093],
  Melbourne: [-37.8136, 144.9631],
};

export default function MapClient({ cafes, selectedCafe, onSelectCafe, city, isMobile = false }: Props) {
  useEffect(() => { fixLeafletIcon(); }, []);

  // Read saved position once on mount — persists across page navigations within the same tab
  const savedPos = useRef(loadMapPosition());
  const center: [number, number] = savedPos.current
    ? [savedPos.current.lat, savedPos.current.lng]
    : (CITY_CENTERS[city] || CITY_CENTERS.All);
  const zoom = savedPos.current?.zoom ?? 13;

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ width: "100%", height: "100%" }}
      zoomControl={false}
    >
      <Basemap />
      <MapStateTracker city={city} />
      <ResizeHandler />
      <SelectionMode active={!!selectedCafe} />
      <FlyTo cafe={selectedCafe} isMobile={isMobile} />
      <LocateControl isMobile={isMobile} />
      {cafes.map((cafe) => {
        const isSelected = selectedCafe?.id === cafe.id;
        return (
          <Marker
            key={cafe.id}
            position={[cafe.lat, cafe.lng]}
            icon={getIcon(cafe.level, isSelected, cafe.name)}
            // Clicking the selected pin again clears it — back to every cafe shown equally
            eventHandlers={{ click: () => onSelectCafe(isSelected ? null : cafe) }}
            zIndexOffset={isSelected ? 1000 : 0}
          />
        );
      })}
    </MapContainer>
  );
}
