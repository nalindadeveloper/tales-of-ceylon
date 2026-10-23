/**
 * Terrain materials.
 *
 * The land surface uses MeshStandardMaterial so it receives the sun, sky light,
 * shadows and fog like everything else. Colour comes from the baked albedo
 * (painted from elevation, slope, coastal distance and climate zoning — see
 * terrain-palette.js). Shading detail comes from an OBJECT-SPACE normal map
 * baked from the DEM at BAKE_EXAGGERATION; because the mesh is scaled
 * vertically by (multiplier / BAKE_EXAGGERATION), Three's normal matrix keeps
 * lighting correct for any runtime exaggeration.
 *
 * A small shader extension adds fine procedural tonal variation so the land
 * keeps some texture when the camera is close to a destination. It only
 * modulates brightness by a few percent and never alters the elevation.
 */
import { Color, DoubleSide, MeshStandardMaterial, ObjectSpaceNormalMap } from 'three';
import { TERRAIN_PALETTE } from './terrain-palette.js';
import { receiveCloudShadows } from '../three/clouds.js';

const DETAIL_NOISE_GLSL = /* glsl */ `
  varying vec3 vTerrainWorld;
  float terrainHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float terrainNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), u.x),
               mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

/**
 * @param {{albedo, normal, vegetation?}} textures  vegetation.g is the river
 *   mask: rivers become dark, glossy water that catches the sky.
 */
export function createSurfaceMaterial({ albedo, normal, vegetation }) {
  const material = new MeshStandardMaterial({
    map: albedo,
    normalMap: normal,
    normalMapType: ObjectSpaceNormalMap,
    roughness: 0.94,
    metalness: 0,
  });
  const riverExpression = vegetation ? 'smoothstep(0.15, 0.7, texture2D(uVegetation, vMapUv).g)' : '0.0';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVegetation = { value: vegetation ?? null };
    shader.uniforms.uRiverColor = { value: new Color(TERRAIN_PALETTE.riverWater) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DETAIL_NOISE_GLSL}\nuniform sampler2D uVegetation;\nuniform vec3 uRiverColor;`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Fine tonal variation (0.35 km and 1.2 km scales), faded out with distance.
        float detailFade = 1.0 - smoothstep(90.0, 320.0, length(cameraPosition - vTerrainWorld));
        float detail = terrainNoise(vTerrainWorld.xz * 2.8) * 0.6 + terrainNoise(vTerrainWorld.xz * 0.8) * 0.4;
        diffuseColor.rgb *= mix(1.0, 0.9 + detail * 0.2, detailFade);
        float river = ${riverExpression};
        diffuseColor.rgb = mix(diffuseColor.rgb, uRiverColor, river * 0.85);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.16, river);`,
      );
  };
  material.customProgramCacheKey = () => `terrain-surface-v2-${vegetation ? 'rivers' : 'plain'}`;
  return receiveCloudShadows(material, 'terrain');
}

/** Coastline wall: sandy at the top, dark earth below, lit like the land. */
export function createWallMaterial() {
  return new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: DoubleSide });
}

export const WALL_COLORS = {
  top: new Color(TERRAIN_PALETTE.edgeTop),
  bottom: new Color(TERRAIN_PALETTE.edgeBottom),
};
