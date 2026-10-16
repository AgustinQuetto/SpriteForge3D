import * as THREE from 'three';
import { cloneGameObject, disposeGameObject } from './GameAssets.js';

export function renderResourceThumbnail(source, renderer, size = 112) {
  const copy = cloneGameObject(source); copy.visible = true;
  const scene = new THREE.Scene(); scene.add(copy, new THREE.HemisphereLight(0xffffff, 0x48545e, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(200, 400, 160); scene.add(sun);
  const bounds = new THREE.Box3().setFromObject(copy);
  const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  const radius = bounds.isEmpty() ? 16 : Math.max(1, bounds.getSize(new THREE.Vector3()).length() / 2);
  const camera = new THREE.OrthographicCamera(-radius * 1.15, radius * 1.15, radius * 1.15, -radius * 1.15, 0.01, radius * 20 + 100);
  camera.position.copy(center).add(new THREE.Vector3(1, 0.9, 1.5).normalize().multiplyScalar(radius * 4)); camera.lookAt(center);
  const target = new THREE.WebGLRenderTarget(size, size); target.texture.colorSpace = THREE.SRGBColorSpace;
  const previous = {
    target: renderer.getRenderTarget(), viewport: renderer.getViewport(new THREE.Vector4()),
    scissor: renderer.getScissor(new THREE.Vector4()), scissorTest: renderer.getScissorTest(),
    clearColor: renderer.getClearColor(new THREE.Color()), clearAlpha: renderer.getClearAlpha(), autoClear: renderer.autoClear,
  };
  try {
    renderer.setRenderTarget(target); renderer.setViewport(0, 0, size, size); renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0); renderer.autoClear = true; renderer.clear(); renderer.render(scene, camera);
    const pixels = new Uint8Array(size * size * 4); renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const context = canvas.getContext('2d'); const image = context.createImageData(size, size);
    for (let row = 0; row < size; row++) image.data.set(pixels.subarray((size - row - 1) * size * 4, (size - row) * size * 4), row * size * 4);
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    renderer.setRenderTarget(previous.target); renderer.setViewport(previous.viewport); renderer.setScissor(previous.scissor);
    renderer.setScissorTest(previous.scissorTest); renderer.setClearColor(previous.clearColor, previous.clearAlpha); renderer.autoClear = previous.autoClear;
    target.dispose(); disposeGameObject(copy);
  }
}
