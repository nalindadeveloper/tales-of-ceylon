/**
 * Lenis smooth scrolling wired into GSAP's ticker and ScrollTrigger, with a
 * native-scroll fallback when the user prefers reduced motion.
 */
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/** Duration of programmatic smooth scrolls (seconds). */
const SCROLL_DURATION_S = 1.6;

export function createSmoothScroll({ reducedMotion }) {
  let lenis = null;
  let tick = null;

  if (!reducedMotion) {
    lenis = new Lenis({ autoRaf: false, lerp: 0.09, wheelMultiplier: 0.9 });
    lenis.on('scroll', ScrollTrigger.update);
    tick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
  }

  /**
   * Scrolls to an element or pixel offset. Resolves when the scroll settles.
   * @param {Element|number} target
   */
  function scrollTo(target, { offset = 0, immediate = false } = {}) {
    return new Promise((resolve) => {
      if (lenis) {
        const duration = immediate ? 0 : SCROLL_DURATION_S;
        // Lenis skips onComplete when an animation is interrupted (user input,
        // another scrollTo), so a timeout guarantees the promise settles.
        const fallback = window.setTimeout(resolve, duration * 1000 + 300);
        const done = () => {
          window.clearTimeout(fallback);
          resolve();
        };
        lenis.scrollTo(target, { offset, immediate, duration, onComplete: done, force: true });
        if (immediate) done();
        return;
      }
      const top = typeof target === 'number' ? target : target.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + offset, behavior: 'auto' });
      requestAnimationFrame(() => resolve());
    });
  }

  /** Routes in-page anchor links through the smooth scroller. */
  function bindAnchorLinks(root = document) {
    const onClick = (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const id = link.getAttribute('href').slice(1);
      const target = id === 'top' ? 0 : document.getElementById(id);
      if (target === null) return;
      event.preventDefault();
      scrollTo(target);
      // Move focus for keyboard and screen-reader users without a second jump.
      const focusTarget = id === 'top' ? document.getElementById('main') : target;
      if (focusTarget) {
        if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
        focusTarget.focus({ preventScroll: true });
      }
      history.replaceState(null, '', `#${id}`);
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }

  function dispose() {
    if (tick) gsap.ticker.remove(tick);
    lenis?.destroy();
  }

  return { lenis, scrollTo, bindAnchorLinks, dispose };
}
