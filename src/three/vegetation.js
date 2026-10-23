/**
 * Instanced 3D forest canopy, in the spirit of hand-crafted aerial maps.
 *
 * Sri Lanka is far too large to plant every tree, so trees are generated in
 * square chunks around the camera's focus point, only while the camera is
 * close enough to resolve them (destination views). Chunks are created a few
 * per frame, cached, and rise out of the ground when they appear.
 *
 * Placement reads the baked vegetation map (terrain-vegetation.webp, lossless):
 *   R canopy density, G rivers, B coconut-palm share
 * Each candidate on a jittered grid is kept with probability = density, then
 * seated on the rendered terrain with the shared height sampler. Tree types:
 * rounded broadleaf canopies (two shapes), conical montane trees in the hills
 * and star-shaped coconut palms along the coast. All geometry is procedural,
 * lightly faceted and vertex-shaded darker underneath so the canopy reads as
 * a dense, textured mass with real shadows between crowns.
 *
 * Trees are stylised at map scale (crowns ~0.3–0.5 km across) so that they
 * read from the destination camera distance, like the rest of the diorama.
 *
 * Performance: each chunk's trees are shuffled, so drawing only the first n
 * instances thins the forest evenly. That drives two levels of detail —
 * density falls off towards the edge of the planting radius, and a frame-time
 * governor thins the whole forest on slower GPUs and restores it when there
 * is headroom.
 */
import {
  BufferAttribute,
  Color,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VEGETATION_CONFIG } from '../data/scene-config.js';
import { receiveCloudShadows } from './clouds.js';

/** Deterministic hash → [0, 1) so a chunk always grows the same trees. */
function hash(x, z, salt) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(salt | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Darkens the lower part of a crown (cheap ambient occlusion in vertex colours). */
function shadeVertically(geometry, dark = 0.45) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) - min.y) / Math.max(max.y - min.y, 1e-6);
    const v = dark + (1 - dark) * Math.pow(t, 0.8);
    colors.set([v, v, v], i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

function clump(parts) {
  const pieces = parts.map(([x, y, z, r, squash]) => new IcosahedronGeometry(r, 0).scale(1, squash, 1).translate(x, y, z));
  return shadeVertically(mergeGeometries(pieces.map((g) => g.toNonIndexed())));
}

/** Procedural tree geometries, unit-sized (≈ 1 unit across), base at y = 0. */
function createTreeGeometries() {
  // Few, low-poly lobes per crown: tens of thousands are drawn at once.
  const broadleafA = clump([
    [0, 0.36, 0, 0.38, 0.72],
    [0.24, 0.28, 0.12, 0.27, 0.8],
  ]);
  const broadleafB = clump([
    [0, 0.4, 0, 0.32, 0.82],
    [0.22, 0.3, -0.14, 0.24, 0.8],
    [-0.18, 0.3, 0.18, 0.24, 0.8],
  ]);
  const montane = shadeVertically(
    mergeGeometries([
      new ConeGeometry(0.32, 0.95, 6, 1, true).translate(0, 0.5, 0).toNonIndexed(),
    ]),
    0.4,
  );
  const fronds = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const frond = new OctahedronGeometry(0.5, 0).scale(0.5, 0.05, 0.11).translate(0.24, 0, 0);
    frond.rotateZ(-0.35).rotateY(angle).translate(0, 0.55, 0);
    fronds.push(frond.toNonIndexed());
  }
  fronds.push(new IcosahedronGeometry(0.08, 0).translate(0, 0.55, 0).toNonIndexed());
  const palm = shadeVertically(mergeGeometries(fronds), 0.55);
  return { broadleafA, broadleafB, montane, palm };
}

export function createVegetation({ vegetationTexture, textureBounds, sampler, qualityTier, shadows }) {
  const config = VEGETATION_CONFIG;
  const group = new Group();
  group.name = 'vegetation';

  // CPU copy of the vegetation map for placement.
  const image = vegetationTexture.image;
  let pixels = null;
  let mapWidth = 0;
  let mapHeight = 0;
  if (image?.width) {
    const canvas = document.createElement('canvas');
    canvas.width = mapWidth = image.width;
    canvas.height = mapHeight = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    pixels = context.getImageData(0, 0, mapWidth, mapHeight).data;
  }

  const spanX = textureBounds.maxX - textureBounds.minX;
  const spanZ = textureBounds.maxZ - textureBounds.minZ;
  /** Vegetation channels at a world point (image rows run north → south). */
  function sampleMap(x, z) {
    if (!pixels) return null;
    const px = Math.floor(((x - textureBounds.minX) / spanX) * mapWidth);
    const py = Math.floor(((z - textureBounds.minZ) / spanZ) * mapHeight);
    if (px < 0 || py < 0 || px >= mapWidth || py >= mapHeight) return null;
    const i = (py * mapWidth + px) * 4;
    return { density: pixels[i] / 255, river: pixels[i + 1] / 255, palms: pixels[i + 2] / 255 };
  }

  const geometries = createTreeGeometries();
  // Crowns grow when the governor thins the forest, so the canopy stays closed.
  const crownScale = { value: 1 };
  const baseMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: false });
  baseMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uCrownScale = crownScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uCrownScale;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed *= uCrownScale;');
  };
  const material = receiveCloudShadows(baseMaterial, 'vegetation');
  const palette = Object.fromEntries(Object.entries(config.colors).map(([k, v]) => [k, v.map((hex) => new Color(hex))]));

  const low = qualityTier === 'low';
  const spacing = config.spacingKm * (low ? 1.45 : 1);
  const chunkSize = config.chunkSizeKm;
  const chunks = new Map();
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const position = new Vector3();
  const scale = new Vector3();
  const color = new Color();

  function buildChunk(cx, cz) {
    const buckets = { broadleafA: [], broadleafB: [], montane: [], palm: [] };
    const x0 = cx * chunkSize;
    const z0 = cz * chunkSize;
    const steps = Math.round(chunkSize / spacing);
    for (let iz = 0; iz < steps; iz++) {
      for (let ix = 0; ix < steps; ix++) {
        const gx = cx * steps + ix;
        const gz = cz * steps + iz;
        const x = x0 + (ix + 0.15 + hash(gx, gz, 1) * 0.7) * spacing;
        const z = z0 + (iz + 0.15 + hash(gx, gz, 2) * 0.7) * spacing;
        const cell = sampleMap(x, z);
        if (!cell || cell.density <= 0.02 || cell.river > 0.2) continue;
        if (hash(gx, gz, 3) > cell.density) continue;
        const trueHeight = sampler.sampleTrueHeight(x, z);
        if (trueHeight === null) continue;

        const pick = hash(gx, gz, 4);
        let type;
        if (pick < cell.palms) type = 'palm';
        else if (trueHeight > config.montaneAboveKm && hash(gx, gz, 5) < 0.65) type = 'montane';
        else type = hash(gx, gz, 6) < 0.5 ? 'broadleafA' : 'broadleafB';
        buckets[type].push({ x, z, y: sampler.sampleHeight(x, z), seed: hash(gx, gz, 7), density: cell.density });
      }
    }

    const chunk = new Group();
    for (const [type, trees] of Object.entries(buckets)) {
      if (!trees.length) continue;
      // Deterministic shuffle so a prefix of the instances is an even sample.
      for (let i = trees.length - 1; i > 0; i--) {
        const j = Math.floor(trees[i].seed * 9301 + i * 49297) % (i + 1);
        [trees[i], trees[j]] = [trees[j], trees[i]];
      }
      const mesh = new InstancedMesh(geometries[type], material, trees.length);
      const colors = palette[type === 'palm' ? 'palm' : type === 'montane' ? 'montane' : 'broadleaf'];
      trees.forEach((tree, i) => {
        const size = config.crownKm[type] * (0.75 + tree.seed * 0.55);
        quaternion.setFromAxisAngle(up, tree.seed * Math.PI * 2 * 7.3);
        position.set(tree.x, tree.y - config.sinkKm, tree.z);
        scale.set(size, size * config.heightScale, size);
        mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
        // Denser forest reads darker; each crown gets its own shade.
        color.copy(colors[Math.floor(tree.seed * 977) % colors.length]).multiplyScalar(1.05 - tree.density * 0.25);
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      mesh.userData.total = trees.length;
      chunk.add(mesh);
    }
    chunk.position.y = -config.growKm;
    chunk.visible = false;
    group.add(chunk);
    return { group: chunk, rise: 0, lastWanted: 0, center: { x: x0 + chunkSize / 2, z: z0 + chunkSize / 2 } };
  }

  let frame = 0;
  // Frame-time governor: global share of trees drawn (1 = all).
  let budget = low ? 0.7 : 1;
  let smoothedFrame = 1 / 60;
  /**
   * @param {{x:number,z:number}} focus  camera target
   * @param {number} cameraDistance       km
   * @param {number} delta                seconds
   */
  function update(focus, cameraDistance, delta) {
    frame++;
    if (!pixels) return;
    smoothedFrame += (Math.min(delta, 0.2) - smoothedFrame) * 0.05;
    if (smoothedFrame > config.targetFrameSeconds * 1.12) budget = Math.max(config.minBudget, budget - delta * 0.35);
    else if (smoothedFrame < config.targetFrameSeconds * 0.85) budget = Math.min(1, budget + delta * 0.08);
    // Same canopy cover with fewer trees: crown area ∝ 1 / share.
    crownScale.value = Math.min(1.7, 1 / Math.sqrt(budget));
    const active = cameraDistance < config.showBelowDistanceKm;
    const radius = Math.min(config.maxRadiusKm * (low ? 0.75 : 1), cameraDistance * config.radiusPerDistance);

    if (active) {
      const c0x = Math.floor((focus.x - radius) / chunkSize);
      const c1x = Math.floor((focus.x + radius) / chunkSize);
      const c0z = Math.floor((focus.z - radius) / chunkSize);
      const c1z = Math.floor((focus.z + radius) / chunkSize);
      let built = 0;
      const wanted = [];
      for (let cz = c0z; cz <= c1z; cz++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          const cxCenter = (cx + 0.5) * chunkSize;
          const czCenter = (cz + 0.5) * chunkSize;
          const d = Math.hypot(cxCenter - focus.x, czCenter - focus.z);
          if (d < radius + chunkSize * 0.7) wanted.push({ cx, cz, d });
        }
      }
      wanted.sort((a, b) => a.d - b.d); // nearest first
      for (const { cx, cz } of wanted) {
        const key = `${cx},${cz}`;
        let chunk = chunks.get(key);
        if (!chunk) {
          if (built >= config.chunksPerFrame) continue;
          chunk = buildChunk(cx, cz);
          chunks.set(key, chunk);
          built++;
        }
        chunk.lastWanted = frame;
      }
    }

    // Grow wanted chunks out of the ground, sink and hide the rest.
    const smoothing = 1 - Math.exp(-delta * 3);
    for (const [key, chunk] of chunks) {
      const target = chunk.lastWanted === frame ? 1 : 0;
      chunk.rise += (target - chunk.rise) * smoothing;
      if (Math.abs(target - chunk.rise) < 0.002) chunk.rise = target;
      chunk.group.visible = chunk.rise > 0.01;
      chunk.group.position.y = -config.growKm * (1 - chunk.rise);
      if (chunk.group.visible) {
        // Distance LOD: full density near the focus, thinner towards the edge.
        const d = Math.hypot(chunk.center.x - focus.x, chunk.center.z - focus.z);
        const edge = Math.min(1, Math.max(0, (d - radius * 0.45) / Math.max(radius * 0.55, 1)));
        const share = budget * (1 - edge * 0.6);
        for (const mesh of chunk.group.children) mesh.count = Math.ceil(mesh.userData.total * share);
      }
      // Free far-away chunks once the cache is large.
      if (!chunk.group.visible && chunks.size > config.maxCachedChunks && frame - chunk.lastWanted > 600) {
        chunk.group.children.forEach((mesh) => mesh.dispose());
        chunk.group.removeFromParent();
        chunks.delete(key);
      }
    }
  }

  return {
    group,
    update,
    dispose() {
      for (const chunk of chunks.values()) chunk.group.children.forEach((mesh) => mesh.dispose());
      Object.values(geometries).forEach((g) => g.dispose());
      material.dispose();
      group.removeFromParent();
    },
  };
}
