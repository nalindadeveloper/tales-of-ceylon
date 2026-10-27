/**
 * Orbit-style camera rig for an oblique aerial view.
 *
 * A pose is described relative to a focus target instead of as a raw camera
 * position, which makes poses easy to interpolate and keeps the viewing angle
 * coherent while travelling across the island:
 *
 *   target    (tx, ty, tz)  point on the terrain being looked at (km)
 *   distance                camera-to-target distance (km)
 *   azimuth                 horizontal angle in degrees; 0 = camera south of
 *                           the target looking north, positive = clockwise
 *   tilt                    angle from straight down, in degrees
 *   frameX / frameY         where the target appears on screen, as a fraction
 *                           of the viewport from its centre (+x right, +y up)
 *
 *   camera = target + distance · (sin t · sin a,  cos t,  sin t · cos a)
 *
 * Off-centre framing uses PerspectiveCamera.setViewOffset, so the target can
 * sit beside a destination card without rotating the camera.
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA_CONFIG } from '../data/scene-config.js';

export function createPose(overrides = {}) {
  return { tx: 0, ty: 0, tz: 0, distance: 600, azimuth: 0, tilt: 35, frameX: 0, frameY: 0, ...overrides };
}

export class CameraRig {
  constructor() {
    this.camera = new PerspectiveCamera(CAMERA_CONFIG.fov, 1, CAMERA_CONFIG.near, CAMERA_CONFIG.far);
    this.target = new Vector3();
    this.width = 1;
    this.height = 1;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Places the camera for a pose.
   * @param {object} pose  See createPose().
   * @param {number} lift  Extra relative distance (used for the mid-flight "hop").
   * @param {number} yaw   Additional azimuth in degrees (hero idle drift).
   */
  apply(pose, lift = 0, yaw = 0) {
    const distance = pose.distance * (1 + lift);
    const azimuth = MathUtils.degToRad(pose.azimuth + yaw);
    const tilt = MathUtils.degToRad(pose.tilt);
    this.target.set(pose.tx, pose.ty, pose.tz);
    this.camera.position.set(
      pose.tx + distance * Math.sin(tilt) * Math.sin(azimuth),
      pose.ty + distance * Math.cos(tilt),
      pose.tz + distance * Math.sin(tilt) * Math.cos(azimuth),
    );
    this.camera.lookAt(this.target);
    this.updateClipPlanes(distance);
    // setViewOffset also refreshes the projection matrix.
    this.camera.setViewOffset(this.width, this.height, -pose.frameX * this.width, pose.frameY * this.height, this.width, this.height);
    return distance;
  }

  /**
   * Keeps depth precision proportional to the viewing distance (see
   * CAMERA_CONFIG.nearRatio): precision depends on far/near, not on scale.
   */
  updateClipPlanes(distance) {
    this.camera.near = Math.max(CAMERA_CONFIG.near, distance * CAMERA_CONFIG.nearRatio);
    this.camera.far = Math.max(CAMERA_CONFIG.far, distance * CAMERA_CONFIG.farRatio);
  }

  /**
   * Distance at which an island of the given size fills `fill` of the view.
   * Foreshortening is approximated by cos(tilt) on the north–south extent.
   */
  fitDistance(bounds, tilt, fill) {
    const halfFov = MathUtils.degToRad(this.camera.fov / 2);
    const visibleHeightPerKm = 2 * Math.tan(halfFov);
    const projectedDepth = bounds.depth * Math.cos(MathUtils.degToRad(tilt));
    const byHeight = projectedDepth / fill / visibleHeightPerKm;
    const byWidth = bounds.width / fill / (visibleHeightPerKm * this.camera.aspect);
    return Math.max(byHeight, byWidth);
  }
}
