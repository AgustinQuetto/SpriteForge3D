import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { MapBatchRenderer } from '../src/engine/MapBatchRenderer.js';
import { createMapTile } from '../src/engine/MapEditor.js';
import { createEngineSettings } from '../src/engine/GameComponents.js';
import { GameRuntime } from '../src/engine/GameRuntime.js';
import { serializeGameObject } from '../src/engine/GameAssets.js';
import { setLocalMatrix } from '../src/core/AuthoringTransforms.js';

function grid(count = 16) {
  const scene = new THREE.Scene(); const root = new THREE.Group(); scene.add(root);
  for (let index = 0; index < count; index++) root.add(createMapTile('ground', { x: index % 16, z: Math.floor(index / 16), size: 32, layer: 'Ground', elevation: 0 }, index % 2 ? '#557744' : '#779955'));
  const camera = new THREE.PerspectiveCamera(); const batches = new MapBatchRenderer(scene, () => root);
  return { scene, root, camera, batches, render: callback => batches.render({ render: callback || (() => {}) }, camera) };
}

test('opaque map tiles share spatial instance batches while retaining independent authored objects and colors', () => {
  const { root, batches, render } = grid(); root.updateMatrixWorld(true); const before = root.toJSON();
  render(() => {
    assert.equal(root.children.filter(object => object.visible).length, 0);
    assert.equal(batches.batches.length, 1); assert.equal(batches.batches[0].mesh.count, 16);
    const mesh = batches.batches[0].mesh; const first = new THREE.Color(); const second = new THREE.Color();
    mesh.getColorAt(0, first); mesh.getColorAt(1, second); assert.notEqual(first.getHex(), second.getHex());
    assert.equal(mesh.material.color.getHex(), 0xffffff);
  });
  assert.equal(root.children.filter(object => object.visible).length, 16);
  assert.deepEqual(root.toJSON(), before);
  assert.equal(root.children.length, 16); assert.equal(batches.stats.cells, 16);
  batches.dispose(); assert.equal(root.children[0].geometry.attributes.position.count, 24);
});

test('instance matrices, colors, bounds, hidden parents and camera layers follow source edits', () => {
  const { root, camera, batches, render } = grid(); render();
  const object = root.children[0]; object.position.x = 1050.1; object.material.color.set('#ff0000'); render();
  const batch = batches.batches[0].mesh; const matrix = new THREE.Matrix4(); batch.getMatrixAt(0, matrix);
  assert.equal(matrix.elements[12], Math.fround(1050.1));
  const version = batch.instanceMatrix.version; render(); assert.equal(batch.instanceMatrix.version, version);
  assert.ok(batch.boundingSphere.center.x + batch.boundingSphere.radius > 1050);
  const color = new THREE.Color(); batch.getColorAt(0, color); assert.equal(color.getHex(), 0xff0000);
  object.visible = false; render(); assert.equal(batches.stats.cells, 15); assert.equal(object.visible, false);
  root.visible = false; render(); assert.equal(batches.stats.cells, 0);
  root.visible = true; camera.layers.set(2); render(); assert.equal(batches.stats.cells, 0);
  object.visible = true; object.layers.set(2); render(); assert.equal(batches.stats.cells, 1);
  batches.dispose();
});

test('material or geometry edits, negative scale, shear, animation and custom rendering fall back without visual loss', () => {
  const { root, batches, render } = grid(); render();
  root.children[0].material.roughness = 0.25;
  root.children[1].geometry.translate(0, 4, 0);
  root.children[2].scale.x = -1;
  setLocalMatrix(root.children[3], new THREE.Matrix4().set(1, 0.3, 0, 112, 0, 1, 0, 1, 0, 0, 1, 16, 0, 0, 0, 1));
  root.children[4].userData.game.animation.enabled = true;
  root.children[5].onBeforeRender = () => {};
  render(() => {
    assert.equal(batches.stats.cells, 10);
    root.children.slice(0, 6).forEach(object => assert.equal(object.visible, true));
  });
  batches.invalidate(); render(); assert.equal(batches.stats.cells, 10);
  batches.dispose();
});

test('render exceptions restore source visibility, and disabling batching renders the original scene', () => {
  const { root, camera, batches, render } = grid();
  assert.throws(() => render(() => { throw new Error('GPU unavailable'); }), /GPU unavailable/);
  root.children.forEach(object => assert.equal(object.visible, true));
  batches.render({ render: () => root.children.forEach(object => assert.equal(object.visible, true)) }, camera, false);
  assert.equal(batches.group.visible, false); assert.equal(batches.stats.cells, 0);
  batches.dispose();
});

test('rebuilds account for structural edits and detached sources never remain visible as stale instances', () => {
  const { root, batches, render } = grid(); render();
  const removed = root.children[0]; removed.removeFromParent(); render(); assert.equal(batches.stats.cells, 15);
  batches.invalidate(); render(); assert.equal(batches.stats.cells, 15);
  root.add(removed); batches.invalidate(); render(); assert.equal(batches.stats.cells, 16);
  assert.equal(batches.batches.length, 1); batches.dispose();
});

test('runtime and editor snapshots share batching without leaking render helpers into saves or export', () => {
  const { root, batches, render } = grid(32); render();
  const runtime = new GameRuntime(root, createEngineSettings()); runtime.start();
  runtime.render({ render: () => {} }); assert.equal(runtime.mapRenderer.stats.cells, 32);
  assert.equal(runtime.root.children.length, 32);
  assert.equal(JSON.stringify(serializeGameObject(root)).includes('MapRenderBatch'), false);
  runtime.dispose(); batches.dispose();
});
