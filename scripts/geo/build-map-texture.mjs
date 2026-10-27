/**
 * Turns an island image (satellite photo, painted map…) into the terrain's
 * surface texture, aligned with the real coastline.
 *
 *   npm run geo:map-texture                                  (default source)
 *   npm run geo:map-texture -- path/to/image.png [height]    (another image)
 *
 * Input: any image of Sri Lanka whose surroundings are TRANSPARENT (only the
 * land is opaque), north up. It does not need georeferencing.
 *
 * 1. Registration. The image's opaque area is compared with the coastline
 *    polygon (public/assets/geo/sri-lanka-boundary.geojson). Two common
 *    layouts are tried — plain longitude/latitude (equirectangular) and Web
 *    Mercator — and the four image edges (west, east, south, north) are tuned
 *    by coordinate descent to maximise the overlap (IoU). The best fit wins.
 * 2. Resampling. Every texel of the terrain texture grid (the same projected
 *    bounds and orientation as terrain-albedo.webp) is mapped back to
 *    lon/lat and then to the image, and sampled bilinearly from a
 *    pre-filtered copy of the source.
 * 3. Edge padding. Texels the image leaves transparent (tiny misalignments
 *    along the coast, islets missing from the image) are filled from the
 *    nearest opaque colour, so no seams appear at the shoreline.
 *
 * Output: public/assets/geo/sri-lanka-elevation/terrain-map.webp and a
 * `textures.map` record (source, fit, quality) in terrain.json.
 *
 * Keep large source images out of /public (they would be published and are
 * too big for git); the default source lives in source-assets/ (git-ignored).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import sharp from 'sharp';
import { projectLonLat, unprojectXZ } from '../../src/geography/projection.js';
import { OUTPUT_GEO_DIR, OUTPUT_TERRAIN_DIR, ROOT } from './geo-config.mjs';
import { rasterizeRings } from './raster-utils.mjs';

const DEFAULT_SOURCE = resolve(ROOT, 'source-assets/textures/map2.png');
const OUTPUT_FILE = 'terrain-map.webp';
const DEFAULT_HEIGHT = 4096;
/** Grid used to measure overlap during registration (lon/lat cells). */
const FIT_GRID = { width: 360, height: 600 };
/** Resolution of the image copy used for registration. */
const FIT_IMAGE_HEIGHT = 1600;

sharp.cache(false);

const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const inverseMercator = (y) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;
const PROJECTIONS = {
  equirectangular: { forward: (lat) => lat, inverse: (y) => y },
  'web-mercator': { forward: mercatorY, inverse: inverseMercator },
};

function loadCoastlineLonLat() {
  const geojson = JSON.parse(readFileSync(resolve(OUTPUT_GEO_DIR, 'sri-lanka-boundary.geojson'), 'utf8'));
  return geojson.features[0].geometry.coordinates.map((polygon) => polygon[0].slice(0, -1));
}

function ringsBounds(rings) {
  const all = rings.flat();
  return {
    west: Math.min(...all.map((p) => p[0])),
    east: Math.max(...all.map((p) => p[0])),
    south: Math.min(...all.map((p) => p[1])),
    north: Math.max(...all.map((p) => p[1])),
  };
}

/** Alpha mask of the image at registration resolution, plus its opaque bbox. */
async function loadAlphaMask(input) {
  const { data, info } = await sharp(input, { limitInputPixels: false })
    .resize({ height: FIT_IMAGE_HEIGHT, kernel: 'linear' })
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer({ resolveWithObject: true });
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let v = 0; v < info.height; v++) {
    for (let u = 0; u < info.width; u++) {
      if (data[v * info.width + u] < 128) continue;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
  }
  if (!Number.isFinite(u0)) throw new Error('The image has no opaque pixels — the land must be opaque and the sea transparent.');
  return { alpha: data, width: info.width, height: info.height, bbox: { u0, u1: u1 + 1, v0, v1: v1 + 1 } };
}

/**
 * Fits the image edges (lon/lat of its left/right/bottom/top) for one
 * projection by maximising the IoU between the image's opaque area and the
 * coastline polygon on a lon/lat grid.
 */
function fitProjection(name, mask, rings, coast) {
  const projection = PROJECTIONS[name];
  const margin = 0.15;
  const grid = { west: coast.west - margin, east: coast.east + margin, south: coast.south - margin, north: coast.north + margin };
  const { width: gw, height: gh } = FIT_GRID;
  const cellLon = (grid.east - grid.west) / gw;
  const cellLat = (grid.north - grid.south) / gh;
  const land = rasterizeRings(rings, {
    width: gw,
    height: gh,
    toPixel: (lon, lat) => [(lon - grid.west) / cellLon, (grid.north - lat) / cellLat],
  });
  const lons = Float64Array.from({ length: gw }, (_, i) => grid.west + (i + 0.5) * cellLon);
  const ys = Float64Array.from({ length: gh }, (_, j) => projection.forward(grid.north - (j + 0.5) * cellLat));

  const iou = ([west, east, south, north]) => {
    const yTop = projection.forward(north);
    const yBottom = projection.forward(south);
    let intersection = 0;
    let union = 0;
    for (let j = 0; j < gh; j++) {
      const v = Math.floor(((yTop - ys[j]) / (yTop - yBottom)) * mask.height);
      for (let i = 0; i < gw; i++) {
        const u = Math.floor(((lons[i] - west) / (east - west)) * mask.width);
        const inImage = u >= 0 && v >= 0 && u < mask.width && v < mask.height && mask.alpha[v * mask.width + u] >= 128;
        const inLand = land[j * gw + i] === 1;
        if (inImage && inLand) intersection++;
        if (inImage || inLand) union++;
      }
    }
    return union ? intersection / union : 0;
  };

  // Initial guess: the image's opaque bbox spans the coastline's bbox.
  const { u0, u1, v0, v1 } = mask.bbox;
  const lonPerPx = (coast.east - coast.west) / (u1 - u0);
  const yNorth = projection.forward(coast.north);
  const ySouth = projection.forward(coast.south);
  const yPerPx = (yNorth - ySouth) / (v1 - v0);
  let params = [
    coast.west - u0 * lonPerPx,
    coast.east + (mask.width - u1) * lonPerPx,
    projection.inverse(ySouth - (mask.height - v1) * yPerPx),
    projection.inverse(yNorth + v0 * yPerPx),
  ];
  let best = iou(params);

  // Coordinate descent on the four edges with a shrinking step (degrees).
  for (let step = 0.04; step > 0.0004; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let k = 0; k < 4; k++) {
        for (const direction of [-1, 1]) {
          const candidate = params.slice();
          candidate[k] += direction * step;
          const score = iou(candidate);
          if (score > best + 1e-6) {
            best = score;
            params = candidate;
            improved = true;
          }
        }
      }
    }
  }
  const [west, east, south, north] = params;
  return { projection: name, edges: { west, east, south, north }, iou: best };
}

/** Fills transparent texels from opaque neighbours (repeated dilation). */
function padEdges(rgba, width, height, passes) {
  let current = rgba;
  for (let pass = 0; pass < passes; pass++) {
    const next = Buffer.from(current);
    let filled = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (current[i + 3] >= 128) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const j = (ny * width + nx) * 4;
            if (current[j + 3] < 128) continue;
            r += current[j]; g += current[j + 1]; b += current[j + 2]; n++;
          }
        }
        if (n) {
          next[i] = r / n; next[i + 1] = g / n; next[i + 2] = b / n; next[i + 3] = 255;
          filled++;
        }
      }
    }
    current = next;
    if (!filled) break;
  }
  return current;
}

async function main() {
  const input = resolve(process.argv[2] ?? DEFAULT_SOURCE);
  const outputHeight = Number(process.argv[3] ?? DEFAULT_HEIGHT);
  if (!existsSync(input)) throw new Error(`Source image not found: ${input}`);
  const started = Date.now();

  // ---- 1. Registration ------------------------------------------------------
  const rings = loadCoastlineLonLat();
  const coast = ringsBounds(rings);
  const mask = await loadAlphaMask(input);
  const fits = Object.keys(PROJECTIONS).map((name) => fitProjection(name, mask, rings, coast));
  fits.forEach((fit) => console.log(`[map-texture] ${fit.projection}: IoU ${(fit.iou * 100).toFixed(2)}%`));
  const fit = fits.reduce((a, b) => (b.iou > a.iou ? b : a));
  console.log(`[map-texture] using ${fit.projection}`, Object.fromEntries(Object.entries(fit.edges).map(([k, v]) => [k, v.toFixed(4)])));
  if (fit.iou < 0.9) console.warn('[map-texture] Low overlap — check that the image is north-up with a transparent sea.');

  // ---- 2. Resampling onto the terrain texture grid ---------------------------
  const metaFile = resolve(OUTPUT_TERRAIN_DIR, 'terrain.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const bounds = meta.textures.bounds;
  const width = Math.round(outputHeight * ((bounds.maxX - bounds.minX) / (bounds.maxZ - bounds.minZ)));
  const height = outputHeight;

  // Pre-filter the source to ~1.5× the output density to avoid aliasing.
  const sourceHeight = Math.min(mask.height * 8, Math.round(height * 1.5));
  const { data: source, info } = await sharp(input, { limitInputPixels: false })
    .resize({ height: sourceHeight, kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const projection = PROJECTIONS[fit.projection];
  const { west, east, south, north } = fit.edges;
  const yTop = projection.forward(north);
  const yBottom = projection.forward(south);
  const pixelKmX = (bounds.maxX - bounds.minX) / width;
  const pixelKmZ = (bounds.maxZ - bounds.minZ) / height;
  const rgba = Buffer.alloc(width * height * 4);
  const sw = info.width;
  const sh = info.height;
  const at = (x, y, c) => source[(y * sw + x) * 4 + c];

  for (let py = 0; py < height; py++) {
    const z = bounds.minZ + (py + 0.5) * pixelKmZ;
    for (let px = 0; px < width; px++) {
      const x = bounds.minX + (px + 0.5) * pixelKmX;
      const { lon, lat } = unprojectXZ(x, z);
      const fu = ((lon - west) / (east - west)) * sw - 0.5;
      const fv = ((yTop - projection.forward(lat)) / (yTop - yBottom)) * sh - 0.5;
      if (fu < 0 || fv < 0 || fu >= sw - 1 || fv >= sh - 1) continue;
      const u = Math.floor(fu);
      const v = Math.floor(fv);
      const tu = fu - u;
      const tv = fv - v;
      const o = (py * width + px) * 4;
      // Bilinear, weighting colour by alpha so transparent texels don't darken edges.
      let r = 0, g = 0, b = 0, a = 0;
      for (const [dx, dy, w] of [[0, 0, (1 - tu) * (1 - tv)], [1, 0, tu * (1 - tv)], [0, 1, (1 - tu) * tv], [1, 1, tu * tv]]) {
        const alpha = (at(u + dx, v + dy, 3) / 255) * w;
        r += at(u + dx, v + dy, 0) * alpha;
        g += at(u + dx, v + dy, 1) * alpha;
        b += at(u + dx, v + dy, 2) * alpha;
        a += alpha;
      }
      if (a > 1e-4) {
        rgba[o] = r / a; rgba[o + 1] = g / a; rgba[o + 2] = b / a;
      }
      rgba[o + 3] = Math.round(a * 255);
    }
  }

  // ---- 3. Edge padding, then write an opaque texture -------------------------
  const padded = padEdges(rgba, width, height, 24);
  const target = resolve(OUTPUT_TERRAIN_DIR, OUTPUT_FILE);
  await sharp(padded, { raw: { width, height, channels: 4 } }).removeAlpha().webp({ quality: 84, effort: 5 }).toFile(target);

  meta.textures.map = {
    file: OUTPUT_FILE,
    width,
    height,
    source: basename(input),
    fit: { projection: fit.projection, edges: fit.edges, iou: Number(fit.iou.toFixed(4)) },
    note: 'Generated by scripts/geo/build-map-texture.mjs; same bounds and orientation as the albedo.',
  };
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  console.log(`[map-texture] ${width}×${height} → ${target} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((error) => {
  console.error('[map-texture] Failed:', error.message ?? error);
  process.exitCode = 1;
});
