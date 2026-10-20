/**
 * Development aid: renders a flat preview of the baked terrain (albedo lit by
 * the normal map) with the destination coordinates overlaid, so the coastline,
 * orientation and marker positions can be checked against a reference map.
 *
 *   node scripts/geo/preview-terrain.mjs <output.png>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { projectLonLat } from '../../src/geography/projection.js';
import { DESTINATIONS } from '../../src/data/destinations.js';
import { OUTPUT_TERRAIN_DIR } from './geo-config.mjs';

const output = process.argv[2] ?? 'terrain-preview.png';
const meta = JSON.parse(readFileSync(resolve(OUTPUT_TERRAIN_DIR, 'terrain.json'), 'utf8'));
const { width, height, bounds } = meta.textures;

const albedo = await sharp(resolve(OUTPUT_TERRAIN_DIR, meta.textures.albedo)).raw().toBuffer();
const normal = await sharp(resolve(OUTPUT_TERRAIN_DIR, meta.textures.normal)).raw().toBuffer();
const light = [-0.5, 0.75, -0.45];
const lightLength = Math.hypot(...light);
const out = Buffer.alloc(width * height * 3);
for (let i = 0; i < width * height; i++) {
  const n = [0, 1, 2].map((k) => normal[i * 3 + k] / 127.5 - 1);
  const shade = 0.35 + 0.75 * Math.max(0, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / lightLength);
  for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.min(255, albedo[i * 3 + k] * shade);
}

const markers = DESTINATIONS.map((d) => {
  const { x, z } = projectLonLat(d.longitude, d.latitude);
  const px = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width;
  const py = ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * height;
  return `<circle cx="${px}" cy="${py}" r="14" fill="#c9a24a" stroke="#111" stroke-width="4"/>
    <text x="${px + 22}" y="${py + 12}" font-size="44" font-family="sans-serif" fill="#111" stroke="#fff" stroke-width="6" paint-order="stroke">${d.name}</text>`;
}).join('');
const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${markers}</svg>`);

const composited = await sharp(out, { raw: { width, height, channels: 3 } })
  .composite([{ input: overlay }])
  .png()
  .toBuffer();
await sharp(composited)
  .resize({ height: 1400 })
  .png()
  .toFile(output);
console.log('Preview written to', output);
