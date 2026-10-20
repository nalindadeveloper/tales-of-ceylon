/**
 * Destination markers: a flat base ring, a pulsing ring, a thin stem and a
 * glowing head, positioned at each destination's terrain-sampled position.
 *
 * Markers are scaled with their distance to the camera so they keep a roughly
 * constant on-screen size from the island overview to a close destination
 * view. Labels are lightweight DOM elements projected to screen space each
 * frame (crisp text, no Three.js text meshes). They are presentational only —
 * keyboard and screen-reader users navigate with the DOM destination list.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from 'three';
import { MARKER_CONFIG } from '../data/scene-config.js';

/** Pixels at the top of the viewport reserved for the fixed site header. */
const LABEL_TOP_SAFE_AREA = 110;

function createGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,240,210,0.55)');
  gradient.addColorStop(1, 'rgba(255,230,190,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

export function createMapMarkers({ placements, labelContainer, reducedMotion, onSelect }) {
  const group = new Group();
  group.name = 'markers';
  const activeColor = new Color(MARKER_CONFIG.activeColor);
  const idleColor = new Color(MARKER_CONFIG.idleColor);
  const H = MARKER_CONFIG.stemHeight;

  // Shared geometries; materials are per marker so colours can animate independently.
  const ringGeometry = new RingGeometry(0.75, 1, 48).rotateX(-Math.PI / 2);
  const stemGeometry = new CylinderGeometry(0.05, 0.05, H, 6).translate(0, H / 2, 0);
  const headGeometry = new SphereGeometry(0.42, 20, 14);
  const hitGeometry = new SphereGeometry(1.8, 8, 6);
  const glowTexture = createGlowTexture();

  const markers = placements.map((placement) => {
    const root = new Group();
    root.position.copy(placement.markerPosition);
    root.userData.index = placement.index;

    const material = (opacity) => new MeshBasicMaterial({ color: idleColor.clone(), transparent: true, opacity, depthWrite: false, side: DoubleSide });
    const base = new Mesh(ringGeometry, material(0.85));
    const pulse = new Mesh(ringGeometry, material(0.5));
    const stem = new Mesh(stemGeometry, material(0.8));
    const head = new Mesh(headGeometry, new MeshBasicMaterial({ color: idleColor.clone(), depthTest: false, transparent: true }));
    head.position.y = H;
    const glow = new Sprite(new SpriteMaterial({ map: glowTexture, color: activeColor.clone(), blending: AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0.6 }));
    glow.position.y = H;
    glow.scale.setScalar(3.2);
    const hit = new Mesh(hitGeometry, new MeshBasicMaterial({ visible: false }));
    hit.position.y = H * 0.75;
    hit.userData.index = placement.index;

    // Heads and glows draw last so a marker is never lost behind a ridge.
    head.renderOrder = 10;
    glow.renderOrder = 11;
    root.add(base, pulse, stem, head, glow, hit);
    group.add(root);

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'map-label';
    label.tabIndex = -1; // the accessible equivalent is the destination list
    label.setAttribute('aria-hidden', 'true');
    label.innerHTML = `<span class="map-label__index">${String(placement.index + 1).padStart(2, '0')}</span><span class="map-label__name">${placement.destination.name}</span>`;
    label.addEventListener('click', () => onSelect?.(placement.index));
    labelContainer.append(label);

    return { placement, root, base, pulse, stem, head, glow, hit, label, emphasis: 0, hover: 0, phase: placement.index * 0.7 };
  });

  let activeIndex = -1;
  let hoveredIndex = -1;
  let visibility = 0;
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const headWorld = new Vector3();
  const tmpColor = new Color();

  function setActive(index) {
    activeIndex = index;
    markers.forEach((marker, i) => marker.label.classList.toggle('is-active', i === index));
  }

  function setHovered(index) {
    hoveredIndex = index;
    markers.forEach((marker, i) => marker.label.classList.toggle('is-hovered', i === index));
  }

  /** 0 hides markers (hero), 1 shows them (island experience). */
  function setVisibility(value) {
    visibility = MathUtils.clamp(value, 0, 1);
    labelContainer.style.opacity = String(visibility);
    labelContainer.style.visibility = visibility < 0.02 ? 'hidden' : 'visible';
  }

  /** Returns the destination index under a client-space point, or −1. */
  function pick(clientX, clientY, camera, rect) {
    if (visibility < 0.5) return -1;
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(markers.map((m) => m.hit), false);
    return hits.length ? hits[0].object.userData.index : -1;
  }

  function update(camera, time, delta, viewport) {
    const smoothing = 1 - Math.exp(-delta * 8);
    for (const marker of markers) {
      const isActive = marker.placement.index === activeIndex;
      const isHovered = marker.placement.index === hoveredIndex;
      marker.emphasis += ((isActive ? 1 : 0) - marker.emphasis) * smoothing;
      marker.hover += ((isHovered ? 1 : 0) - marker.hover) * smoothing;

      // Constant screen size: scale proportional to camera distance.
      const distance = camera.position.distanceTo(marker.root.position);
      const scale = MathUtils.clamp(distance * MARKER_CONFIG.screenScale, MARKER_CONFIG.minScale, MARKER_CONFIG.maxScale);
      marker.root.scale.setScalar(scale * (1 + marker.emphasis * 0.25 + marker.hover * 0.12) * visibility);
      marker.root.visible = visibility > 0.01;

      const emphasis = Math.max(marker.emphasis, marker.hover * 0.6);
      tmpColor.copy(idleColor).lerp(activeColor, emphasis);
      for (const part of [marker.base, marker.pulse, marker.stem, marker.head]) part.material.color.copy(tmpColor);
      marker.stem.scale.y = 0.65 + 0.35 * marker.emphasis;
      marker.head.position.y = marker.glow.position.y = H * marker.stem.scale.y;
      marker.glow.material.opacity = (0.35 + 0.55 * emphasis) * visibility;
      marker.stem.material.opacity = (0.55 + 0.4 * emphasis) * visibility;
      marker.base.material.opacity = 0.85 * visibility;

      // Pulse: an expanding, fading ring (static when reduced motion is requested).
      const cycle = reducedMotion ? 0.35 : ((time * (0.55 + marker.emphasis * 0.35) + marker.phase) % 1);
      marker.pulse.scale.setScalar(1 + cycle * (1.6 + marker.emphasis * 1.4));
      marker.pulse.material.opacity = (1 - cycle) * (0.35 + 0.45 * marker.emphasis) * visibility;

      // Project the head into screen space for the DOM label.
      marker.head.getWorldPosition(headWorld);
      headWorld.project(camera);
      const x = (headWorld.x * 0.5 + 0.5) * viewport.width;
      const y = (-headWorld.y * 0.5 + 0.5) * viewport.height;
      // Hide labels that would sit under the fixed header or outside the view.
      const onScreen = headWorld.z < 1 && x > -40 && x < viewport.width + 40 && y > LABEL_TOP_SAFE_AREA && y < viewport.height + 20;
      if (onScreen) {
        marker.label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
      marker.label.classList.toggle('is-offscreen', !onScreen);
    }
  }

  function dispose() {
    markers.forEach((marker) => {
      marker.label.remove();
      marker.root.traverse((object) => object.material?.dispose());
    });
    [ringGeometry, stemGeometry, headGeometry, hitGeometry, glowTexture].forEach((resource) => resource.dispose());
    group.removeFromParent();
  }

  setVisibility(0);
  return { group, update, setActive, setHovered, setVisibility, pick, dispose };
}
