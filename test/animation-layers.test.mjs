import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SpriteAnimator, normalizeSpriteAnimation } from '../src/engine/SpriteAnimation.js';
import { MapLayers, normalizeMapLayers } from '../src/engine/MapLayers.js';
import { createEngineSettings, createGameComponents, normalizeGameComponents } from '../src/engine/GameComponents.js';
import { createMapTile, cellAt, MapEditor } from '../src/engine/MapEditor.js';
import { cloneGameObject, parseGameObject, serializeGameObject } from '../src/engine/GameAssets.js';
import { GameRuntime } from '../src/engine/GameRuntime.js';
import { HistoryManager } from '../src/editor/HistoryManager.js';

const clip = (name, frames, loop = true) => ({ name, frames, fps: 60, loop });

function sprite(animation, overrides = {}) {
  const texture = new THREE.DataTexture(new Uint8Array(64 * 32 * 4), 64, 32);
  const object = new THREE.Mesh(new THREE.PlaneGeometry(64, 32), new THREE.MeshBasicMaterial({ map: texture }));
  object.name = 'Sprite';
  object.userData.game = createGameComponents({ animation, ...overrides });
  return object;
}

function runtime(object) {
  const source = new THREE.Group(); source.add(object);
  const game = new GameRuntime(source, createEngineSettings()); game.start();
  return game;
}

test('legacy animation data migrates to a named clip and invalid named definitions are rejected', () => {
  const legacy = normalizeSpriteAnimation({ enabled: true, columns: 2, rows: 2, fps: 12, frames: [0, 3], loop: false });
  assert.deepEqual(legacy.clips, [{ name: 'default', frames: [0, 3], fps: 12, loop: false }]);
  assert.equal(legacy.defaultClip, 'default');
  assert.throws(() => normalizeSpriteAnimation({ clips: [clip('idle', [0]), clip('idle', [0])], defaultClip: 'idle' }), /unique/);
  assert.throws(() => normalizeSpriteAnimation({ clips: [clip('idle', [1])], defaultClip: 'idle' }), /frames/);
  assert.throws(() => normalizeSpriteAnimation({ clips: [clip('idle', [0])], defaultClip: 'absent' }), /default clip/);
});

test('named clips reset immediately, stop on their final frame, and report completion once', () => {
  const config = { enabled: true, columns: 4, rows: 1, defaultClip: 'idle', clips: [clip('idle', [0]), clip('attack', [2, 3], false)] };
  const object = sprite(config);
  const animator = new SpriteAnimator(object, config);
  animator.play('attack');
  assert.deepEqual(object.material.map.offset.toArray(), [0.5, 0]);
  assert.equal(animator.update(1 / 60), false);
  assert.deepEqual(object.material.map.offset.toArray(), [0.75, 0]);
  assert.equal(animator.update(1 / 60), true);
  assert.equal(animator.update(1), false);
  animator.play('attack');
  assert.deepEqual(object.material.map.offset.toArray(), [0.5, 0]);
  animator.stop(); animator.update(1);
  assert.deepEqual(object.material.map.offset.toArray(), [0.5, 0]);
});

test('movement animations follow actual displacement, preserve facing at rest, and yield to script overrides', () => {
  const animation = { enabled: true, columns: 4, rows: 1, defaultClip: 'idle', movement: true, clips: [clip('idle', [0]), clip('walk-north', [1]), clip('idle-north', [2]), clip('attack', [3])] };
  const object = sprite(animation, { player: { enabled: true, speed: 60 } });
  const game = runtime(object);
  game.keyDown('w'); game.update(1 / 60);
  const entity = game.entities[0];
  assert.equal(entity.object.material.map.offset.x, 0.25);
  game.keyUp('w'); game.update(1 / 60);
  assert.equal(entity.object.material.map.offset.x, 0.5);
  game.api(entity).playAnimation('attack');
  game.keyDown('w'); game.update(1 / 60);
  assert.equal(entity.object.material.map.offset.x, 0.75);
  game.api(entity).resumeMovementAnimation(); game.update(1 / 60);
  assert.equal(entity.object.material.map.offset.x, 0.25);
  game.dispose();
});

test('visual events play named clips and animation completion can launch a subsequent clip', () => {
  const animation = { enabled: true, columns: 4, rows: 1, defaultClip: 'idle', clips: [clip('idle', [0]), clip('attack', [2, 3], false)] };
  const object = sprite(animation, { events: [
    { when: 'start', action: 'playAnimation', value: 'attack' },
    { when: 'animationEnd', action: 'increment', value: 'finished' },
    { when: 'animationEnd', action: 'playAnimation', value: 'idle' },
  ] });
  const game = runtime(object);
  assert.equal(game.entities[0].object.material.map.offset.x, 0.5);
  game.update(2 / 60);
  assert.equal(game.variables.finished, 1);
  assert.equal(game.entities[0].object.material.map.offset.x, 0);
  game.update(0.1);
  assert.equal(game.variables.finished, 1);
  game.dispose();
  assert.throws(() => normalizeGameComponents({ animation, events: [{ when: 'start', action: 'playAnimation', value: 'missing' }] }), /clip not found/);
});

test('frame-size fitting changes only runtime buffers, while named clips survive asset serialization', async () => {
  const animation = { enabled: true, columns: 4, rows: 2, resizeToFrame: true, defaultClip: 'walk', clips: [clip('walk', [0, 1, 2, 3]), clip('idle', [4])] };
  const source = sprite(animation);
  source.geometry.translate(0, 16, 0);
  const restored = await parseGameObject(serializeGameObject(source));
  assert.deepEqual(normalizeGameComponents(restored.userData.game).animation.clips, animation.clips);
  const game = runtime(restored);
  const bounds = new THREE.Box3().setFromObject(game.root);
  assert.deepEqual(bounds.getSize(new THREE.Vector3()).toArray(), [16, 16, 0]);
  assert.equal(bounds.min.y, 0);
  assert.deepEqual(new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3()).toArray(), [64, 32, 0]);
  assert.deepEqual(source.material.map.repeat.toArray(), [1, 1]);
  game.dispose();
});

function layerScene() {
  const exportGroup = new THREE.Group();
  const object = createMapTile('ground', cellAt({ x: 0, z: 0 }, 32, 'Legacy ground'));
  exportGroup.add(object);
  const scene = { exportGroup, objects: [object], selectedObjects: [object], deselectObject(item) { this.selectedObjects = this.selectedObjects.filter(selected => selected !== item); } };
  const settings = { ...createEngineSettings(), layer: 'Legacy ground' };
  const history = new HistoryManager();
  const layers = new MapLayers(scene, history, () => settings, () => {});
  normalizeMapLayers(settings, scene.objects);
  return { object, scene, settings, history, layers };
}

test('legacy map layers are discovered; renaming updates cells and active layer through undo/redo', () => {
  const { object, settings, history, layers } = layerScene();
  assert.ok(layers.layers.some(layer => layer.name === 'Legacy ground'));
  layers.rename('Terrain');
  assert.equal(object.userData.mapCell.layer, 'Terrain');
  assert.equal(settings.layer, 'Terrain');
  assert.equal(layers.layers.some(layer => layer.name === 'Legacy ground'), false);
  history.undo(); assert.equal(object.userData.mapCell.layer, 'Legacy ground');
  history.redo(); assert.equal(object.userData.mapCell.layer, 'Terrain');
  layers.add('Decor'); assert.equal(settings.layer, 'Decor');
  assert.throws(() => layers.rename('Terrain'), /único/);
});

test('layer visibility and locks protect painting and selection without changing game visibility', () => {
  const { object, scene, history, layers } = layerScene();
  const original = object.layers.mask;
  layers.setFlag('locked', true);
  assert.equal(layers.canPaint('Legacy ground'), false);
  assert.equal(layers.isEditable(object), false);
  assert.equal(scene.selectedObjects.length, 0);
  assert.equal(object.layers.mask, original);
  history.undo(); assert.equal(layers.isEditable(object), true);
  layers.setFlag('visible', false);
  assert.equal(object.layers.mask, 0);
  assert.equal(object.visible, true);
  assert.equal(cloneGameObject(scene.exportGroup).children[0].layers.mask, original);
  history.undo(); assert.equal(object.layers.mask, original);
});

test('locking a nested map cell protects its parent group and sibling selection state', () => {
  const { scene, object, layers } = layerScene();
  const group = new THREE.Group(); scene.exportGroup.add(group); group.add(object);
  const sibling = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); group.add(sibling);
  scene.selectedObjects = [group];
  layers.setFlag('locked', true);
  assert.equal(layers.isEditable(group), false);
  assert.equal(scene.selectedObjects.length, 0);
  layers.setFlag('visible', false);
  assert.equal(object.layers.mask, 0);
  assert.equal(sibling.layers.mask, 1);
});

test('failed stamp construction preserves an existing cell and does not poison the next stroke', () => {
  const { scene, object, history } = layerScene();
  Object.assign(scene, {
    addObject(item) { this.objects.push(item); this.exportGroup.add(item); },
    removeObject(item) { this.objects.splice(this.objects.indexOf(item), 1); item.removeFromParent(); },
  });
  const map = new MapEditor(scene, history, () => {});
  const cell = object.userData.mapCell;
  assert.throws(() => map.paint(cell, () => { throw new Error('Bad asset'); }), /Bad asset/);
  assert.equal(scene.objects[0], object);
  map.paint(cell, item => createMapTile('wall', item)); map.end();
  assert.equal(scene.objects[0].userData.game.collider.mode, 'solid');
  history.undo(); assert.equal(scene.objects[0], object);
});
