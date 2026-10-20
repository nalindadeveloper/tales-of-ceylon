/**
 * Scene with an atmospheric background and distance-adaptive fog.
 *
 * The camera works at very different distances (≈ 900 km in the hero, ≈ 60 km
 * at a destination), so fixed fog values cannot work. Instead the fog band is
 * kept proportional to the camera-to-target distance: the focus area is always
 * clear and the far ocean always melts into the haze.
 */
import { Color, Fog, Scene } from 'three';
import { ATMOSPHERE_CONFIG } from '../data/scene-config.js';

export function createScene() {
  const scene = new Scene();
  scene.background = new Color(ATMOSPHERE_CONFIG.background);
  scene.fog = new Fog(ATMOSPHERE_CONFIG.fogColor, 100, 1000);

  function updateFog(focusDistance) {
    scene.fog.near = focusDistance * ATMOSPHERE_CONFIG.fogNear;
    scene.fog.far = focusDistance * ATMOSPHERE_CONFIG.fogFar;
  }

  return { scene, updateFog };
}
