/**
 * Composition root of the 3D experience. Loads the essential terrain assets,
 * assembles the scene and runs the render loop. Exposes a small API used by
 * main.js; it never touches destination cards or other page UI.
 */
import { resolveUrl } from '../utils/asset-url.js';
import { Timer } from 'three';
import { QUALITY, TERRAIN_CONFIG } from '../data/scene-config.js';
import { computeDestinationPlacements } from '../geography/destination-placement.js';
import { loadBoundary } from '../terrain/boundary-loader.js';
import { loadElevationData } from '../terrain/elevation-loader.js';
import { buildTerrain } from '../terrain/terrain-builder.js';
import { createTerrainSampler } from '../terrain/terrain-sampling.js';
import { createCameraDirector } from '../animation/camera-animation.js';
import { createEssentialLoader, whenIdle } from '../utils/asset-loader.js';
import { createCleanupStack, disposeObject3D } from '../utils/cleanup.js';
import { CameraRig } from './camera.js';
import { createDestinationObjects } from './destination-objects.js';
import { createLighting } from './lighting.js';
import { createMapMarkers } from './map-markers.js';
import { createModelLoader } from './model-loader.js';
import { createOcean } from './ocean.js';
import { createRenderer } from './renderer.js';
import { createScene } from './scene.js';

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {HTMLElement} options.labelContainer
 * @param {Array} options.destinations
 * @param {'high'|'low'} options.qualityTier
 * @param {boolean} options.reducedMotion
 * @param {(fraction:number)=>void} [options.onProgress]
 * @param {(label:string)=>void} [options.onStage]
 */
export async function createIslandWorld({ canvas, labelContainer, destinations, qualityTier, reducedMotion, onProgress, onStage }) {
  const quality = QUALITY[qualityTier] ?? QUALITY.high;
  const cleanup = createCleanupStack();
  const { renderer, resize: resizeRenderer, maxAnisotropy, dispose: disposeRenderer } = createRenderer(canvas, quality);
  cleanup.add(disposeRenderer);

  // ---- Essential assets ---------------------------------------------------
  onStage?.('Charting the coastline');
  const loader = createEssentialLoader({ onProgress });
  const [boundary, elevation] = await Promise.all([
    loadBoundary(loader, resolveUrl(TERRAIN_CONFIG.boundaryUrl)),
    loadElevationData(loader, resolveUrl(TERRAIN_CONFIG.basePath), { maxAnisotropy }).then((data) => {
      onStage?.('Raising the highlands');
      return data;
    }),
  ]);

  // ---- Scene assembly -----------------------------------------------------
  onStage?.('Composing the island');
  const { scene, updateFog } = createScene();
  const rig = new CameraRig();

  const terrain = buildTerrain({ elevation, boundary, config: TERRAIN_CONFIG, shadows: quality.shadows });
  scene.add(terrain.group);

  const lighting = createLighting({ bounds: boundary.bounds, shadows: quality.shadows });
  scene.add(...lighting.lights);

  const ocean = createOcean({ texture: elevation.textures.ocean, bounds: elevation.meta.ocean.bounds, sunDirection: lighting.direction });
  scene.add(ocean.mesh);

  const sampler = createTerrainSampler(elevation.mesh, TERRAIN_CONFIG);
  const placements = computeDestinationPlacements(destinations, sampler);

  const selectListeners = new Set();
  const markers = createMapMarkers({
    placements,
    labelContainer,
    reducedMotion,
    onSelect: (index) => selectListeners.forEach((listener) => listener(index)),
  });
  scene.add(markers.group);

  const modelLoader = createModelLoader();
  const objects = createDestinationObjects({ placements, modelLoader, shadows: quality.shadows, reducedMotion });
  scene.add(objects.group);

  const director = createCameraDirector({ rig, islandBounds: boundary.bounds, reducedMotion });

  // ---- Sizing -------------------------------------------------------------
  const viewport = { width: 1, height: 1 };
  function resize() {
    viewport.width = canvas.clientWidth || window.innerWidth;
    viewport.height = canvas.clientHeight || window.innerHeight;
    resizeRenderer(viewport.width, viewport.height);
    rig.setSize(viewport.width, viewport.height);
    director.refresh();
  }
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  cleanup.add(() => resizeObserver.disconnect());

  // ---- Pointer interaction (raycast markers) ------------------------------
  cleanup.listen(canvas, 'pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const index = markers.pick(event.clientX, event.clientY, rig.camera, canvas.getBoundingClientRect());
    markers.setHovered(index);
    canvas.style.cursor = index >= 0 ? 'pointer' : '';
  });
  cleanup.listen(canvas, 'pointerleave', () => markers.setHovered(-1));
  cleanup.listen(canvas, 'click', (event) => {
    const index = markers.pick(event.clientX, event.clientY, rig.camera, canvas.getBoundingClientRect());
    if (index >= 0) selectListeners.forEach((listener) => listener(index));
  });

  // ---- Render loop --------------------------------------------------------
  const timer = new Timer();
  timer.connect(document); // pauses delta accumulation while the page is hidden
  let sectionVisible = true;
  let pageVisible = !document.hidden;
  let elapsed = 0;

  function frame(timestamp) {
    timer.update(timestamp);
    const delta = Math.min(timer.getDelta(), 0.1);
    elapsed += delta;
    const focusDistance = director.update(elapsed, delta);
    updateFog(focusDistance);
    ocean.update(elapsed);
    markers.setVisibility(Math.min(1, Math.max(0, (director.getIntroProgress() - 0.55) / 0.35)));
    markers.update(rig.camera, elapsed, delta, viewport);
    objects.update(elapsed, delta);
    renderer.render(scene, rig.camera);
  }

  function updateLoop() {
    const running = sectionVisible && pageVisible;
    renderer.setAnimationLoop(running ? frame : null);
    if (running) timer.reset(); // discard the paused interval
  }
  cleanup.listen(document, 'visibilitychange', () => {
    pageVisible = !document.hidden;
    updateLoop();
  });

  // Development-only handle for inspecting the scene from the console.
  if (import.meta.env.DEV) window.__island = { scene, rig, placements, sampler };

  // First frame without damping, then start the loop.
  director.snap();
  frame();
  updateLoop();

  // Optional landmark models load once the browser is idle.
  whenIdle(() => objects.loadModels());

  return {
    placements,
    camera: rig.camera,
    setActiveDestination(index) {
      markers.setActive(index);
      objects.setActive(index);
      if (index < 0) director.showIntro();
      else director.focusDestination(placements[index]);
    },
    setIntroProgress: (progress) => director.setIntroProgress(progress),
    setSectionVisible(visible) {
      sectionVisible = visible;
      updateLoop();
    },
    onSelect(listener) {
      selectListeners.add(listener);
      return () => selectListeners.delete(listener);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      timer.dispose();
      director.dispose();
      markers.dispose();
      objects.dispose();
      modelLoader.dispose();
      disposeObject3D(terrain.group);
      disposeObject3D(ocean.mesh);
      cleanup.run();
    },
  };
}
