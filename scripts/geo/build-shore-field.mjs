/**
 * Bakes a distance-to-coast field around Sri Lanka for the ocean shader
 * (rolling surf lines, wash at the beach, foam that thins with distance).
 *
 * Input:  public/assets/geo/sri-lanka-boundary.geojson (the simplified coastline
 *         used by the terrain mesh, so the surf meets the land exactly)
 * Output: public/assets/geo/sri-lanka-elevation/shore-distance.png
 *         + a `shore` section in terrain.json (bounds and encoding)
 *
 * Encoding: 8-bit grey, value = sqrt(distance / MAX_DISTANCE_KM). The square
 * root spends most precision near the shore, where the surf needs it
 * (≈ 20 m steps at 0.5 km). Land pixels are 0.
 *
 * Distances are EXACT distances to the coastline polygon edges (not a raster
 * approximation): a Euclidean distance transform gives a first estimate, then
 * nearby segments are measured exactly through a spatial hash.
 *
 *   npm run geo:shore      (also runs at the end of npm run geo:build)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { geojsonToProjectedRings, ringsBounds } from '../../src/geography/coordinate-conversion.js';
import { OUTPUT_GEO_DIR, OUTPUT_TERRAIN_DIR } from './geo-config.mjs';
import { distanceTransform, rasterizeRings } from './raster-utils.mjs';

const MAX_DISTANCE_KM = 12;
const PADDING_KM = MAX_DISTANCE_KM + 2;
const PIXEL_KM = 0.2;
const HASH_CELL_KM = 2;

function pointSegmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function buildSegmentHash(rings) {
  const cells = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      const segment = [ax, az, bx, bz];
      for (let cz = Math.floor(Math.min(az, bz) / HASH_CELL_KM); cz <= Math.floor(Math.max(az, bz) / HASH_CELL_KM); cz++) {
        for (let cx = Math.floor(Math.min(ax, bx) / HASH_CELL_KM); cx <= Math.floor(Math.max(ax, bx) / HASH_CELL_KM); cx++) {
          if (!cells.has(key(cx, cz))) cells.set(key(cx, cz), []);
          cells.get(key(cx, cz)).push(segment);
        }
      }
    }
  }
  /** Exact distance to the nearest coastline segment within `radius` km. */
  return (x, z, radius) => {
    let best = Infinity;
    const r = Math.ceil(radius / HASH_CELL_KM);
    const cx0 = Math.floor(x / HASH_CELL_KM);
    const cz0 = Math.floor(z / HASH_CELL_KM);
    for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
      for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
        for (const [ax, az, bx, bz] of cells.get(key(cx, cz)) ?? []) {
          best = Math.min(best, pointSegmentDistance(x, z, ax, az, bx, bz));
        }
      }
    }
    return best;
  };
}

async function main() {
  const started = Date.now();
  const geojson = JSON.parse(readFileSync(resolve(OUTPUT_GEO_DIR, 'sri-lanka-boundary.geojson'), 'utf8'));
  const rings = geojsonToProjectedRings(geojson);
  const island = ringsBounds(rings);

  const minX = island.minX - PADDING_KM;
  const minZ = island.minZ - PADDING_KM;
  const width = Math.ceil((island.width + 2 * PADDING_KM) / PIXEL_KM);
  const height = Math.ceil((island.depth + 2 * PADDING_KM) / PIXEL_KM);
  const grid = {
    width,
    height,
    toPixel: (x, z) => [(x - minX) / PIXEL_KM, (z - minZ) / PIXEL_KM],
  };

  const land = rasterizeRings(rings, grid);
  const sea = new Uint8Array(land.length);
  for (let i = 0; i < land.length; i++) sea[i] = land[i] ? 0 : 1;
  const estimatePx = distanceTransform(sea, width, height, 1);
  const exactDistance = buildSegmentHash(rings);

  const pixels = Buffer.alloc(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = py * width + px;
      if (land[i]) continue; // land stays 0
      const estimate = estimatePx[i] * PIXEL_KM;
      let distance = MAX_DISTANCE_KM;
      if (estimate < MAX_DISTANCE_KM + PIXEL_KM) {
        const x = minX + (px + 0.5) * PIXEL_KM;
        const z = minZ + (py + 0.5) * PIXEL_KM;
        distance = Math.min(MAX_DISTANCE_KM, exactDistance(x, z, estimate + PIXEL_KM * 2));
      }
      pixels[i] = Math.round(Math.sqrt(distance / MAX_DISTANCE_KM) * 255);
    }
  }

  const target = resolve(OUTPUT_TERRAIN_DIR, 'shore-distance.png');
  await sharp(pixels, { raw: { width, height, channels: 1 } }).png({ compressionLevel: 9 }).toFile(target);

  const metaFile = resolve(OUTPUT_TERRAIN_DIR, 'terrain.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  meta.shore = {
    texture: 'shore-distance.png',
    bounds: { minX, minZ, maxX: minX + width * PIXEL_KM, maxZ: minZ + height * PIXEL_KM },
    maxDistanceKm: MAX_DISTANCE_KM,
    encoding: 'grey = sqrt(distance / maxDistanceKm); exact distance to coastline segments',
  };
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  console.log(`[geo:shore] ${width}×${height} @ ${PIXEL_KM * 1000} m/px in ${((Date.now() - started) / 1000).toFixed(1)} s → ${target}`);
}

main().catch((error) => {
  console.error('[geo:shore] Failed:', error);
  process.exitCode = 1;
});
