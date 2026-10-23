/**
 * GPU FFT ocean simulation (Tessendorf) in WebGL2, run every frame.
 *
 * For each cascade:
 *   1. Evolve   h̃(k,t) = h̃0(k)·e^{iωt} + conj(h̃0(−k))·e^{−iωt},
 *               ω = √(g·k) (deep-water dispersion), and build the spectra of
 *               the fields the shader needs, packed two-real-fields-per-complex:
 *                 A = ∂h/∂x + i·∂h/∂z          (surface slopes → normals)
 *                 B = ∂Dx/∂x + i·∂Dz/∂z        (choppy-wave Jacobian → foam)
 *   2. Inverse FFT: log2(N) horizontal + log2(N) vertical Stockham radix-2
 *      passes (ping-pong). The last pass writes into a half-float, mipmapped,
 *      repeating texture that the ocean shader samples.
 *   3. Foam: where the Jacobian J = (1 − λ·Dxx)(1 − λ·Dzz) folds below a
 *      threshold the crest is breaking. Foam is accumulated into a persistent
 *      buffer that decays over a few seconds, so it lingers after the crest
 *      has moved on, like real foam.
 *
 * All passes are tiny (N ≤ 128) full-screen draws into private render
 * targets; the module restores the renderer's target afterwards.
 */
import {
  FloatType,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  WebGLRenderTarget,
} from 'three';
import { createOceanSpectrum } from './ocean-spectrum.js';

const GRAVITY_KM = 9.81e-3; // km/s²

const fullscreenVertex = /* glsl */ `
  in vec3 position;
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const evolveFragment = /* glsl */ `
  precision highp float;
  precision highp int;
  uniform sampler2D uH0;
  uniform float uTime;
  uniform float uSize;
  uniform float uTimeScale;
  uniform int uN;
  out vec4 outColor;
  const float PI = 3.141592653589793;
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  vec2 timesI(vec2 a) { return vec2(-a.y, a.x); }
  void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    float kx = 2.0 * PI / uSize * float(c.x < uN / 2 ? c.x : c.x - uN);
    float kz = 2.0 * PI / uSize * float(c.y < uN / 2 ? c.y : c.y - uN);
    float k = length(vec2(kx, kz));
    vec4 h0 = texelFetch(uH0, c, 0);
    float omega = sqrt(${GRAVITY_KM} * k) * uTimeScale;
    vec2 phase = vec2(cos(omega * uTime), sin(omega * uTime));
    vec2 h = cmul(h0.xy, phase) + cmul(h0.zw, vec2(phase.x, -phase.y));

    vec2 ih = timesI(h);
    vec2 slopeX = kx * ih;
    vec2 slopeZ = kz * ih;
    float invK = k > 1e-6 ? 1.0 / k : 0.0;
    vec2 dxx = (kx * kx * invK) * h;
    vec2 dzz = (kz * kz * invK) * h;
    outColor = vec4(slopeX + timesI(slopeZ), dxx + timesI(dzz));
  }
`;

const fftFragment = /* glsl */ `
  precision highp float;
  precision highp int;
  uniform sampler2D uInput;
  uniform int uSubSize;
  uniform int uHorizontal;
  uniform int uN;
  out vec4 outColor;
  const float PI = 3.141592653589793;
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    int index = uHorizontal == 1 ? c.x : c.y;
    int halfSize = uSubSize / 2;
    int evenIndex = (index / uSubSize) * halfSize + (index % halfSize);
    ivec2 evenCoord = uHorizontal == 1 ? ivec2(evenIndex, c.y) : ivec2(c.x, evenIndex);
    ivec2 oddCoord = uHorizontal == 1 ? ivec2(evenIndex + uN / 2, c.y) : ivec2(c.x, evenIndex + uN / 2);
    vec4 even = texelFetch(uInput, evenCoord, 0);
    vec4 odd = texelFetch(uInput, oddCoord, 0);
    // Inverse transform: twiddle e^{+2πi·index/subSize} (verified against a direct DFT).
    float angle = 2.0 * PI * float(index) / float(uSubSize);
    vec2 twiddle = vec2(cos(angle), sin(angle));
    outColor = vec4(even.xy + cmul(twiddle, odd.xy), even.zw + cmul(twiddle, odd.zw));
  }
`;

const foamFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uWaves;     // (slopeX, slopeZ, Dxx, Dzz)
  uniform sampler2D uPrevious;  // previous foam
  uniform float uChoppiness;
  uniform float uThreshold;
  uniform float uDecay;         // fraction of foam kept per second
  uniform float uDelta;
  out vec4 outColor;
  void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    vec4 w = texelFetch(uWaves, c, 0);
    float jacobian = (1.0 - uChoppiness * w.z) * (1.0 - uChoppiness * w.w);
    float coverage = clamp((uThreshold - jacobian) * 2.5, 0.0, 1.0);
    float previous = texelFetch(uPrevious, c, 0).r * pow(uDecay, uDelta);
    float foam = max(previous, coverage);
    outColor = vec4(foam, jacobian, 0.0, 1.0);
  }
`;

/** True when the GPU can render to (and filter) half-float textures. */
export function isFFTOceanSupported(renderer) {
  // three.js ≥ r163 always runs on WebGL2; float render targets need one of these.
  return renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
}

export function createOceanSimulation(renderer, config) {
  const n = config.resolution;
  const fullFloat = renderer.extensions.has('EXT_color_buffer_float');
  const workType = fullFloat ? FloatType : HalfFloatType;

  const { cascades: spectra } = createOceanSpectrum({
    sizesKm: config.cascadeSizesKm,
    resolution: n,
    windDirection: config.windDirection,
    peakWavelengthKm: config.peakWavelengthKm,
    rmsSlope: config.rmsSlope,
  });

  const workTarget = () =>
    new WebGLRenderTarget(n, n, {
      type: workType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
  // Sampled by the ocean shader: filtered, mipmapped and tiling.
  const sampledTarget = () => {
    const target = new WebGLRenderTarget(n, n, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
      depthBuffer: false,
      generateMipmaps: true,
    });
    target.texture.anisotropy = 4;
    return target;
  };

  const passScene = new Scene();
  const passCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  passScene.add(quad);

  const material = (fragmentShader, uniforms) => new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: fullscreenVertex, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  const evolveMaterial = material(evolveFragment, {
    uH0: { value: null },
    uTime: { value: 0 },
    uSize: { value: 1 },
    uTimeScale: { value: config.timeScale },
    uN: { value: n },
  });
  const fftMaterial = material(fftFragment, { uInput: { value: null }, uSubSize: { value: 2 }, uHorizontal: { value: 1 }, uN: { value: n } });
  const foamMaterial = material(foamFragment, {
    uWaves: { value: null },
    uPrevious: { value: null },
    uChoppiness: { value: config.foam.choppiness },
    uThreshold: { value: config.foam.threshold },
    uDecay: { value: config.foam.decayPerSecond },
    uDelta: { value: 0 },
  });

  const cascades = spectra.map((spectrum) => ({
    size: spectrum.size,
    slopeVariance: spectrum.slopeVariance,
    h0: spectrum.h0,
    ping: workTarget(),
    pong: workTarget(),
    waves: sampledTarget(),
    foam: [sampledTarget(), sampledTarget()],
    foamIndex: 0,
  }));
  const stages = Math.log2(n);

  function draw(passMaterial, target) {
    quad.material = passMaterial;
    renderer.setRenderTarget(target);
    renderer.render(passScene, passCamera);
  }

  function simulateCascade(cascade, time, delta) {
    evolveMaterial.uniforms.uH0.value = cascade.h0;
    evolveMaterial.uniforms.uTime.value = time;
    evolveMaterial.uniforms.uSize.value = cascade.size;
    draw(evolveMaterial, cascade.ping);

    let read = cascade.ping;
    let write = cascade.pong;
    for (let direction = 1; direction >= 0; direction--) {
      for (let stage = 0; stage < stages; stage++) {
        const last = direction === 0 && stage === stages - 1;
        fftMaterial.uniforms.uInput.value = read.texture;
        fftMaterial.uniforms.uSubSize.value = 2 ** (stage + 1);
        fftMaterial.uniforms.uHorizontal.value = direction;
        const target = last ? cascade.waves : write;
        draw(fftMaterial, target);
        if (!last) [read, write] = [write, read];
      }
    }

    const previous = cascade.foam[cascade.foamIndex];
    const next = cascade.foam[1 - cascade.foamIndex];
    foamMaterial.uniforms.uWaves.value = cascade.waves.texture;
    foamMaterial.uniforms.uPrevious.value = previous.texture;
    foamMaterial.uniforms.uDelta.value = delta;
    draw(foamMaterial, next);
    cascade.foamIndex = 1 - cascade.foamIndex;
  }

  /** Advances the simulation; call once per frame before rendering the scene. */
  function update(time, delta) {
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false; // every pass overwrites all texels
    for (const cascade of cascades) simulateCascade(cascade, time, delta);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }

  return {
    cascades,
    resolution: n,
    update,
    /** Current textures for the ocean shader. */
    textures: () => cascades.map((cascade) => ({ waves: cascade.waves.texture, foam: cascade.foam[cascade.foamIndex].texture })),
    dispose() {
      for (const cascade of cascades) {
        [cascade.ping, cascade.pong, cascade.waves, ...cascade.foam].forEach((target) => target.dispose());
        cascade.h0.dispose();
      }
      [evolveMaterial, fftMaterial, foamMaterial].forEach((m) => m.dispose());
      quad.geometry.dispose();
    },
  };
}
