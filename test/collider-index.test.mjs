import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ColliderIndex } from '../src/engine/ColliderIndex.js';
import { colliderBounds, overlapsXZ, normalizeCollider } from '../src/engine/Colliders.js';
import { createGameComponents, createEngineSettings, normalizeGameComponents } from '../src/engine/GameComponents.js';
import { GameRuntime } from '../src/engine/GameRuntime.js';

function entity(x, z, mode = 'solid', size = 10) {
  const object = new THREE.Object3D(); object.position.set(x, 0, z);
  const components = normalizeGameComponents(createGameComponents({ collider: { mode, size: [size, size] } })); object.userData.game = components;
  return { object, components };
}

test('analytic collider bounds match transformed corner bounds for compound scales, rotations and shear', () => {
  for (let index = 0; index < 30; index++) {
    const parent = new THREE.Group(); parent.position.set(index, 5, -index); parent.scale.set(index % 2 ? -2 : 2, 3, 0.5); parent.rotation.set(0.3, index * 0.1, 0.7);
    const object = new THREE.Object3D(); object.rotation.set(0.5, 0.8, 0.1); object.scale.set(1, 2, 0.3); parent.add(object);
    const collider = normalizeCollider({ size: [14, 17], offset: [-2, 5], offsetY: -4, height: 20 });
    const bounds = colliderBounds(object, collider); const reference = new THREE.Box3();
    for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) reference.expandByPoint(new THREE.Vector3(-2 + x * 14, -4 + y * 20, 5 + z * 17).applyMatrix4(object.matrixWorld));
    for (const axis of ['X', 'Y', 'Z']) for (const side of ['min', 'max']) assert.ok(Math.abs(bounds[`${side}${axis}`] - reference[side][axis.toLowerCase()]) < 1e-7);
  }
});

test('spatial queries include every real overlap while excluding distant colliders and respecting dynamic edits', () => {
  const entries = Array.from({ length: 3000 }, (_, index) => entity((index % 100 - 50) * 32, (Math.floor(index / 100) - 15) * 32));
  const index = new ColliderIndex(32); index.sync(entries, item => item.components.enabled);
  const query = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }; const candidates = index.query(query);
  assert.ok(candidates.length < 30);
  for (const item of entries) if (overlapsXZ(index.bounds(item), query)) assert.ok(candidates.some(candidate => candidate.entity === item));
  const moved = entries[0]; moved.object.position.set(0, 0, 0); index.sync(entries, item => item.components.enabled);
  assert.ok(index.query(query).some(candidate => candidate.entity === moved));
  moved.components.enabled = false; index.sync(entries, item => item.components.enabled);
  assert.equal(index.query(query).some(candidate => candidate.entity === moved), false);
  moved.components.enabled = true; moved.object.position.x = 200; moved.components.collider.size[0] = 500;
  index.sync(entries, item => item.components.enabled); assert.ok(index.query(query).some(candidate => candidate.entity === moved));
  index.clear(); assert.equal(index.cells.size, 0);
});

test('huge colliders, long queries and non-finite script transforms use bounded fallbacks', () => {
  const huge = entity(0, 0, 'solid', 100000); const local = entity(-2, 4); const index = new ColliderIndex(1);
  index.sync([huge, local], () => true); assert.equal(index.large.size, 1);
  assert.equal(index.query({ minX: 10000, maxX: 10001, minZ: 20, maxZ: 21 }).some(entry => entry.entity === huge), true);
  assert.equal(index.query(index.bounds(huge)).length, 2);
  local.object.position.x = Infinity; index.sync([huge, local], () => true); assert.equal(index.large.size, 2);
  assert.equal(index.query(index.bounds(local)).length, 2);
  local.object.position.x = 1e20; index.sync([huge, local], () => true);
  assert.equal(index.query(index.bounds(local)).length, 2);
});

test('swept movement finds thin solids across many spatial cells without tunneling', () => {
  const player = entity(-4000, -16); player.object.name = 'Player';
  const wall = entity(4000, -16, 'solid', 2); const root = new THREE.Group(); root.add(player.object, wall.object);
  const runtime = new GameRuntime(root, createEngineSettings()); runtime.start();
  runtime.api(runtime.entities[0]).move(20000, 0);
  assert.ok(Math.abs(runtime.entities[0].object.position.x - 3994) < 1e-7); runtime.dispose();
});

test('indexed simulation matches brute-force collision candidates through motion, activation and trigger transitions', () => {
  const root = new THREE.Group();
  for (let i = 0; i < 60; i++) {
    const item = entity((i % 10) * 40 - 200, Math.floor(i / 10) * 40 - 120, i % 4 ? 'solid' : 'trigger', 12);
    item.object.name = `Object ${i}`;
    item.object.userData.game.events = ['triggerEnter', 'triggerStay', 'triggerExit'].map(when => ({ when, action: 'message', value: `${i}:${when}` })); root.add(item.object);
  }
  const firstMessages = []; const secondMessages = [];
  const first = new GameRuntime(root, createEngineSettings(), { onMessage: value => firstMessages.push(value) });
  const second = new GameRuntime(root, createEngineSettings(), { onMessage: value => secondMessages.push(value) });
  second.colliderIndex.query = () => [...second.colliderIndex.entries.values()].sort((a, b) => a.order - b.order);
  first.start(); second.start();
  for (let step = 0; step < 24; step++) {
    const mover = step % 8;
    for (const runtime of [first, second]) {
      runtime.api(runtime.entities[mover]).move(step % 2 ? -95 : 73, step % 3 ? 43 : -37);
      if (step % 6 === 0) runtime.setEnabled(runtime.entities[20], step % 12 === 0);
      runtime.entities[30].object.position.z = step * 5 - 40; runtime.update(1 / 60);
    }
    assert.deepEqual(first.entities.map(item => item.object.position.toArray()), second.entities.map(item => item.object.position.toArray()));
    assert.deepEqual([...first.contacts.keys()], [...second.contacts.keys()]);
    assert.deepEqual(firstMessages, secondMessages);
  }
  first.dispose(); second.dispose();
});
