/**
 * Builds the island geometry from the preprocessed data.
 *
 * Surface: the constrained-Delaunay mesh produced offline (scripts/geo). Its
 * outer edge is exactly the coastline rings, interior vertices are denser
 * where the relief is high, and every vertex carries the SRTM elevation.
 * Vertices are created at BAKE_EXAGGERATION height and the mesh is scaled
 * vertically by (multiplier / BAKE_EXAGGERATION), which keeps the baked
 * object-space normal map consistent with any chosen exaggeration.
 *
 * Edge: a vertical wall extruded down from every coastline ring gives the
 * island a visible landmass edge (a shallow "geological base") instead of a
 * paper-thin cut-out. The wall top meets the surface at the coast lift height.
 */
import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three';
import { BAKE_EXAGGERATION } from './terrain-palette.js';
import { WALL_COLORS, createSurfaceMaterial, createWallMaterial } from './terrain-materials.js';

function buildSurfaceGeometry(mesh, textureBounds) {
  const { vertexCount, x, z, heightKm, indices } = mesh;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const spanX = textureBounds.maxX - textureBounds.minX;
  const spanZ = textureBounds.maxZ - textureBounds.minZ;

  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3] = x[i];
    positions[i * 3 + 1] = heightKm[i] * BAKE_EXAGGERATION;
    positions[i * 3 + 2] = z[i];
    // Textures are stored north-up; flipY maps the top image row to v = 1.
    uvs[i * 2] = (x[i] - textureBounds.minX) / spanX;
    uvs[i * 2 + 1] = 1 - (z[i] - textureBounds.minZ) / spanZ;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

function buildWallGeometry(rings, topY, bottomY) {
  const vertexTotal = rings.reduce((sum, ring) => sum + ring.length * 2, 0);
  const positions = new Float32Array(vertexTotal * 3);
  const colors = new Float32Array(vertexTotal * 3);
  const indices = [];
  let offset = 0;

  for (const ring of rings) {
    const n = ring.length;
    ring.forEach(([x, z], i) => {
      const top = (offset + i * 2) * 3;
      const bottom = top + 3;
      positions.set([x, topY, z], top);
      positions.set([x, bottomY, z], bottom);
      colors.set([WALL_COLORS.top.r, WALL_COLORS.top.g, WALL_COLORS.top.b], top);
      colors.set([WALL_COLORS.bottom.r, WALL_COLORS.bottom.g, WALL_COLORS.bottom.b], bottom);
      const a = offset + i * 2;
      const b = offset + ((i + 1) % n) * 2;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    });
    offset += n * 2;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * @returns {{group: Group, surface: Mesh, wall: Mesh, setElevationMultiplier: Function}}
 */
export function buildTerrain({ elevation, boundary, config, shadows }) {
  const group = new Group();
  group.name = 'terrain';

  const surface = new Mesh(buildSurfaceGeometry(elevation.mesh, elevation.meta.textures.bounds), createSurfaceMaterial(elevation.textures));
  surface.name = 'terrain-surface';
  surface.position.y = config.coastLift;
  surface.receiveShadow = shadows;
  surface.castShadow = shadows;

  const wall = new Mesh(buildWallGeometry(boundary.rings, config.coastLift, -config.wallDepth), createWallMaterial());
  wall.name = 'terrain-wall';
  wall.receiveShadow = shadows;

  group.add(surface, wall);

  function setElevationMultiplier(multiplier) {
    surface.scale.y = multiplier / BAKE_EXAGGERATION;
    surface.updateMatrixWorld();
  }
  setElevationMultiplier(config.elevationMultiplier);

  return { group, surface, wall, setElevationMultiplier };
}
