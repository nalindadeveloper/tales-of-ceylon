/**
 * Runtime environment checks: WebGL support, reduced-motion preference,
 * layout breakpoints and a coarse rendering-quality tier.
 */

const MOBILE_LAYOUT_QUERY = '(max-width: 899px)';

/**
 * QA flags: `?static` forces the no-WebGL fallback and `?reduced-motion`
 * simulates the reduced-motion preference, so both paths can be tested
 * without changing browser or OS settings.
 */
const params = new URLSearchParams(window.location.search);

export function isWebGL2Available() {
  if (params.has('static')) return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

export function prefersReducedMotion() {
  return params.has('reduced-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isMobileLayout() {
  return window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

/**
 * Picks 'low' for small touch devices or machines with few cores, so phones get
 * a lower pixel ratio and no shadow maps.
 */
export function detectQualityTier() {
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 820;
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  return (coarsePointer && smallScreen) || fewCores ? 'low' : 'high';
}

/** Subscribes to a media query; returns an unsubscribe function. */
export function onMediaChange(query, callback) {
  const list = window.matchMedia(query);
  list.addEventListener('change', callback);
  return () => list.removeEventListener('change', callback);
}

export { MOBILE_LAYOUT_QUERY };
