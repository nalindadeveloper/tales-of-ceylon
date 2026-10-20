/**
 * Helpers for optional resources that must never block or break the page.
 * Kept free of three.js so the entry chunk stays small.
 */

/** Optional JSON: resolves to null instead of throwing. */
export async function loadOptionalJSON(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
