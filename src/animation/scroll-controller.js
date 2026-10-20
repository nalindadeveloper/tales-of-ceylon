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
          if (self.isActive && !navigationLock) transitions.setActive(i - 1, { source: 'scroll' });
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
   */
  async function navigateTo(index) {
    const step = steps[index + 1];
    if (!step) return;
    const token = {};
    navigationLock = token;
    transitions.setActive(index, { source: 'navigation' });
    // Land the step's centre on the activation line.
    const offset = -(window.innerHeight / 2) + step.offsetHeight / 2;
    await smoothScroll.scrollTo(step, { offset });
    if (navigationLock === token) {
      navigationLock = null;
      syncWithScroll();
    }
  }

  function refresh() {
    ScrollTrigger.refresh();
  }

  function dispose() {
    triggers.forEach((trigger) => trigger.kill());
    steps.forEach((step) => step.remove());
  }

  return { navigateTo, refresh, syncWithScroll, dispose, steps };
}
