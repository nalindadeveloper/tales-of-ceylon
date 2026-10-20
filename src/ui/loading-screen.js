/**
 * Loading screen controller. The coastline outline is drawn in proportion to
 * REAL loading progress (files and bytes reported by the asset loader); the
 * stage label names the step in progress rather than inventing percentages.
 */
import gsap from 'gsap';
import { ISLAND_OUTLINE } from '../data/island-outline.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createLoadingScreen({ root, outline, bar, stage, reducedMotion }) {
  outline.setAttribute('viewBox', ISLAND_OUTLINE.viewBox);
  const traces = [];
  for (const d of ISLAND_OUTLINE.paths) {
    const ghost = document.createElementNS(SVG_NS, 'path');
    ghost.setAttribute('d', d);
    ghost.setAttribute('class', 'loading-screen__ghost');
    const trace = document.createElementNS(SVG_NS, 'path');
    trace.setAttribute('d', d);
    trace.setAttribute('class', 'loading-screen__trace');
    trace.setAttribute('pathLength', '1');
    outline.append(ghost, trace);
    traces.push(trace);
  }

  let shown = 0;
  function setProgress(fraction) {
    const value = Math.max(shown, Math.min(1, fraction)); // never moves backwards
    shown = value;
    bar.style.transform = `scaleX(${value})`;
    traces.forEach((trace) => (trace.style.strokeDashoffset = String(1 - value)));
  }

  function setStage(label) {
    stage.textContent = label;
  }

  function showError(message) {
    root.classList.add('is-error');
    setStage(message);
  }

  function hide() {
    setProgress(1);
    document.documentElement.classList.add('is-loaded');
    return new Promise((resolve) => {
      const done = () => {
        root.hidden = true;
        resolve();
      };
      if (reducedMotion) return done();
      gsap.timeline({ onComplete: done })
        .to(root.querySelector('.loading-screen__inner'), { opacity: 0, y: -16, duration: 0.6, ease: 'power2.in', delay: 0.25 })
        .to(root, { clipPath: 'inset(0 0 100% 0)', duration: 1, ease: 'power4.inOut' }, '-=0.15');
    });
  }

  setProgress(0);
  return { setProgress, setStage, showError, hide };
}
