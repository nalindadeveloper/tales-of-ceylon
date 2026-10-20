/**
 * WebGL renderer setup with a capped device pixel ratio and colour management.
 */
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';

export function createRenderer(canvas, quality) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: quality.antialias,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = PCFShadowMap;

  function resize(width, height) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
    renderer.setSize(width, height, false);
  }

  return {
    renderer,
    resize,
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    dispose: () => renderer.dispose(),
  };
}
