/**
 * Destination cards (semantic HTML) and the overview intro panel.
 *
 * Exactly one panel is visible at a time: the intro (activeIndex −1) or the
 * active destination's card. The outgoing panel finishes leaving before the
 * incoming one enters; interrupted transitions are killed and restarted from
 * the current state. Inactive cards are `inert` so they are skipped by
 * keyboard and assistive technology.
 */
import gsap from 'gsap';
import { resolveUrl } from '../utils/asset-url.js';

function formatCoordinate(value, positive, negative) {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}

function createCard(destination, index, total) {
  const article = document.createElement('article');
  article.className = 'destination-card';
  article.id = `destination-${destination.id}`;
  article.setAttribute('aria-labelledby', `destination-${destination.id}-title`);
  article.innerHTML = `
    <div class="destination-card__media">
      <img src="${resolveUrl(destination.image)}" alt="${destination.imageAlt}" width="1600" height="1067" loading="lazy" decoding="async" />
      <span class="destination-card__coords">${formatCoordinate(destination.latitude, 'N', 'S')} · ${formatCoordinate(destination.longitude, 'E', 'W')}</span>
    </div>
    <div class="destination-card__body">
      <p class="destination-card__count"><span>${String(index + 1).padStart(2, '0')}</span> / ${String(total).padStart(2, '0')}</p>
      <h3 class="destination-card__title" id="destination-${destination.id}-title">${destination.name}</h3>
      <p class="destination-card__province">${destination.province}</p>
      <p class="destination-card__text">${destination.description}</p>
      <a class="destination-card__link" href="${resolveUrl(destination.link)}">
        <span>Explore ${destination.name}</span>
        <span class="destination-card__arrow" aria-hidden="true">↗</span>
      </a>
    </div>`;
  return article;
}

export function createDestinationCards({ container, intro, destinations, reducedMotion }) {
  const cards = destinations.map((destination, index) => {
    const card = createCard(destination, index, destinations.length);
    container.append(card);
    return card;
  });
  const panels = [intro, ...cards]; // panel 0 = intro, panel i+1 = destination i
  let visiblePanel = null;
  let timeline = null;

  const parts = (panel) => (panel === intro ? [...panel.children] : [panel.querySelector('.destination-card__media'), ...panel.querySelectorAll('.destination-card__body > *')]);

  function setPanelState(panel, active) {
    panel.classList.toggle('is-active', active);
    panel.inert = !active;
    panel.setAttribute('aria-hidden', String(!active));
  }

  panels.forEach((panel) => {
    setPanelState(panel, false);
    gsap.set(panel, { autoAlpha: 0 });
  });

  /** Shows the panel for `activeIndex` (−1 = intro). */
  function show(activeIndex) {
    const next = panels[activeIndex + 1];
    if (!next || next === visiblePanel) return;
    const previous = visiblePanel;
    visiblePanel = next;
    timeline?.kill();

    panels.forEach((panel) => panel !== next && panel !== previous && gsap.set(panel, { autoAlpha: 0 }));
    panels.forEach((panel) => setPanelState(panel, panel === next));

    if (reducedMotion) {
      if (previous) gsap.set(previous, { autoAlpha: 0 });
      gsap.set(next, { autoAlpha: 1 });
      gsap.set(parts(next), { clearProps: 'all' });
      return;
    }

    timeline = gsap.timeline();
    if (previous) {
      timeline.to(previous, { autoAlpha: 0, y: -18, duration: 0.35, ease: 'power2.in' });
    }
    timeline.set(next, { autoAlpha: 1, y: 0 });
    const media = next.querySelector('.destination-card__media');
    if (media) {
      timeline.fromTo(media, { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: 0.9, ease: 'power3.out' });
    }
    timeline
      .fromTo(
        parts(next).filter((part) => !part.classList.contains('destination-card__media')),
        { autoAlpha: 0, y: 22 },
        { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.06, ease: 'power3.out' },
        '<0.15',
      );
  }

  function dispose() {
    timeline?.kill();
    cards.forEach((card) => card.remove());
  }

  return { show, cards, dispose };
}
