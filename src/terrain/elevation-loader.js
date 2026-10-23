/**
 * Loads the preprocessed elevation assets: metadata, the triangulated terrain
 * mesh (binary) and the baked textures. All requests start in parallel so the
 * LoadingManager knows the full item count up front (stable progress).
 *
 * Binary layout of terrain-mesh.bin (offsets are given in terrain.json):
 *   positions  Uint16 × 2 per vertex — x and z normalised over mesh.bounds
 *   heights    Uint16 × 1 per vertex — elevation in metres
 *   indices    Uint16 or Uint32 × 3 per triangle
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RedFormat, SRGBColorSpace } from 'three';

const FILES = {
  meta: 'terrain.json',
  mesh: 'terrain-mesh.bin',
  albedo: 'terrain-albedo.webp',
  normal: 'terrain-normal.webp',
  ocean: 'ocean.webp',
  shore: 'shore-distance.png',
  vegetation: 'terrain-vegetation.webp',
};

/** Stand-in when the shore field is missing: "far from any coast" everywhere. */
function createOpenSeaTexture() {
  const texture = new DataTexture(new Uint8Array([255]), 1, 1, RedFormat);
  texture.needsUpdate = true;
  return texture;
}

export async function loadElevationData(loader, basePath, { maxAnisotropy = 1 } = {}) {
  const [meta, buffer, albedo, normal, ocean, shore, vegetation] = await Promise.all([
    loader.loadJSON(basePath + FILES.meta),
    loader.loadArrayBuffer(basePath + FILES.mesh),
    loader.loadTexture(basePath + FILES.albedo),
    loader.loadTexture(basePath + FILES.normal),
    loader.loadTexture(basePath + FILES.ocean),
    // The surf field is decorative: a missing file only disables the surf.
    loader.loadTexture(basePath + FILES.shore).catch(() => {
      console.warn('[terrain] shore-distance.png missing — run npm run geo:shore to enable surf.');
      return createOpenSeaTexture();
    }),
    // Forest + rivers are decorative too: without the map there are no trees.
    loader.loadTexture(basePath + FILES.vegetation).catch(() => {
      console.warn('[terrain] terrain-vegetation.webp missing — run npm run geo:build to enable the forest.');
      return null;
    }),
  ]);

  if (meta.mesh.file !== FILES.mesh || meta.textures.albedo !== FILES.albedo) {
    console.warn('[terrain] terrain.json lists different file names than expected; re-run npm run geo:build.');
  }

  albedo.colorSpace = SRGBColorSpace;
  ocean.colorSpace = SRGBColorSpace;
  normal.colorSpace = NoColorSpace; // normal vectors, not colours
  for (const texture of [albedo, normal, ocean]) {
    texture.anisotropy = Math.min(8, maxAnisotropy);
    texture.minFilter = LinearMipmapLinearFilter;
  }

  // Distance data, not colour; linear filtering keeps the surf lines smooth.
  shore.colorSpace = NoColorSpace;
  shore.minFilter = LinearFilter;
  shore.generateMipmaps = false;

  if (vegetation) {
    vegetation.colorSpace = NoColorSpace; // data channels, not colour
    vegetation.minFilter = LinearMipmapLinearFilter;
  }

  return { meta, mesh: decodeMesh(buffer, meta.mesh), textures: { albedo, normal, ocean, shore, vegetation } };
}

/**
 * Decodes the quantised binary mesh into plain arrays.
 * Returns x/z in km and heights in km (true, not exaggerated).
 */
function decodeMesh(buffer, info) {
  const { vertexCount, indexCount, positionsOffset, heightsOffset, indicesOffset, indexType, bounds } = info;
  const quantised = new Uint16Array(buffer, positionsOffset, vertexCount * 2);
  const heightsM = new Uint16Array(buffer, heightsOffset, vertexCount);
  const indices = indexType === 'uint16'
    ? new Uint16Array(buffer, indicesOffset, indexCount)
    : new Uint32Array(buffer, indicesOffset, indexCount);

  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const x = new Float32Array(vertexCount);
  const z = new Float32Array(vertexCount);
  const heightKm = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    x[i] = bounds.minX + (quantised[i * 2] / 65535) * spanX;
    z[i] = bounds.minZ + (quantised[i * 2 + 1] / 65535) * spanZ;
    heightKm[i] = heightsM[i] / 1000;
  }
  return { vertexCount, x, z, heightKm, indices, bounds };
}
