/**
 * Conversions between geographic data structures and scene geometry.
 * All projection maths lives in projection.js; this module only adapts data.
 */
import { Vector3 } from 'three';
import { projectLonLat } from './projection.js';

/** Projects lon/lat into a Vector3 on the horizontal plane at height `y`. */
export function lonLatToVector3(lon, lat, y = 0, target = new Vector3()) {
  const { x, z } = projectLonLat(lon, lat);
  return target.set(x, y, z);
}

/**
 * Extracts every outer ring of a (Multi)Polygon GeoJSON as projected [x, z]
 * pairs. The closing duplicate vertex is removed.
 */
export function geojsonToProjectedRings(geojson) {
  const rings = [];
  for (const feature of geojson.features ?? []) {
    const { type, coordinates } = feature.geometry ?? {};
    const polygons = type === 'MultiPolygon' ? coordinates : type === 'Polygon' ? [coordinates] : [];
    for (const polygon of polygons) {
      const outer = polygon[0];
      const ring = outer.slice(0, -1).map(([lon, lat]) => {
        const { x, z } = projectLonLat(lon, lat);
        return [x, z];
      });
      if (ring.length >= 3) rings.push(ring);
    }
  }
  return rings;
}

/**
 * Signed area of a ring on the x/z plane. Positive means counter-clockwise
 * when viewed from above with +x to the right and +z towards the viewer
 * (i.e. clockwise on a north-up map).
 */
export function signedRingArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

/** Axis-aligned bounds of a set of rings. */
export function ringsBounds(rings) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const ring of rings) {
    for (const [x, z] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  return { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 };
}
