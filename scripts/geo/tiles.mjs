/**
 * Web Mercator (slippy map) tile helpers and a Terrarium DEM mosaic sampler.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

export function lonToTileX(lon, zoom) {
  return ((lon + 180) / 360) * 2 ** zoom;
}

export function latToTileY(lat, zoom) {
  const phi = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * 2 ** zoom;
}

/** Lists the integer tile coordinates covering a lon/lat bounding box. */
export function tilesForBounds(bounds, zoom) {
  const x0 = Math.floor(lonToTileX(bounds.west, zoom));
  const x1 = Math.floor(lonToTileX(bounds.east, zoom));
  const y0 = Math.floor(latToTileY(bounds.north, zoom));
  const y1 = Math.floor(latToTileY(bounds.south, zoom));
  const tiles = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) tiles.push({ x, y, z: zoom });
  }
  return { tiles, x0, x1, y0, y1 };
}

export function tileFileName({ z, x, y }) {
  return `terrarium-${z}-${x}-${y}.png`;
}

const TILE_SIZE = 256;

/**
 * Decodes Terrarium tiles into one Float32 mosaic and returns a bilinear
 * elevation sampler (metres) addressed by longitude / latitude.
 */
export function createDemSampler(tileDir, bounds, zoom) {
  const { tiles, x0, x1, y0, y1 } = tilesForBounds(bounds, zoom);
  const width = (x1 - x0 + 1) * TILE_SIZE;
  const height = (y1 - y0 + 1) * TILE_SIZE;
  const data = new Float32Array(width * height);

  for (const tile of tiles) {
    const png = PNG.sync.read(readFileSync(resolve(tileDir, tileFileName(tile))));
    const offsetX = (tile.x - x0) * TILE_SIZE;
    const offsetY = (tile.y - y0) * TILE_SIZE;
    for (let py = 0; py < TILE_SIZE; py++) {
      for (let px = 0; px < TILE_SIZE; px++) {
        const i = (py * TILE_SIZE + px) * 4;
        const metres = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
        data[(offsetY + py) * width + offsetX + px] = metres;
      }
    }
  }

  return function sampleElevation(lon, lat) {
    // Pixel centres sit at +0.5, hence the −0.5 shift before interpolation.
    const fx = (lonToTileX(lon, zoom) - x0) * TILE_SIZE - 0.5;
    const fy = (latToTileY(lat, zoom) - y0) * TILE_SIZE - 0.5;
    const ix = Math.max(0, Math.min(width - 2, Math.floor(fx)));
    const iy = Math.max(0, Math.min(height - 2, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - ix));
    const ty = Math.min(1, Math.max(0, fy - iy));
    const a = data[iy * width + ix];
    const b = data[iy * width + ix + 1];
    const c = data[(iy + 1) * width + ix];
    const d = data[(iy + 1) * width + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}
