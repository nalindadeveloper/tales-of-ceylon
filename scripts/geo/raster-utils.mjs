/**
 * Small raster-processing toolkit used by the terrain bake:
 * polygon rasterisation, Euclidean distance transform, blur, value noise,
 * depression filling and flow accumulation (for deriving rivers from the DEM).
 */

/** Even-odd scanline rasterisation of polygon rings into a 0/1 mask. */
export function rasterizeRings(rings, grid) {
  const { width, height, toPixel } = grid;
  const mask = new Uint8Array(width * height);
  const pixelRings = rings.map((ring) => ring.map(([x, z]) => toPixel(x, z)));

  for (let py = 0; py < height; py++) {
    const sampleY = py + 0.5;
    const crossings = [];
    for (const ring of pixelRings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > sampleY) !== (yj > sampleY)) {
          crossings.push(xi + ((sampleY - yi) / (yj - yi)) * (xj - xi));
        }
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const start = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const end = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5));
      for (let px = start; px <= end; px++) mask[py * width + px] = 1;
    }
  }
  return mask;
}

/** 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Distance (in pixels) from every pixel where `mask === value` to the nearest
 * pixel where it is not. Pixels outside the region get 0.
 */
export function distanceTransform(mask, width, height, value = 1) {
  const INF = 1e20;
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] === value ? INF : 0;

  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
  }

  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

/** Separable box blur (run several passes to approximate a Gaussian). */
export function boxBlur(source, width, height, radius, passes = 2) {
  let a = Float32Array.from(source);
  let b = new Float32Array(a.length);
  const span = radius * 2 + 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += a[row + Math.min(width - 1, Math.max(0, x))];
      for (let x = 0; x < width; x++) {
        b[row + x] = sum / span;
        sum += a[row + Math.min(width - 1, x + radius + 1)] - a[row + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += b[Math.min(height - 1, Math.max(0, y)) * width + x];
      for (let y = 0; y < height; y++) {
        a[y * width + x] = sum / span;
        sum += b[Math.min(height - 1, y + radius + 1) * width + x] - b[Math.max(0, y - radius) * width + x];
      }
    }
  }
  return a;
}

/** Deterministic 2D value noise + fractal sum, used for subtle colour variation. */
function hash2(ix, iy) {
  let h = ix * 374761393 + iy * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = smooth(x - ix);
  const ty = smooth(y - iy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export function fbm(x, y, octaves = 4) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

/** Binary min-heap keyed by Float64 priorities storing Int32 cell indices. */
class MinHeap {
  constructor(capacity) {
    this.keys = new Float64Array(capacity);
    this.items = new Int32Array(capacity);
    this.size = 0;
  }

  push(item, key) {
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.items[i] = item;
  }

  pop() {
    const top = this.items[0];
    const lastKey = this.keys[--this.size];
    const lastItem = this.items[this.size];
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= lastKey) break;
      this.keys[i] = this.keys[child];
      this.items[i] = this.items[child];
      i = child;
    }
    this.keys[i] = lastKey;
    this.items[i] = lastItem;
    return top;
  }
}

const NEIGHBOURS = [
  [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
  [-1, 0, 1], [1, 0, 1],
  [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2],
];

/**
 * Derives drainage from the DEM:
 *  1. Priority-Flood (Barnes et al. 2014) fills depressions with a tiny
 *     gradient so every land cell drains to the sea.
 *  2. Each cell flows to its steepest-descent (D8) neighbour.
 *  3. Cells are visited from the highest filled elevation down, accumulating
 *     upstream contributing area.
 * Returns the number of upstream cells per land cell (0 for water).
 */
export function flowAccumulation(heights, landMask, width, height) {
  const count = width * height;
  const filled = new Float64Array(count);
  const visited = new Uint8Array(count);
  const order = new Int32Array(count);
  let orderLength = 0;
  const heap = new MinHeap(count);
  const EPSILON = 0.01;

  for (let i = 0; i < count; i++) {
    if (!landMask[i]) {
      visited[i] = 1;
      continue;
    }
    const x = i % width;
    const y = (i / width) | 0;
    const touchesWater = NEIGHBOURS.some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx < 0 || ny < 0 || nx >= width || ny >= height || !landMask[ny * width + nx];
    });
    if (touchesWater) {
      filled[i] = Math.max(0, heights[i]);
      visited[i] = 1;
      heap.push(i, filled[i]);
    }
  }

  while (heap.size) {
    const cell = heap.pop();
    order[orderLength++] = cell;
    const x = cell % width;
    const y = (cell / width) | 0;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (visited[n]) continue;
      visited[n] = 1;
      filled[n] = Math.max(heights[n], filled[cell] + EPSILON);
      heap.push(n, filled[n]);
    }
  }

  const accumulation = new Float32Array(count);
  for (let k = 0; k < orderLength; k++) accumulation[order[k]] = 1;

  for (let k = orderLength - 1; k >= 0; k--) {
    const cell = order[k];
    const x = cell % width;
    const y = (cell / width) | 0;
    let receiver = -1;
    let steepest = 0;
    for (const [dx, dy, distance] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (!landMask[n]) continue;
      const drop = (filled[cell] - filled[n]) / distance;
      if (drop > steepest) {
        steepest = drop;
        receiver = n;
      }
    }
    if (receiver >= 0) accumulation[receiver] += accumulation[cell];
  }
  return accumulation;
}
