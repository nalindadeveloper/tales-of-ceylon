/**
 * Downloads the raw geographic source data into .geo-cache/raw.
 * Already-downloaded files are skipped, so the script can be re-run safely.
 *
 *   npm run geo:fetch
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOUNDARY_SOURCE, CACHE_DIR, DEM_SOURCE, LAND_DEM, OCEAN_DEM } from './geo-config.mjs';
import { tileFileName, tilesForBounds } from './tiles.mjs';

const RAW_DIR = resolve(CACHE_DIR, 'raw');
const CONCURRENCY = 6;

async function download(url, target) {
  if (existsSync(target)) return false;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return true;
}

async function downloadAll(jobs) {
  let fetched = 0;
  const queue = [...jobs];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const job = queue.shift();
      if (await download(job.url, job.target)) fetched++;
    }
  });
  await Promise.all(workers);
  return fetched;
}

function demJobs({ bounds, zoom }) {
  return tilesForBounds(bounds, zoom).tiles.map((tile) => ({
    url: DEM_SOURCE.urlTemplate.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y),
    target: resolve(RAW_DIR, tileFileName(tile)),
  }));
}

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });

  console.log('[geo:fetch] Boundary:', BOUNDARY_SOURCE.url);
  await download(BOUNDARY_SOURCE.url, resolve(RAW_DIR, BOUNDARY_SOURCE.file));

  const jobs = [...demJobs(LAND_DEM), ...demJobs(OCEAN_DEM)];
  console.log(`[geo:fetch] Elevation tiles: ${jobs.length}`);
  const fetched = await downloadAll(jobs);
  console.log(`[geo:fetch] Done (${fetched} new files) → ${RAW_DIR}`);
}

main().catch((error) => {
  console.error('[geo:fetch] Failed:', error);
  process.exitCode = 1;
});
