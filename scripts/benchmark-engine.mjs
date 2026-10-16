import fs from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { MapEditor, createMapTile } from '../src/engine/MapEditor.js';
import { MapBatchRenderer } from '../src/engine/MapBatchRenderer.js';
import { GameRuntime } from '../src/engine/GameRuntime.js';
import { createEngineSettings, createGameComponents } from '../src/engine/GameComponents.js';
import { HistoryManager } from '../src/editor/HistoryManager.js';
import { captureProjectScene } from '../src/project/ProjectDocument.js';
import { disposeGameObject } from '../src/engine/GameAssets.js';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const size = Number(option('--size', 32)); const output = option('--project');
if (args.length % 2 || !Number.isInteger(size) || size < 8 || size > 128 || args.some((value, index) => index % 2 === 0 && !['--size', '--project'].includes(value))) throw new Error('Usage: npm run benchmark:engine -- --size 32 [--project output.s3d] (size: 8–128)');
const root = new THREE.Group(); const scene = new THREE.Scene(); scene.add(root);
const model = {
  objects: [], groups: [], exportGroup: root,
  addObject(object) { this.objects.push(object); root.add(object); },
  removeObject(object) { this.objects.splice(this.objects.indexOf(object), 1); object.removeFromParent(); },
};
const history = new HistoryManager(); const map = new MapEditor(model, history, () => {});
const timings = {};
const measure = (name, run) => { const start = performance.now(); const result = run(); timings[name] = +(performance.now() - start).toFixed(2); return result; };
measure('paintMs', () => {
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const cell = { x, z, size: 32, layer: 'Ground', elevation: 0 };
    map.paint(cell, item => createMapTile('ground', item, (x + z) % 2 ? '#60794d' : '#6a8355'));
  }
  map.end();
});
measure('undoMs', () => history.undo()); measure('redoMs', () => history.redo());
map.begin();
for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
  if (x && z && x !== size - 1 && z !== size - 1) continue;
  const cell = { x, z, size: 32, layer: 'Walls', elevation: 0 }; map.paint(cell, item => createMapTile('wall', item, '#8194a3'));
}
map.end();
const player = new THREE.Mesh(new THREE.BoxGeometry(20, 28, 20), new THREE.MeshStandardMaterial({ color: '#829bff' }));
player.name = 'Benchmark player'; player.position.set(80, 16, 80);
player.userData.game = createGameComponents({ tag: 'player', player: { enabled: true, speed: 120 }, collider: { mode: 'solid', size: [18, 18] } }); model.addObject(player);
const goal = new THREE.Mesh(new THREE.OctahedronGeometry(12), new THREE.MeshStandardMaterial({ color: '#7ce7dc' }));
goal.name = 'Benchmark goal'; goal.position.set(208, 16, 80);
goal.userData.game = createGameComponents({ collider: { mode: 'trigger', size: [32, 32] }, events: [{ when: 'interact', action: 'message', value: 'Benchmark mission complete.' }] }); model.addObject(goal);
const settings = { ...createEngineSettings(), cameraSize: Math.min(2048, size * 18), followPlayer: false,
  layers: [{ name: 'Ground', visible: true, locked: false }, { name: 'Walls', visible: true, locked: false }] };
root.updateMatrixWorld(true);
const batches = new MapBatchRenderer(scene, () => root); const camera = new THREE.PerspectiveCamera();
measure('batchBuildMs', () => batches.render({ render() {} }, camera));
function sample(run, count = 60) {
  for (let index = 0; index < 5; index++) run();
  const values = Array.from({ length: count }, () => { const start = performance.now(); run(); return performance.now() - start; }).sort((a, b) => a - b);
  return { median: +values[Math.floor(count / 2)].toFixed(2), p95: +values[Math.floor(count * 0.95)].toFixed(2) };
}
const batchPreparationMs = sample(() => batches.render({ render() {} }, camera));
const runtime = measure('runtimeCreateMs', () => new GameRuntime(root, settings));
measure('runtimeStartMs', () => runtime.start());
const simulationStepMs = sample(() => runtime.update(1 / 60));
if (output) {
  const document = { version: 4, assets: [], modelAssets: [], ...captureProjectScene(model), engine: settings };
  await fs.writeFile(output, JSON.stringify(document));
}
console.log(JSON.stringify({ node: process.version, platform: `${os.platform()} ${os.arch()}`, size, objects: model.objects.length,
  timings, batchPreparationMs, simulationStepMs, batches: batches.stats,
  note: 'CPU-only benchmark; batch preparation excludes GPU drawing. Use editor Rendimiento for actual drawing calls/frame times.', project: output || null }, null, 2));
runtime.dispose(); batches.dispose(); disposeGameObject(root);
