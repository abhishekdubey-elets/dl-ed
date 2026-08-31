// Stale-while-revalidate cache for the signed-in views.
//
// On production the database sits a continent away from the API, so a cold
// reload pays ~6 sequential requests before anything renders. This cache
// paints the learner's LAST KNOWN state instantly and lets the live fetch
// replace it in the background — the "Refreshing your data…" footer already
// tells the truth while that happens.
//
// Safety: entries are keyed by user id, and the id is read from the JWT's
// own `sub` claim (decoded locally, never trusted for auth — only for cache
// addressing), so one account can never be shown another account's snapshot.
// Sign-out clears everything.

import { getToken } from "@/lib/api";

const PREFIX = "pathwise_cache_v1:";

/** The user id inside the stored JWT, or null. Local addressing only. */
export function tokenUserId(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function readCache<T>(key: string): T | null {
  const userId = tokenUserId();
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { userId: string; value: T };
    return entry.userId === userId ? entry.value : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  const userId = tokenUserId();
  if (!userId) return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ userId, value }));
  } catch {
    /* quota or private mode — the cache is a convenience, never required */
  }
}

export function clearCaches(): void {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
