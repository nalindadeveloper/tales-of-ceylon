/**
 * Warm morning sun plus sky/ground hemisphere light.
 * The sun's shadow camera covers the whole island so the exaggerated central
 * highlands cast soft shadows across the lowlands.
 */
import { Color, DirectionalLight, HemisphereLight, MathUtils, Vector3 } from 'three';
import { LIGHTING_CONFIG } from '../data/scene-config.js';

/** Unit vector pointing towards the sun (north = −z, east = +x). */
export function sunDirection({ sunAzimuth, sunElevation } = LIGHTING_CONFIG) {
  const azimuth = MathUtils.degToRad(sunAzimuth);
  const elevation = MathUtils.degToRad(sunElevation);
  return new Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
}

export function createLighting({ bounds, shadows }) {
  const config = LIGHTING_CONFIG;
  const direction = sunDirection(config);
  const center = new Vector3(bounds.centerX, 0, bounds.centerZ);

  const sun = new DirectionalLight(new Color(config.sunColor), config.sunIntensity);
  sun.position.copy(center).addScaledVector(direction, 900);
  sun.target.position.copy(center);

  if (shadows) {
    const radius = Math.max(bounds.width, bounds.depth) * 0.6;
    sun.castShadow = true;
    sun.shadow.mapSize.set(config.shadowMapSize, config.shadowMapSize);
    Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 300, far: 1500 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.shadow.radius = 3;
    sun.shadow.camera.updateProjectionMatrix();
  }

  const hemisphere = new HemisphereLight(new Color(config.skyColor), new Color(config.groundColor), config.hemisphereIntensity);

  const islandRadius = Math.max(bounds.width, bounds.depth) * 0.6;
  let shadowRadius = islandRadius;
  /**
   * Keeps the shadow map focused on what the camera sees: at a destination it
   * shrinks to a few tens of kilometres so landmarks and relief get crisp shadows; in
   * the overview it covers the whole island.
   */
  function update(focus, cameraDistance) {
    if (!shadows) return;
    const radius = Math.min(islandRadius, Math.max(25, cameraDistance * 0.75));
    sun.target.position.set(focus.x, 0, focus.z);
    sun.position.copy(sun.target.position).addScaledVector(direction, 900);
    if (Math.abs(radius - shadowRadius) / shadowRadius > 0.01) {
      shadowRadius = radius;
      Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius });
      sun.shadow.camera.updateProjectionMatrix();
      // Bias in world units must follow the texel size.
      sun.shadow.normalBias = ((2 * radius) / config.shadowMapSize) * 1.2;
    }
  }

  return { lights: [sun, sun.target, hemisphere], sun, direction, update };
}
