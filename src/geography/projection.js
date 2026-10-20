/**
 * Geographic projection shared by the browser scene AND the Node terrain
 * preprocessing scripts (scripts/geo/*). Keeping a single implementation
 * guarantees that the terrain mesh, the coastline wall, the baked textures,
 * the markers and the camera targets all live in exactly the same space.
 *
 * Projection: local equirectangular (equidistant cylindrical) projection with
 * its standard parallel at the centre of Sri Lanka.
 *
 *   x = R · Δλ · cos(φ0)      (east  → +x)
 *   z = −R · Δφ                (north → −z, so the island keeps a north-up
 *                               orientation when the camera looks along −z)
 *
 * Why this projection: Sri Lanka spans only ~4° of latitude, so the scale error
 * of an equirectangular projection centred at φ0 = 7.85°N stays below ±0.6%
 * across the whole island. Longitude degrees are explicitly scaled by cos(φ0),
 * so latitude and longitude are never treated as interchangeable distances.
 *
 * Scene units: 1 unit = 1 kilometre horizontally. Elevation is stored in
 * kilometres and multiplied by a configurable vertical exaggeration at runtime.
 */

export const EARTH_RADIUS_KM = 6371.0088;

/** Projection origin — the approximate geographic centre of Sri Lanka. */
export const PROJECTION_ORIGIN = Object.freeze({ lat: 7.85, lon: 80.7 });

const DEG_TO_RAD = Math.PI / 180;
const KM_PER_DEG_LAT = EARTH_RADIUS_KM * DEG_TO_RAD;
const KM_PER_DEG_LON = KM_PER_DEG_LAT * Math.cos(PROJECTION_ORIGIN.lat * DEG_TO_RAD);

/**
 * Projects geographic coordinates into local scene kilometres.
 * @param {number} lon Longitude in degrees.
 * @param {number} lat Latitude in degrees.
 * @returns {{x:number, z:number}}
 */
export function projectLonLat(lon, lat) {
  return {
    x: (lon - PROJECTION_ORIGIN.lon) * KM_PER_DEG_LON,
    z: -(lat - PROJECTION_ORIGIN.lat) * KM_PER_DEG_LAT,
  };
}

/**
 * Inverse of {@link projectLonLat}.
 * @param {number} x Scene x in km (east).
 * @param {number} z Scene z in km (south).
 * @returns {{lon:number, lat:number}}
 */
export function unprojectXZ(x, z) {
  return {
    lon: PROJECTION_ORIGIN.lon + x / KM_PER_DEG_LON,
    lat: PROJECTION_ORIGIN.lat - z / KM_PER_DEG_LAT,
  };
}
