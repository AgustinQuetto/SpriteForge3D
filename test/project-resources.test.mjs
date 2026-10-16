import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SceneManager } from '../src/core/SceneManager.js';
import { attachPreservingWorld, setLocalMatrix } from '../src/core/AuthoringTransforms.js';
import { selectionRoots, captureSceneRemoval, removeSceneTrees, restoreSceneTrees } from '../src/core/SceneEdits.js';
import { captureProjectScene, cloneEditorObject, normalizeProjectDocument, prepareProjectScene, validateVisualSnapshot } from '../src/project/ProjectDocument.js';
import { ProjectLoader } from '../src/project/ProjectLoader.js';
import { restoreEditorReferences } from '../src/project/ProjectAssets.js';
import { normalizeEngineSettings } from '../src/project/EngineSettings.js';
import { createEngineSettings, createGameComponents } from '../src/engine/GameComponents.js';
import { cloneGameObject, disposeGameObject, parseGameObject } from '../src/engine/GameAssets.js';
import { ResourceLibrary, prepareResources, disposeResources } from '../src/engine/ResourceLibrary.js';
import { HistoryManager } from '../src/editor/HistoryManager.js';

function mesh(name, x = 0) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 30), new THREE.MeshStandardMaterial({ color: '#6382ff' }));
  object.name = name; object.position.x = x;
  object.userData = { type: 'cube', originalWidth: 10, originalHeight: 20, extrusionDepth: 30, game: createGameComponents({ tag: name }) };
  return object;
}

function sceneState(objects = []) {
  const scene = new THREE.Scene(); const exportGroup = new THREE.Group(); const tempSelectionGroup = new THREE.Group();
  scene.add(exportGroup, tempSelectionGroup); exportGroup.add(...objects);
  return { scene, exportGroup, tempSelectionGroup, objects, groups: [], selectedObjects: [] };
}

function documentFor(scene) { return { version: 4, assets: [], ...captureProjectScene(scene) }; }
function nearMatrix(actual, expected) {
  actual.elements.forEach((value, index) => assert.ok(Math.abs(value - expected.elements[index]) < 1e-6, `Matrix element ${index}: ${value} != ${expected.elements[index]}`));
}

test('v4 captures authored hierarchy while multiple objects remain in the transform gizmo group', async () => {
  const first = mesh('First', 12); const second = mesh('Second', 35); const third = mesh('Third', -70);
  const state = sceneState([first, second, third]);
  const outer = new THREE.Group(); outer.name = 'Outer'; outer.userData.isSceneGroup = true;
  outer.position.set(30, 8, -10); outer.rotation.y = 0.7; outer.scale.set(2, 1, 3);
  const inner = new THREE.Group(); inner.name = 'Inner'; inner.userData.isSceneGroup = true;
  inner.position.set(4, 6, 3); inner.rotation.x = 0.4; inner.scale.set(0.7, 2, 1);
  state.exportGroup.add(outer); outer.add(inner, first); inner.add(second); state.groups = [outer, inner];
  state.selectedObjects = [first, third];
  SceneManager.prototype._packTempGroup.call(state);
  state.tempSelectionGroup.position.x += 40; state.tempSelectionGroup.rotation.z = 0.3; state.tempSelectionGroup.scale.set(1.2, 0.8, 1.1);
  state.scene.updateMatrixWorld(true);
  const matrices = state.objects.map(object => object.matrixWorld.clone());
  const parentBefore = first.parent;
  const document = normalizeProjectDocument(JSON.parse(JSON.stringify(documentFor(state))));
  assert.equal(first.parent, parentBefore);
  assert.equal(first.userData._origParent, outer);
  const restored = await prepareProjectScene(document);
  restored.objects.forEach((object, index) => nearMatrix(object.matrixWorld, matrices[index]));
  assert.equal(restored.objects[0].parent, restored.groups[0]);
  assert.equal(restored.objects[1].parent, restored.groups[1]);
  assert.equal(restored.groups[1].parent, restored.groups[0]);
  SceneManager.prototype._unpackTempGroup.call(state); state.scene.updateMatrixWorld(true);
  state.objects.forEach((object, index) => nearMatrix(object.matrixWorld, matrices[index]));
});

test('nested selection packs ancestors once, preserving the hierarchy and all world transforms', () => {
  const child = mesh('Child', 7); const state = sceneState([child]);
  const parent = new THREE.Group(); parent.name = 'Parent'; parent.userData.isSceneGroup = true; parent.position.x = 20;
  state.exportGroup.add(parent); parent.add(child); state.groups = [parent]; state.selectedObjects = [parent, child];
  state.scene.updateMatrixWorld(true); const before = child.matrixWorld.clone();
  SceneManager.prototype._packTempGroup.call(state);
  assert.equal(child.parent, parent); assert.equal(state.tempSelectionGroup.children.length, 1);
  SceneManager.prototype._unpackTempGroup.call(state); state.scene.updateMatrixWorld(true);
  assert.equal(child.parent, parent); nearMatrix(child.matrixWorld, before);
});

test('affine snapshots retain shear through cloning, parsing, reparenting and subsequent translation edits', async () => {
  const object = mesh('Sheared');
  const matrix = new THREE.Matrix4().set(2, 0.4, 0, 15, 0, 1, 0.3, 8, 0.2, 0, 3, -4, 0, 0, 0, 1);
  setLocalMatrix(object, matrix);
  const parsed = await parseGameObject(cloneGameObject(object).toJSON()); parsed.updateMatrixWorld(true);
  nearMatrix(parsed.matrixWorld, matrix);
  parsed.position.x += 10; parsed.updateMatrixWorld(true);
  const expected = matrix.clone(); expected.elements[12] += 10; nearMatrix(parsed.matrixWorld, expected);
  const parent = new THREE.Group(); parent.scale.set(3, 1, 2); parent.rotation.z = 0.5; parent.position.x = 70;
  attachPreservingWorld(parent, parsed); parent.updateMatrixWorld(true); nearMatrix(parsed.matrixWorld, expected);
});

test('singular but finite transforms retain collapsed geometry without NaN matrices', () => {
  const object = mesh('Flat'); const matrix = new THREE.Matrix4().makeScale(0, 2, 1); matrix.setPosition(10, 5, 0);
  setLocalMatrix(object, matrix); object.updateMatrixWorld(true); nearMatrix(object.matrixWorld, matrix);
  object.position.z += 12; object.updateMatrixWorld(true);
  assert.ok(object.matrixWorld.elements.every(Number.isFinite)); assert.equal(object.matrixWorld.elements[14], 12);
});

test('edited primitive buffers, material settings, visibility and voxel metadata survive v4 restoration', async () => {
  const object = mesh('Edited'); object.visible = false;
  object.geometry.attributes.position.setXYZ(0, 17, 9, -6); object.material.transparent = true; object.material.opacity = 0.4;
  object.userData.voxelActiveMap = new Uint8Array([1, 0, 1]); object.userData.voxelDepthMap = new Uint16Array([2, 4, 6]);
  object.userData.voxelSelection = new Uint8Array([0, 1, 0]); object.userData.voxelized = true;
  const prepared = await prepareProjectScene(normalizeProjectDocument(documentFor(sceneState([object]))));
  restoreEditorReferences(prepared.root, []);
  const restored = prepared.objects[0];
  assert.deepEqual([...restored.geometry.attributes.position.array], [...object.geometry.attributes.position.array]);
  assert.equal(restored.visible, false); assert.equal(restored.material.opacity, 0.4);
  assert.deepEqual(restored.userData.voxelActiveMap, object.userData.voxelActiveMap);
  assert.deepEqual(restored.userData.voxelDepthMap, object.userData.voxelDepthMap);
  assert.deepEqual(restored.userData.voxelSelection, object.userData.voxelSelection);
  assert.equal(restored.userData.game.id, object.userData.game.id);
});

test('legacy object/group records normalize correctly and preserve original object indexing', async () => {
  const legacy = normalizeProjectDocument({ version: 2, assets: [], objects: [
    { type: 'cube', name: 'One', position: [3, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { type: 'cube', name: 'Two', position: [7, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  ], groups: [{ name: 'Group', position: [20, 0, 0], children: [1] }] });
  const prepared = await prepareProjectScene(legacy, { legacyObject: async data => { const object = mesh(data.name); object.position.fromArray(data.position); return object; } });
  assert.equal(prepared.objects[1].parent, prepared.groups[0]);
  assert.equal(prepared.objects[1].getWorldPosition(new THREE.Vector3()).x, 27);
  assert.equal(prepared.objects[0].parent, prepared.root);
});

test('malformed versions, hierarchy, geometry references, embedded images and components are rejected', () => {
  assert.throws(() => normalizeProjectDocument({ version: 99, assets: [], objects: [] }), /version/);
  assert.throws(() => normalizeProjectDocument({ version: 3, assets: [], objects: [{ type: 'unknown' }] }), /Unsupported/);
  const document = documentFor(sceneState([mesh('One')]));
  document.groups = [{ name: 'Broken', matrix: new THREE.Matrix4().toArray(), children: [{ kind: 'object', index: 9 }] }];
  assert.throws(() => normalizeProjectDocument(document), /child reference/);
  document.groups = [{ name: 'A', matrix: new THREE.Matrix4().toArray(), children: [{ kind: 'group', index: 1 }] }, { name: 'B', matrix: new THREE.Matrix4().toArray(), children: [{ kind: 'group', index: 0 }] }];
  assert.throws(() => normalizeProjectDocument(document), /cycle/);
  document.groups = []; document.objects[0].visual.object.geometry = 'missing';
  assert.throws(() => normalizeProjectDocument(document), /Missing geometry/);
  assert.throws(() => validateVisualSnapshot({ object: { type: 'Group' }, images: [{ uuid: 'x', url: 'https://example.com/texture.png' }] }), /not embedded/);
  assert.throws(() => normalizeEngineSettings({ cellSize: 0 }), /cellSize/);
  assert.throws(() => normalizeEngineSettings({ templates: [{ id: 'x', name: 'Broken', scene: {} }] }), /Invalid/);
});

test('failed preparation and failed commit leave the current project and dispose staged data', async () => {
  const original = sceneState([mesh('Current')]); let live = original; let disposed = 0;
  const loader = new ProjectLoader({
    prepare: async input => prepareProjectScene(normalizeProjectDocument(input)),
    commit: () => { throw new Error('UI commit failed'); },
    dispose: state => { disposed++; disposeGameObject(state.root); },
  });
  await assert.rejects(loader.load({ version: 99, assets: [], objects: [] }), /version/);
  assert.equal(live, original); assert.equal(disposed, 0);
  await assert.rejects(loader.load(documentFor(sceneState([mesh('New')]))), /commit failed/);
  assert.equal(live, original); assert.equal(disposed, 1);
});

test('newer loads win, stale prepared scenes are disposed, and cancel releases the busy state immediately', async () => {
  const busy = []; const disposed = []; let release; let live;
  const gate = new Promise(resolve => { release = resolve; });
  const loader = new ProjectLoader({
    prepare: async input => { const prepared = await prepareProjectScene(normalizeProjectDocument(input)); if (input.slow) await gate; return prepared; },
    commit: state => { live = state; }, dispose: state => { disposed.push(state.objects[0].name); disposeGameObject(state.root); },
    onBusy: value => busy.push(value),
  });
  const slow = loader.load({ ...documentFor(sceneState([mesh('Slow')])), slow: true });
  assert.equal(await loader.load(documentFor(sceneState([mesh('Fast')]))), true);
  release(); assert.equal(await slow, false);
  assert.equal(live.objects[0].name, 'Fast'); assert.deepEqual(disposed, ['Slow']);
  let releaseCancel; const cancelGate = new Promise(resolve => { releaseCancel = resolve; });
  loader.prepare = async input => { const prepared = await prepareProjectScene(normalizeProjectDocument(input)); await cancelGate; return prepared; };
  const cancelled = loader.load(documentFor(sceneState([mesh('Cancelled')])));
  loader.cancel(); assert.equal(busy.at(-1), false);
  releaseCancel(); assert.equal(await cancelled, false); assert.equal(live.objects[0].name, 'Fast');
  assert.deepEqual(disposed, ['Slow', 'Cancelled']);
});

test('editor duplication strips temporary parent cycles while preserving editable data and independent buffers', () => {
  const object = mesh('Duplicate'); const state = sceneState([object, mesh('Other', 30)]);
  object.userData.voxelDepthMap = new Uint16Array([2, 5]); state.selectedObjects = [...state.objects];
  SceneManager.prototype._packTempGroup.call(state);
  const copy = cloneEditorObject(object);
  assert.equal(copy.userData._origParent, undefined);
  copy.userData.voxelDepthMap[0] = 9; copy.geometry.attributes.position.setX(0, 100);
  assert.equal(object.userData.voxelDepthMap[0], 2); assert.notEqual(object.geometry.attributes.position.getX(0), 100);
});

test('resource capture, rename, update and removal preserve placed instances and support undo/redo', async () => {
  const settings = createEngineSettings(); const history = new HistoryManager();
  const library = new ResourceLibrary({ getSettings: () => settings, history, onChange: () => {} });
  const source = mesh('Stone'); const record = library.capture(source);
  const placed = cloneGameObject(library.cache.get(record.id));
  assert.equal(library.capture(source).name, 'Stone 2');
  library.rename(record.id, 'Rock'); assert.equal(library.require(record.id).name, 'Rock');
  history.undo(); assert.equal(library.require(record.id).name, 'Stone'); history.redo();
  const updated = mesh('Bigger'); updated.geometry.scale(2, 2, 2); library.update(record.id, updated);
  assert.equal(new THREE.Box3().setFromObject(library.cache.get(record.id)).getSize(new THREE.Vector3()).x, 20);
  assert.equal(new THREE.Box3().setFromObject(placed).getSize(new THREE.Vector3()).x, 10);
  history.undo(); assert.equal(new THREE.Box3().setFromObject(library.cache.get(record.id)).getSize(new THREE.Vector3()).x, 10);
  history.redo(); library.remove(record.id); assert.equal(library.cache.has(record.id), false);
  history.undo(); assert.equal(library.require(record.id).name, 'Rock');
  const prepared = await prepareResources(settings.templates);
  assert.equal(prepared.cache.size, 2); assert.equal(prepared.records[0].id, record.id);
  disposeResources(prepared); disposeResources(library.state());
});

test('failed resource staging cleans newly parsed roots without modifying the active resource library', async () => {
  const settings = createEngineSettings(); const library = new ResourceLibrary({ getSettings: () => settings, history: new HistoryManager(), onChange: () => {} });
  const record = library.capture(mesh('Original')); const existing = library.cache.get(record.id);
  let calls = 0; let disposed = 0;
  await assert.rejects(prepareResources([record, { ...record, id: 'bad' }], { parse: async json => {
    if (++calls === 2) throw new Error('Broken resource image');
    const root = await parseGameObject(json); root.geometry.addEventListener('dispose', () => disposed++); return root;
  } }), /Broken resource/);
  assert.equal(disposed, 1); assert.equal(library.cache.get(record.id), existing);
  assert.equal(settings.templates.length, 1);
  disposeResources(library.state());
});

test('large staged scenes yield for cancellation and dispose the partial scene', async () => {
  const controller = new AbortController(); let parsed = 0; let disposed = 0;
  const document = { version: 4, objects: Array.from({ length: 96 }, (_, index) => ({ name: `Tile ${index}`, children: [], visual: {} })), groups: [] };
  await assert.rejects(prepareProjectScene(document, { signal: controller.signal, parseVisual: async () => {
    const object = mesh(`Prepared ${parsed}`); parsed++;
    object.geometry.addEventListener('dispose', () => disposed++);
    if (parsed === 32) setTimeout(() => controller.abort(), 0);
    return object;
  } }), { name: 'AbortError' });
  assert.equal(parsed, 32); assert.equal(disposed, 32);
});

test('visual decoding failures identify the object or resource that failed', async () => {
  const broken = { name: 'Player sprite', children: [], visual: {} };
  await assert.rejects(prepareProjectScene({ version: 4, objects: [broken], groups: [] }, { parseVisual: async () => { throw {}; } }), /Player sprite: invalid visual or embedded image/);
  await assert.rejects(prepareResources([{ id: 'broken', name: 'Door template', scene: {} }], { parse: async () => { throw {}; } }), /Door template: invalid visual or embedded image/);
});

test('deleting nested groups removes their registered descendants from saves and undo restores hierarchy and order', async () => {
  const first = mesh('First'); const child = mesh('Child', 20); const third = mesh('Third', 40);
  const state = sceneState([first, child, third]); state._updateObjectCount = () => {};
  const outer = new THREE.Group(); const inner = new THREE.Group();
  outer.name = 'Outer'; inner.name = 'Inner'; outer.userData.isSceneGroup = inner.userData.isSceneGroup = true;
  state.exportGroup.add(outer); outer.add(inner); inner.add(child); state.groups = [outer, inner];
  assert.deepEqual(selectionRoots([child, outer, inner]), [outer]);
  const removal = captureSceneRemoval(state, [outer]); removeSceneTrees(state, removal);
  assert.deepEqual(state.objects, [first, third]); assert.deepEqual(state.groups, []);
  const reopened = await prepareProjectScene(normalizeProjectDocument(documentFor(state)));
  assert.deepEqual(reopened.objects.map(object => object.name), ['First', 'Third']);
  restoreSceneTrees(state, removal);
  assert.deepEqual(state.objects, [first, child, third]); assert.deepEqual(state.groups, [outer, inner]);
  assert.equal(child.parent, inner); assert.equal(inner.parent, outer);
  const children = [...state.exportGroup.children];
  const reverseRemoval = captureSceneRemoval(state, [children[2], children[0]]);
  removeSceneTrees(state, reverseRemoval); restoreSceneTrees(state, reverseRemoval);
  assert.deepEqual(state.exportGroup.children, children);
  removeSceneTrees(state, removal); assert.deepEqual(state.objects, [first, third]);
});
