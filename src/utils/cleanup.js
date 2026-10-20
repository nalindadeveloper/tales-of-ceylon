/**
 * GPU resource disposal and a small helper to collect teardown callbacks.
 */

const TEXTURE_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'envMap'];

function disposeMaterial(material, disposed) {
  if (!material || disposed.has(material)) return;
  disposed.add(material);
  for (const key of TEXTURE_KEYS) {
    const texture = material[key];
    if (texture && !disposed.has(texture)) {
      disposed.add(texture);
      texture.dispose();
    }
  }
  if (material.uniforms) {
    for (const uniform of Object.values(material.uniforms)) {
      const value = uniform?.value;
      if (value?.isTexture && !disposed.has(value)) {
        disposed.add(value);
        value.dispose();
      }
    }
  }
  material.dispose();
}

/** Disposes every geometry, material and texture below `root` (each only once). */
export function disposeObject3D(root) {
  if (!root) return;
  const disposed = new Set();
  root.traverse((object) => {
    if (object.geometry && !disposed.has(object.geometry)) {
      disposed.add(object.geometry);
      object.geometry.dispose();
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => disposeMaterial(material, disposed));
  });
  root.removeFromParent();
}

/** Collects teardown functions and runs them in reverse order. */
export function createCleanupStack() {
  const tasks = [];
  return {
    add(task) {
      if (typeof task === 'function') tasks.push(task);
      return task;
    },
    listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      tasks.push(() => target.removeEventListener(type, handler, options));
    },
    run() {
      while (tasks.length) {
        try {
          tasks.pop()();
        } catch (error) {
          console.warn('[cleanup] task failed', error);
        }
      }
    },
  };
}
