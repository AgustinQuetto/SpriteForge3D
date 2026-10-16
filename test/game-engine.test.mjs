import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEngineSettings, createGameComponents, normalizeGameComponents } from '../src/engine/GameComponents.js';
import { cloneGameObject, serializeGameObject, parseGameObject } from '../src/engine/GameAssets.js';
import { cellAt, createMapTile, MapEditor } from '../src/engine/MapEditor.js';
import { GameRuntime } from '../src/engine/GameRuntime.js';
import { HistoryManager } from '../src/editor/HistoryManager.js';

function entity(name, x, z, overrides = {}) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial());
  object.name = name;
  object.position.set(x, 5, z);
  object.userData.game = createGameComponents({ collider: { mode: 'solid', size: [10, 10], offset: [0, 0] }, ...overrides });
  return object;
}

function game(objects, callbacks) {
  const source = new THREE.Group();
  source.add(...objects);
  const runtime = new GameRuntime(source, createEngineSettings(), callbacks);
  runtime.start();
  return runtime;
}

test('map cells use consistent negative coordinates and a stroke replaces cells atomically through undo/redo', () => {
  const root = new THREE.Group();
  const scene = { objects: [], addObject(object) { this.objects.push(object); root.add(object); }, removeObject(object) { this.objects.splice(this.objects.indexOf(object), 1); object.removeFromParent(); } };
  const history = new HistoryManager();
  const map = new MapEditor(scene, history, () => {});
  const cell = cellAt({ x: -0.1, z: -32.1 }, 32);
  assert.equal(cell.x, -1); assert.equal(cell.z, -2);
  const ground = createMapTile('ground', cell);
  scene.addObject(ground);
  map.paint(cell, item => createMapTile('wall', item));
  map.paint(cell, () => { throw new Error('A repeated stroke cell must not be rebuilt'); });
  map.end();
  assert.equal(scene.objects.length, 1);
  assert.equal(scene.objects[0].userData.game.collider.mode, 'solid');
  history.undo();
  assert.equal(scene.objects[0], ground);
  history.redo();
  assert.equal(scene.objects[0].userData.game.collider.mode, 'solid');
  map.paint(cell, null, true); map.end();
  assert.equal(scene.objects.length, 0);
  history.undo(); assert.equal(scene.objects.length, 1);
});

test('independent asset instances and visual snapshots preserve geometry, game IDs, visibility, and map data', async () => {
  const source = createMapTile('wall', cellAt({ x: 40, z: -1 }, 32));
  source.visible = false;
  const copy = cloneGameObject(source);
  copy.userData.game.collider.size[0] = 500;
  copy.material.color.set('#ff0000');
  assert.equal(source.userData.game.collider.size[0], 32);
  assert.notEqual(copy.material.color.getHex(), source.material.color.getHex());
  const restored = await parseGameObject(serializeGameObject(source));
  assert.equal(restored.userData.game.id, source.userData.game.id);
  assert.equal(restored.visible, false);
  assert.deepEqual(restored.userData.mapCell, source.userData.mapCell);
  assert.deepEqual(restored.position.toArray(), source.position.toArray());
  assert.deepEqual(new THREE.Box3().setFromObject(restored).getSize(new THREE.Vector3()).toArray(), [32, 32, 32]);
});

test('whole-scene snapshots preserve child transforms before a renderer has updated matrices', async () => {
  const group = new THREE.Group();
  group.position.set(10, 0, -20);
  const player = entity('Player', 80, 144);
  group.add(player);
  const restored = await parseGameObject(serializeGameObject(group));
  restored.updateMatrixWorld(true);
  assert.deepEqual(restored.children[0].getWorldPosition(new THREE.Vector3()).toArray(), [90, 5, 124]);
});

test('asset snapshots preserve edited primitive vertices and bottom-anchored sprite pivots', async () => {
  const source = new THREE.Mesh(new THREE.PlaneGeometry(20, 40), new THREE.MeshBasicMaterial());
  source.geometry.translate(0, 20, 0);
  source.geometry.attributes.position.setZ(0, 5);
  const restored = await parseGameObject(serializeGameObject(source));
  assert.deepEqual([...restored.geometry.attributes.position.array], [...source.geometry.attributes.position.array]);
  const bounds = new THREE.Box3().setFromObject(restored);
  assert.equal(bounds.min.y, 0);
  assert.equal(bounds.max.y, 40);
});

test('fixed-step movement slides along walls without tunneling and preserves the authored scene', () => {
  const player = entity('Player', 0, 0, { player: { enabled: true, speed: 600 } });
  const wall = entity('Wall', 20, 0);
  const runtime = game([player, wall]);
  runtime.keyDown('d'); runtime.update(0.1);
  assert.equal(runtime.entities[0].object.position.x, 10);
  runtime.keyDown('s'); runtime.update(0.1);
  assert.ok(runtime.entities[0].object.position.z > 0);
  assert.equal(player.position.x, 0);
  assert.equal(player.position.z, 0);
  runtime.dispose();
  assert.ok(player.geometry.getAttribute('position'));
});

test('trigger enter/stay/exit, interaction, and script errors are routed to the correct object', () => {
  const player = entity('Player', 0, 0, { player: { enabled: true, speed: 60 } });
  const trigger = entity('Zone', 10, 0, {
    collider: { mode: 'trigger', size: [10, 10], offset: [0, 0] },
    events: [
      { when: 'triggerEnter', action: 'increment', value: 'enter' },
      { when: 'triggerStay', action: 'increment', value: 'stay' },
      { when: 'triggerExit', action: 'increment', value: 'exit' },
      { when: 'interact', action: 'message', value: 'Hello' },
    ],
    script: 'return { update() { throw new Error("broken"); } };',
  });
  const messages = []; const errors = [];
  const runtime = game([player, trigger], { onMessage: value => messages.push(value), onError: value => errors.push(value) });
  runtime.keyDown('d'); runtime.update(1 / 60); runtime.keyUp('d');
  runtime.update(1 / 60);
  runtime.keyDown('e'); runtime.update(1 / 60); runtime.keyUp('e');
  assert.equal(runtime.variables.enter, 1);
  assert.ok(runtime.variables.stay >= 1);
  assert.deepEqual(messages, ['Hello']);
  assert.deepEqual(errors, ['Zone / update: broken (línea 1)']);
  runtime.keyDown('a'); runtime.update(0.1);
  assert.equal(runtime.variables.exit, 1);
  runtime.dispose();
});

test('pause freezes simulation, short key presses survive until a fixed step, and scripts use collision-aware movement', () => {
  const source = entity('Script', 0, 0, { script: 'return { update(dt) { api.move(600 * dt, 0); if (api.input.pressed("e")) api.variables.presses = (api.variables.presses || 0) + 1; } };' });
  const runtime = game([source, entity('Wall', 20, 0)]);
  runtime.paused = true; runtime.update(0.1);
  assert.equal(runtime.entities[0].object.position.x, 0);
  runtime.paused = false;
  runtime.keyDown('e'); runtime.keyUp('e'); runtime.update(1 / 120);
  assert.equal(runtime.variables.presses, undefined);
  runtime.update(1 / 120);
  assert.equal(runtime.variables.presses, 1);
  assert.equal(runtime.entities[0].object.position.x, 10);
  runtime.dispose();
});

test('recursive visual signals have an event budget and do not hang Play', () => {
  const object = entity('Signals', 0, 0, { events: [
    { when: 'start', action: 'emit', value: 'loop' },
    { when: 'signal', signal: 'loop', action: 'emit', value: 'loop' },
  ] });
  const errors = [];
  const runtime = game([object], { onError: value => errors.push(value) });
  assert.equal(errors.length, 1);
  assert.equal(runtime.queue.length, 0);
  runtime.dispose();
});

test('sprite animation uses top-left sheet frame order and never changes authored textures', () => {
  const object = entity('Animated', 0, 0, { animation: { enabled: true, columns: 2, rows: 2, fps: 60, frames: [0, 3], loop: false } });
  object.material.map = new THREE.Texture();
  const runtime = game([object]);
  runtime.update(1 / 60);
  const texture = runtime.entities[0].object.material.map;
  assert.deepEqual(texture.repeat.toArray(), [0.5, 0.5]);
  assert.deepEqual(texture.offset.toArray(), [0.5, 0]);
  assert.deepEqual(object.material.map.repeat.toArray(), [1, 1]);
  assert.deepEqual(object.material.map.offset.toArray(), [0, 0]);
  runtime.dispose();
});

test('colliders respect parent transforms and component validation rejects invalid animation frames', () => {
  const parent = new THREE.Group(); parent.scale.set(2, 1, 3); parent.position.x = 50;
  const child = entity('Child', 5, 0); parent.add(child);
  const runtime = game([parent]);
  assert.deepEqual(runtime.bounds(runtime.entities[0]), { minX: 50, maxX: 70, minZ: -15, maxZ: 15, minY: 5, maxY: 37 });
  assert.throws(() => normalizeGameComponents({ animation: { columns: 1, rows: 1, frames: [1] } }), /frames/);
  runtime.dispose();
});
