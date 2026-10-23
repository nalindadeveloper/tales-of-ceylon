/**
 * Terrain colour palette and terrain configuration.
 *
 * This file is shared by the browser (materials, edge wall) and by the Node
 * bake script (scripts/geo/build-terrain.mjs), which paints the albedo texture
 * from elevation, slope, coastal distance and an approximate climatic zoning.
 *
 * After changing any "bake" value, re-run `npm run geo:build` to regenerate the
 * textures in public/assets/geo/sri-lanka-elevation/.
 */

/**
 * Default vertical exaggeration. Real relief (2,524 m at Pidurutalagala over a
 * 435 km long island) would be nearly invisible at website viewing distances,
 * so heights are multiplied by this factor. The object-space normal map is
 * baked for exactly this value; the runtime can still use a different value
 * (see TERRAIN_CONFIG.elevationMultiplier) and the lighting stays correct
 * because the normal matrix compensates for the vertical scale.
 */
export const BAKE_EXAGGERATION = 4.5;

/** sRGB colour stops (hex) used for the baked albedo texture. */
export const TERRAIN_PALETTE = Object.freeze({
  sand: '#d8c79f',
  wetSand: '#b9ab84',
  lowlandWet: '#6c9a50',
  lowlandDry: '#8e9a5e',
  scrubDry: '#7d8950',
  hills: '#4e7c3e',
  forest: '#2f5c33',
  montane: '#3b5b3a',
  patana: '#76805a', // montane grassland of Horton Plains and the high plateaux
  rock: '#7c705f',
  river: '#47727a',
  /** Runtime colour of glossy river water (terrain shader). */
  riverWater: '#1d3b42',
  edgeTop: '#bba98a',
  edgeBottom: '#6e5c45',
});

/** Elevation thresholds (metres) for the colour bands. */
export const ELEVATION_BANDS = Object.freeze({
  lowlandTop: 150,
  hillsTop: 650,
  forestTop: 1500,
  montaneTop: 2050,
  beachMax: 12,
});

/**
 * Art-directed approximation of Sri Lanka's climatic zones: the wet zone is
 * centred on the south-west (Colombo – Ratnapura – Galle) and the dry zone
 * covers the north, east and south-east. This is NOT land-cover data; it only
 * tints vegetation so the whole island is not a uniform green.
 */
export const CLIMATE_ZONES = Object.freeze({
  wetCentre: { lat: 6.85, lon: 80.25 },
  wetRadiusKm: 70,
  dryRadiusKm: 150,
});
