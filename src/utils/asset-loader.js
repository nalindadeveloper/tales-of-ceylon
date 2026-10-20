/**
 * Loading infrastructure that separates ESSENTIAL assets (coastline, elevation
 * mesh, terrain textures — the site cannot show the island without them) from
 * OPTIONAL assets (landmark models, audio, credits), which never block or fail
 * the loading screen.
 *
 * Progress is real: it combines the number of finished files reported by the
 * Three.js LoadingManager with byte-level progress where the browser provides
 * it (FileLoader requests).
 */
import { FileLoader, LoadingManager, TextureLoader } from 'three';

export function createEssentialLoader({ onProgress } = {}) {
  const manager = new LoadingManager();
  const partial = new Map();
  let itemsLoaded = 0;
  let itemsTotal = 0;

  const report = () => {
    if (!itemsTotal) return;
    let fraction = itemsLoaded;
    for (const value of partial.values()) fraction += value;
    onProgress?.(Math.min(1, fraction / itemsTotal));
  };

  manager.onStart = (_url, loaded, total) => {
    itemsLoaded = loaded;
    itemsTotal = total;
    report();
  };
  manager.onProgress = (url, loaded, total) => {
    partial.delete(url);
    itemsLoaded = loaded;
    itemsTotal = total;
    report();
  };

  const fileLoader = (responseType) => {
    const loader = new FileLoader(manager);
    loader.setResponseType(responseType);
    return loader;
  };
  const textureLoader = new TextureLoader(manager);

  /** Promise wrapper with byte progress for JSON / ArrayBuffer files. */
  const loadFile = (url, responseType) =>
    new Promise((resolve, reject) => {
      fileLoader(responseType).load(
        url,
        resolve,
        (event) => {
          if (event.lengthComputable && event.total > 0) {
            partial.set(manager.resolveURL(url), Math.min(0.99, event.loaded / event.total));
            report();
          }
        },
        (error) => reject(new Error(`Essential asset failed: ${url} (${error?.message ?? error})`)),
      );
    });

  return {
    manager,
    loadJSON: (url) => loadFile(url, 'json'),
    loadArrayBuffer: (url) => loadFile(url, 'arraybuffer'),
    loadTexture: (url) =>
      new Promise((resolve, reject) => {
        textureLoader.load(url, resolve, undefined, () => reject(new Error(`Essential texture failed: ${url}`)));
      }),
  };
}

/** Runs a callback when the browser is idle (falls back to a short timeout). */
export function whenIdle(callback, timeout = 1500) {
  if ('requestIdleCallback' in window) return window.requestIdleCallback(callback, { timeout });
  return window.setTimeout(callback, 200);
}
