/**
 * Camera director: decides where the camera rig should be and animates it.
 *
 * Two modes:
 *  - intro: the pose is a blend between the hero pose (small floating island)
 *    and the overview pose (whole island), driven by scroll progress. The
 *    rig follows that blended pose with exponential damping, which also gives
 *    a smooth return when the user scrolls back up from a destination.
 *  - destination: focusDestination() flies the rig to a destination with a
 *    GSAP timeline. A temporary "hop" lifts the camera mid-flight in
 *    proportion to the distance travelled, so longer journeys (Jaffna →
 *    Nuwara Eliya) briefly reveal more of the island, like Google Earth.
 *
 * Interruptions are safe: every new flight kills the previous timeline and
 * starts from the rig's current (possibly mid-flight) pose, so rapid scrolling
 * or clicking never causes jumps.
 *
 * Cloud fly-through ("veil"): only during the intro zoom between the opening
 * view and the island overview. It is scrubbed by the same scroll progress as
 * the camera, so scrolling down dives in through the clouds and scrolling back
 * up zooms out through them again. Flights between destinations have no veil.
 *
 * The director never touches the DOM; it only receives targets and poses.
 */
import gsap from 'gsap';
import { MathUtils } from 'three';
import { CAMERA_CONFIG, CLOUD_VEIL_CONFIG, FRAMING } from '../data/scene-config.js';
import { isMobileLayout } from '../utils/environment.js';
import { createPose } from '../three/camera.js';

const POSE_KEYS = ['tx', 'ty', 'tz', 'distance', 'tilt', 'frameX', 'frameY'];

/** Signed shortest angular difference in degrees. */
function angleDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function createCameraDirector({ rig, islandBounds, reducedMotion }) {
  const current = createPose();
  const hop = { value: 0 };
  const veil = { amount: 0, phase: 0 };
  let followedIntro = 0; // intro progress as the damped camera actually shows it
  let mode = 'intro';
  let introProgress = 0;
  let flight = null;
  let focusedPlacement = null;

  const framing = () => (isMobileLayout() ? FRAMING.mobile : FRAMING.desktop);

  function islandPose(settings, frame) {
    return createPose({
      tx: islandBounds.centerX,
      ty: 0,
      tz: islandBounds.centerZ,
      tilt: settings.tilt,
      azimuth: settings.azimuth,
      distance: rig.fitDistance(islandBounds, settings.tilt, settings.fill),
      frameX: frame.x,
      frameY: frame.y,
    });
  }

  /** Pose for a destination, preserving the configured oblique viewing angle. */
  function destinationPose(placement) {
    const { camera = {} } = placement.destination;
    const distanceScale = isMobileLayout() ? CAMERA_CONFIG.mobileDistanceScale : 1;
    const frame = framing().destination;
    return createPose({
      tx: placement.cameraTarget.x,
      ty: placement.cameraTarget.y,
      tz: placement.cameraTarget.z,
      distance: (camera.distance ?? 60) * distanceScale,
      azimuth: camera.azimuth ?? 0,
      tilt: camera.tilt ?? 52,
      frameX: frame.x,
      frameY: frame.y,
    });
  }

  function introPose() {
    const hero = islandPose(CAMERA_CONFIG.hero, framing().hero);
    const overview = islandPose(CAMERA_CONFIG.overview, framing().overview);
    const t = MathUtils.smootherstep(introProgress, 0, 1);
    const pose = createPose();
    for (const key of POSE_KEYS) pose[key] = MathUtils.lerp(hero[key], overview[key], t);
    pose.azimuth = hero.azimuth + angleDelta(hero.azimuth, overview.azimuth) * t;
    return pose;
  }

  function setIntroProgress(progress) {
    introProgress = MathUtils.clamp(progress, 0, 1);
  }

  /** Returns to scroll-driven intro/overview framing. */
  function showIntro() {
    flight?.kill();
    flight = null;
    focusedPlacement = null;
    mode = 'intro';
    if (reducedMotion) Object.assign(current, introPose());
  }

  /**
   * Flies to a destination.
   * @param {object} placement From computeDestinationPlacements().
   * @param {{immediate?: boolean}} options
   */
  function focusDestination(placement, { immediate = false } = {}) {
    flight?.kill();
    mode = 'destination';
    focusedPlacement = placement;
    const target = destinationPose(placement);
    const azimuth = current.azimuth + angleDelta(current.azimuth, target.azimuth);

    if (immediate || reducedMotion) {
      Object.assign(current, target, { azimuth });
      hop.value = 0;
      flight = null;
      return;
    }

    const travelKm = Math.hypot(target.tx - current.tx, target.tz - current.tz);
    const duration = MathUtils.clamp(CAMERA_CONFIG.flightDuration * (0.75 + travelKm / 400), 1.3, 3);
    const hopAmount = Math.min(1.4, (travelKm / 100) * CAMERA_CONFIG.flightHopPer100Km);
    const pose = {};
    for (const key of POSE_KEYS) pose[key] = target[key];

    flight = gsap.timeline({ onComplete: () => (flight = null) })
      .to(current, { ...pose, duration, ease: 'power3.inOut' }, 0)
      .to(current, { azimuth, duration, ease: 'power2.inOut' }, 0)
      .to(hop, { value: hopAmount, duration: duration * 0.45, ease: 'sine.out' }, 0)
      .to(hop, { value: 0, duration: duration * 0.55, ease: 'sine.inOut' }, duration * 0.45);
  }

  /** Re-frames after a resize or breakpoint change. */
  function refresh() {
    if (mode === 'destination' && focusedPlacement) focusDestination(focusedPlacement, { immediate: !flight });
  }

  /** Per-frame update. Returns the effective camera-to-target distance. */
  function update(time, delta) {
    let yaw = 0;
    if (mode === 'intro') {
      const desired = introPose();
      const damping = reducedMotion ? 1 : 1 - Math.exp(-delta * 3.2);
      for (const key of POSE_KEYS) current[key] += (desired[key] - current[key]) * damping;
      current.azimuth += angleDelta(current.azimuth, desired.azimuth) * damping;
      hop.value += (0 - hop.value) * damping;
      followedIntro += (introProgress - followedIntro) * damping;
      if (!reducedMotion) {
        const { idleYawDegrees, idlePeriodSeconds } = CAMERA_CONFIG.hero;
        yaw = Math.sin((time / idlePeriodSeconds) * Math.PI * 2) * idleYawDegrees * (1 - introProgress);
      }
    }
    updateVeil();
    return rig.apply(current, hop.value, yaw);
  }

  /** Scroll-scrubbed intro veil: rises, peaks mid-dive, clears before the overview. */
  function updateVeil() {
    if (reducedMotion || mode !== 'intro') {
      veil.amount = 0;
      return;
    }
    const { introStart, introEnd } = CLOUD_VEIL_CONFIG;
    const t = MathUtils.clamp((followedIntro - introStart) / (introEnd - introStart), 0, 1);
    veil.amount = Math.pow(Math.sin(t * Math.PI), 1.3);
    veil.phase = t * 2.6;
  }

  /** Jump straight to the current intro pose (first frame, no damping). */
  function snap() {
    Object.assign(current, introPose());
    followedIntro = introProgress;
  }

  return {
    setIntroProgress,
    showIntro,
    focusDestination,
    refresh,
    update,
    snap,
    getIntroProgress: () => introProgress,
    /** Cloud fly-through state for the veil layer: { amount 0–1, phase }. */
    getVeil: () => veil,
    dispose: () => flight?.kill(),
  };
}
