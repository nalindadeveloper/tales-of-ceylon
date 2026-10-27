/**
 * Animated ocean: one large plane, everything else happens in the shader.
 * No simulation and no render targets — the look comes from physically
 * motivated shading of an analytic wave field.
 *
 * Water body colour
 *   Baked from real bathymetry (ETOPO1/GMTED via Terrain Tiles) so the narrow
 *   shelf and the shallow Palk Strait read naturally; fades to a deep tone
 *   beyond the baked area.
 *
 * Waves (normals only — the camera flies tens of kilometres up, so the motion
 * is read through light, as in real aerial footage)
 *   Primary: a GPU FFT simulation (ocean-simulation.js) — three tiling
 *   cascades of a wind-driven spectrum, sampled with mip-mapping, plus
 *   persistent crest foam from the choppy-wave Jacobian.
 *   Fallback (no float render targets): a sum of directional waves spread
 *   around the prevailing wind. Each wave
 *   moves with the deep-water dispersion relation ω = √(g·k), so longer waves
 *   travel faster than short ones, exactly like a real sea. Slow "wave group"
 *   noise modulates their amplitude so the surface never looks tiled.
 *   Waves too small to resolve at the current pixel footprint are faded out
 *   (no aliasing or stripes) and their slope energy is moved into the
 *   specular roughness — which is why the sun glitter widens into a broad,
 *   shimmering glint path towards the horizon, as it does from an aircraft.
 *
 * Light
 *   GGX sun specular, Schlick Fresnel sky reflection with a sky gradient, a
 *   touch of crest brightening, and drifting wind patches (large "cat's paw"
 *   areas of rougher water) that keep the sea alive in wide shots.
 *
 * Surf
 *   A baked distance-to-coast field (scripts/geo/build-shore-field.mjs) drives
 *   swell lines that roll in towards the beach, steepen and break into foam,
 *   plus a pulsing wash right at the shoreline. Surf detail fades into a soft
 *   white rim when the camera is too far away to resolve individual lines.
 */
import { Color, MathUtils, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector2, Vector3, Vector4 } from 'three';
import { LIGHTING_CONFIG, OCEAN_CONFIG } from '../data/scene-config.js';
import { CLOUD_GLSL, cloudUniforms } from './clouds.js';

const WAVE_COUNT = 8;

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
  #define WAVE_COUNT ${WAVE_COUNT}
  uniform sampler2D uMap;
  uniform sampler2D uShore;
  uniform vec4 uBounds;         // bathymetry texture: minX, minZ, maxX, maxZ (km)
  uniform vec4 uShoreBounds;    // shore-distance texture bounds (km)
  uniform float uShoreMax;      // km encoded by a white shore pixel
  uniform vec3 uDeep;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform vec3 uFoamColor;
  uniform float uTime;
  uniform vec2 uEdgeFade;       // ellipse radii (0–1) where the baked colours start / finish fading
  // xy = direction, z = wavenumber k (rad/km), w = slope amplitude (A·k)
  uniform vec4 uWaves[WAVE_COUNT];
  uniform float uWaveSpeed[WAVE_COUNT];   // angular frequency ω (rad/s, time-scaled)
  uniform vec2 uWind;                     // unit vector the wind blows towards
  uniform float uRoughness;
  uniform float uSurfStrength;
  #ifdef USE_FFT
  // FFT cascades: (slopeX, slopeZ, Dxx, Dzz) and foam (coverage, Jacobian).
  uniform sampler2D uWaves0;
  uniform sampler2D uWaves1;
  uniform sampler2D uWaves2;
  uniform sampler2D uFoam0;
  uniform sampler2D uFoam1;
  uniform sampler2D uFoam2;
  uniform vec3 uCascadeSize;      // km
  uniform vec3 uCascadeVariance;  // expected slope variance of each cascade
  uniform float uResolution;      // N
  uniform float uFoamStrength;
  uniform vec3 uFoamWeights;      // foam contribution per cascade
  #endif
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_fragment>
  ${CLOUD_GLSL}

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
  float fbm(vec2 p) {
    return oceanNoise(p) * 0.55 + oceanNoise(p * 2.07 + 17.3) * 0.3 + oceanNoise(p * 4.13 - 9.1) * 0.15;
  }

  // Decoded distance to the coast in km (uShoreMax offshore / outside the field).
  float shoreDistance(vec2 p) {
    vec2 span = uShoreBounds.zw - uShoreBounds.xy;
    vec2 uv = (p - uShoreBounds.xy) / span;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return uShoreMax;
    float encoded = texture2D(uShore, vec2(uv.x, 1.0 - uv.y)).r;
    return encoded * encoded * uShoreMax;
  }

  // How open the water is: sheltered lagoons and narrow straits have land
  // nearby in most directions, so they get calm water and no surf.
  float openness(vec2 p) {
    float open = 0.0;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0471976;
      open += smoothstep(0.5, 3.5, shoreDistance(p + vec2(cos(a), sin(a)) * 6.0));
    }
    return open / 6.0;
  }

  #ifdef USE_FFT
  // Samples one tiling FFT cascade. Mip-mapping filters waves smaller than a
  // pixel; the slope variance they would have had is returned as roughness.
  void addCascade(sampler2D waves, sampler2D foamMap, float size, float variance, float foamWeight, vec2 p, float footprint,
                  inout vec2 slope, inout float unresolved, inout float foam, inout float fold) {
    vec2 uv = p / size;
    slope += texture2D(waves, uv).xy;
    float level = log2(max(footprint * uResolution / size, 1.0));
    unresolved += variance * clamp(level / log2(uResolution), 0.0, 1.0);
    vec2 f = texture2D(foamMap, uv).rg;
    foam = max(foam, f.r * foamWeight);
    fold = max(fold, clamp(1.0 - f.g, 0.0, 1.0) * foamWeight);
  }
  #endif

  // GGX normal distribution term.
  float ggx(float nDotH, float alpha) {
    float a2 = alpha * alpha;
    float d = nDotH * nDotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d);
  }

  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;

    // ---- Water body colour from bathymetry --------------------------------
    vec2 span = uBounds.zw - uBounds.xy;
    vec2 uv = vec2((p.x - uBounds.x) / span.x, 1.0 - (p.y - uBounds.y) / span.y);
    vec3 baked = texture2D(uMap, clamp(uv, 0.0, 1.0)).rgb;
    // Elliptical fade into the open-ocean colour: a rectangular fade still
    // showed the texture's square outline (and a straight-cut India) from afar.
    vec2 centre = (uBounds.xy + uBounds.zw) * 0.5;
    float ellipse = length((p - centre) / (span * 0.5));
    vec3 water = mix(baked, uDeep, smoothstep(uEdgeFade.x, uEdgeFade.y, ellipse));

    // ---- Wave field --------------------------------------------------------
    // Kilometres covered by one pixel: decides which waves can be resolved.
    float footprint = max(length(fwidth(p)), 1e-4);
    float shore = shoreDistance(p);
    // Waves calm down inside the surf zone and in very sheltered water.
    float exposure = smoothstep(0.05, 1.2, shore);

    // Drifting wind patches ("cat's paws"): large areas of rougher water.
    vec2 drift = uWind * t * 0.012;
    float windField = smoothstep(0.25, 0.85, fbm(p * 0.045 - drift));
    float windStrength = mix(0.55, 1.25, windField);

    vec2 slope = vec2(0.0);
    float unresolved = 0.0;   // slope variance of waves too small to draw
    float crest = 0.0;
    float waveFoam = 0.0;
  #ifdef USE_FFT
    float fold = 0.0;
    // Foam comes mostly from the large waves: crests of the small cascades are
    // smaller than a pixel from this altitude and would only add speckle.
    addCascade(uWaves0, uFoam0, uCascadeSize.x, uCascadeVariance.x, uFoamWeights.x, p, footprint, slope, unresolved, waveFoam, fold);
    addCascade(uWaves1, uFoam1, uCascadeSize.y, uCascadeVariance.y, uFoamWeights.y, p, footprint, slope, unresolved, waveFoam, fold);
    addCascade(uWaves2, uFoam2, uCascadeSize.z, uCascadeVariance.z, uFoamWeights.z, p, footprint, slope, unresolved, waveFoam, fold);
    float modulation = windStrength * exposure;
    slope *= modulation;
    unresolved *= modulation * modulation;
    crest = fold * 0.25 * modulation;
    // Simulated breaking-crest foam, stronger in the windier patches.
    waveFoam = smoothstep(0.25, 0.95, waveFoam) * uFoamStrength * exposure * mix(0.35, 1.2, windField);
  #else
    for (int i = 0; i < WAVE_COUNT; i++) {
      vec4 w = uWaves[i];
      float k = w.z;
      float wavelength = 6.2831853 / k;
      // Wave groups: slow amplitude modulation travelling with the wave.
      float group = 0.55 + 0.9 * oceanNoise(p * (k * 0.035) + w.xy * t * 0.02 + float(i) * 7.31);
      float amplitude = w.w * group * windStrength * exposure;
      float resolved = smoothstep(2.5 * footprint, 6.0 * footprint, wavelength);
      float phase = dot(w.xy, p) * k - uWaveSpeed[i] * t;
      // Slightly sharpened profile (Gerstner-like crests, flatter troughs).
      float s = sin(phase);
      float c = cos(phase);
      float profile = c * (1.0 + 0.35 * s);
      slope += w.xy * profile * amplitude * resolved;
      unresolved += amplitude * amplitude * (1.0 - resolved);
      crest += max(s, 0.0) * amplitude * resolved;
    }
    // Rare, soft whitecaps riding on wave crests in the windier patches.
    float capNoise = fbm(p * 1.1 + uWind * t * 0.05);
    waveFoam = smoothstep(0.7, 0.85, capNoise * windField) * smoothstep(0.03, 0.08, crest)
             * exposure * (1.0 - smoothstep(0.04, 0.12, footprint)) * 0.12;
  #endif
    vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));

    // ---- Lighting -----------------------------------------------------------
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 sunDir = normalize(uSunDirection);
    vec3 halfDir = normalize(sunDir + viewDir);
    float nDotV = max(dot(normal, viewDir), 1e-3);
    // Cloud shadows block the direct sun: no glitter and duller water beneath.
    float cloudShade = 1.0 - cloudShadow(vWorld);
    float nDotL = max(dot(normal, sunDir), 0.0) * cloudShade;
    float fresnel = 0.02 + 0.98 * pow(1.0 - nDotV, 5.0);

    // Sky reflection with a simple zenith-to-horizon gradient.
    vec3 reflected = reflect(-viewDir, normal);
    vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(reflected.y, 0.0, 1.0), 0.45));

    // Sun glitter: unresolved waves widen the highlight into a glint path.
    float alpha = clamp(sqrt(uRoughness * uRoughness + unresolved) * mix(0.8, 1.2, windField), 0.02, 0.6);
    float specular = ggx(max(dot(normal, halfDir), 0.0), alpha) * fresnel * nDotL / (4.0 * nDotV + 1e-3);

    // Light scattering through crests makes wave tops slightly lighter.
    vec3 body = water * (0.9 + 0.1 * nDotL) + water * crest * 0.35;
    vec3 color = mix(body, sky, fresnel * 0.55);
    color += uSunColor * min(specular, 40.0) * 0.6 * cloudShade;
    color *= 0.82 + 0.18 * cloudShade;

    // ---- Surf -----------------------------------------------------------------
    // Swell lines roll towards the beach (phase decreases with distance),
    // bend with the coastline and break up into foam in the last few hundred metres.
    float surfZone = 1.0 - smoothstep(0.4, 2.6, shore);
    if (surfZone > 0.0) surfZone *= smoothstep(0.35, 0.8, openness(p));
    if (surfZone > 0.0) {
      float breakup = fbm(p * 2.2 + vec2(t * 0.03, -t * 0.02));
      // Swell sets: long-period groups so lines come and go instead of repeating.
      float sets = smoothstep(0.3, 0.75, oceanNoise(p * 0.35 + vec2(t * 0.02, 0.0)));
      float swellPhase = shore * 7.0 + t * 0.8 + breakup * 3.0;
      // Lines sharpen as they approach the shore, then dissolve into foam.
      float sharpness = mix(3.0, 9.0, smoothstep(2.4, 0.3, shore));
      float lines = pow(0.5 + 0.5 * sin(swellPhase), sharpness);
      float lineFoam = lines * smoothstep(0.25, 0.75, breakup + 0.15) * sets * surfZone * 0.7;
      float wash = (1.0 - smoothstep(0.02, 0.22, shore)) * (0.55 + 0.45 * sin(t * 0.9 + breakup * 6.0)) * surfZone;
      // Individual swell lines (~0.7 km apart) need roughly < 0.15 km per pixel.
      float resolvedSurf = 1.0 - smoothstep(0.07, 0.18, footprint);
      // Too far away to see individual lines: keep a soft averaged surf rim.
      float averaged = (1.0 - smoothstep(0.0, 0.9, shore)) * 0.22;
      float foam = mix(averaged, max(lineFoam, wash), resolvedSurf) * uSurfStrength;
      // Lighter, aerated water just behind the breakers.
      color = mix(color, color * 1.25 + vec3(0.03, 0.05, 0.05), surfZone * 0.35);
      color = mix(color, uFoamColor * (0.75 + 0.25 * nDotL), clamp(foam, 0.0, 1.0));
    }

    // Open-sea foam: simulated crest foam (FFT) or soft whitecaps (fallback).
    color = mix(color, uFoamColor * (0.8 + 0.2 * nDotL), clamp(waveFoam, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Builds the wave spectrum: wavelengths spread over a few octaves and
 * directions fanned around the wind, each with deep-water dispersion.
 */
function createWaveSpectrum() {
  const { windDirection, wavelengthsKm, spreadDegrees, steepness, timeScale } = OCEAN_CONFIG.waves;
  // Config gives where the wind comes FROM; waves travel the opposite way.
  const windAngle = MathUtils.degToRad(windDirection + 180);
  // Direction the wind blows towards: x east, z south (north = −z).
  const wind = { x: Math.sin(windAngle), y: -Math.cos(windAngle) };
  const GRAVITY_KM = 9.81e-3; // km/s²

  const waves = [];
  const speeds = [];
  wavelengthsKm.forEach((wavelength, i) => {
    // Alternate sides of the wind and widen the spread for shorter waves.
    const side = i % 2 === 0 ? 1 : -1;
    const spread = MathUtils.degToRad(spreadDegrees) * (0.25 + (i / wavelengthsKm.length) * 0.75) * side;
    const angle = windAngle + spread + Math.sin(i * 12.9898) * 0.15;
    const k = (Math.PI * 2) / wavelength;
    const amplitude = (steepness / wavelengthsKm.length) * (0.7 + 0.6 * ((i * 0.618) % 1));
    waves.push(new Vector4(Math.sin(angle), -Math.cos(angle), k, amplitude));
    speeds.push(Math.sqrt(GRAVITY_KM * k) * timeScale);
  });
  return { waves, speeds, wind: new Vector2(wind.x, wind.y) };
}

/**
 * @param {object} options
 * @param {object|null} options.simulation  FFT simulation (ocean-simulation.js),
 *   or null to use the analytic wave fallback.
 */
export function createOcean({ texture, bounds, shoreTexture, shoreBounds, shoreMaxKm, sunDirection, reducedMotion, simulation = null }) {
  const spectrum = createWaveSpectrum();
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uMap: { value: null },
      uShore: { value: null },
      uBounds: { value: new Vector4(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ) },
      uShoreBounds: { value: new Vector4(shoreBounds.minX, shoreBounds.minZ, shoreBounds.maxX, shoreBounds.maxZ) },
      uShoreMax: { value: shoreMaxKm },
      uDeep: { value: new Color(OCEAN_CONFIG.deepColor) },
      uSkyZenith: { value: new Color(OCEAN_CONFIG.skyZenith) },
      uSkyHorizon: { value: new Color(OCEAN_CONFIG.skyHorizon) },
      uSunColor: { value: new Color(LIGHTING_CONFIG.sunColor) },
      uSunDirection: { value: new Vector3().copy(sunDirection) },
      uFoamColor: { value: new Color(OCEAN_CONFIG.foamColor) },
      uTime: { value: 0 },
      uEdgeFade: { value: new Vector2(...OCEAN_CONFIG.edgeFade) },
      uWaves: { value: spectrum.waves },
      uWaveSpeed: { value: spectrum.speeds },
      uWind: { value: new Vector2() },
      uRoughness: { value: OCEAN_CONFIG.roughness },
      uSurfStrength: { value: OCEAN_CONFIG.surfStrength },
      uWaves0: { value: null },
      uWaves1: { value: null },
      uWaves2: { value: null },
      uFoam0: { value: null },
      uFoam1: { value: null },
      uFoam2: { value: null },
      uCascadeSize: { value: new Vector3() },
      uCascadeVariance: { value: new Vector3() },
      uResolution: { value: 1 },
      uFoamStrength: { value: OCEAN_CONFIG.fft.foamStrength },
      uFoamWeights: { value: new Vector3(...OCEAN_CONFIG.fft.foamWeights) },
    },
  ]);
  Object.assign(uniforms, cloudUniforms); // shared cloud state, not copies
  // Assigned after merge: UniformsUtils.merge would clone textures and vectors.
  uniforms.uMap.value = texture;
  uniforms.uShore.value = shoreTexture;
  uniforms.uWaves.value = spectrum.waves;
  uniforms.uWind.value = spectrum.wind;

  if (simulation) {
    const [c0, c1, c2] = simulation.cascades;
    uniforms.uCascadeSize.value.set(c0.size, c1.size, c2.size);
    uniforms.uCascadeVariance.value.set(c0.slopeVariance, c1.slopeVariance, c2.slopeVariance);
    uniforms.uResolution.value = simulation.resolution;
  }
  const bindSimulationTextures = () => {
    simulation.textures().forEach(({ waves, foam }, i) => {
      uniforms[`uWaves${i}`].value = waves;
      uniforms[`uFoam${i}`].value = foam;
    });
  };

  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    fog: true,
    defines: simulation ? { USE_FFT: '' } : {},
  });
  const geometry = new PlaneGeometry(OCEAN_CONFIG.size, OCEAN_CONFIG.size, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new Mesh(geometry, material);
  mesh.name = 'ocean';
  mesh.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);

  // Reduced motion: the sea is shown as a still frame.
  const STILL_TIME = 37;

  let simulatedOnce = false;
  return {
    mesh,
    /** Advances waves and foam; call once per frame before rendering. */
    update(time, delta = 0) {
      uniforms.uTime.value = reducedMotion ? STILL_TIME : time;
      if (!simulation) return;
      if (!reducedMotion || !simulatedOnce) {
        simulation.update(uniforms.uTime.value, reducedMotion ? 0 : delta);
        simulatedOnce = true;
      }
      bindSimulationTextures();
    },
    dispose() {
      simulation?.dispose();
    },
  };
}
