/**
 * Full-screen "fly through the clouds" layer.
 *
 * The camera never physically dips below the cloud layer (it stays tens of
 * kilometres up), so passing through cloud during a zoom is rendered as a
 * screen-space effect drawn on top of the scene:
 *
 *   - three layers of procedural cloud at different depths stream outward
 *     from the centre of the screen, growing as they approach, so it feels
 *     like flying forward into them (parallax between the layers);
 *   - `amount` (0–1) thickens them from scattered wisps into a full
 *     white-out, then thins them again; as it falls the clouds part from the
 *     centre first, so the zoomed location is revealed through the opening;
 *   - `phase` advances while the camera travels, driving the streaming.
 *
 * Both values come from the camera director and are scrubbed by the intro
 * scroll only (opening view ↔ island overview), so the effect plays when
 * zooming in and in reverse when scrolling back up to the top.
 */
import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { CLOUD_VEIL_CONFIG } from '../data/scene-config.js';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uAmount;
  uniform float uPhase;
  uniform float uTime;
  uniform float uAspect;
  uniform vec3 uLit;
  uniform vec3 uShade;
  varying vec2 vUv;

  float veilHash(vec2 p) {
    p = fract(p * vec2(127.13, 311.71));
    p += dot(p, p + 23.17);
    return fract(p.x * p.y);
  }
  float veilNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(veilHash(i), veilHash(i + vec2(1.0, 0.0)), u.x),
               mix(veilHash(i + vec2(0.0, 1.0)), veilHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float veilFbm(vec2 p) {
    float n = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      n += veilNoise(p) * a;
      p = p * 2.02 + vec2(5.3, -2.7);
      a *= 0.5;
    }
    return n;
  }

  void main() {
    vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
    float radius = length(c);
    vec3 color = vec3(0.0);
    float alpha = 0.0;
    float threshold = mix(0.92, 0.18, uAmount);

    // Front-to-back compositing of three cloud layers streaming past.
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      // Each layer cycles from far (small) to near (large) as we fly forward.
      float layerPhase = fract(uPhase * 0.55 + fi / 3.0);
      float zoom = mix(3.2, 0.45, layerPhase);
      vec2 q = c * zoom + vec2(fi * 17.3, fi * -9.1) + vec2(uTime * 0.012, uTime * 0.007);
      float n = veilFbm(q * 1.4);
      float presence = sin(layerPhase * 3.14159);         // fade in, pass, fade out
      float density = smoothstep(threshold, threshold + 0.24, n) * presence;
      // Self-shadowing towards the lower left gives the puffs volume.
      float shade = clamp((n - veilFbm(q * 1.4 + vec2(0.06, 0.05))) * 4.0 + 0.65, 0.0, 1.0);
      vec3 layerColor = mix(uShade, uLit, shade);
      color += layerColor * density * (1.0 - alpha);
      alpha += density * (1.0 - alpha);
    }

    // Near the peak the view becomes a soft white-out.
    float haze = smoothstep(0.6, 1.0, uAmount);
    color += uLit * haze * (1.0 - alpha);
    alpha += haze * (1.0 - alpha);
    // Composited colour is premultiplied; un-premultiply before shaping alpha.
    vec3 cloudColor = alpha > 0.001 ? color / alpha : uLit;

    // While thinning, clouds part from the centre first to reveal the view.
    float opening = smoothstep(0.0, 0.55, radius * 1.3 - (1.0 - uAmount) * 0.55 + 0.25);
    alpha *= mix(opening, 1.0, smoothstep(0.75, 1.0, uAmount));
    alpha = clamp(alpha * smoothstep(0.0, 0.2, uAmount), 0.0, 1.0);

    gl_FragColor = vec4(cloudColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCloudVeil() {
  const uniforms = {
    uAmount: { value: 0 },
    uPhase: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uLit: { value: new Color(CLOUD_VEIL_CONFIG.litColor) },
    uShade: { value: new Color(CLOUD_VEIL_CONFIG.shadeColor) },
  };
  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const geometry = new PlaneGeometry(2, 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'cloud-veil';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // drawn over everything
  mesh.visible = false;

  return {
    mesh,
    /**
     * @param {{amount:number, phase:number}} veil from the camera director
     * @param {number} time seconds
     * @param {number} aspect viewport width / height
     */
    update(veil, time, aspect) {
      uniforms.uAmount.value = veil.amount;
      uniforms.uPhase.value = veil.phase;
      uniforms.uTime.value = time;
      uniforms.uAspect.value = aspect;
      mesh.visible = veil.amount > 0.004;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
