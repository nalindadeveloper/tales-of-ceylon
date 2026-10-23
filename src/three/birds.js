/**
 * Flocks of birds gliding over the forest around the focused destination.
 *
 * Each flock follows a smooth looping path (an ellipse with slow wobble)
 * around an anchor near the camera focus, holding a clearance above the real
 * terrain, so flocks climb over the hill country. Members keep a loose
 * formation relative to the flock heading, bob slightly, and bank into turns.
 *
 * Birds are one InstancedMesh of a tiny procedural bird (body + two bent
 * wings). Wing flapping happens in the vertex shader: each wing vertex is
 * lifted by sin(time·speed + phase) scaled by its distance from the body, and
 * every bird alternates between flapping and gliding on its own rhythm. The
 * same deformation is applied to the shadow-depth material, so the small
 * shadows on the canopy flap too.
 *
 * Wingspans are stylised at map scale (≈ 0.85 km) so birds read from the
 * destination camera distance, like the trees. Birds only appear in close
 * views and fade out / regroup when the camera travels to a new destination.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshDepthMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  Vector3,
} from 'three';
import { BIRD_CONFIG } from '../data/scene-config.js';

/**
 * Unit bird: wingspan 1 along x, flying towards +z, wings slightly swept back.
 * `aWing` (0 at the body → 1 at the tips) drives the flap in the shader.
 */
function createBirdGeometry() {
  const points = {
    nose: [0, 0, 0.26],
    tail: [0, 0, -0.2],
    tailL: [-0.07, 0, -0.27],
    tailR: [0.07, 0, -0.27],
    rootFront: 0.07,
    rootBack: -0.07,
  };
  const wing = (side) => {
    const s = side;
    // Broad wings: a slim silhouette aliases away at a few pixels.
    const rootF = [0.03 * s, 0, points.rootFront + 0.03];
    const rootB = [0.03 * s, 0, points.rootBack - 0.04];
    const elbow = [0.27 * s, 0.03, 0.06];
    const elbowB = [0.25 * s, 0.03, -0.14];
    const tip = [0.5 * s, 0.01, -0.12];
    return [rootF, elbow, rootB, rootB, elbow, elbowB, elbowB, elbow, tip];
  };
  const triangles = [
    // body (two crossed diamonds so it reads from above and from the side)
    points.nose, [0.035, 0, 0], points.tail,
    points.nose, points.tail, [-0.035, 0, 0],
    points.tail, points.tailR, points.tailL,
    ...wing(-1),
    ...wing(1),
  ];
  const positions = new Float32Array(triangles.flat());
  const wingWeight = new Float32Array(triangles.length);
  triangles.forEach(([x], i) => (wingWeight[i] = Math.min(1, Math.abs(x) / 0.5)));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aWing', new BufferAttribute(wingWeight, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** Vertex-shader wing flap shared by the colour and shadow-depth materials. */
function addWingFlap(material, uniforms, key) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aWing;
        attribute float aPhase;
        uniform float uBirdTime;
        uniform float uFlapSpeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // Alternate between bursts of flapping and long glides.
        float glide = smoothstep(-0.2, 0.6, sin(uBirdTime * 0.35 + aPhase * 1.7));
        float flap = sin(uBirdTime * uFlapSpeed + aPhase) * mix(0.1, 1.0, glide);
        transformed.y += flap * aWing * 0.32;
        // Wings fold in slightly on the up-stroke.
        transformed.x *= 1.0 - max(flap, 0.0) * aWing * 0.12;`,
      );
  };
  material.customProgramCacheKey = () => `bird-flap-${key}`;
  return material;
}

export function createBirds({ sampler, qualityTier, shadows }) {
  const config = BIRD_CONFIG;
  const flockCount = qualityTier === 'low' ? Math.ceil(config.flocks / 2) : config.flocks;

  // Flock definitions (deterministic).
  const flocks = [];
  let total = 0;
  for (let f = 0; f < flockCount; f++) {
    const r = (n) => MathUtils.seededRandom(1000 + f * 37 + n);
    const size = config.minFlockSize + Math.floor(r(1) * (config.maxFlockSize - config.minFlockSize + 1));
    const members = [];
    for (let m = 0; m < size; m++) {
      // Loose V / cluster formation behind the leader (local: x side, z forward).
      const row = Math.ceil(m / 2);
      const side = m === 0 ? 0 : m % 2 ? -1 : 1;
      members.push({
        x: side * row * config.spacingKm * (0.8 + MathUtils.seededRandom(f * 100 + m) * 0.5),
        z: -row * config.spacingKm * (0.7 + MathUtils.seededRandom(f * 100 + m + 50) * 0.6),
        y: (MathUtils.seededRandom(f * 100 + m + 90) - 0.5) * 0.25,
        bob: MathUtils.seededRandom(f * 100 + m + 130) * Math.PI * 2,
        scale: 0.85 + MathUtils.seededRandom(f * 100 + m + 170) * 0.3,
      });
    }
    flocks.push({
      members,
      start: total,
      white: r(2) < config.whiteShare, // egrets vs dark birds
      radiusX: config.pathRadiusKm[0] + r(3) * (config.pathRadiusKm[1] - config.pathRadiusKm[0]),
      radiusZ: config.pathRadiusKm[0] + r(4) * (config.pathRadiusKm[1] - config.pathRadiusKm[0]),
      angle: r(5) * Math.PI * 2,
      speed: (config.speedKmPerSecond / config.pathRadiusKm[1]) * (0.75 + r(6) * 0.5) * (r(7) < 0.5 ? 1 : -1),
      offset: [(r(8) - 0.5) * 10, (r(9) - 0.5) * 10],
      clearance: config.clearanceKm[0] + r(10) * (config.clearanceKm[1] - config.clearanceKm[0]),
      phase: r(11) * 100,
      altitude: null,
      heading: new Vector3(0, 0, 1),
    });
    total += size;
  }

  const uniforms = { uBirdTime: { value: 0 }, uFlapSpeed: { value: config.flapSpeed } };
  const geometry = createBirdGeometry();
  const phases = new Float32Array(total);
  for (let i = 0; i < total; i++) phases[i] = MathUtils.seededRandom(i + 7) * Math.PI * 2;
  geometry.setAttribute('aPhase', new InstancedBufferAttribute(phases, 1));

  const material = addWingFlap(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0, side: DoubleSide }), uniforms, 'colour');
  const depthMaterial = addWingFlap(new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide }), uniforms, 'depth');

  const mesh = new InstancedMesh(geometry, material, total);
  mesh.name = 'birds';
  mesh.customDepthMaterial = depthMaterial;
  mesh.castShadow = shadows;
  mesh.frustumCulled = false; // instances move every frame
  const dark = new Color(config.darkColor);
  const white = new Color(config.whiteColor);
  flocks.forEach((flock) => flock.members.forEach((_, m) => mesh.setColorAt(flock.start + m, flock.white ? white : dark)));
  mesh.instanceColor.needsUpdate = true;

  const anchor = new Vector3();
  let anchored = false;
  let visibility = 0;
  let regrouping = false;
  const matrix = new Matrix4();
  const basisX = new Vector3();
  const basisY = new Vector3();
  const basisZ = new Vector3();
  const up = new Vector3(0, 1, 0);
  const flockPosition = new Vector3();
  const previous = new Vector3();
  const memberPosition = new Vector3();
  const memberScale = new Vector3();

  function flockCentre(flock, time, target) {
    const a = flock.angle + time * flock.speed;
    const wobble = Math.sin(time * 0.05 + flock.phase) * 0.25;
    return target.set(
      anchor.x + flock.offset[0] + Math.cos(a) * flock.radiusX * (1 + wobble),
      0,
      anchor.z + flock.offset[1] + Math.sin(a) * flock.radiusZ * (1 - wobble),
    );
  }

  /**
   * @param {number} time      seconds
   * @param {number} delta     seconds
   * @param {Vector3} focus    camera target
   * @param {number} distance  camera-to-target distance (km)
   */
  function update(time, delta, focus, distance) {
    uniforms.uBirdTime.value = time;
    const close = distance < config.showBelowDistanceKm;

    // Re-anchor at a new destination: fade out, jump, fade back in.
    if (!anchored) {
      anchor.set(focus.x, 0, focus.z);
      anchored = true;
    }
    const drift = Math.hypot(focus.x - anchor.x, focus.z - anchor.z);
    if (drift > config.regroupDistanceKm) regrouping = true;
    if (regrouping && visibility < 0.02) {
      anchor.set(focus.x, 0, focus.z);
      flocks.forEach((flock) => (flock.altitude = null));
      regrouping = false;
    }
    const targetVisibility = close && !regrouping ? 1 : 0;
    visibility += (targetVisibility - visibility) * (1 - Math.exp(-delta * 2.5));
    mesh.visible = visibility > 0.01;
    if (!mesh.visible) return;

    const birdSize = config.wingspanKm * visibility;
    for (const flock of flocks) {
      flockCentre(flock, time, flockPosition);
      flockCentre(flock, time - 0.5, previous);
      // Altitude follows the terrain below, smoothed so flocks glide over ridges.
      const ground = sampler.sampleHeight(flockPosition.x, flockPosition.z);
      const desired = ground + flock.clearance;
      flock.altitude = flock.altitude === null ? desired : flock.altitude + (desired - flock.altitude) * (1 - Math.exp(-delta * 0.8));
      flockPosition.y = flock.altitude;
      previous.y = flock.altitude;

      basisZ.subVectors(flockPosition, previous);
      if (basisZ.lengthSq() < 1e-8) basisZ.copy(flock.heading);
      basisZ.normalize();
      // Bank into the turn: compare with the stored heading.
      const turn = flock.heading.x * basisZ.z - flock.heading.z * basisZ.x;
      flock.heading.copy(basisZ);
      const bank = MathUtils.clamp(turn * 40, -0.6, 0.6) * Math.sign(flock.speed);
      basisX.crossVectors(up, basisZ).normalize();
      basisY.crossVectors(basisZ, basisX).normalize();
      basisX.applyAxisAngle(basisZ, bank);
      basisY.applyAxisAngle(basisZ, bank);

      flock.members.forEach((member, m) => {
        const bob = Math.sin(time * 0.9 + member.bob) * 0.08;
        memberPosition
          .copy(flockPosition)
          .addScaledVector(basisX, member.x)
          .addScaledVector(basisZ, member.z)
          .addScaledVector(up, member.y + bob);
        const s = birdSize * member.scale;
        matrix.makeBasis(basisX, basisY, basisZ).scale(memberScale.setScalar(s)).setPosition(memberPosition);
        mesh.setMatrixAt(flock.start + m, matrix);
      });
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    mesh,
    update,
    dispose() {
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
      mesh.dispose();
    },
  };
}
