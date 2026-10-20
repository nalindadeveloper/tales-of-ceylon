/**
 * Configuration shared by the geodata fetch and terrain build scripts.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = resolve(ROOT, '.geo-cache');
export const OUTPUT_GEO_DIR = resolve(ROOT, 'public/assets/geo');
export const OUTPUT_TERRAIN_DIR = resolve(OUTPUT_GEO_DIR, 'sri-lanka-elevation');

/**
 * geoBoundaries gbOpen ADM0 for Sri Lanka (derived from OpenStreetMap).
 * License: Open Data Commons Open Database License (ODbL) 1.0.
 * Pinned to a commit hash so builds are reproducible.
 */
export const BOUNDARY_SOURCE = {
  url: 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/LKA/ADM0/geoBoundaries-LKA-ADM0.geojson',
  file: 'geoBoundaries-LKA-ADM0.geojson',
  attribution: 'geoBoundaries (Runfola et al. 2020), data © OpenStreetMap contributors, ODbL 1.0',
};

/**
 * AWS Open Data "Terrain Tiles" in Terrarium encoding.
 * Around Sri Lanka these are derived from SRTM (land, public domain) and
 * ETOPO1 / GMTED2010 (bathymetry and fill). Elevation in metres is decoded as
 * (R × 256 + G + B / 256) − 32768.
 */
export const DEM_SOURCE = {
  urlTemplate: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  attribution: 'Terrain Tiles (AWS Open Data / Mapzen): SRTM (NASA, public domain), ETOPO1 (NOAA), GMTED2010 (USGS)',
};

/** Land elevation: zoom 10 ≈ 150 m per pixel at Sri Lanka's latitude. */
export const LAND_DEM = {
  zoom: 10,
  bounds: { west: 79.45, east: 81.98, south: 5.85, north: 9.9 },
};

/** Ocean bathymetry for the sea surface colouring: zoom 8 ≈ 600 m per pixel. */
export const OCEAN_DEM = {
  zoom: 8,
  bounds: { west: 77.4, east: 84.0, south: 4.2, north: 11.4 },
};
