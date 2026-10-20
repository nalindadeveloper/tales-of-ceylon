/**
 * Performant stylised ocean: one large plane with a custom shader.
 *
 *  - Colour comes from a texture baked from real bathymetry (ETOPO1/GMTED via
 *    Terrain Tiles), so the narrow continental shelf and the shallow Palk
 *    Strait read naturally around the island.
 *  - Beyond the baked area the colour fades to a deep tone.
 *  - A few analytic wave layers perturb the normal for a gentle, slowly moving
 *    sun glint and a Fresnel sky tint. Wave detail fades with distance to
 *    avoid shimmering in wide shots. No simulation, no render targets.
 */
import { Color, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, Vector4 } from 'three';
import { LIGHTING_CONFIG, OCEAN_CONFIG } from '../data/scene-config.js';

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec4 uBounds;      // minX, minZ, maxX, maxZ (km)
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform float uTime;
  uniform float uEdgeFade;
  uniform float uWaveStrength;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_fragment>

  float oceanHash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }
  float oceanNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(oceanHash(i), oceanHash(i + vec2(1.0, 0.0)), u.x),
               mix(oceanHash(i + vec2(0.0, 1.0)), oceanHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // Two drifting octaves of value noise; returns the height gradient (d/dx, d/dz).
  // Irregular noise avoids the stripe patterns that summed sine waves produce.
  float waveHeight(vec2 p, float t) {
    return oceanNoise(p * 1.3 + vec2(t * 0.12, t * 0.07)) * 0.6
         + oceanNoise(p * 3.4 - vec2(t * 0.1, -t * 0.15)) * 0.4;
  }
  vec2 waveGradient(vec2 p, float t) {
    const float e = 0.08;
    float h = waveHeight(p, t);
    return vec2(waveHeight(p + vec2(e, 0.0), t) - h, waveHeight(p + vec2(0.0, e), t) - h) / e;
  }

  void main() {
    vec2 span = uBounds.zw - uBounds.xy;
    vec2 uv = vec2((vWorld.x - uBounds.x) / span.x, 1.0 - (vWorld.z - uBounds.y) / span.y);
    vec3 baked = texture2D(uMap, clamp(uv, 0.0, 1.0)).rgb;
    float edgeDistance = min(min(vWorld.x - uBounds.x, uBounds.z - vWorld.x), min(vWorld.z - uBounds.y, uBounds.w - vWorld.z));
    vec3 color = mix(uDeep, baked, smoothstep(0.0, uEdgeFade, edgeDistance));

    float cameraDistance = length(cameraPosition - vWorld);
    // Fade wave detail where a wave cycle would span only a few pixels (prevents aliasing).
    float footprint = length(fwidth(vWorld.xz));
    float detail = uWaveStrength * (1.0 - smoothstep(0.12, 0.45, footprint)) * (1.0 - smoothstep(150.0, 900.0, cameraDistance));
    vec2 g = waveGradient(vWorld.xz, uTime) * detail;
    vec3 normal = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 reflected = reflect(-uSunDirection, normal);
    float glint = pow(max(dot(reflected, viewDir), 0.0), 140.0) * 0.9 + pow(max(dot(reflected, viewDir), 0.0), 14.0) * 0.07;
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);

    color = mix(color, uSky, fresnel * 0.1);
    color *= 0.92 + 0.08 * dot(normal, normalize(uSunDirection + vec3(0.0, 1.0, 0.0)));
    color += uSunColor * glint;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createOcean({ texture, bounds, sunDirection }) {
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uMap: { value: null },
      uBounds: { value: new Vector4(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ) },
      uDeep: { value: new Color(OCEAN_CONFIG.deepColor) },
      uSky: { value: new Color(LIGHTING_CONFIG.skyColor) },
      uSunColor: { value: new Color(LIGHTING_CONFIG.sunColor) },
      uSunDirection: { value: new Vector3().copy(sunDirection) },
      uTime: { value: 0 },
      uEdgeFade: { value: OCEAN_CONFIG.edgeFadeKm },
      uWaveStrength: { value: OCEAN_CONFIG.waveStrength },
    },
  ]);
  uniforms.uMap.value = texture; // assigned after merge: merge would clone the texture

  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, fog: true });
  const geometry = new PlaneGeometry(OCEAN_CONFIG.size, OCEAN_CONFIG.size, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new Mesh(geometry, material);
  mesh.name = 'ocean';
  mesh.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);

  return {
    mesh,
    update(time) {
      uniforms.uTime.value = time;
    },
  };
}
