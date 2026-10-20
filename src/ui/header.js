/**
 * Site header: transparent over the hero, solid once the page scrolls, plus
 * an accessible mobile menu (Escape closes it, focus returns to the button).
 */
import { createCleanupStack } from '../utils/cleanup.js';

/** Scroll distance (px) after which the header gains its solid background. */
const SCROLLED_THRESHOLD = 80;

export function initHeader({ header, menuButton, menu }) {
  const cleanup = createCleanupStack();

  const updateScrolled = () => header.classList.toggle('is-scrolled', window.scrollY > SCROLLED_THRESHOLD);
  cleanup.listen(window, 'scroll', updateScrolled, { passive: true });
  updateScrolled();

  function setOpen(open) {
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    header.classList.toggle('is-menu-open', open);
    menu.hidden = !open;
    if (open) menu.querySelector('a')?.focus();
  }

  cleanup.listen(menuButton, 'click', () => setOpen(menuButton.getAttribute('aria-expanded') !== 'true'));
  cleanup.listen(menu, 'click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });
  cleanup.listen(document, 'keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      menuButton.focus();
    }
  });
  cleanup.listen(window, 'resize', () => {
    if (window.innerWidth >= 900) setOpen(false);
  });

  return { dispose: cleanup.run };
}
