/**
 * Height sampling on the rendered terrain surface.
 *
 * Rather than re-reading the DEM, the sampler interpolates the exact triangles
 * that are drawn, so markers and objects sit precisely on the visible land.
 * Triangles are indexed in a uniform 2 km grid on the x/z plane; a query finds
 * the triangle containing the point (barycentric test) and interpolates its
 * vertex heights. Heights are stored true-to-scale (km) and converted to world
 * Y with the current exaggeration: worldY = coastLift + heightKm × multiplier.
 */

const CELL_SIZE_KM = 2;

export function createTerrainSampler(mesh, { coastLift, elevationMultiplier }) {
  const { x, z, heightKm, indices, bounds } = mesh;
  const columns = Math.ceil((bounds.maxX - bounds.minX) / CELL_SIZE_KM);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / CELL_SIZE_KM);
  const cells = Array.from({ length: columns * rows }, () => []);
  let multiplier = elevationMultiplier;

  const cellIndex = (cx, cz) => cz * columns + cx;
  const toCell = (value, min, count) => Math.min(count - 1, Math.max(0, Math.floor((value - min) / CELL_SIZE_KM)));

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const cx0 = toCell(Math.min(x[a], x[b], x[c]), bounds.minX, columns);
    const cx1 = toCell(Math.max(x[a], x[b], x[c]), bounds.minX, columns);
    const cz0 = toCell(Math.min(z[a], z[b], z[c]), bounds.minZ, rows);
    const cz1 = toCell(Math.max(z[a], z[b], z[c]), bounds.minZ, rows);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) cells[cellIndex(cx, cz)].push(t);
    }
  }

  /** True terrain height (km) at x/z, or null when the point is in the sea. */
  function sampleTrueHeight(px, pz) {
    if (px < bounds.minX || px > bounds.maxX || pz < bounds.minZ || pz > bounds.maxZ) return null;
    const candidates = cells[cellIndex(toCell(px, bounds.minX, columns), toCell(pz, bounds.minZ, rows))];
    for (const t of candidates) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      const v0x = x[b] - x[a], v0z = z[b] - z[a];
      const v1x = x[c] - x[a], v1z = z[c] - z[a];
      const v2x = px - x[a], v2z = pz - z[a];
      const denominator = v0x * v1z - v1x * v0z;
      if (Math.abs(denominator) < 1e-12) continue;
      const v = (v2x * v1z - v1x * v2z) / denominator;
      const w = (v0x * v2z - v2x * v0z) / denominator;
      const u = 1 - v - w;
      if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6) {
        return u * heightKm[a] + v * heightKm[b] + w * heightKm[c];
      }
    }
    return null;
  }

  /** World-space Y of the land surface (falls back to the coast level at sea). */
  function sampleHeight(px, pz) {
    const height = sampleTrueHeight(px, pz);
    return coastLift + (height ?? 0) * multiplier;
  }

  /** Lowest surface Y within `radius` km — used to seat objects on slopes. */
  function sampleFootprintMin(px, pz, radius) {
    let lowest = sampleHeight(px, pz);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      lowest = Math.min(lowest, sampleHeight(px + Math.cos(angle) * radius, pz + Math.sin(angle) * radius));
    }
    return lowest;
  }

  return {
    sampleHeight,
    sampleTrueHeight,
    sampleFootprintMin,
    setElevationMultiplier(value) {
      multiplier = value;
    },
  };
}
