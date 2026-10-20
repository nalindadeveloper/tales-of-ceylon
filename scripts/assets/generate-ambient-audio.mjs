/**
 * Synthesises a seamless, original ocean-and-wind ambience loop and encodes it
 * as MP3 — no third-party recording, so there are no licensing obligations.
 *
 *   npm run assets:audio
 *
 * Technique: brown/pink noise shaped by filters. Each "wave" is a slow swell
 * (low-passed noise rising in level and brightness), a short brighter break
 * and a long decaying wash. A quiet band-passed noise layer with slow drift
 * provides wind. The tail of the render is cross-faded into its head so the
 * file loops without a click.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// lamejs's module entry has a known 'MPEGMode is not defined' bug, so the
// prebuilt browser bundle (which defines a global `lamejs`) is evaluated instead.
const lameContext = {};
runInNewContext(`${readFileSync(require.resolve('lamejs/lame.all.js'), 'utf8')}
this.lamejs = lamejs;`, lameContext);
const { lamejs } = lameContext;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = resolve(ROOT, 'public/assets/audio/ocean-ambience.mp3');

const SAMPLE_RATE = 44100;
const LOOP_SECONDS = 36;
const CROSSFADE_SECONDS = 4;
const BITRATE_KBPS = 96;

/** Small deterministic PRNG so the render is reproducible. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function renderChannel(seed, totalSamples) {
  const random = mulberry32(seed);
  const out = new Float32Array(totalSamples);

  // Wave schedule: irregular periods between 6.5 and 10.5 seconds.
  const waves = [];
  for (let t = -4; t < totalSamples / SAMPLE_RATE + 4; ) {
    const period = 6.5 + random() * 4;
    waves.push({ start: t, period, strength: 0.65 + random() * 0.35 });
    t += period;
  }

  let brown = 0;
  let pinkB0 = 0, pinkB1 = 0, pinkB2 = 0;
  let low = 0, low2 = 0, bright = 0;
  let windLow = 0, windBand = 0;
  let waveIndex = 0;

  for (let i = 0; i < totalSamples; i++) {
    const time = i / SAMPLE_RATE;
    const white = random() * 2 - 1;

    brown = (brown + white * 0.02) / 1.02;
    pinkB0 = 0.99765 * pinkB0 + white * 0.099046;
    pinkB1 = 0.963 * pinkB1 + white * 0.2965164;
    pinkB2 = 0.57 * pinkB2 + white * 1.0526913;
    const pink = (pinkB0 + pinkB1 + pinkB2 + white * 0.1848) * 0.11;

    while (waveIndex + 1 < waves.length && waves[waveIndex + 1].start <= time) waveIndex++;
    let swell = 0;
    let breakEnergy = 0;
    for (let k = Math.max(0, waveIndex - 1); k <= Math.min(waves.length - 1, waveIndex + 1); k++) {
      const wave = waves[k];
      const phase = (time - wave.start) / wave.period;
      if (phase < 0 || phase > 1.6) continue;
      const rise = phase < 0.45 ? Math.sin((phase / 0.45) * Math.PI * 0.5) ** 2 : Math.exp(-(phase - 0.45) * 2.6);
      swell += rise * wave.strength;
      const crash = phase > 0.4 && phase < 0.9 ? Math.exp(-(phase - 0.42) * 7) : 0;
      breakEnergy += crash * wave.strength;
    }

    // Brightness follows the wave: low-pass coefficient rises with energy.
    const cutoff = 0.015 + 0.05 * Math.min(1, swell) + 0.12 * breakEnergy;
    low += (pink - low) * cutoff;
    low2 += (low - low2) * cutoff;
    bright += (white - bright) * 0.35;

    const surf = low2 * (0.25 + 0.9 * swell) * 2.4 + bright * breakEnergy * 0.035 + brown * 0.55;

    // Wind: band-passed noise with a very slow, smooth level drift.
    windLow += (white - windLow) * 0.06;
    windBand += (windLow - windBand) * 0.012;
    const gust = 0.5 + 0.5 * Math.sin(time * 0.21 + seed) * Math.sin(time * 0.077 + seed * 0.5);
    const wind = (windLow - windBand) * (0.03 + 0.05 * gust);

    out[i] = surf + wind;
  }
  return out;
}

function makeSeamless(samples, loopLength, fadeLength) {
  const loop = new Float32Array(loopLength);
  for (let i = 0; i < loopLength; i++) loop[i] = samples[i];
  for (let i = 0; i < fadeLength; i++) {
    const t = i / fadeLength;
    const fadeIn = Math.sin(t * Math.PI * 0.5);
    const fadeOut = Math.cos(t * Math.PI * 0.5);
    loop[i] = samples[i] * fadeIn + samples[loopLength + i] * fadeOut;
  }
  return loop;
}

function normalise(channels, peak = 0.7) {
  let max = 0;
  for (const channel of channels) for (const s of channel) max = Math.max(max, Math.abs(s));
  const gain = peak / max;
  return channels.map((channel) => {
    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) pcm[i] = Math.round(channel[i] * gain * 32767);
    return pcm;
  });
}

function encodeMp3(left, right) {
  const encoder = new lamejs.Mp3Encoder(2, SAMPLE_RATE, BITRATE_KBPS);
  const chunks = [];
  const block = 1152;
  for (let i = 0; i < left.length; i += block) {
    const chunk = encoder.encodeBuffer(left.subarray(i, i + block), right.subarray(i, i + block));
    if (chunk.length) chunks.push(Buffer.from(chunk));
  }
  const end = encoder.flush();
  if (end.length) chunks.push(Buffer.from(end));
  return Buffer.concat(chunks);
}

const loopSamples = LOOP_SECONDS * SAMPLE_RATE;
const fadeSamples = CROSSFADE_SECONDS * SAMPLE_RATE;
const channels = [11, 29].map((seed) => makeSeamless(renderChannel(seed, loopSamples + fadeSamples), loopSamples, fadeSamples));
const [left, right] = normalise(channels);

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, encodeMp3(left, right));
console.log('[audio] Wrote', OUTPUT);
