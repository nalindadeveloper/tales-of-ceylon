/**
 * Builds every terrain asset the website needs from the raw source data in
 * .geo-cache/raw (run `npm run geo:fetch` first):
 *
 *   public/assets/geo/sri-lanka-boundary.geojson         simplified coastline (lon/lat)
 *   public/assets/geo/sri-lanka-elevation/terrain.json   metadata + provenance
 *   public/assets/geo/sri-lanka-elevation/terrain-mesh.bin   triangulated surface
 *   public/assets/geo/sri-lanka-elevation/terrain-albedo.webp
 *   public/assets/geo/sri-lanka-elevation/terrain-normal.webp
 *   public/assets/geo/sri-lanka-elevation/ocean.webp     bathymetry-tinted sea
 *   src/data/island-outline.js                           SVG outline for the loader
 *
 * Pipeline overview
 *  1. Extract the coastline rings from geoBoundaries, drop tiny islets and
 *     simplify them (Douglas–Peucker in projected kilometres).
 *  2. Resample the Terrarium DEM (SRTM) onto a regular raster in the local
 *     scene projection (see src/geography/projection.js).
 *  3. Rasterise the coastline into a land mask and compute the distance to the
 *     coast for every pixel.
 *  4. Build an adaptive set of interior points (denser where the relief is
 *     high) and triangulate them together with the coastline using a
 *     constrained Delaunay triangulation, so the mesh edge follows the true
 *     coastline exactly. Vertex heights come from the DEM raster.
 *  5. Bake an object-space normal map, a colour (albedo) map and an ocean map.
 *
 *   npm run geo:build
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import cdt2d from 'cdt2d';
import sharp from 'sharp';
import { projectLonLat, unprojectXZ, PROJECTION_ORIGIN } from '../../src/geography/projection.js';
import {
  BAKE_EXAGGERATION,
  CLIMATE_ZONES,
  ELEVATION_BANDS,
  TERRAIN_PALETTE,
} from '../../src/terrain/terrain-palette.js';
import {
  BOUNDARY_SOURCE,
  CACHE_DIR,
  DEM_SOURCE,
  LAND_DEM,
  OCEAN_DEM,
  OUTPUT_GEO_DIR,
  OUTPUT_TERRAIN_DIR,
  ROOT,
} from './geo-config.mjs';
import { createDemSampler } from './tiles.mjs';
import { boxBlur, distanceTransform, fbm, flowAccumulation, rasterizeRings } from './raster-utils.mjs';

const RAW_DIR = resolve(CACHE_DIR, 'raw');

/** Rings smaller than this (km²) are discarded — they vanish at our scale. */
const MIN_ISLAND_AREA_KM2 = 4;
/** Coastline simplification tolerance for the mesh / wall (km). */
const COAST_TOLERANCE_KM = 0.16;
/** Coarser tolerance for the decorative loading-screen outline (km). */
const OUTLINE_TOLERANCE_KM = 0.9;
/** Height of the bake raster in pixels (width follows the island aspect). */
const BAKE_HEIGHT_PX = 2048;
/** Padding around the island in the bake raster (km). */
const BAKE_PADDING_KM = 2;
/** Base spacing of interior mesh points (km), refined where relief is high. */
const MESH_BASE_SPACING_KM = 1.5;
/** Relief (m) inside a base cell that triggers 2×2 and 3×3 refinement. */
const MESH_REFINE_RELIEF_M = [110, 420];
/** Minimum upstream area (km²) for a drainage line to be painted as a river. */
const RIVER_MIN_AREA_KM2 = 320;
const OCEAN_TEXTURE_WIDTH = 1024;
/** Terrarium values above this (m) outside Sri Lanka are treated as other land (India). */
const FOREIGN_LAND_THRESHOLD_M = 3;

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                     */
/* ------------------------------------------------------------------ */

function ringAreaKm2(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(area) / 2;
}

function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  let t = lengthSq ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

/** Douglas–Peucker on the open polyline ring[start..end] (end may wrap to 0). */
function douglasPeucker(ring, start, end, tolerance, keep) {
  const stack = [[start, end]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const endPoint = ring[b % ring.length];
    let maxDistance = 0;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistance(ring[i], ring[a], endPoint);
      if (d > maxDistance) {
        maxDistance = d;
        index = i;
      }
    }
    if (index >= 0 && maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
}

/** Returns the indices (into the original ring) kept by Douglas–Peucker. */
function simplifyRingIndices(ring, tolerance) {
  // Split the closed ring at its most distant vertex so DP works on open lines.
  let farthest = 0;
  let farthestDistance = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > farthestDistance) {
      farthestDistance = d;
      farthest = i;
    }
  }
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[farthest] = 1;
  douglasPeucker(ring, 0, farthest, tolerance, keep);
  douglasPeucker(ring, farthest, ring.length, tolerance, keep);
  const indices = [];
  keep.forEach((k, i) => k && indices.push(i));
  return indices;
}

function simplifyRing(ring, tolerance) {
  return simplifyRingIndices(ring, tolerance).map((i) => ring[i]);
}

function segmentsIntersect(a, b, c, d) {
  const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * Lists simplified segments that cross any other segment (within or across
 * rings). Segments are bucketed into horizontal bands to keep this fast.
 */
function findCrossingSegments(rings) {
  const segments = [];
  rings.forEach((ring, r) => {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      segments.push({ r, k, n: ring.length, a, b, zMin: Math.min(a[1], b[1]), zMax: Math.max(a[1], b[1]) });
    }
  });
  const BAND_KM = 2;
  const bands = new Map();
  segments.forEach((segment, index) => {
    for (let band = Math.floor(segment.zMin / BAND_KM); band <= Math.floor(segment.zMax / BAND_KM); band++) {
      if (!bands.has(band)) bands.set(band, []);
      bands.get(band).push(index);
    }
  });
  const crossing = new Set();
  for (const members of bands.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const s = segments[members[i]];
        const t = segments[members[j]];
        if (s.r === t.r && (Math.abs(s.k - t.k) <= 1 || Math.abs(s.k - t.k) === s.n - 1)) continue;
        if (segmentsIntersect(s.a, s.b, t.a, t.b)) {
          crossing.add(`${s.r}:${s.k}`);
          crossing.add(`${t.r}:${t.k}`);
        }
      }
    }
  }
  return crossing;
}

/**
 * Topology-preserving simplification: run Douglas–Peucker, then repeatedly
 * re-insert the most significant original vertex into every simplified
 * segment that crosses another one, until no crossings remain.
 */
function simplifyRingsSafely(sourceRings, tolerance) {
  const kept = sourceRings.map((ring) => simplifyRingIndices(ring, tolerance));
  for (let iteration = 0; iteration < 50; iteration++) {
    const crossing = findCrossingSegments(kept.map((indices, r) => indices.map((i) => sourceRings[r][i])));
    if (!crossing.size) break;
    for (const key of crossing) {
      const [r, k] = key.split(':').map(Number);
      const indices = kept[r];
      const start = indices[k];
      const end = k + 1 < indices.length ? indices[k + 1] : sourceRings[r].length;
      if (end - start < 2) continue;
      const ring = sourceRings[r];
      let best = start + 1;
      let bestDistance = -1;
      for (let i = start + 1; i < end; i++) {
        const d = pointSegmentDistance(ring[i], ring[start], ring[end % ring.length]);
        if (d > bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      indices.push(best);
    }
    kept.forEach((indices) => indices.sort((a, b) => a - b));
  }
  return kept.map((indices, r) => [...new Set(indices)].map((i) => sourceRings[r][i]));
}

/** Exact even-odd point-in-polygon test, accelerated with 1 km horizontal bands. */
function createPointInRings(rings) {
  const BAND_KM = 1;
  const bands = new Map();
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const edge = [ring[j], ring[i]];
      const z0 = Math.min(ring[i][1], ring[j][1]);
      const z1 = Math.max(ring[i][1], ring[j][1]);
      for (let band = Math.floor(z0 / BAND_KM); band <= Math.floor(z1 / BAND_KM); band++) {
        if (!bands.has(band)) bands.set(band, []);
        bands.get(band).push(edge);
      }
    }
  }
  return (x, z) => {
    let inside = false;
    for (const [[xj, zj], [xi, zi]] of bands.get(Math.floor(z / BAND_KM)) ?? []) {
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
}

const roundCoordinate = (value) => Math.round(value * 1e5) / 1e5;

/**
 * Loads geoBoundaries, keeps the outer rings of the main island and the larger
 * offshore islands, simplifies them and rounds them to 5 decimals (~1 m).
 * Returns the rings both as lon/lat (for GeoJSON) and projected km.
 */
function loadCoastline() {
  const geojson = JSON.parse(readFileSync(resolve(RAW_DIR, BOUNDARY_SOURCE.file), 'utf8'));
  const polygons = geojson.features.flatMap((feature) =>
    feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates],
  );

  const sourceRings = [];
  for (const polygon of polygons) {
    const outer = polygon[0].slice(0, -1); // drop closing duplicate
    const projected = outer.map(([lon, lat]) => {
      const { x, z } = projectLonLat(lon, lat);
      return [x, z];
    });
    if (ringAreaKm2(projected) >= MIN_ISLAND_AREA_KM2) sourceRings.push(projected);
  }

  const result = [];
  simplifyRingsSafely(sourceRings, COAST_TOLERANCE_KM).forEach((simplified, r) => {
    const lonLat = [];
    for (const [x, z] of simplified) {
      const { lon, lat } = unprojectXZ(x, z);
      const point = [roundCoordinate(lon), roundCoordinate(lat)];
      const previous = lonLat[lonLat.length - 1];
      if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) lonLat.push(point);
    }
    const xz = lonLat.map(([lon, lat]) => {
      const { x, z } = projectLonLat(lon, lat);
      return [x, z];
    });
    result.push({ lonLat, xz, areaKm2: ringAreaKm2(xz), sourceVertices: sourceRings[r].length });
  });
  result.sort((a, b) => b.areaKm2 - a.areaKm2);
  return result;
}

/* ------------------------------------------------------------------ */
/* Raster grid in scene space                                           */
/* ------------------------------------------------------------------ */

function createGrid(minX, minZ, maxX, maxZ, heightPx) {
  const pixelKm = (maxZ - minZ) / heightPx;
  const width = Math.ceil((maxX - minX) / pixelKm);
  const height = heightPx;
  return {
    width,
    height,
    pixelKm,
    minX,
    minZ,
    maxX: minX + width * pixelKm,
    maxZ,
    toPixel: (x, z) => [(x - minX) / pixelKm, (z - minZ) / pixelKm],
    centre: (px, py) => [minX + (px + 0.5) * pixelKm, minZ + (py + 0.5) * pixelKm],
  };
}

function sampleBilinear(raster, grid, x, z) {
  const fx = (x - grid.minX) / grid.pixelKm - 0.5;
  const fy = (z - grid.minZ) / grid.pixelKm - 0.5;
  const ix = Math.max(0, Math.min(grid.width - 2, Math.floor(fx)));
  const iy = Math.max(0, Math.min(grid.height - 2, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - ix));
  const ty = Math.min(1, Math.max(0, fy - iy));
  const w = grid.width;
  const a = raster[iy * w + ix];
  const b = raster[iy * w + ix + 1];
  const c = raster[(iy + 1) * w + ix];
  const d = raster[(iy + 1) * w + ix + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function sampleNearest(raster, grid, x, z) {
  const px = Math.floor((x - grid.minX) / grid.pixelKm);
  const py = Math.floor((z - grid.minZ) / grid.pixelKm);
  if (px < 0 || py < 0 || px >= grid.width || py >= grid.height) return 0;
  return raster[py * grid.width + px];
}

/* ------------------------------------------------------------------ */
/* Colour helpers                                                       */
/* ------------------------------------------------------------------ */

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const PALETTE = Object.fromEntries(Object.entries(TERRAIN_PALETTE).map(([k, v]) => [k, hexToRgb(v)]));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ */
/* Bake steps                                                           */
/* ------------------------------------------------------------------ */

function bakeElevation(grid, sampleLand) {
  const heights = new Float32Array(grid.width * grid.height);
  for (let py = 0; py < grid.height; py++) {
    for (let px = 0; px < grid.width; px++) {
      const [x, z] = grid.centre(px, py);
      const { lon, lat } = unprojectXZ(x, z);
      heights[py * grid.width + px] = sampleLand(lon, lat);
    }
  }
  return heights;
}

/** Land heights clamped to ≥ 0 m, water set to 0 m. */
function landOnly(heights, mask) {
  const out = new Float32Array(heights.length);
  for (let i = 0; i < heights.length; i++) out[i] = mask[i] ? Math.max(0, heights[i]) : 0;
  return out;
}

function buildMesh(coast, grid, landHeights, coastDistanceKm) {
  const points = [];
  const heightsM = [];
  const edges = [];

  // Coastline vertices: constrained edges, pinned to sea level so they meet the edge wall.
  for (const ring of coast) {
    const start = points.length;
    ring.xz.forEach((p, i) => {
      points.push([p[0], p[1]]);
      heightsM.push(0);
      edges.push([start + i, start + ((i + 1) % ring.xz.length)]);
    });
  }

  // Adaptive interior points: denser where the terrain has more relief.
  const s = MESH_BASE_SPACING_KM;
  for (let cz = grid.minZ; cz < grid.maxZ; cz += s) {
    for (let cx = grid.minX; cx < grid.maxX; cx += s) {
      let minH = Infinity;
      let maxH = -Infinity;
      let anyLand = false;
      for (let sz = 0; sz <= 4; sz++) {
        for (let sx = 0; sx <= 4; sx++) {
          const x = cx + (sx / 4) * s;
          const z = cz + (sz / 4) * s;
          if (sampleNearest(coastDistanceKm, grid, x, z) <= 0) continue;
          anyLand = true;
          const h = sampleBilinear(landHeights, grid, x, z);
          minH = Math.min(minH, h);
          maxH = Math.max(maxH, h);
        }
      }
      if (!anyLand) continue;
      const relief = maxH - minH;
      const n = relief > MESH_REFINE_RELIEF_M[1] ? 3 : relief > MESH_REFINE_RELIEF_M[0] ? 2 : 1;
      const step = s / n;
      for (let iz = 0; iz < n; iz++) {
        for (let ix = 0; ix < n; ix++) {
          const x = cx + (ix + 0.5) * step;
          const z = cz + (iz + 0.5) * step;
          // Keep interior points away from the coastline to avoid sliver triangles.
          if (sampleNearest(coastDistanceKm, grid, x, z) < step * 0.45) continue;
          points.push([x, z]);
          heightsM.push(Math.max(0, sampleBilinear(landHeights, grid, x, z)));
        }
      }
    }
  }

  // Triangulate everything, then keep the triangles whose centroid lies on land.
  const insideLand = createPointInRings(coast.map((ring) => ring.xz));
  const triangles = cdt2d(points, edges).filter(([a, b, c]) =>
    insideLand((points[a][0] + points[b][0] + points[c][0]) / 3, (points[a][1] + points[b][1] + points[c][1]) / 3),
  );

  // Make every triangle face +Y (upwards) in a right-handed, Y-up frame.
  for (const tri of triangles) {
    const [a, b, c] = tri.map((i) => points[i]);
    const crossY = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (crossY < 0) [tri[1], tri[2]] = [tri[2], tri[1]];
  }
  return { points, heightsM, triangles };
}

function writeMeshBinary(mesh, bounds, target) {
  const vertexCount = mesh.points.length;
  const indexCount = mesh.triangles.length * 3;
  const indexBytes = vertexCount < 65536 ? 2 : 4;
  const positionsOffset = 0;
  const heightsOffset = vertexCount * 4;
  const indicesOffset = Math.ceil((heightsOffset + vertexCount * 2) / 4) * 4;
  const buffer = new ArrayBuffer(indicesOffset + indexCount * indexBytes);

  // Positions are quantised to 16 bits across the bounds (≈ 4–7 m precision).
  const positions = new Uint16Array(buffer, positionsOffset, vertexCount * 2);
  const heights = new Uint16Array(buffer, heightsOffset, vertexCount);
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  mesh.points.forEach(([x, z], i) => {
    positions[i * 2] = Math.round(((x - bounds.minX) / spanX) * 65535);
    positions[i * 2 + 1] = Math.round(((z - bounds.minZ) / spanZ) * 65535);
    heights[i] = Math.min(65535, Math.round(mesh.heightsM[i]));
  });
  const indices = indexBytes === 2
    ? new Uint16Array(buffer, indicesOffset, indexCount)
    : new Uint32Array(buffer, indicesOffset, indexCount);
  mesh.triangles.forEach((tri, i) => indices.set(tri, i * 3));

  writeFileSync(target, Buffer.from(buffer));
  return { vertexCount, indexCount, indexType: indexBytes === 2 ? 'uint16' : 'uint32', positionsOffset, heightsOffset, indicesOffset, byteLength: buffer.byteLength };
}

function bakeNormalMap(grid, landHeights, mask) {
  const { width, height, pixelKm } = grid;
  const rgb = Buffer.alloc(width * height * 3);
  const at = (x, y) => landHeights[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] / 1000;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let nx = 0;
      let nz = 0;
      if (mask[i]) {
        // Central differences in km/km, exaggerated for the bake (see BAKE_EXAGGERATION).
        nx = (-(at(x + 1, y) - at(x - 1, y)) / (2 * pixelKm)) * BAKE_EXAGGERATION;
        nz = (-(at(x, y + 1) - at(x, y - 1)) / (2 * pixelKm)) * BAKE_EXAGGERATION;
      }
      const length = Math.hypot(nx, 1, nz);
      rgb[i * 3] = Math.round((nx / length * 0.5 + 0.5) * 255);
      rgb[i * 3 + 1] = Math.round((1 / length * 0.5 + 0.5) * 255);
      rgb[i * 3 + 2] = Math.round((nz / length * 0.5 + 0.5) * 255);
    }
  }
  return rgb;
}

function bakeRivers(grid, landHeights, mask) {
  const { width, height, pixelKm } = grid;
  const accumulation = flowAccumulation(landHeights, mask, width, height);
  const cellArea = pixelKm * pixelKm;
  const strength = new Float32Array(width * height);
  const logMin = Math.log(RIVER_MIN_AREA_KM2);
  const logMajor = Math.log(RIVER_MIN_AREA_KM2 * 12);
  for (let i = 0; i < strength.length; i++) {
    if (!mask[i]) continue;
    const area = accumulation[i] * cellArea;
    if (area < RIVER_MIN_AREA_KM2) continue;
    strength[i] = 0.55 + 0.45 * smoothstep(logMin, logMajor, Math.log(area));
  }
  // Widen major rivers by one pixel, then soften the edges.
  const widened = Float32Array.from(strength);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const v = strength[y * width + x];
      if (v < 0.9) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = (y + dy) * width + x + dx;
        widened[n] = Math.max(widened[n], v * 0.8);
      }
    }
  }
  const soft = boxBlur(widened, width, height, 1, 1);
  const rivers = new Float32Array(width * height);
  for (let i = 0; i < rivers.length; i++) rivers[i] = mask[i] ? clamp01(Math.max(widened[i] * 0.85, soft[i] * 1.4)) : 0;
  return { rivers, accumulation };
}

function climateWetness(x, z, elevation) {
  const centre = projectLonLat(CLIMATE_ZONES.wetCentre.lon, CLIMATE_ZONES.wetCentre.lat);
  // Noise bends the zone boundary so it does not read as a perfect circle.
  const wobble = (fbm(x / 40 + 11.3, z / 40 - 4.1, 3) - 0.5) * 50;
  const distance = Math.hypot(x - centre.x, z - centre.z) + wobble;
  const lowlandWet = 1 - smoothstep(CLIMATE_ZONES.wetRadiusKm, CLIMATE_ZONES.dryRadiusKm, distance);
  const highlandWet = smoothstep(500, 1300, elevation) * 0.75;
  return clamp01(Math.max(lowlandWet, highlandWet));
}

function bakeAlbedo(grid, landHeights, mask, coastDistanceKm, rivers) {
  const { width, height, pixelKm } = grid;
  const rgb = Buffer.alloc(width * height * 3);
  // Local "openness": valleys sit below their blurred surroundings → darker.
  const blurred = boxBlur(landHeights, width, height, 8, 2);
  const at = (x, y) => landHeights[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  const B = ELEVATION_BANDS;
  const P = PALETTE;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) {
        // Outside the island: sand colour avoids dark fringes in mip-maps.
        rgb.set(P.sand, i * 3);
        continue;
      }
      const [wx, wz] = grid.centre(x, y);
      const elevation = landHeights[i];
      const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * pixelKm * 1000);
      const dz = (at(x, y + 1) - at(x, y - 1)) / (2 * pixelKm * 1000);
      const slope = Math.hypot(dx, dz); // true slope, m/m
      const wet = climateWetness(wx, wz, elevation);
      const broadNoise = fbm(wx / 9, wz / 9, 4);
      const fineNoise = fbm(wx / 1.6 + 50, wz / 1.6 - 20, 3);

      let c = mix(P.lowlandDry, P.lowlandWet, wet);
      c = mix(c, P.scrubDry, (1 - wet) * smoothstep(0.35, 0.75, broadNoise) * 0.7);
      c = mix(c, P.hills, smoothstep(B.lowlandTop * 0.5, B.hillsTop, elevation) * (0.55 + 0.45 * wet));
      c = mix(c, P.forest, smoothstep(B.hillsTop * 0.7, B.forestTop * 0.85, elevation) * (0.6 + 0.4 * wet));
      c = mix(c, P.montane, smoothstep(B.forestTop, B.montaneTop, elevation));
      c = mix(c, P.patana, smoothstep(B.montaneTop - 120, B.montaneTop + 220, elevation) * (0.55 + 0.45 * fineNoise));
      c = mix(c, P.rock, smoothstep(0.3, 0.75, slope) * 0.75);

      const beach = (1 - smoothstep(0.12, 0.6, coastDistanceKm[i])) * (1 - smoothstep(B.beachMax * 0.5, B.beachMax * 1.6, elevation));
      c = mix(c, mix(P.wetSand, P.sand, smoothstep(0.05, 0.3, coastDistanceKm[i])), beach);
      c = mix(c, P.river, rivers[i] * 0.85);

      const ambientOcclusion = Math.min(1.06, Math.max(0.74, 1 + (elevation - blurred[i]) / 650));
      const tone = (0.93 + 0.14 * fineNoise) * ambientOcclusion;
      rgb[i * 3] = Math.min(255, Math.round(c[0] * tone));
      rgb[i * 3 + 1] = Math.min(255, Math.round(c[1] * tone));
      rgb[i * 3 + 2] = Math.min(255, Math.round(c[2] * tone));
    }
  }
  return rgb;
}

const OCEAN_RAMP = [
  [0, '#4c8f96'],
  [8, '#3a7d90'],
  [30, '#2c688a'],
  [80, '#235783'],
  [300, '#1b4776'],
  [1200, '#153b68'],
  [3500, '#0f3159'],
].map(([depth, hex]) => [depth, hexToRgb(hex)]);

function oceanColour(depth) {
  for (let k = 1; k < OCEAN_RAMP.length; k++) {
    if (depth <= OCEAN_RAMP[k][0]) {
      const [d0, c0] = OCEAN_RAMP[k - 1];
      const [d1, c1] = OCEAN_RAMP[k];
      // Interpolate in log-depth so the narrow continental shelf stays visible.
      const t = (Math.log1p(depth) - Math.log1p(d0)) / (Math.log1p(d1) - Math.log1p(d0));
      return mix(c0, c1, clamp01(t));
    }
  }
  return OCEAN_RAMP[OCEAN_RAMP.length - 1][1];
}

/**
 * The Terrarium bathymetry contains a few isolated spikes in open sea that would
 * read as phantom islands. Foreign-land patches smaller than the threshold are
 * turned back into sea and their depth (plus a small margin) is filled by
 * diffusing the surrounding valid depths inwards.
 */
const MIN_FOREIGN_LAND_PIXELS = 300;

function removeDemArtifacts(land, depth, width, height) {
  const label = new Int32Array(land.length).fill(-1);
  const invalid = new Uint8Array(land.length);
  const stack = [];
  for (let start = 0; start < land.length; start++) {
    if (land[start] !== 2 || label[start] >= 0) continue;
    const members = [];
    stack.push(start);
    label[start] = start;
    while (stack.length) {
      const i = stack.pop();
      members.push(i);
      const x = i % width;
      const y = (i / width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (land[n] === 2 && label[n] < 0) {
          label[n] = start;
          stack.push(n);
        }
      }
    }
    if (members.length >= MIN_FOREIGN_LAND_PIXELS) continue;
    for (const i of members) {
      land[i] = 0;
      const x = i % width;
      const y = (i / width) | 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && land[ny * width + nx] === 0) invalid[ny * width + nx] = 1;
        }
      }
    }
  }
  // Diffusion fill of invalid depths from valid neighbours.
  for (let pass = 0; pass < 40; pass++) {
    let remaining = 0;
    for (let i = 0; i < invalid.length; i++) {
      if (!invalid[i]) continue;
      const x = i % width;
      const y = (i / width) | 0;
      let sum = 0;
      let count = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (!invalid[n] && land[n] === 0) {
          sum += depth[n];
          count++;
        }
      }
      if (count) {
        depth[i] = sum / count;
        invalid[i] = 0;
      } else remaining++;
    }
    if (!remaining) break;
  }
}

function bakeOcean(sampleOcean, islandGrid, islandMask) {
  const west = projectLonLat(OCEAN_DEM.bounds.west, PROJECTION_ORIGIN.lat).x;
  const east = projectLonLat(OCEAN_DEM.bounds.east, PROJECTION_ORIGIN.lat).x;
  const north = projectLonLat(PROJECTION_ORIGIN.lon, OCEAN_DEM.bounds.north).z;
  const south = projectLonLat(PROJECTION_ORIGIN.lon, OCEAN_DEM.bounds.south).z;
  const pixelKm = (east - west) / OCEAN_TEXTURE_WIDTH;
  const grid = createGrid(west, north, east, south, Math.round((south - north) / pixelKm));
  const { width, height } = grid;

  const depth = new Float32Array(width * height);
  const land = new Uint8Array(width * height); // 0 sea, 1 Sri Lanka, 2 other land
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = py * width + px;
      const [x, z] = grid.centre(px, py);
      const { lon, lat } = unprojectXZ(x, z);
      const elevation = sampleOcean(lon, lat);
      if (sampleNearest(islandMask, islandGrid, x, z)) land[i] = 1;
      else if (elevation > FOREIGN_LAND_THRESHOLD_M) land[i] = 2;
      depth[i] = Math.max(0, -elevation);
    }
  }
  removeDemArtifacts(land, depth, width, height);
  const seaMask = new Uint8Array(land.length);
  for (let i = 0; i < land.length; i++) seaMask[i] = land[i] === 0 ? 1 : 0;
  const distanceToLand = distanceTransform(seaMask, width, height, 1);

  const sand = PALETTE.sand;
  const foreign = hexToRgb('#34433f');
  const surf = hexToRgb('#8cbfbf');
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < land.length; i++) {
    let c;
    if (land[i] === 1) c = sand;
    else if (land[i] === 2) {
      const [x, z] = grid.centre(i % width, (i / width) | 0);
      c = mix(foreign, hexToRgb('#3d4b43'), fbm(x / 12, z / 12, 3));
    } else {
      c = oceanColour(depth[i]);
      const shoreKm = distanceToLand[i] * pixelKm;
      c = mix(c, surf, (1 - smoothstep(0.3, 2.0, shoreKm)) * 0.25);
    }
    rgb.set(c.map(Math.round), i * 3);
  }
  return { rgb, grid };
}

/* ------------------------------------------------------------------ */
/* Outputs                                                              */
/* ------------------------------------------------------------------ */

function writeBoundaryGeoJSON(coast, target) {
  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        name: 'Sri Lanka',
        source: BOUNDARY_SOURCE.attribution,
        license: 'ODbL-1.0',
        processing: `Islands < ${MIN_ISLAND_AREA_KM2} km² removed; Douglas–Peucker ${COAST_TOLERANCE_KM} km; 5 decimal places`,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: coast.map((ring) => [[...ring.lonLat, ring.lonLat[0]]]),
      },
    }],
  };
  writeFileSync(target, JSON.stringify(geojson));
}

function writeOutlineModule(coast, target) {
  const rings = coast.filter((ring) => ring.areaKm2 > 20).map((ring) => simplifyRing(ring.xz, OUTLINE_TOLERANCE_KM));
  const all = rings.flat();
  const minX = Math.min(...all.map((p) => p[0]));
  const minZ = Math.min(...all.map((p) => p[1]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const maxZ = Math.max(...all.map((p) => p[1]));
  const paths = rings.map((ring) =>
    'M' + ring.map(([x, z]) => `${(x - minX).toFixed(1)} ${(z - minZ).toFixed(1)}`).join('L') + 'Z',
  );
  const source = `/**
 * Generated by scripts/geo/build-terrain.mjs — do not edit by hand.
 * Simplified Sri Lanka coastline (km in the scene projection) for the
 * loading screen and decorative UI. Source: ${BOUNDARY_SOURCE.attribution}.
 */
export const ISLAND_OUTLINE = {
  /** Scene-projection position (km) of the SVG origin. */
  origin: { minX: ${minX.toFixed(3)}, minZ: ${minZ.toFixed(3)} },
  viewBox: '0 0 ${(maxX - minX).toFixed(1)} ${(maxZ - minZ).toFixed(1)}',
  paths: ${JSON.stringify(paths, null, 2)},
};
`;
  writeFileSync(target, source);
}

async function writeImage(rgb, width, height, target, options) {
  await sharp(rgb, { raw: { width, height, channels: 3 } }).webp(options).toFile(target);
}

async function main() {
  const started = Date.now();
  mkdirSync(OUTPUT_TERRAIN_DIR, { recursive: true });

  console.log('[geo:build] Coastline…');
  const coast = loadCoastline();
  console.log(`  ${coast.length} rings kept, main ring ${coast[0].sourceVertices} → ${coast[0].xz.length} vertices, area ${Math.round(coast.reduce((s, r) => s + r.areaKm2, 0))} km²`);

  const allPoints = coast.flatMap((ring) => ring.xz);
  const minX = Math.min(...allPoints.map((p) => p[0])) - BAKE_PADDING_KM;
  const maxX = Math.max(...allPoints.map((p) => p[0])) + BAKE_PADDING_KM;
  const minZ = Math.min(...allPoints.map((p) => p[1])) - BAKE_PADDING_KM;
  const maxZ = Math.max(...allPoints.map((p) => p[1])) + BAKE_PADDING_KM;
  const grid = createGrid(minX, minZ, maxX, maxZ, BAKE_HEIGHT_PX);
  console.log(`  bake raster ${grid.width}×${grid.height} @ ${(grid.pixelKm * 1000).toFixed(0)} m/px`);

  console.log('[geo:build] Elevation (SRTM via Terrarium)…');
  const sampleLand = createDemSampler(RAW_DIR, LAND_DEM.bounds, LAND_DEM.zoom);
  const rawHeights = bakeElevation(grid, sampleLand);
  const mask = rasterizeRings(coast.map((ring) => ring.xz), grid);
  const coastDistancePx = distanceTransform(mask, grid.width, grid.height, 1);
  const coastDistanceKm = coastDistancePx.map((d) => d * grid.pixelKm);
  // A light Gaussian-like smoothing (two 3×3 box passes, ≈ 300 m) removes SRTM
  // speckle that would otherwise read as spikes once heights are exaggerated.
  const landHeights = landOnly(boxBlur(rawHeights, grid.width, grid.height, 1, 2), mask);
  let maxElevation = 0;
  let maxAt = 0;
  landHeights.forEach((h, i) => { if (h > maxElevation) { maxElevation = h; maxAt = i; } });
  const peak = unprojectXZ(...grid.centre(maxAt % grid.width, (maxAt / grid.width) | 0));
  console.log(`  highest raster cell ${maxElevation.toFixed(0)} m at ${peak.lat.toFixed(3)}N ${peak.lon.toFixed(3)}E`);

  console.log('[geo:build] Mesh (constrained Delaunay)…');
  const mesh = buildMesh(coast, grid, landHeights, coastDistanceKm);
  const meshBounds = { minX: grid.minX, minZ: grid.minZ, maxX: grid.maxX, maxZ: grid.maxZ };
  const meshInfo = writeMeshBinary(mesh, meshBounds, resolve(OUTPUT_TERRAIN_DIR, 'terrain-mesh.bin'));
  console.log(`  ${meshInfo.vertexCount} vertices, ${meshInfo.indexCount / 3} triangles, ${(meshInfo.byteLength / 1024).toFixed(0)} KB`);

  console.log('[geo:build] Normal map…');
  const normalRgb = bakeNormalMap(grid, landHeights, mask);
  await writeImage(normalRgb, grid.width, grid.height, resolve(OUTPUT_TERRAIN_DIR, 'terrain-normal.webp'), { quality: 92, smartSubsample: true });

  console.log('[geo:build] Rivers (flow accumulation) + albedo…');
  const { rivers } = bakeRivers(grid, landHeights, mask);
  const albedoRgb = bakeAlbedo(grid, landHeights, mask, coastDistanceKm, rivers);
  await writeImage(albedoRgb, grid.width, grid.height, resolve(OUTPUT_TERRAIN_DIR, 'terrain-albedo.webp'), { quality: 86 });

  console.log('[geo:build] Ocean bathymetry…');
  const sampleOcean = createDemSampler(RAW_DIR, OCEAN_DEM.bounds, OCEAN_DEM.zoom);
  const ocean = bakeOcean(sampleOcean, grid, mask);
  await writeImage(ocean.rgb, ocean.grid.width, ocean.grid.height, resolve(OUTPUT_TERRAIN_DIR, 'ocean.webp'), { quality: 88 });

  writeBoundaryGeoJSON(coast, resolve(OUTPUT_GEO_DIR, 'sri-lanka-boundary.geojson'));
  writeOutlineModule(coast, resolve(ROOT, 'src/data/island-outline.js'));

  const metadata = {
    version: 1,
    generatedAt: new Date().toISOString(),
    units: 'Horizontal positions in km (scene units); heights in metres.',
    projection: { type: 'local-equirectangular', origin: PROJECTION_ORIGIN, module: 'src/geography/projection.js' },
    bakeExaggeration: BAKE_EXAGGERATION,
    maxElevationM: Math.round(maxElevation),
    mesh: { file: 'terrain-mesh.bin', bounds: meshBounds, ...meshInfo, positionEncoding: 'uint16 normalised over bounds', heightEncoding: 'uint16 metres' },
    textures: {
      bounds: meshBounds,
      width: grid.width,
      height: grid.height,
      metresPerPixel: Math.round(grid.pixelKm * 1000),
      albedo: 'terrain-albedo.webp',
      normal: 'terrain-normal.webp',
      normalSpace: 'object (x east, y up, z south)',
    },
    ocean: {
      texture: 'ocean.webp',
      bounds: { minX: ocean.grid.minX, minZ: ocean.grid.minZ, maxX: ocean.grid.maxX, maxZ: ocean.grid.maxZ },
    },
    sources: [
      { role: 'coastline', name: 'geoBoundaries gbOpen LKA ADM0', url: BOUNDARY_SOURCE.url, attribution: BOUNDARY_SOURCE.attribution, license: 'ODbL-1.0' },
      { role: 'elevation + bathymetry', name: 'AWS Terrain Tiles (Terrarium)', url: DEM_SOURCE.urlTemplate, attribution: DEM_SOURCE.attribution, landZoom: LAND_DEM.zoom, oceanZoom: OCEAN_DEM.zoom },
    ],
    notes: [
      'Colours are art-directed from elevation, slope, coastal distance and an approximate wet/dry climate zoning; they are not land-cover data.',
      `Rivers are derived from the DEM by flow accumulation (upstream area ≥ ${RIVER_MIN_AREA_KM2} km²).`,
    ],
  };
  writeFileSync(resolve(OUTPUT_TERRAIN_DIR, 'terrain.json'), JSON.stringify(metadata, null, 2));
  console.log(`[geo:build] Done in ${((Date.now() - started) / 1000).toFixed(1)} s → ${OUTPUT_TERRAIN_DIR}`);
}

main().catch((error) => {
  console.error('[geo:build] Failed:', error);
  process.exitCode = 1;
});
