/**
 * GLB/GLTF loading with Draco support and a per-path cache, so a model is
 * fetched and parsed at most once no matter how often its destination is
 * activated. Knows nothing about destinations or animation.
 *
 * Since three r17x the DRACOLoader resolves its bundled decoder files through
 * `new URL(..., import.meta.url)`, so Vite ships them automatically and they
 * are only downloaded when a Draco-compressed model is actually loaded.
 */
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function createModelLoader() {
  const draco = new DRACOLoader();
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const cache = new Map();

  /**
   * @param {string} path
   * @returns {Promise<import('three').Group>} the GLTF scene (shared — clone it to reuse)
   */
  function load(path) {
    if (!cache.has(path)) {
      cache.set(
        path,
        loader.loadAsync(path).then((gltf) => {
          gltf.scene.traverse((object) => {
            if (object.isMesh) {
              object.castShadow = true;
              object.receiveShadow = true;
            }
          });
          return gltf.scene;
        }),
      );
    }
    return cache.get(path);
  }

  return {
    load,
    dispose() {
      cache.clear();
      draco.dispose();
    },
  };
}
