/**
 * Tunable scene parameters. Units: kilometres (1 scene unit = 1 km) and
 * degrees for angles. Destination-specific values live in destinations.js.
 */
import { BAKE_EXAGGERATION } from '../terrain/terrain-palette.js';

export const TERRAIN_CONFIG = {
  /** Base path of the preprocessed terrain assets (see scripts/geo). */
  basePath: '/assets/geo/sri-lanka-elevation/',
  boundaryUrl: '/assets/geo/sri-lanka-boundary.geojson',
  /**
   * Colour texture draped over the terrain (file in basePath). terrain-map.webp
   * is generated from an island image by `npm run geo:map-texture`; set this to
   * 'terrain-albedo.webp' for the procedural, elevation-painted colours.
   * Falls back to terrain-albedo.webp if the file cannot be loaded.
   */
  surfaceTexture: 'terrain-map.webp',
  /**
   * Draws DEM-derived rivers as glossy water. Off for photographic textures,
   * which already show the real rivers and reservoirs.
   */
  riverOverlay: false,
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
  /**
   * The bathymetry texture fades into deepColor along an ellipse inscribed in
   * its bounds: from this fraction of the radius to this one (1 = the edge).
   */
  edgeFade: [0.68, 0.97],
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

/** Full-screen cloud fly-through during the intro zoom only (src/three/cloud-veil.js). */
export const CLOUD_VEIL_CONFIG = {
  /** Window of the hero → overview scroll in which the camera passes through cloud. */
  introStart: 0.12,
  introEnd: 0.82,
  litColor: '#f7f8f6',
  shadeColor: '#aebccb',
};

/** Drifting cloud layer and cloud shadows (src/three/clouds.js). */
export const CLOUD_CONFIG = {
  /** Altitude of the cloud layer (km) — above the exaggerated peaks. */
  heightKm: 16,
  /** Size of the largest cloud features (km). */
  scaleKm: 38,
  /** 0 clear sky … 1 overcast. */
  coverage: 0.3,
  windKmPerSecond: [0.32, -0.14],
  /** Drift is scaled by cameraDistance / driftReferenceKm (capped) so clouds glide visibly from afar. */
  driftReferenceKm: 100,
  maxDriftScale: 11,
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
  /**
   * Depth precision: the near plane follows the camera distance (×nearRatio)
   * and the far plane (×farRatio). With a fixed 0.5 km near plane, the
   * 1,000 km hero view could only separate surfaces ~0.2 km apart, so the
   * low coast z-fought with the sea and flickered. The nearest geometry is
   * always more than half the camera distance away, so 0.1 is safe.
   */
  nearRatio: 0.1,
  farRatio: 9,
  /** Island overview: whole country, gently tilted. */
  overview: { tilt: 34, azimuth: 0, fill: 0.7 },
  /** Hero: smaller, floating model with a slow idle rotation. */
  hero: { tilt: 28, azimuth: -22, fill: 0.48, idleYawDegrees: 9, idlePeriodSeconds: 48 },
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
