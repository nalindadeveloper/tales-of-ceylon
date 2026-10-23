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
  skyZenith: '#5f86ad',
  skyHorizon: '#c9dbe8',
  foamColor: '#f2f5f2',
  /** Base specular roughness of the water surface (GGX alpha). */
  roughness: 0.06,
  /** 0 disables the surf along the coast, 1 is the default intensity. */
  surfStrength: 1,
  waves: {
    /** Compass direction the wind blows FROM (225 = south-west monsoon). */
    windDirection: 225,
    /** Wavelengths in km. Stylised: real swells are ~100 m, invisible from this altitude. */
    wavelengthsKm: [3.4, 2.2, 1.45, 0.95, 0.62, 0.41, 0.27, 0.18],
    /** Directional spread of the shortest waves around the wind, in degrees. */
    spreadDegrees: 70,
    /** Total slope amplitude shared by all waves (higher = rougher sea). */
    steepness: 0.42,
    /** Multiplies real deep-water wave speeds so motion reads from altitude. */
    timeScale: 2.6,
  },
  /**
   * GPU FFT simulation (Tessendorf). Falls back to the analytic `waves` above
   * when the GPU cannot render to float textures or `enabled` is false.
   */
  fft: {
    enabled: true,
    /** Grid size per cascade (power of two); low-quality devices use half. */
    resolution: 128,
    /** Tiling patch sizes in km, largest first; each owns one wavelength band. */
    cascadeSizesKm: [12, 3.5, 1],
    /** Wavelength (km) where the wind-sea spectrum peaks. */
    peakWavelengthKm: 3,
    /** RMS slope of the whole sea: higher is rougher. */
    rmsSlope: 0.22,
    /** Overall foam intensity (0 disables crest foam). */
    foamStrength: 0.5,
    /** Foam contribution of each cascade (large waves break visibly, ripples don't). */
    foamWeights: [1, 0.35, 0],
    foam: {
      /** Choppy-wave strength used for the Jacobian (crest folding). */
      choppiness: 1.6,
      /** Jacobian below this value counts as a breaking crest. */
      threshold: 0.45,
      /** Fraction of foam that survives one second. */
      decayPerSecond: 0.35,
    },
  },
};

/** Instanced 3D forest (src/three/vegetation.js). Distances in km. */
export const VEGETATION_CONFIG = {
  /** Trees appear only when the camera is closer than this to its target. */
  showBelowDistanceKm: 175,
  /** Planting radius around the focus = camera distance × this, capped. */
  radiusPerDistance: 0.55,
  maxRadiusKm: 40,
  chunkSizeKm: 10,
  chunksPerFrame: 2,
  maxCachedChunks: 140,
  /** Frame-time target for the density governor (s) and the lowest share of trees it may keep. */
  targetFrameSeconds: 1 / 40,
  minBudget: 0.3,
  /** Jittered grid spacing between candidate trees (larger on low tier). */
  spacingKm: 0.42,
  /** Crown diameter per tree type (stylised map scale). */
  crownKm: { broadleafA: 0.56, broadleafB: 0.5, montane: 0.36, palm: 0.4 },
  heightScale: 0.85,
  /** Trees above this true elevation (km) are often montane conifer-like crowns. */
  montaneAboveKm: 1.3,
  sinkKm: 0.05,
  /** Depth chunks rise from when they appear. */
  growKm: 0.7,
  colors: {
    broadleaf: ['#2d5729', '#38662f', '#467634', '#294c27', '#527d38', '#3f6a2c'],
    montane: ['#2a4630', '#33553a', '#3c5f3c'],
    palm: ['#6a8e3c', '#5b8034', '#78993f'],
  },
};

/** Bird flocks over the forest (src/three/birds.js). Distances in km. */
export const BIRD_CONFIG = {
  /** Birds appear only when the camera is closer than this to its target. */
  showBelowDistanceKm: 175,
  flocks: 6,
  minFlockSize: 5,
  maxFlockSize: 11,
  /** Stylised wingspan so birds read from the camera height. */
  wingspanKm: 0.85,
  spacingKm: 1.0,
  /** Range of the looping flight paths around the destination. */
  pathRadiusKm: [5, 16],
  speedKmPerSecond: 0.6,
  /** Height above the terrain: well above the canopy, so shadows fall visibly offset. */
  clearanceKm: [5, 9],
  flapSpeed: 7,
  /** Share of flocks that are white egrets (the rest are dark silhouettes). */
  whiteShare: 0.65,
  whiteColor: '#f3f1ea',
  darkColor: '#4a3e31',
  /** Flocks fade out and regroup when the focus moves further than this. */
  regroupDistanceKm: 25,
};

/** Drifting cloud layer and cloud shadows (src/three/clouds.js). */
export const CLOUD_CONFIG = {
  /** Altitude of the cloud layer (km) — above the exaggerated peaks. */
  heightKm: 16,
  /** Size of the largest cloud features (km). */
  scaleKm: 38,
  /** 0 clear sky … 1 overcast. */
  coverage: 0.42,
  windKmPerSecond: [0.32, -0.14],
  opacity: 0.9,
  shadowStrength: 0.55,
  litColor: '#ffffff',
  shadeColor: '#a3b4c4',
  layerSizeKm: 2400,
  /** Radius kept clear around the focus, as a fraction of camera distance. */
  focusClearing: 0.34,
  /** Upper limit of that clear radius, so wide views still have clouds over land. */
  maxClearingKm: 70,
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
