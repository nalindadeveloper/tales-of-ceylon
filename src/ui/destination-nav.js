/**
 * Accessible destination navigation — the keyboard / screen-reader equivalent
 * of clicking the 3D markers. Each button activates its destination through
 * the same navigateTo() path as a marker click.
 */
export function createDestinationNav({ container, destinations, onSelect }) {
  const list = document.createElement('ol');
  list.className = 'destination-nav__list';

  const buttons = destinations.map((destination, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'destination-nav__button';
    button.setAttribute('aria-controls', `destination-${destination.id}`);
    button.innerHTML = `<span class="destination-nav__index">${String(index + 1).padStart(2, '0')}</span><span class="destination-nav__name">${destination.name}</span>`;
    button.addEventListener('click', () => onSelect(index));
    item.append(button);
    list.append(item);
    return button;
  });

  const progress = document.createElement('div');
  progress.className = 'destination-nav__progress';
  progress.setAttribute('aria-hidden', 'true');
  progress.innerHTML = '<span class="destination-nav__progress-bar"></span>';
  container.append(list, progress);
  const bar = progress.firstElementChild;

  function setActive(activeIndex) {
    buttons.forEach((button, index) => {
      const active = index === activeIndex;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
    // On phones the list scrolls horizontally: keep the active chip centred.
    const activeButton = buttons[activeIndex];
    if (activeButton && container.scrollWidth > container.clientWidth) {
      const left = activeButton.offsetLeft - (container.clientWidth - activeButton.offsetWidth) / 2;
      container.scrollTo({ left, behavior: 'smooth' });
    }
    bar.style.transform = `scaleY(${(activeIndex + 1) / destinations.length})`;
  }

  return {
    setActive,
    dispose: () => {
      list.remove();
      progress.remove();
    },
  };
}
