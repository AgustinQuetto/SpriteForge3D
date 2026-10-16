import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createMapTile, MapEditor, cellAt } from '../src/engine/MapEditor.js';
import { anchorMapCell, reconcileMapCell, reconcileMapCells } from '../src/engine/MapPlacement.js';
import { HistoryManager } from '../src/editor/HistoryManager.js';
import { captureProjectScene, normalizeProjectDocument, prepareProjectScene } from '../src/project/ProjectDocument.js';
import { attachPreservingWorld } from '../src/core/AuthoringTransforms.js';

const initial = { x: 0, z: 0, size: 32, elevation: 0, layer: 'Ground' };
function setup(objects) {
  const root = new THREE.Group(); root.add(...objects);
  const scene = { objects: [...objects], groups: [], exportGroup: root,
    addObject(object) { this.objects.push(object); root.add(object); },
    removeObject(object) { this.objects.splice(this.objects.indexOf(object), 1); object.removeFromParent(); },
  };
  const history = new HistoryManager(); return { scene, history, map: new MapEditor(scene, history, () => {}) };
}

test('translated placements reconcile cell coordinates and elevation so erase no longer targets the old address', () => {
  const tile = createMapTile('wall', initial); const { scene, history, map } = setup([tile]);
  tile.position.add(new THREE.Vector3(-64, 9.5, 96)); reconcileMapCells(scene.objects);
  const cell = tile.userData.mapCell; assert.deepEqual([cell.x, cell.z, cell.elevation], [-2, 3, 9.5]);
  map.paint(initial, null, true); map.end(); assert.equal(scene.objects.length, 1);
  map.paint({ ...initial, x: -2, z: 3, elevation: 9.5 }, null, true); map.end(); assert.equal(scene.objects.length, 0);
  history.undo(); assert.equal(scene.objects[0], tile); history.redo(); assert.equal(scene.objects.length, 0);
});

test('rotated and nonuniformly scaled parents move support points while grid size and layers remain authored', () => {
  const tile = createMapTile('wall', initial); const { scene } = setup([tile]); const parent = new THREE.Group(); scene.exportGroup.add(parent); parent.add(tile);
  parent.position.set(-70, 12, 80); parent.rotation.set(0.2, 0.7, -0.3); parent.scale.set(2, 3, 0.5);
  parent.updateMatrixWorld(true); const support = new THREE.Vector3(0, -16, 0).applyMatrix4(tile.matrixWorld);
  reconcileMapCell(tile); const cell = tile.userData.mapCell;
  assert.equal(cell.x, Math.floor(support.x / 32)); assert.equal(cell.z, Math.floor(support.z / 32));
  assert.ok(Math.abs(cell.elevation - support.y) < 1e-6); assert.equal(cell.size, 32); assert.equal(cell.layer, 'Ground');
  parent.position.set(0, 0, 0); parent.rotation.set(0, 0, 0); parent.scale.set(1, 1, 1); reconcileMapCell(tile);
  assert.deepEqual([cell.x, cell.z, cell.elevation], [0, 0, 0]);
});

test('scale edits follow the base of a tile and singular placements retain finite metadata', () => {
  const tile = createMapTile('wall', initial); setup([tile]); tile.scale.y = 2; reconcileMapCell(tile);
  assert.equal(tile.userData.mapCell.elevation, -16);
  tile.scale.y = 0; reconcileMapCell(tile); assert.equal(tile.userData.mapCell.elevation, 16);
  const custom = new THREE.Group(); custom.position.set(16, 4, 16); custom.scale.y = 0;
  anchorMapCell(custom, { ...initial, elevation: 4 }); reconcileMapCell(custom);
  assert.deepEqual(custom.userData.mapCell.anchor, [0, 0, 0]); assert.equal(custom.userData.mapCell.elevation, 4);
});

test('legacy cells adopt the current pivot and saved editing plane; floating-point boundaries are stable', () => {
  const tile = createMapTile('wall', initial); delete tile.userData.mapCell.anchor; tile.position.x = 80;
  reconcileMapCell(tile); assert.equal(tile.userData.mapCell.x, 2); assert.equal(tile.userData.mapCell.elevation, 0);
  tile.position.y += 6; reconcileMapCell(tile); assert.equal(tile.userData.mapCell.elevation, 6);
  assert.equal(cellAt({ x: 32 - 1e-13, z: -32 - 1e-13 }, 32).x, 1);
  assert.equal(cellAt({ x: -0.1, z: -32 - 1e-13 }, 32).z, -1);
});

test('overlapping placements replace and erase together; undo restores all original parents and buffers', () => {
  const first = createMapTile('ground', initial); const second = createMapTile('wall', initial);
  const { scene, history, map } = setup([first, second]); const parent = new THREE.Group(); scene.exportGroup.add(parent); parent.add(second);
  map.paint(initial, cell => createMapTile('ground', cell)); map.end(); assert.equal(scene.objects.length, 1);
  const replacement = scene.objects[0]; history.undo(); assert.deepEqual(new Set(scene.objects), new Set([first, second])); assert.equal(second.parent, parent);
  history.redo(); assert.deepEqual(scene.objects, [replacement]); map.paint(initial, null, true); map.end();
  assert.equal(scene.objects.length, 0); history.undo(); assert.equal(scene.objects[0], replacement);
});

test('blocked occupants and invalid factories leave every existing placement intact', () => {
  const tile = createMapTile('ground', initial); const { scene, map } = setup([tile]);
  scene.canEditObject = () => false; assert.throws(() => map.paint(initial, () => { throw new Error('Must not build'); }), /bloqueada/);
  assert.deepEqual(scene.objects, [tile]); scene.canEditObject = () => true;
  assert.throws(() => map.paint(initial, () => null), /objeto válido/); assert.deepEqual(scene.objects, [tile]);
  map.paint(initial, null, true); map.end(); assert.equal(scene.objects.length, 0);
});

test('support anchors survive save/reload, reparenting and later transforms without stale map addresses', async () => {
  const tile = createMapTile('wall', initial); const { scene } = setup([tile]); const parent = new THREE.Group(); parent.name = 'Map group'; parent.userData.isSceneGroup = true;
  scene.exportGroup.add(parent); scene.groups.push(parent); attachPreservingWorld(parent, tile); parent.position.set(64, 8, -32);
  const doc = normalizeProjectDocument(JSON.parse(JSON.stringify({ version: 4, assets: [], ...captureProjectScene(scene) })));
  const restored = await prepareProjectScene(doc); const copy = restored.objects[0];
  assert.deepEqual(copy.userData.mapCell.anchor, [0, -16, 0]);
  assert.deepEqual([copy.userData.mapCell.x, copy.userData.mapCell.z, copy.userData.mapCell.elevation], [2, -1, 8]);
  restored.groups[0].position.x -= 96; reconcileMapCells(restored.objects); assert.equal(copy.userData.mapCell.x, -1);
  const bad = structuredClone(doc); bad.objects[0].visual.object.userData.mapCell.anchor = [0, 'bad', 0];
  assert.throws(() => normalizeProjectDocument(bad), /anchor/);
});
