/**
 * Tunable scene parameters. Units: kilometres (1 scene unit = 1 km) and
 * degrees for angles. Destination-specific values live in destinations.js.
 */
import { BAKE_EXAGGERATION } from '../terrain/terrain-palette.js';

export const TERRAIN_CONFIG = {
  /** Base path of the preprocessed terrain assets (see scripts/geo). */
  basePath: '/assets/geo/sri-lanka-elevation/',
  boundaryUrl: '/assets/geo/sri-lanka-boundary.geojson',
  /** Vertical exaggeration applied to real elevations (documented in README). */
  elevationMultiplier: BAKE_EXAGGERATION,
  /** The land surface sits this far above sea level so the island reads as a landmass. */
  coastLift: 0.2,
  /** How far the coastline wall extends below sea level (hidden by the ocean). */
  wallDepth: 2.5,
};

export const OCEAN_CONFIG = {
  size: 6000,
  deepColor: '#0d2b4c',
  edgeFadeKm: 90,
  waveStrength: 0.12,
};

export const ATMOSPHERE_CONFIG = {
  background: '#163a59',
  fogColor: '#1d4566',
  /** Fog start / end as multiples of the camera-to-target distance. */
  fogNear: 1.15,
  fogFar: 3.6,
};

export const LIGHTING_CONFIG = {
  sunColor: '#ffe7c4',
  sunIntensity: 2.6,
  /** Sun direction: azimuth from north (clockwise) and elevation, in degrees. */
  sunAzimuth: 60,
  sunElevation: 38,
  skyColor: '#cfe3f2',
  groundColor: '#41513a',
  hemisphereIntensity: 0.95,
  shadowMapSize: 2048,
};

export const CAMERA_CONFIG = {
  fov: 32,
  near: 0.5,
  far: 8000,
  /** Island overview: whole country, gently tilted. */
  overview: { tilt: 34, azimuth: 0, fill: 0.7 },
  /** Hero: smaller, floating model with a slow idle rotation. */
  hero: { tilt: 28, azimuth: -22, fill: 0.62, idleYawDegrees: 9, idlePeriodSeconds: 48 },
  /** Seconds for a destination-to-destination flight. */
  flightDuration: 2.1,
  /** How much the camera rises (relative to its distance) mid-flight per 100 km travelled. */
  flightHopPer100Km: 0.55,
  /** Mobile viewports frame the destination a little further away. */
  mobileDistanceScale: 1.35,
};

/**
 * Screen-space framing of the focus point, as a fraction of the viewport from
 * its centre (+x right, +y up). Keeps the destination clear of the card.
 */
export const FRAMING = {
  desktop: { hero: { x: 0.2, y: -0.02 }, overview: { x: 0.16, y: 0.02 }, destination: { x: -0.16, y: 0.02 } },
  mobile: { hero: { x: 0, y: -0.2 }, overview: { x: 0, y: -0.16 }, destination: { x: 0, y: 0.04 } },
};

export const MARKER_CONFIG = {
  /** Marker size as a fraction of the camera distance (keeps screen size stable). */
  screenScale: 0.012,
  minScale: 0.35,
  maxScale: 9,
  stemHeight: 6,
  activeColor: '#d8b46a',
  idleColor: '#f4eee2',
};

export const QUALITY = {
  high: { maxPixelRatio: 2, shadows: true, antialias: true },
  low: { maxPixelRatio: 1.5, shadows: false, antialias: true },
};
