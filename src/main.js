/**
 * Application entry: wires the page UI, the scroll system and the 3D world
 * together. Each concern lives in its own module; this file only connects
 * them through the transition manager (the single source of truth for the
 * active destination).
 */
import { resolveUrl } from './utils/asset-url.js';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource-variable/manrope';
import 'lenis/dist/lenis.css';
import './styles/main.scss';

import { ArrowDown, ArrowUp, createIcons } from 'lucide';
import { DESTINATIONS } from './data/destinations.js';
import { TERRAIN_CONFIG } from './data/scene-config.js';
import { createAmbientAudio } from './audio/ambient-audio.js';
import { initPageAnimations } from './animation/reveal-animations.js';
import { createScrollController } from './animation/scroll-controller.js';
import { createStepNavigation } from './animation/step-navigation.js';
import { createTransitionManager } from './animation/transition-manager.js';
import { createDestinationCards } from './ui/destination-cards.js';
import { createDestinationNav } from './ui/destination-nav.js';
import { renderFallbackMap } from './ui/fallback-map.js';
import { initHeader } from './ui/header.js';
import { createLoadingScreen } from './ui/loading-screen.js';
import { initSoundToggle } from './ui/sound-toggle.js';
import { loadOptionalJSON } from './utils/optional-assets.js';
import { detectQualityTier, isWebGL2Available, MOBILE_LAYOUT_QUERY, onMediaChange, prefersReducedMotion } from './utils/environment.js';
import { createSmoothScroll } from './utils/smooth-scroll.js';

/** Essential loading must finish within this time before we show the fallback. */
const ESSENTIAL_TIMEOUT_MS = 45000;

const $ = (selector) => document.querySelector(selector);

function renderFooter() {
  $('#copyright-year').textContent = String(new Date().getFullYear());
  $('#footer-destinations').innerHTML = DESTINATIONS.map((d) => `<li><a href="${resolveUrl(d.link)}">${d.name}</a></li>`).join('');
  $('#exaggeration-label').textContent = String(TERRAIN_CONFIG.elevationMultiplier);
}

/** Image credits are optional: a missing credits file just leaves the defaults. */
async function renderImageCredits() {
  const credits = await loadOptionalJSON(resolveUrl('/assets/images/credits.json'));
  if (!credits) return;
  const list = $('#credits-list');
  for (const [file, credit] of Object.entries(credits)) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = credit.source;
    link.rel = 'noopener';
    link.target = '_blank';
    link.textContent = credit.title.replace(/\.(jpe?g|png|tiff?)$/i, '');
    item.append(link, ` — ${credit.author}, ${credit.license} (${file})`);
    list.append(item);
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Essential assets timed out after ${ms / 1000}s`)), ms)),
  ]);
}

function enterFallbackMode(reason) {
  if (reason) console.warn('[island] Showing the static fallback:', reason);
  document.documentElement.classList.add('is-fallback');
  $('#world').hidden = true;
  renderFallbackMap({ container: $('.island-experience__stage'), destinations: DESTINATIONS });
}

async function init() {
  const reducedMotion = prefersReducedMotion();
  document.documentElement.classList.toggle('is-reduced-motion', reducedMotion);
  createIcons({ icons: { ArrowDown, ArrowUp } });
  renderFooter();
  renderImageCredits();

  const loading = createLoadingScreen({
    root: $('#loading-screen'),
    outline: $('#loading-outline'),
    bar: $('#loading-bar'),
    stage: $('#loading-stage'),
    reducedMotion,
  });

  const smoothScroll = createSmoothScroll({ reducedMotion });
  smoothScroll.bindAnchorLinks();
  initHeader({ header: $('#site-header'), menuButton: $('#menu-toggle'), menu: $('#mobile-menu') });
  initSoundToggle({ button: $('#sound-toggle'), audio: createAmbientAudio({ src: resolveUrl('/assets/audio/ocean-ambience.mp3') }) });

  // ---- State + DOM views -------------------------------------------------
  const transitions = createTransitionManager({ count: DESTINATIONS.length });
  const cards = createDestinationCards({ container: $('#destination-cards'), intro: $('#island-intro'), destinations: DESTINATIONS, reducedMotion });

  // ---- 3D world ----------------------------------------------------------
  let world = null;
  if (!isWebGL2Available()) {
    enterFallbackMode('WebGL 2 is not available');
  } else {
    try {
      const { createIslandWorld } = await import('./three/island-world.js');
      world = await withTimeout(
        createIslandWorld({
          canvas: $('#world-canvas'),
          labelContainer: $('#world-labels'),
          destinations: DESTINATIONS,
          qualityTier: detectQualityTier(),
          reducedMotion,
          onProgress: loading.setProgress,
          onStage: loading.setStage,
        }),
        ESSENTIAL_TIMEOUT_MS,
      );
    } catch (error) {
      console.error(error);
      enterFallbackMode(error.message);
    }
  }

  // ---- Scroll storytelling ----------------------------------------------
  let scroll = null;
  let stepNavigation = null;
  // Nav list and marker clicks go through the stepped navigation when it
  // exists, so they also lock input until the camera has arrived.
  const select = (index) => (stepNavigation ?? scroll)?.navigateTo(index);
  const nav = createDestinationNav({ container: $('#destination-nav'), destinations: DESTINATIONS, onSelect: select });

  if (world) {
    scroll = createScrollController({
      section: $('#island'),
      stepsContainer: $('#island-steps'),
      count: DESTINATIONS.length,
      transitions,
      smoothScroll,
      onIntroProgress: world.setIntroProgress,
      onSectionVisibility: world.setSectionVisible,
    });
    world.onSelect(select);
    stepNavigation = createStepNavigation({ scroll, transitions, world, count: DESTINATIONS.length });
    transitions.subscribe((index) => world.setActiveDestination(index));
    onMediaChange(MOBILE_LAYOUT_QUERY, () => scroll.refresh());
  } else {
    // Without WebGL every card is shown statically; the nav jumps to them.
    cards.cards.forEach((card) => {
      card.inert = false;
      card.removeAttribute('aria-hidden');
    });
    scroll = { navigateTo: (index) => smoothScroll.scrollTo(cards.cards[index], { offset: -100 }) };
  }

  transitions.subscribe((index) => {
    cards.show(index);
    nav.setActive(index);
    document.documentElement.dataset.activeDestination = index >= 0 ? DESTINATIONS[index].id : 'overview';
  });

  initPageAnimations({ reducedMotion });
  await loading.hide();
  scroll?.syncWithScroll?.();
}

init().catch((error) => {
  console.error('[island] Initialisation failed', error);
  document.documentElement.classList.add('is-loaded', 'is-fallback');
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) loadingScreen.hidden = true;
});
