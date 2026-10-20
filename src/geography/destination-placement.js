/**
 * Resolves each destination's lon/lat into scene positions on the terrain.
 *
 * 1. The coordinate is projected with the shared projection (projection.js).
 * 2. The terrain sampler ray-casts the real rendered surface at that x/z, so
 *    markers and objects sit on the land regardless of elevation — Nuwara
 *    Eliya lands high in the hills, Colombo and Galle at the coast.
 * 3. Per-destination offsets from destinations.js are applied.
 *
 * The resulting placement records are the only positions used by markers,
 * landmark objects and the camera, so they cannot drift apart.
 */
import { Vector3 } from 'three';
import { projectLonLat } from './projection.js';

/**
 * @param {Array} destinations Destination config objects.
 * @param {{sampleHeight:(x:number,z:number)=>number}} sampler Terrain sampler.
 */
export function computeDestinationPlacements(destinations, sampler) {
  return destinations.map((destination, index) => {
    const { x, z } = projectLonLat(destination.longitude, destination.latitude);
    const surfaceY = sampler.sampleHeight(x, z);
    const surface = new Vector3(x, surfaceY, z);

    const markerPosition = surface.clone();
    markerPosition.y += destination.marker?.heightOffset ?? 0.15;

    const [ox = 0, oy = 0, oz = 0] = destination.model?.offset ?? [];
    const objectX = x + ox;
    const objectZ = z + oz;
    // Objects rest on the lowest point of their footprint so they never float.
    const footprintY = sampler.sampleFootprintMin(objectX, objectZ, 2.5);
    const objectPosition = new Vector3(objectX, footprintY + oy, objectZ);

    const [tx = 0, ty = 0, tz = 0] = destination.camera?.targetOffset ?? [];
    const cameraTarget = new Vector3(x + tx, surfaceY + ty, z + tz);

    return { id: destination.id, index, destination, surface, markerPosition, objectPosition, cameraTarget };
  });
}
