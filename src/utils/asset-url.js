/**
 * Resolves a root-relative path from the config files ("/assets/…") against
 * the deployment base path, so the site works both at a domain root and in a
 * sub-folder such as GitHub Pages (https://user.github.io/repo/).
 *
 * The base comes from Vite's `base` option (see vite.config.js, BASE_PATH).
 * Absolute URLs and non-root paths are returned unchanged.
 */
const BASE_URL = import.meta.env?.BASE_URL ?? '/';

export function resolveUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return path;
  return BASE_URL.replace(/\/$/, '') + path;
}
