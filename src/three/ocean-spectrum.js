/**
 * Initial ocean wave spectrum for the FFT simulation (Tessendorf 2001).
 *
 * For every cascade (a square, tiling patch of ocean of side L km sampled on an
 * N×N grid of wave vectors) this builds h̃0(k), the random complex amplitude of
 * each wave, from a Phillips spectrum:
 *
 *   P(k) = A · exp(−1 / (k·Lw)²) / k⁴ · |k̂·ŵ|² · exp(−k²·l²)
 *
 *   Lw  sets the peak wavelength (wind-sea scale), ŵ is the wind direction,
 *   waves running against the wind are strongly damped, l suppresses the
 *   tiniest ripples.
 *
 * Each cascade keeps only its own band of wavelengths so the three cascades
 * add up to one continuous spectrum without double counting. The amplitude A
 * is normalised so the whole sea has the configured RMS slope, and the
 * expected slope variance of every cascade is returned — the shader uses it
 * to turn waves that are too small to draw into sun-glitter roughness.
 *
 * Units: kilometres and seconds (scene units). The scale is stylised: the
 * camera flies tens of kilometres up, so the visible "waves" are wind-sea
 * patterns a few hundred metres to a few kilometres long.
 */
import { DataTexture, FloatType, NearestFilter, RGBAFormat, RepeatWrapping } from 'three';

/** Deterministic PRNG so the sea looks the same on every visit. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal pair via Box–Muller. */
function gaussianPair(random) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

/** Wave number of grid index i in FFT (non-centred) order. */
export function waveNumber(i, n, size) {
  return ((2 * Math.PI) / size) * (i < n / 2 ? i : i - n);
}

function phillips(kx, kz, { wind, peakLength, smallWaveLength }) {
  const k2 = kx * kx + kz * kz;
  if (k2 < 1e-12) return 0;
  const k = Math.sqrt(k2);
  const alignment = (kx * wind.x + kz * wind.z) / k;
  let directional = alignment * alignment;
  if (alignment < 0) directional *= 0.08; // waves against the wind barely exist
  const kl = k * peakLength;
  return (Math.exp(-1 / (kl * kl)) / (k2 * k2)) * directional * Math.exp(-k2 * smallWaveLength * smallWaveLength);
}

/**
 * @param {object} options
 * @param {number[]} options.sizesKm       cascade patch sizes, largest first
 * @param {number}   options.resolution    N (power of two)
 * @param {number}   options.windDirection compass degrees the wind blows FROM
 * @param {number}   options.peakWavelengthKm
 * @param {number}   options.rmsSlope      target RMS slope of the whole sea
 * @returns {{cascades: Array<{size:number, h0: DataTexture, slopeVariance:number}>}}
 */
export function createOceanSpectrum({ sizesKm, resolution: n, windDirection, peakWavelengthKm, rmsSlope, seed = 1337 }) {
  // Direction the wind blows TOWARDS on the x (east) / z (south) plane.
  const towards = ((windDirection + 180) * Math.PI) / 180;
  const params = {
    wind: { x: Math.sin(towards), z: -Math.cos(towards) },
    // Phillips peaks at k = 1 / (Lw·√2), i.e. wavelength 2π·√2·Lw.
    peakLength: peakWavelengthKm / (2 * Math.PI * Math.SQRT2),
    smallWaveLength: 0.008,
  };

  // Band limits: each cascade owns the wavelengths it resolves best.
  const bandEdges = sizesKm.map((size, i) => (i === 0 ? 0 : ((2 * Math.PI) / size) * 4));
  const bands = sizesKm.map((size, i) => ({ min: bandEdges[i], max: i + 1 < sizesKm.length ? bandEdges[i + 1] : Infinity }));

  // First pass with A = 1 to measure the slope variance, then normalise.
  const raw = sizesKm.map((size, c) => {
    const dk = (2 * Math.PI) / size;
    const spectrum = new Float64Array(n * n);
    let slopeVariance = 0;
    for (let m = 0; m < n; m++) {
      for (let i = 0; i < n; i++) {
        const kx = waveNumber(i, n, size);
        const kz = waveNumber(m, n, size);
        const k = Math.hypot(kx, kz);
        if (k < bands[c].min || k >= bands[c].max) continue;
        const energy = phillips(kx, kz, params) * dk * dk;
        spectrum[m * n + i] = energy;
        slopeVariance += k * k * energy;
      }
    }
    return { size, spectrum, slopeVariance };
  });
  const totalVariance = raw.reduce((sum, c) => sum + c.slopeVariance, 0);
  const amplitudeScale = totalVariance > 0 ? (rmsSlope * rmsSlope) / totalVariance : 0;

  const random = mulberry32(seed);
  const cascades = raw.map(({ size, spectrum, slopeVariance }) => {
    // h̃0(k) = ξ · √(P(k)/2), ξ complex standard normal.
    const h0 = new Float32Array(n * n * 2);
    for (let j = 0; j < n * n; j++) {
      const [gr, gi] = gaussianPair(random);
      const amplitude = Math.sqrt((spectrum[j] * amplitudeScale) / 2);
      h0[j * 2] = gr * amplitude;
      h0[j * 2 + 1] = gi * amplitude;
    }
    // Texture: (h̃0(k).re, h̃0(k).im, conj(h̃0(−k)).re, conj(h̃0(−k)).im)
    const data = new Float32Array(n * n * 4);
    for (let m = 0; m < n; m++) {
      for (let i = 0; i < n; i++) {
        const j = m * n + i;
        const mirror = ((n - m) % n) * n + ((n - i) % n);
        data[j * 4] = h0[j * 2];
        data[j * 4 + 1] = h0[j * 2 + 1];
        data[j * 4 + 2] = h0[mirror * 2];
        data[j * 4 + 3] = -h0[mirror * 2 + 1];
      }
    }
    const texture = new DataTexture(data, n, n, RGBAFormat, FloatType);
    texture.minFilter = texture.magFilter = NearestFilter;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.needsUpdate = true;
    return { size, h0: texture, slopeVariance: slopeVariance * amplitudeScale };
  });

  return { cascades };
}
