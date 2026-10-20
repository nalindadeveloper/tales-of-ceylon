/**
 * Static fallback used when WebGL is unavailable (or the terrain fails to
 * load): an SVG outline of the island with destination dots placed with the
 * same projection as the 3D scene. The destination cards are then shown as a
 * regular, fully readable list by the `is-fallback` styles.
 */
import { ISLAND_OUTLINE } from '../data/island-outline.js';
import { projectLonLat } from '../geography/projection.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function renderFallbackMap({ container, destinations }) {
  const outlineBounds = ISLAND_OUTLINE.origin;
  const [, , width, height] = ISLAND_OUTLINE.viewBox.split(' ').map(Number);
  const figure = document.createElement('figure');
  figure.className = 'fallback-map';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `-20 -10 ${width + 120} ${height + 20}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Map of Sri Lanka showing Colombo, Kandy, Jaffna, Nuwara Eliya and Galle');

  for (const d of ISLAND_OUTLINE.paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'fallback-map__land');
    svg.append(path);
  }

  for (const destination of destinations) {
    const { x, z } = projectLonLat(destination.longitude, destination.latitude);
    const cx = x - outlineBounds.minX;
    const cy = z - outlineBounds.minZ;
    const dot = document.createElementNS(SVG_NS, 'circle');
    Object.entries({ cx, cy, r: 5, class: 'fallback-map__dot' }).forEach(([k, v]) => dot.setAttribute(k, v));
    const label = document.createElementNS(SVG_NS, 'text');
    Object.entries({ x: cx + 10, y: cy + 5, class: 'fallback-map__label' }).forEach(([k, v]) => label.setAttribute(k, v));
    label.textContent = destination.name;
    svg.append(dot, label);
  }

  figure.append(svg);
  container.prepend(figure);
  return figure;
}
