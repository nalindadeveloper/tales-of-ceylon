/**
 * Header sound toggle. Reflects the ambient audio state with aria-pressed,
 * a text label and animated equaliser bars; disables itself if the audio
 * file cannot be loaded.
 */
export function initSoundToggle({ button, audio }) {
  const stateLabel = button.querySelector('.sound-toggle__state');

  function render(state) {
    const on = state === 'on';
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', state === 'unavailable' ? 'Ambient sound unavailable' : on ? 'Turn ambient sound off' : 'Turn ambient sound on');
    button.classList.toggle('is-on', on);
    button.classList.toggle('is-unavailable', state === 'unavailable');
    button.disabled = state === 'unavailable';
    stateLabel.textContent = state === 'unavailable' ? 'N/A' : on ? 'On' : 'Off';
  }

  const unsubscribe = audio.onStateChange(render);
  const onClick = () => audio.toggle();
  button.addEventListener('click', onClick);
  render(audio.state);

  return {
    dispose() {
      unsubscribe();
      button.removeEventListener('click', onClick);
    },
  };
}
