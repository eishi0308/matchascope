"use client";

import { useEffect } from "react";
import { TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre/maplibre-gl-leaflet";

/**
 * The basemap, in one place because two maps draw it — the full map on /map and the
 * per-cafe locator on each permalink page. It used to be a URL string duplicated in
 * both, which is how one of them gets fixed and the other quietly doesn't.
 *
 * This is CARTO's Positron design, which is what the map has always looked like —
 * but served by OpenFreeMap, which needs no API key. CARTO's own CDN was open for
 * years and then began requiring one: it does not fail loudly, it returns HTTP 200
 * with a working tile that has "API KEY REQUIRED" stamped across it, held for the
 * 180 days its cache-control asks for.
 *
 * These are vector tiles, not images. That matters for more than licensing: place
 * names are drawn as real text by the GPU at the device's own pixel density, so
 * "Bellevue Hill" stays sharp on a retina screen and while zooming, where a raster
 * basemap ships the label pre-drawn at 1x and lets the browser stretch it.
 *
 * maplibre-gl is held at v4 on purpose. maplibre-gl-leaflet 0.1.4 lists ^6.0.0 as a
 * supported peer, but under v6 the layer mounts, fetches the style and the sprites,
 * and then stalls: isStyleLoaded() never turns true, not one vector tile is requested,
 * and nothing is logged. The map is simply blank. Bare MapLibre v6 renders the same
 * style fine, so it is the bridge, not the library or the provider. Upgrade only after
 * checking a real map still draws — a version bump here fails silently.
 *
 * To pin a different provider, set NEXT_PUBLIC_MAP_STYLE_URL to another MapLibre
 * style, or NEXT_PUBLIC_MAP_TILE_URL to fall back to plain raster tiles — for CARTO
 * with a key that is:
 *   https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?api_key=YOUR_KEY
 */

const CUSTOM_TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL;

const STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/positron";

/**
 * Attribution is a licence condition for every provider here, not decoration, so the
 * credit tracks whichever one is actually being drawn.
 */
const VECTOR_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · ' +
  '<a href="https://openfreemap.org">OpenFreeMap</a>';

const RASTER_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function VectorBasemap() {
  const map = useMap();

  useEffect(() => {
    // MapLibre draws its own attribution box; Leaflet already has one, and on the
    // mini map both are suppressed, so the credit goes through Leaflet's control.
    const layer = L.maplibreGL({ style: STYLE_URL, attributionControl: false });
    layer.addTo(map);
    map.attributionControl?.addAttribution(VECTOR_ATTRIBUTION);

    return () => {
      map.attributionControl?.removeAttribution(VECTOR_ATTRIBUTION);
      map.removeLayer(layer);
    };
  }, [map]);

  return null;
}

export default function Basemap() {
  if (CUSTOM_TILE_URL) {
    return <TileLayer url={CUSTOM_TILE_URL} attribution={RASTER_ATTRIBUTION} />;
  }
  return <VectorBasemap />;
}
