import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createGameComponents, createEngineSettings, normalizeGameComponents } from '../src/engine/GameComponents.js';
import { normalizeEventRules } from '../src/engine/GameEvents.js';
import { ColliderOverlay, colliderBounds, fitColliderToVisual, normalizeCollider } from '../src/engine/Colliders.js';
import { GameRuntime } from '../src/engine/GameRuntime.js';
import { cloneGameObject, reidentifyGameObjects, serializeGameObject, parseGameObject } from '../src/engine/GameAssets.js';

function object(name, x = 0, z = 0, game = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial());
  mesh.name = name; mesh.position.set(x, 0, z);
  mesh.userData.game = createGameComponents({ collider: { mode: 'solid', size: [10, 10], offset: [0, 0] }, ...game });
  return mesh;
}

function setup(objects, callbacks = {}) {
  const source = new THREE.Group(); source.add(...objects);
  const runtime = new GameRuntime(source, createEngineSettings(), callbacks);
  runtime.start();
  return runtime;
}

test('legacy actions migrate to ordered numeric actions and malformed event definitions are rejected', () => {
  const [rule] = normalizeEventRules([{ when: 'start', action: 'increment', value: 'keys' }]);
  assert.deepEqual(rule.actions, [{ type: 'addVariable', value: 'keys', amount: 1, target: 'self' }]);
  assert.equal(rule.once, false);
  assert.throws(() => normalizeEventRules([{ when: 'start', actions: [] }]), /1 to 32/);
  assert.throws(() => normalizeEventRules([{ when: 'start', cooldown: -1, action: 'message', value: '' }]), /cooldown/);
  assert.throws(() => normalizeEventRules([{ when: 'start', conditions: [{ variable: 'keys', operator: 'eval', value: 1 }], action: 'message', value: '' }]), /condition/);
});

test('a collectible filters the other tag, increments once, hides/disables itself and displays the new score in order', () => {
  const pickup = object('Key', 0, 0, { collider: { mode: 'trigger', size: [10, 10], offset: [0, 0] }, events: [{
    when: 'triggerEnter', otherTag: 'player', once: true, actions: [
      { type: 'addVariable', value: 'keys', amount: 1 }, { type: 'hide' }, { type: 'disable' }, { type: 'message', value: 'Keys: {keys}' },
    ],
  }] });
  const npc = object('NPC', 0, 0, { tag: 'npc', collider: { mode: 'trigger', size: [2, 2], offset: [0, 0] } });
  const player = object('Player', 30, 0, { tag: 'player', collider: { mode: 'trigger', size: [2, 2], offset: [0, 0] } });
  const messages = [];
  const game = setup([pickup, npc, player], { onMessage: message => messages.push(message) });
  game.update(1 / 60);
  assert.equal(game.variables.keys, undefined);
  game.api(game.entities[2]).move(-30, 0); game.update(1 / 60);
  assert.equal(game.variables.keys, 1);
  assert.deepEqual(messages, ['Keys: 1']);
  assert.equal(game.entities[0].object.visible, false);
  assert.equal(game.entities[0].components.enabled, false);
  assert.equal(pickup.visible, true);
  assert.equal(pickup.userData.game.enabled, true);
  game.dispose();
});

test('variable conditions and stable object targets implement a key-gated door', () => {
  const door = object('Door', 20, 0);
  const switchObject = object('Switch', 0, 0, { events: [{
    when: 'signal', signal: 'unlock', conditions: [{ variable: 'keys', operator: 'gte', value: 1 }], actions: [
      { type: 'addVariable', value: 'keys', amount: -1 }, { type: 'disable', target: door.userData.game.id },
      { type: 'message', value: 'Open; keys={keys}' },
    ],
  }] });
  const messages = []; const game = setup([switchObject, door], { onMessage: value => messages.push(value) });
  game.emit('unlock'); game.update(1 / 60);
  assert.equal(game.entities[1].components.enabled, true);
  game.variables.keys = 1; game.emit('unlock'); game.update(1 / 60);
  assert.equal(game.entities[1].components.enabled, false);
  assert.deepEqual(messages, ['Open; keys=0']);
  game.dispose();
});

test('one-shot and cooldown rules retain state independently per instance and reset on a new Play session', () => {
  const rule = { when: 'signal', signal: 'tick', cooldown: 0.05, actions: [{ type: 'addVariable', value: 'ticks', amount: 1 }] };
  const once = { when: 'signal', signal: 'once', once: true, actions: [{ type: 'addVariable', value: 'once', amount: 1 }] };
  const a = object('A', 0, 0, { events: [rule, once] });
  const b = object('B', 30, 0, { events: [rule, once] });
  const game = setup([a, b]);
  game.emit('tick'); game.emit('tick'); game.emit('once'); game.emit('once'); game.update(1 / 60);
  assert.equal(game.variables.ticks, 2); assert.equal(game.variables.once, 2);
  game.update(0.05); game.emit('tick'); game.emit('once'); game.update(1 / 60);
  assert.equal(game.variables.ticks, 4); assert.equal(game.variables.once, 2);
  game.dispose();
  const next = setup([a, b]); next.emit('once'); next.update(1 / 60);
  assert.equal(next.variables.once, 2); next.dispose();
});

test('missing targets produce contextual diagnostics once, and later actions still execute', () => {
  const errors = [];
  const source = object('Button', 0, 0, { events: [{ when: 'signal', signal: 'press', actions: [
    { type: 'disable', target: 'missing-object' }, { type: 'addVariable', value: 'attempts', amount: 1 },
  ] }] });
  const game = setup([source], { onError: value => errors.push(value) });
  game.emit('press'); game.emit('press'); game.update(1 / 60);
  assert.equal(game.variables.attempts, 2); assert.equal(errors.length, 1);
  assert.match(errors[0], /Button \/ signal action 1.*missing-object/);
  game.dispose();
});

test('start signals can reach hooks on objects appearing later in the scene', () => {
  const sender = object('Sender', 0, 0, { script: 'return { start() { api.emit("ready", 7); } };' });
  const receiver = object('Receiver', 30, 0, { script: 'return { onEvent(name, data) { if (name === "ready") api.variables.received = data; } };' });
  const game = setup([sender, receiver]);
  assert.equal(game.variables.received, 7); game.dispose();
});

test('interaction reaches only the closest active object with an interaction handler', () => {
  const player = object('Player', 0, 0, { player: { enabled: true, speed: 0 } });
  const near = object('Near', 15, 0, { events: [{ when: 'interact', action: 'message', value: 'near' }] });
  const far = object('Far', 35, 0, { events: [{ when: 'interact', action: 'message', value: 'far' }] });
  const messages = []; const game = setup([player, near, far], { onMessage: value => messages.push(value) });
  game.keyDown('e'); game.update(1 / 60); assert.deepEqual(messages, ['near']);
  game.dispose();
});

test('a player starting inside a wall is separated in runtime and cannot tunnel back through it', () => {
  const player = object('Player', 0, 0, { player: { enabled: true, speed: 600 } });
  const wall = object('Wall', 0, 0);
  const game = setup([player, wall]);
  assert.equal(game.entities[0].object.position.x, -10);
  game.keyDown('d'); game.update(0.1);
  assert.equal(game.entities[0].object.position.x, -10);
  assert.equal(player.position.x, 0); assert.equal(wall.position.x, 0);
  game.dispose();
});

test('height checks permit passing below elevated solids; legacy colliders still block on XZ', () => {
  const create = respectHeight => {
    const player = object('Player', 0, 0, { player: { enabled: true, speed: 600 }, collider: { mode: 'solid', size: [10, 10], offset: [0, 0], height: 10, respectHeight } });
    const bridge = object('Bridge', 20, 0); bridge.position.y = 80;
    return setup([player, bridge]);
  };
  const vertical = create(true); vertical.keyDown('d'); vertical.update(0.1);
  assert.equal(vertical.entities[0].object.position.x, 60); vertical.dispose();
  const legacy = create(false); legacy.keyDown('d'); legacy.update(0.1);
  assert.equal(legacy.entities[0].object.position.x, 10); legacy.dispose();
});

test('collision masks require mutual group membership for solids and trigger events', () => {
  const player = object('Player', 0, 0, { player: { enabled: true, speed: 600 }, collider: { mode: 'solid', size: [10, 10], offset: [0, 0], group: 2, mask: 1 } });
  const ignored = object('Ignored wall', 20, 0, { collider: { mode: 'solid', size: [10, 10], offset: [0, 0], group: 4, mask: 255 } });
  const trigger = object('Trigger', 20, 0, { collider: { mode: 'trigger', size: [20, 20], offset: [0, 0], group: 1, mask: 4 }, events: [{ when: 'triggerEnter', action: 'increment', value: 'entered' }] });
  const game = setup([player, ignored, trigger]);
  game.keyDown('d'); game.update(0.1);
  assert.equal(game.entities[0].object.position.x, 60);
  // The ignored wall (group 4) can trigger this volume; the player (group 2) cannot.
  assert.equal(game.variables.entered, 1);
  game.dispose();
});

test('disabled parent objects suppress descendant behavior and colliders', () => {
  const group = new THREE.Group(); group.userData.game = createGameComponents({ enabled: false });
  const wall = object('Hidden child wall', 20, 0, { events: [{ when: 'start', action: 'increment', value: 'started' }] }); group.add(wall);
  const player = object('Player', 0, 0, { player: { enabled: true, speed: 600 } });
  const game = setup([player, group]);
  game.keyDown('d'); game.update(0.1);
  assert.equal(game.entities[0].object.position.x, 60);
  assert.equal(game.variables.started, undefined);
  game.dispose();
});

test('fitting and collider overlays account for sprite-frame size and never enter exported scene data', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(64, 32), new THREE.MeshBasicMaterial({ map: new THREE.DataTexture(new Uint8Array(64 * 32 * 4), 64, 32) }));
  mesh.geometry.translate(0, 16, 0);
  const fit = fitColliderToVisual(mesh, { enabled: true, columns: 4, rows: 2, resizeToFrame: true });
  assert.deepEqual(fit.size, [16, 6.4]); assert.equal(fit.height, 16); assert.equal(fit.offsetY, 0);
  assert.equal(new THREE.Box3().setFromObject(mesh).max.y, 32);
  const scene = new THREE.Scene(); const root = new THREE.Group(); root.add(mesh); scene.add(root);
  const overlay = new ColliderOverlay(scene);
  overlay.update([{ object: mesh, collider: normalizeCollider({ mode: 'trigger', ...fit }), selected: true }]);
  assert.equal(overlay.group.children.length, 1);
  assert.equal(root.children.length, 1);
  assert.equal(serializeGameObject(root).object.children.length, 1);
  overlay.update([]); assert.equal(overlay.group.children.length, 0); overlay.dispose();
});

test('collider volumes transform all axes and rich event sequences survive visual asset round trips', async () => {
  const source = object('Configured', 10, 5, { collider: { mode: 'trigger', size: [10, 20], offset: [2, -1], height: 8, offsetY: -3, respectHeight: true, group: 8, mask: 2 }, events: [{ when: 'triggerEnter', otherTag: 'player', once: true, conditions: [{ variable: 'keys', operator: 'lt', value: 3 }], actions: [{ type: 'addVariable', value: 'keys', amount: 1 }, { type: 'message', value: '{keys}' }] }] });
  source.scale.set(2, 3, 2);
  const normalized = normalizeGameComponents(source.userData.game);
  assert.deepEqual(colliderBounds(source, normalized.collider), { minX: 4, maxX: 24, minZ: -17, maxZ: 23, minY: -9, maxY: 15 });
  source.userData.game = normalized;
  const restored = await parseGameObject(serializeGameObject(source));
  assert.deepEqual(restored.userData.game.events, normalized.events);
  assert.deepEqual(restored.userData.game.collider, normalized.collider);
});

test('resource instances remap internal object targets while preserving external references and source IDs', () => {
  const door = object('Door');
  const external = object('External');
  const button = object('Button', 30, 0, { events: [{ when: 'interact', actions: [
    { type: 'disable', target: door.userData.game.id }, { type: 'show', target: external.userData.game.id },
  ] }] });
  const group = new THREE.Group(); group.add(door, button);
  const instance = reidentifyGameObjects(cloneGameObject(group));
  assert.notEqual(instance.children[0].userData.game.id, door.userData.game.id);
  const actions = instance.children[1].userData.game.events[0].actions;
  assert.equal(actions[0].target, instance.children[0].userData.game.id);
  assert.equal(actions[1].target, external.userData.game.id);
  assert.equal(button.userData.game.events[0].actions[0].target, door.userData.game.id);
  const copies = [cloneGameObject(door), cloneGameObject(button)];
  reidentifyGameObjects(copies);
  assert.equal(copies[1].userData.game.events[0].actions[0].target, copies[0].userData.game.id);
});

test('showing a disabled target changes its pending visibility without reactivating its renderer or collider', () => {
  const target = object('Target', 30, 0, { enabled: false });
  const source = object('Source', 0, 0, { events: [{ when: 'signal', signal: 'show', actions: [{ type: 'show', target: target.userData.game.id }] }] });
  const game = setup([source, target]);
  game.emit('show'); game.update(1 / 60);
  assert.equal(game.entities[1].object.visible, false);
  assert.equal(game.isActive(game.entities[1]), false);
  game.api(game.entities[0]).setEnabled(true, target.userData.game.id);
  assert.equal(game.entities[1].object.visible, true);
  assert.equal(game.isActive(game.entities[1]), true);
  game.dispose();
});

test('activating an initially disabled parent starts descendant scripts once and retains their state after reactivation', () => {
  const parent = new THREE.Group(); parent.userData.game = createGameComponents({ enabled: false });
  const child = object('Child', 20, 0, { script: 'return { start() { api.variables.starts = (api.variables.starts || 0) + 1; }, update() { api.variables.updates = (api.variables.updates || 0) + 1; } };' });
  parent.add(child);
  const button = object('Button', 0, 0, { events: [{ when: 'signal', signal: 'activate', actions: [{ type: 'enable', target: parent.userData.game.id }] }] });
  const game = setup([button, parent]);
  assert.equal(game.variables.starts, undefined);
  game.emit('activate'); game.update(1 / 60);
  assert.equal(game.variables.starts, 1);
  game.update(1 / 60); assert.ok(game.variables.updates > 0);
  game.api(game.entities[0]).setEnabled(false, parent.userData.game.id);
  const updates = game.variables.updates; game.update(1 / 60); assert.equal(game.variables.updates, updates);
  game.api(game.entities[0]).setEnabled(true, parent.userData.game.id);
  game.update(1 / 60); assert.equal(game.variables.starts, 1);
  assert.ok(game.variables.updates > updates);
  game.dispose();
});
