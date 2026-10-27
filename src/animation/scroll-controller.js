/**
 * Scroll-driven storytelling.
 *
 * The island section contains one invisible "step" per stage: an overview step
 * followed by one step per destination. A ScrollTrigger per step reports when
 * it crosses the activation line; that — never a timer — decides the active
 * destination, which is written to the transition manager (single source of
 * truth). Scrolling up simply activates earlier steps again, so the whole
 * experience reverses naturally.
 *
 * Marker clicks and the destination list call navigateTo(): the state switches
 * immediately and the page scrolls to the matching step, while intermediate
 * steps passed during that programmatic scroll are ignored.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const ACTIVATION_LINE = 'center';

export function createScrollController({ section, stepsContainer, count, transitions, smoothScroll, onIntroProgress, onSectionVisibility }) {
  const triggers = [];
  const steps = [];
  let navigationLock = null;
  /** Optional veto on scroll-driven activation (see setActivationFilter). */
  let activationFilter = null;

  // Step 0 = overview, steps 1…count = destinations.
  for (let i = 0; i <= count; i++) {
    const step = document.createElement('div');
    step.className = `island-experience__step${i === 0 ? ' island-experience__step--overview' : ''}`;
    step.dataset.step = String(i - 1);
    stepsContainer.append(step);
    steps.push(step);
  }

  steps.forEach((step, i) => {
    triggers.push(
      ScrollTrigger.create({
        trigger: step,
        start: `top ${ACTIVATION_LINE}`,
        end: `bottom ${ACTIVATION_LINE}`,
        onToggle: (self) => {
          if (self.isActive && !navigationLock && (!activationFilter || activationFilter(i - 1))) {
            transitions.setActive(i - 1, { source: 'scroll' });
          }
        },
      }),
    );
  });

  // Hero → overview camera blend: 0 at the top of the page, 1 when the island
  // section reaches the top of the viewport.
  triggers.push(
    ScrollTrigger.create({
      trigger: section,
      start: 'top bottom',
      end: 'top top',
      onUpdate: (self) => onIntroProgress?.(self.progress),
      onLeave: () => onIntroProgress?.(1),
      onLeaveBack: () => onIntroProgress?.(0),
    }),
  );

  // Rendering is paused once the editorial section fully covers the viewport.
  triggers.push(
    ScrollTrigger.create({
      trigger: section,
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => onSectionVisibility?.(self.isActive || self.progress === 0),
    }),
  );

  /** Re-applies whatever step is under the activation line. */
  function syncWithScroll() {
    const active = triggers.slice(0, steps.length).findIndex((trigger) => trigger.isActive);
    if (active >= 0) transitions.setActive(active - 1, { source: 'scroll' });
    else if (window.scrollY < section.offsetTop) transitions.setActive(-1, { source: 'scroll' });
  }

  /**
   * Activates a destination (−1 = overview) and scrolls to its step.
   * `immediate` jumps instead of animating: inside the sticky island section
   * the jump is invisible (the camera flight is the visible transition) and
   * it avoids any race with a long-running scroll animation.
   */
  async function navigateTo(index, { immediate = false } = {}) {
    const step = steps[index + 1];
    if (!step) return;
    const token = {};
    navigationLock = token;
    transitions.setActive(index, { source: 'navigation' });
    // Land the step's centre on the activation line.
    const offset = -(window.innerHeight / 2) + step.offsetHeight / 2;
    await smoothScroll.scrollTo(step, { offset, immediate });
    // Let ScrollTrigger process the new position while the lock still holds.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    ScrollTrigger.update();
    if (navigationLock === token) {
      navigationLock = null;
      syncWithScroll();
    }
  }

  /** Scroll position that centres a stage's step on the activation line (−1 = overview). */
  function stepScrollY(index) {
    const step = steps[index + 1];
    return step.getBoundingClientRect().top + window.scrollY + step.offsetHeight / 2 - window.innerHeight / 2;
  }

  function refresh() {
    ScrollTrigger.refresh();
  }

  function dispose() {
    triggers.forEach((trigger) => trigger.kill());
    steps.forEach((step) => step.remove());
  }

  return {
    navigateTo,
    stepScrollY,
    refresh,
    syncWithScroll,
    /** Lets a stepped-navigation layer decide which stages free scrolling may activate. */
    setActivationFilter: (filter) => (activationFilter = filter),
    dispose,
    steps,
  };
}
