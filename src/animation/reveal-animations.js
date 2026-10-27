/**
 * Page-level motion outside the 3D experience: the hero entrance, the hero
 * fading as the island takes over, and scroll-triggered reveals in the
 * editorial section. Everything is skipped under reduced motion, leaving the
 * content fully visible.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function initPageAnimations({ reducedMotion }) {
  const triggers = [];
  if (reducedMotion) return { dispose: () => {} };

  gsap.from('[data-hero-reveal]', { autoAlpha: 0, y: 28, duration: 1.2, stagger: 0.1, ease: 'power3.out', delay: 0.15 });

  // The hero copy drifts up and fades as the island section approaches.
  const heroFade = gsap.to('.hero__content, .hero__meta, .scroll-indicator', {
    autoAlpha: 0,
    y: -60,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 35%', scrub: true },
  });
  triggers.push(heroFade.scrollTrigger);

  // The legibility gradient fades early, before the camera enters the clouds.
  const shadeFade = gsap.to('.hero', {
    '--hero-shade': 0,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: '30% top', scrub: true },
  });
  triggers.push(shadeFade.scrollTrigger);

  // Island intro panel: the overlay title fades in as the section pins.
  const batch = ScrollTrigger.batch('[data-reveal]', {
    start: 'top 85%',
    once: true,
    onEnter: (elements) => gsap.fromTo(elements, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 1.1, stagger: 0.12, ease: 'power3.out' }),
  });
  gsap.set('[data-reveal]', { autoAlpha: 0 });
  triggers.push(...batch);

  return { dispose: () => triggers.forEach((trigger) => trigger?.kill()) };
}
