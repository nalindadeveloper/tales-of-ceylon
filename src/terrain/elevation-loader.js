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
import { LinearMipmapLinearFilter, NoColorSpace, SRGBColorSpace } from 'three';

const FILES = {
  meta: 'terrain.json',
  mesh: 'terrain-mesh.bin',
  albedo: 'terrain-albedo.webp',
  normal: 'terrain-normal.webp',
  ocean: 'ocean.webp',
};

export async function loadElevationData(loader, basePath, { maxAnisotropy = 1 } = {}) {
  const [meta, buffer, albedo, normal, ocean] = await Promise.all([
    loader.loadJSON(basePath + FILES.meta),
    loader.loadArrayBuffer(basePath + FILES.mesh),
    loader.loadTexture(basePath + FILES.albedo),
    loader.loadTexture(basePath + FILES.normal),
    loader.loadTexture(basePath + FILES.ocean),
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

  return { meta, mesh: decodeMesh(buffer, meta.mesh), textures: { albedo, normal, ocean } };
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
