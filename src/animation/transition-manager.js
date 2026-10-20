/**
 * Single source of truth for the active destination.
 *
 * activeIndex = −1 means "no destination" (hero / island overview);
 * 0…n−1 selects a destination. The camera, markers, landmark objects, cards
 * and navigation never decide this themselves — they subscribe here and
 * render whatever the current state is. Only the scroll controller writes.
 */
export function createTransitionManager({ count }) {
  let activeIndex = -1;
  const listeners = new Set();

  function setActive(index, meta = {}) {
    const next = Math.max(-1, Math.min(count - 1, index));
    if (next === activeIndex) return false;
    const previous = activeIndex;
    activeIndex = next;
    for (const listener of listeners) {
      try {
        listener(next, previous, meta);
      } catch (error) {
        console.error('[transitions] listener failed', error);
      }
    }
    return true;
  }

  /** Subscribes and immediately receives the current state. */
  function subscribe(listener) {
    listeners.add(listener);
    listener(activeIndex, activeIndex, { initial: true });
    return () => listeners.delete(listener);
  }

  return {
    setActive,
    subscribe,
    getActive: () => activeIndex,
    dispose: () => listeners.clear(),
  };
}
