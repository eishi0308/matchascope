"use client";

import { useEffect } from "react";
import { MapContainer, Marker } from "react-leaflet";
import Basemap from "./Basemap";
import L from "leaflet";

/**
 * A single-pin, non-interactive locator map for the cafe permalink page — the same
 * "where is this" glance every listing-detail page (Airbnb, Google Maps place pages)
 * gives you before you commit to opening full directions. Deliberately not the full
 * MapClient: no other pins, no zoom/pan controls, nothing to fly to — it's a locator,
 * not a second copy of /map. Must be loaded with `dynamic(..., { ssr: false })` by
 * its caller, same as MapClient, since Leaflet touches `window` at import time.
 */
function fixLeafletIcon() {
  // @ts-ignore
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  });
}

function pinIcon(color: string) {
  const size = 40;
  return L.divIcon({
    html: `
      <div style="
        width:${size}px; height:${size}px; background:${color};
        border-radius:50% 50% 50% 0; transform:rotate(-45deg);
        display:flex; align-items:center; justify-content:center;
        box-shadow:0 6px 18px rgba(0,0,0,0.3); border:3px solid #ffffff;
      ">
        <span style="transform:rotate(45deg); width:8px; height:8px; border-radius:50%; background:#ffffff;"></span>
      </div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });
}

interface Props {
  lat: number;
  lng: number;
  levelColor: string;
}

export default function CafeMiniMap({ lat, lng, levelColor }: Props) {
  useEffect(() => { fixLeafletIcon(); }, []);

  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      style={{ width: "100%", height: "100%" }}
      zoomControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      boxZoom={false}
      keyboard={false}
      attributionControl={false}
    >
      <Basemap />
      <Marker position={[lat, lng]} icon={pinIcon(levelColor)} interactive={false} />
    </MapContainer>
  );
}
