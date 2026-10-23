/**
 * Drifting cloud layer with matching cloud shadows.
 *
 * One procedural density field (fractal value noise in world kilometres,
 * advected by the wind) is shared by:
 *   - the visible cloud layer, a transparent plane above the highest peaks,
 *     self-shadowed by sampling the density a little towards the sun;
 *   - cloud shadows on the terrain, the trees and the ocean: each surface
 *     point looks up along the sun direction to the cloud layer and dims its
 *     direct sunlight by the density found there.
 * Clouds thin out around the focused destination (radius proportional to the
 * camera distance) so the story's subject is never hidden.
 */
import { Color, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import { CLOUD_CONFIG } from '../data/scene-config.js';

/** Uniforms shared by every material that renders or receives clouds. */
export const cloudUniforms = {
  uCloudTime: { value: 0 },
  uCloudCoverage: { value: CLOUD_CONFIG.coverage },
  uCloudHeight: { value: CLOUD_CONFIG.heightKm },
  uCloudScale: { value: CLOUD_CONFIG.scaleKm },
  uCloudWind: { value: new Vector3(...CLOUD_CONFIG.windKmPerSecond, 0) },
  uCloudFocus: { value: new Vector3(0, 0, 0) }, // x, z, clear radius (km)
  uCloudSun: { value: new Vector3(0, 1, 0) },
  uCloudShadowStrength: { value: CLOUD_CONFIG.shadowStrength },
};

/** GLSL shared by the cloud layer and every cloud-shadow receiver. */
export const CLOUD_GLSL = /* glsl */ `
  uniform float uCloudTime;
  uniform float uCloudCoverage;
  uniform float uCloudHeight;
  uniform float uCloudScale;
  uniform vec3 uCloudWind;
  uniform vec3 uCloudFocus;
  uniform vec3 uCloudSun;
  uniform float uCloudShadowStrength;

  float cloudHash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
  }
  float cloudNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x),
               mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // Cloud density 0–1 at a point of the cloud layer (world km).
  float cloudDensity(vec2 p) {
    // Keep the focused destination clear (cheap test first).
    float clearing = smoothstep(uCloudFocus.z * 0.55, uCloudFocus.z, distance(p, uCloudFocus.xy));
    if (clearing <= 0.0) return 0.0;
    vec2 q = (p - uCloudWind.xy * uCloudTime) / uCloudScale;
    float threshold = 1.0 - uCloudCoverage;
    float n = cloudNoise(q) * 0.5;
    q = q * 2.03 + vec2(13.7, -7.1);
    n += cloudNoise(q) * 0.25;
    // Early out: the finer octaves (≤ 0.25 in total) cannot reach the threshold.
    if (n + 0.25 < threshold) return 0.0;
    float amplitude = 0.125;
    for (int i = 0; i < 3; i++) {
      q = q * 2.03 + vec2(13.7, -7.1) + uCloudWind.xy * uCloudTime * 0.002 * float(i + 2);
      n += cloudNoise(q) * amplitude;
      amplitude *= 0.5;
    }
    float d = smoothstep(threshold, threshold + 0.28, n);
    return d * clearing;
  }
  // Fraction of direct sunlight blocked at a surface point.
  float cloudShadow(vec3 worldPosition) {
    vec3 sun = normalize(uCloudSun);
    float lift = max(uCloudHeight - worldPosition.y, 0.0) / max(sun.y, 0.15);
    return cloudDensity(worldPosition.xz + sun.xz * lift) * uCloudShadowStrength;
  }
`;

/**
 * Patches a MeshStandardMaterial so direct sunlight is dimmed by cloud
 * shadows. Works for instanced meshes too. Chains any existing
 * onBeforeCompile hook.
 */
export function receiveCloudShadows(material, cacheKey) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, cloudUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCloudWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 cloudWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cloudWorld = instanceMatrix * cloudWorld;
        #endif
        vCloudWorld = (modelMatrix * cloudWorld).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCloudWorld;\n${CLOUD_GLSL}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        float cloudShade = 1.0 - cloudShadow(vCloudWorld);
        reflectedLight.directDiffuse *= cloudShade;
        reflectedLight.directSpecular *= cloudShade;`,
      );
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|clouds|${cacheKey}`;
  return material;
}

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
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform float uCloudOpacity;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_fragment>
  ${CLOUD_GLSL}
  void main() {
    float density = cloudDensity(vWorld.xz);
    if (density < 0.01) discard;
    // Self-shadowing: denser cloud towards the sun means a darker underside.
    vec2 towardsSun = normalize(uCloudSun.xz + 1e-4) * uCloudScale * 0.12;
    float ahead = cloudDensity(vWorld.xz + towardsSun);
    float light = clamp(1.0 - (ahead - density) * 1.6 - density * 0.25, 0.0, 1.0);
    vec3 color = mix(uCloudShade, uCloudLit, light);
    gl_FragColor = vec4(color, density * uCloudOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createClouds({ center, sunDirection }) {
  cloudUniforms.uCloudSun.value.copy(sunDirection);
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uCloudLit: { value: new Color(CLOUD_CONFIG.litColor) },
      uCloudShade: { value: new Color(CLOUD_CONFIG.shadeColor) },
      uCloudOpacity: { value: CLOUD_CONFIG.opacity },
    },
  ]);
  Object.assign(uniforms, cloudUniforms); // shared references, not copies

  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, fog: true, transparent: true, depthWrite: false });
  const geometry = new PlaneGeometry(CLOUD_CONFIG.layerSizeKm, CLOUD_CONFIG.layerSizeKm, 1, 1).rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'clouds';
  mesh.position.set(center.x, CLOUD_CONFIG.heightKm, center.z);
  mesh.renderOrder = 20;

  return {
    mesh,
    /**
     * @param {number} time seconds
     * @param {{x:number,z:number}} focus camera target
     * @param {number} cameraDistance km
     */
    update(time, focus, cameraDistance) {
      cloudUniforms.uCloudTime.value = time;
      const clearRadius = Math.min(cameraDistance * CLOUD_CONFIG.focusClearing, CLOUD_CONFIG.maxClearingKm);
      cloudUniforms.uCloudFocus.value.set(focus.x, focus.z, clearRadius);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
