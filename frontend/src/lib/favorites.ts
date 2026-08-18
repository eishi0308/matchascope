"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Favourites live in localStorage, not an account. The app has no session-aware UI
 * anywhere yet (Navbar never reads Supabase auth state — see AuthModal usage), so a
 * server-backed favourites list would need to be built twice: once for real and once
 * as UI decoration that silently does nothing for a signed-out visitor, which is most
 * of them. localStorage gets every visitor the actual feature today; migrating a
 * user's saved ids to a `favorites` table keyed on auth.uid() later is a small,
 * additive follow-up, not a rewrite.
 */
const KEY = "matchascope:favorites";
const EVENT = "matchascope:favorites-changed";

function readAll(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeAll(ids: Set<string>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(ids)));
    // storage event only fires in *other* tabs — dispatch our own so every
    // FavoriteButton/useFavorites instance in this tab re-renders immediately.
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // localStorage unavailable (private mode, quota) — favouriting silently no-ops
  }
}

export function isFavorite(id: string): boolean {
  return readAll().has(id);
}

export function toggleFavorite(id: string): boolean {
  const all = readAll();
  const next = all.has(id);
  next ? all.delete(id) : all.add(id);
  writeAll(all);
  return !next;
}

/** Re-renders whenever the favourites set changes, anywhere in this tab or another. */
export function useFavoriteIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setIds(readAll()); // hydrate after mount — SSR has no localStorage
    const sync = () => setIds(readAll());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return ids;
}

export function useFavorite(id: string): [boolean, () => void] {
  const ids = useFavoriteIds();
  const toggle = useCallback(() => toggleFavorite(id), [id]);
  return [ids.has(id), toggle];
}
