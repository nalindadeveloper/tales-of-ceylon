/**
 * One location per scroll gesture inside the destinations section.
 *
 * Between the island overview and the last destination, free scrolling is
 * replaced by discrete steps: each wheel flick, swipe or arrow / Page key
 * moves exactly one stage (overview → Colombo → Kandy …, or back). While the
 * page scrolls to the stage and the camera pans to it, further input is
 * swallowed; it is accepted again only once the scroll has landed AND the
 * camera has settled.
 *
 * Trackpads keep emitting wheel events for about a second after a flick
 * ("momentum"). After unlocking, the controller therefore waits for a fresh
 * gesture — a pause in the wheel stream — so one flick never skips two
 * locations.
 *
 * Outside that range scrolling stays free: scrolling up from the overview
 * zooms back out through the clouds to the hero, and scrolling down from the
 * last destination continues to the editorial section. A fast free scroll
 * that would carry past the overview (from above) or into the last stage
 * (from below) is caught there.
 */

const GESTURE_GAP_MS = 220;   // pause that marks the start of a new wheel gesture
const MAX_SETTLE_MS = 4500;   // safety cap: input is never locked longer than this
const SWIPE_MIN_PX = 40;
const KEYS_FORWARD = new Set(['ArrowDown', 'PageDown', ' ', 'Spacebar']);
const KEYS_BACK = new Set(['ArrowUp', 'PageUp']);

export function createStepNavigation({ scroll, transitions, world, count }) {
  const first = -1;          // overview
  const last = count - 1;    // final destination
  let locked = false;
  let needsFreshGesture = false;
  let lastWheelTime = 0;
  let touchStartY = null;
  let lastScrollY = window.scrollY;

  /** Inside the stepped range: from the overview stop to the last destination stop. */
  const inZone = () => {
    const y = window.scrollY;
    const tolerance = 4; // px; overshoot past either edge is caught by onScroll
    return y >= scroll.stepScrollY(first) - tolerance && y <= scroll.stepScrollY(last) + tolerance;
  };

  /** Resolves once the camera has stopped flying / settling. */
  const cameraSettled = () =>
    new Promise((resolve) => {
      const started = performance.now();
      const check = () => (world.isCameraMoving() && performance.now() - started < MAX_SETTLE_MS ? requestAnimationFrame(check) : resolve());
      requestAnimationFrame(check);
    });

  async function go(index) {
    locked = true;
    try {
      // Instant page jump (invisible in the sticky section); the camera flight
      // is the transition, and input stays locked until it has settled.
      await scroll.navigateTo(index, { immediate: true });
      await cameraSettled();
    } finally {
      locked = false;
      needsFreshGesture = true;
      lastScrollY = window.scrollY;
    }
  }

  /**
   * Handles one gesture in a direction. Returns true when the gesture was
   * consumed (the native / smooth scroll must then be prevented).
   */
  function step(direction) {
    if (!inZone()) return false;
    if (locked) return true;
    const current = transitions.getActive();
    const next = current + direction;
    // Leaving the stepped range: let the page scroll freely.
    if (next < first || next > last) return false;
    go(next);
    return true;
  }

  function onWheel(event) {
    if (event.ctrlKey) return; // pinch-zoom
    const now = performance.now();
    const fresh = now - lastWheelTime > GESTURE_GAP_MS;
    lastWheelTime = now;
    if (Math.abs(event.deltaY) < 2) return;
    const direction = event.deltaY > 0 ? 1 : -1;
    if (!inZone()) return;

    // Momentum from the previous gesture: swallow until a new gesture starts.
    if (locked || (needsFreshGesture && !fresh)) {
      if (locked || stepWouldStayInZone(direction)) cancel(event);
      return;
    }
    needsFreshGesture = false;
    if (step(direction)) cancel(event);
  }

  /** True when a gesture in this direction would remain inside the stepped range. */
  function stepWouldStayInZone(direction) {
    const next = transitions.getActive() + direction;
    return next >= first && next <= last;
  }

  function onTouchStart(event) {
    touchStartY = event.touches[0]?.clientY ?? null;
  }

  function onTouchMove(event) {
    if (touchStartY === null || !inZone()) return;
    const dy = touchStartY - event.touches[0].clientY;
    const direction = dy > 0 ? 1 : -1;
    // Block native scrolling while inside the stepped range (or while locked).
    if (locked || stepWouldStayInZone(direction)) cancel(event);
  }

  function onTouchEnd(event) {
    if (touchStartY === null) return;
    const endY = event.changedTouches[0]?.clientY ?? touchStartY;
    const dy = touchStartY - endY;
    touchStartY = null;
    if (Math.abs(dy) < SWIPE_MIN_PX) return;
    step(dy > 0 ? 1 : -1);
  }

  function onKeyDown(event) {
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      // Space on a focused button or link activates it rather than scrolling.
      if (event.key === ' ' && /^(BUTTON|A)$/.test(target.tagName)) return;
    }
    const direction = KEYS_FORWARD.has(event.key) ? (event.shiftKey && event.key === ' ' ? -1 : 1) : KEYS_BACK.has(event.key) ? -1 : 0;
    if (!direction) return;
    if (step(direction)) cancel(event);
  }

  /**
   * Free scrolling that crosses into the stepped range is caught at its edge:
   * from the hero it stops on the overview, from the editorial on the last
   * destination, instead of sailing past locations.
   */
  function onScroll() {
    const y = window.scrollY;
    const previous = lastScrollY;
    lastScrollY = y;
    if (locked) return;
    const overviewY = scroll.stepScrollY(first);
    const lastY = scroll.stepScrollY(last);
    // Same guarded path as a step: overrides the remaining momentum and keeps
    // scroll triggers from flipping the active stage during the correction.
    if (previous < overviewY - 2 && y > overviewY + 2) go(first);
    else if (previous > lastY + 2 && y < lastY - 2) go(last);
  }

  function cancel(event) {
    if (event.cancelable) event.preventDefault();
    // Keep Lenis (also listening on window) from scrolling as well.
    event.stopImmediatePropagation();
  }

  // Destinations are only ever activated by a deliberate step (gesture, key,
  // nav or marker click). Free scrolling may only return to the overview, so a
  // fast flick that briefly overshoots past it never flashes a destination.
  scroll.setActivationFilter((index) => index < 0);

  // Capture phase on window runs before Lenis' own listeners.
  const options = { capture: true, passive: false };
  window.addEventListener('wheel', onWheel, options);
  window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  window.addEventListener('touchmove', onTouchMove, options);
  window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('scroll', onScroll, { passive: true });

  return {
    /** Programmatic navigation (nav list, markers) also locks input. */
    navigateTo: (index) => (locked ? Promise.resolve() : go(index)),
    isLocked: () => locked,
    dispose() {
      scroll.setActivationFilter(null);
      window.removeEventListener('wheel', onWheel, options);
      window.removeEventListener('touchstart', onTouchStart, { capture: true });
      window.removeEventListener('touchmove', onTouchMove, options);
      window.removeEventListener('touchend', onTouchEnd, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('scroll', onScroll);
    },
  };
}
