/**
 * Ambient ocean-and-wind audio via Howler.js.
 *
 *  - Starts muted and never autoplays: the Howl is only created on the first
 *    explicit toggle (a user gesture), which satisfies autoplay policies.
 *  - Fades in and out smoothly; pauses while the tab is hidden.
 *  - A missing or undecodable file switches the state to 'unavailable'
 *    without throwing.
 *
 * To change the sound, replace public/assets/audio/ocean-ambience.mp3 or pass
 * a different `src` from main.js.
 */
import { Howl } from 'howler';

const FADE_MS = 1400;

export function createAmbientAudio({ src, volume = 0.45 }) {
  let howl = null;
  let state = 'off'; // 'off' | 'on' | 'unavailable'
  const listeners = new Set();

  const setState = (next) => {
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  function ensureHowl() {
    if (howl) return howl;
    howl = new Howl({
      src: Array.isArray(src) ? src : [src],
      loop: true,
      volume: 0,
      onloaderror: (_id, error) => {
        console.warn('[audio] Ambient audio could not be loaded:', error);
        setState('unavailable');
      },
      onplayerror: () => {
        // Retry once the audio context is unlocked by the browser.
        howl.once('unlock', () => state === 'on' && howl.play());
      },
    });
    return howl;
  }

  function enable() {
    if (state === 'unavailable') return;
    try {
      const sound = ensureHowl();
      if (!sound.playing()) sound.play();
      sound.fade(sound.volume(), volume, FADE_MS);
      setState('on');
    } catch (error) {
      console.warn('[audio] Ambient audio failed:', error);
      setState('unavailable');
    }
  }

  function disable() {
    if (state !== 'on') return;
    setState('off');
    if (!howl) return;
    howl.fade(howl.volume(), 0, FADE_MS / 2);
    howl.once('fade', () => state === 'off' && howl.pause());
  }

  const onVisibility = () => {
    if (!howl || state !== 'on') return;
    if (document.hidden) howl.pause();
    else howl.play();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    get state() {
      return state;
    },
    toggle: () => (state === 'on' ? disable() : enable()),
    enable,
    disable,
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      document.removeEventListener('visibilitychange', onVisibility);
      howl?.unload();
      listeners.clear();
    },
  };
}
