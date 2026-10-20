/**
 * Manages one replaceable 3D landmark per destination.
 *
 * Each destination gets an anchor group at its terrain-seated object position
 * (see geography/destination-placement.js) with the configured rotation and
 * scale. The anchor first holds the procedural placeholder; the configured
 * GLB is then loaded lazily in the background and, if it loads, replaces the
 * placeholder. A missing or broken model simply leaves the placeholder.
 *
 * Replacing a model: drop a file at the path given in destinations.js
 * (model.path), or point model.path elsewhere. Author it with +Y up, its base
 * at y = 0 and 1 unit = 1 km, then tune model.scale / rotationY / offset.
 *
 * Only the active destination's landmark is shown; it grows in when its
 * destination becomes active and shrinks away when it is left.
 */
import { resolveUrl } from '../utils/asset-url.js';
import gsap from 'gsap';
import { Box3, Group, MathUtils } from 'three';
import { disposeObject3D } from '../utils/cleanup.js';
import { buildLandmark, createLandmarkMaterials } from './procedural-landmarks.js';

const HIDDEN_SCALE = 0.001;

export function createDestinationObjects({ placements, modelLoader, shadows, reducedMotion }) {
  const group = new Group();
  group.name = 'destination-objects';
  const materials = createLandmarkMaterials();

  const entries = placements.map((placement) => {
    const { model = {} } = placement.destination;
    const anchor = new Group();
    anchor.name = `landmark-${placement.id}`;
    anchor.position.copy(placement.objectPosition);
    anchor.rotation.y = MathUtils.degToRad(model.rotationY ?? 0);
    anchor.scale.setScalar(HIDDEN_SCALE);
    anchor.visible = false;

    const landmark = buildLandmark(model.fallback, materials, { reducedMotion });
    setShadows(landmark.object, shadows);
    const content = new Group();
    content.scale.setScalar(model.scale ?? 1);
    content.add(landmark.object);
    anchor.add(content);
    group.add(anchor);

    return { placement, anchor, content, current: landmark, source: 'procedural', baseY: placement.objectPosition.y, tween: null };
  });

  let activeIndex = -1;

  function setShadows(object, enabled) {
    object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = enabled && child.castShadow !== false;
        child.receiveShadow = enabled;
      }
    });
  }

  /** Swaps the placeholder for the loaded GLB (keeping the anchor transform). */
  function useModel(entry, scene) {
    const instance = scene.clone(true);
    // Rest the model's lowest point on the anchor so authoring offsets don't matter.
    const box = new Box3().setFromObject(instance);
    if (Number.isFinite(box.min.y)) instance.position.y -= box.min.y;
    setShadows(instance, shadows);
    disposeObject3D(entry.current.object);
    entry.content.add(instance);
    entry.current = { object: instance };
    entry.source = 'model';
  }

  /** Requests every configured model once; failures keep the placeholder. */
  function loadModels() {
    return Promise.all(
      entries.map(async (entry) => {
        const path = entry.placement.destination.model?.path;
        if (!path) return;
        try {
          useModel(entry, await modelLoader.load(resolveUrl(path)));
        } catch {
          console.info(`[landmarks] No model at ${path} — using the procedural placeholder for ${entry.placement.id}.`);
        }
      }),
    );
  }

  function show(entry) {
    entry.tween?.kill();
    entry.anchor.visible = true;
    if (reducedMotion) {
      entry.anchor.scale.setScalar(1);
      entry.anchor.position.y = entry.baseY;
      return;
    }
    entry.tween = gsap.timeline()
      .to(entry.anchor.scale, { x: 1, y: 1, z: 1, duration: 1.1, ease: 'back.out(1.5)', delay: 0.55 }, 0)
      .fromTo(entry.anchor.position, { y: entry.baseY - 1.5 }, { y: entry.baseY, duration: 1.2, ease: 'power3.out', delay: 0.55 }, 0);
  }

  function hide(entry) {
    entry.tween?.kill();
    if (reducedMotion) {
      entry.anchor.scale.setScalar(HIDDEN_SCALE);
      entry.anchor.visible = false;
      return;
    }
    entry.tween = gsap.to(entry.anchor.scale, {
      x: HIDDEN_SCALE,
      y: HIDDEN_SCALE,
      z: HIDDEN_SCALE,
      duration: 0.45,
      ease: 'power2.in',
      onComplete: () => (entry.anchor.visible = false),
    });
  }

  function setActive(index) {
    if (index === activeIndex) return;
    entries.forEach((entry, i) => {
      if (i === index) show(entry);
      else if (i === activeIndex || entry.anchor.visible) hide(entry);
    });
    activeIndex = index;
  }

  function update(time, delta) {
    for (const entry of entries) {
      if (entry.anchor.visible) entry.current.update?.(time, delta);
    }
  }

  function dispose() {
    entries.forEach((entry) => entry.tween?.kill());
    disposeObject3D(group);
    Object.values(materials).forEach((material) => material.dispose());
  }

  return { group, setActive, update, loadModels, dispose, entries };
}

