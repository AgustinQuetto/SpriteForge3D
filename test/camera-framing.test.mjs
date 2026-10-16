import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { frameCamera } from '../src/core/CameraFraming.js';

for (const kind of ['perspective', 'orthographic']) test(`${kind} framing contains off-origin, rotated, scaled geometry in wide and narrow viewports`, () => {
  for (const aspect of [0.4, 1, 2.2]) {
    const parent = new THREE.Group(); parent.position.set(700, -32, -600); parent.rotation.set(0.3, 0.7, 0.1); parent.scale.set(2, 3, 0.5);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(180, 60, 240), new THREE.MeshBasicMaterial()); parent.add(mesh);
    const camera = kind === 'perspective' ? new THREE.PerspectiveCamera(50, aspect, 1, 10000)
      : new THREE.OrthographicCamera(-256 * aspect, 256 * aspect, 256, -256, 1, 10000);
    camera.position.set(256, 256, 256); const target = new THREE.Vector3(); const frame = frameCamera(camera, target, [parent]);
    assert.ok(frame); assert.deepEqual(target.toArray(), [700, -32, -600]);
    const bounds = new THREE.Box3().setFromObject(parent);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const projected = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1);
    }
  }
});

test('framing empty content is a no-op and large maps extend the far plane', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 10000); camera.position.set(20, 20, 20); const target = new THREE.Vector3();
  assert.equal(frameCamera(camera, target, [new THREE.Group()]), null); assert.deepEqual(camera.position.toArray(), [20, 20, 20]);
  const large = new THREE.Mesh(new THREE.BoxGeometry(30000, 100, 30000)); assert.ok(frameCamera(camera, target, [large]));
  assert.ok(camera.far > 10000);
});
