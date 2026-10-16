import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Environment, daylightAt } from '../src/engine/Environment.js';
import { normalizeEnvironment, normalizeLight, normalizePostProcessing } from '../src/engine/EnvironmentSettings.js';
import { normalizeParticles, ParticleEmitter, ParticleManager } from '../src/engine/Particles.js';
import { postResolution } from '../src/engine/PostProcessing.js';
import { GameRuntime } from '../src/engine/GameRuntime.js';
import { createGameComponents, createEngineSettings } from '../src/engine/GameComponents.js';
import { cloneGameObject, serializeGameObject, parseGameObject, disposeGameObject } from '../src/engine/GameAssets.js';
import { normalizeEngineSettings } from '../src/project/EngineSettings.js';
import { normalizeEventRules } from '../src/engine/GameEvents.js';

function mesh(game = {}) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(8, 16, 8), new THREE.MeshStandardMaterial());
  object.userData.game = createGameComponents(game); return object;
}

test('old projects retain legacy lighting, while saved world and effect settings validate bounded values', () => {
  const defaults = normalizeEngineSettings({});
  assert.equal(defaults.environment.enabled, false); assert.equal(defaults.postProcessing.enabled, false);
  assert.equal(createGameComponents().particles.enabled, false);
  const settings = normalizeEngineSettings({ environment: { enabled: true, dayNight: { hour: 24 } }, postProcessing: { enabled: true, bloom: 2 } });
  assert.equal(settings.environment.dayNight.hour, 0); assert.equal(settings.environment.dayNight.duration, 120);
  assert.equal(settings.postProcessing.bloom, 2);
  for (const data of [{ shadowSize: 4096 }, { dayNight: { duration: 0 } }, { sunIntensity: Infinity }, { background: 'red' }]) assert.throws(() => normalizeEnvironment(data));
  assert.throws(() => normalizeLight({ direction: [0, 0, 0] }));
  assert.throws(() => normalizeParticles({ count: 3000 }));
  assert.throws(() => normalizeParticles({ brightness: NaN }));
  assert.throws(() => normalizePostProcessing({ resolution: 0 }));
});

test('day/night clock wraps, can be frozen at a chosen hour, and removes the sun and its shadow at night', () => {
  const scene = new THREE.Scene(); const root = new THREE.Group(); scene.add(root);
  const world = new Environment(scene, () => root, { enabled: true, dayNight: { enabled: true, hour: 23, duration: 24 } });
  world.advance(2); assert.equal(world.hour, 1);
  world.setTime(12); world.setCycleRunning(false); world.advance(20); assert.equal(world.hour, 12);
  world.prepare(new THREE.Vector3(100, 0, 100)); assert.ok(world.sun.intensity > 0); assert.equal(world.sun.castShadow, true);
  const daylight = daylightAt(world.settings, 12); assert.ok(daylight.direction.y > 0);
  world.setTime(0); world.prepare(); assert.equal(world.sun.intensity, 0); assert.equal(world.sun.castShadow, false);
  assert.equal(scene.background.getHexString(), '050814');
  world.configure({ enabled: true, dayNight: { enabled: false, hour: 0 } }); world.advance(10); world.prepare(); assert.equal(world.sun.intensity, 0); assert.equal(world.hour, 0);
  world.dispose(); assert.equal(scene.background, null); assert.deepEqual(scene.children, [root]);
});

test('object lights follow parent transforms and activation, obey scene budgets, and stay outside project snapshots', () => {
  const scene = new THREE.Scene(); const root = new THREE.Group(); root.position.set(20, 0, 10); scene.add(root);
  const warnings = [];
  for (let index = 0; index < 35; index++) root.add(mesh({ light: { enabled: true, castShadow: true, offset: [0, 10, 0] } }));
  const world = new Environment(scene, () => root, { enabled: true }, { onError: value => warnings.push(value) });
  world.prepare(); assert.equal(world.lights.size, 32);
  assert.equal([...world.lights.values()].filter(item => item.light.castShadow).length, 3);
  const original = root.children[0]; const light = world.lights.get(original).light;
  assert.deepEqual(light.position.toArray(), [20, 10, 10]); assert.equal(light.shadow.mapSize.x, 512);
  root.position.x = 50; world.prepare(); assert.equal(light.position.x, 50);
  assert.equal(warnings.length, 2); world.prepare(); assert.equal(warnings.length, 2);
  assert.equal(serializeGameObject(root).object.children.length, 35);
  root.userData.game = createGameComponents({ enabled: false }); world.prepare(); assert.equal(world.lights.size, 0);
  world.dispose(); disposeGameObject(root);
});

test('shadow flags and alpha-cutout depth materials restore when the environment is disabled or disposed', () => {
  const scene = new THREE.Scene(); const root = new THREE.Group(); const object = mesh(); root.add(object); scene.add(root);
  const texture = new THREE.Texture(); object.material.map = texture; object.material.transparent = true;
  const world = new Environment(scene, () => root, { enabled: true }); world.prepare();
  assert.equal(object.castShadow, true); assert.equal(object.receiveShadow, true);
  assert.equal(object.customDepthMaterial.map, texture); assert.equal(object.customDistanceMaterial.alphaTest, 0.1);
  let disposed = 0; object.customDepthMaterial.addEventListener('dispose', () => disposed++);
  const renderer = { shadowMap: { enabled: false, type: THREE.BasicShadowMap } };
  assert.throws(() => world.render(renderer, () => { assert.equal(renderer.shadowMap.enabled, true); throw new Error('draw'); }));
  assert.equal(renderer.shadowMap.enabled, false); assert.equal(renderer.shadowMap.type, THREE.BasicShadowMap);
  world.configure({ enabled: false }); world.prepare(); assert.equal(object.castShadow, false); assert.equal(object.receiveShadow, false);
  assert.equal(object.customDepthMaterial, undefined); assert.equal(disposed, 1);
  world.dispose(); disposeGameObject(root);
});

test('changing an object light type releases the old light and preserves spot/directional settings in local space', () => {
  const scene = new THREE.Scene(); const root = new THREE.Group(); root.rotation.y = Math.PI / 2; scene.add(root);
  const object = mesh({ light: { enabled: true, type: 'point' } }); root.add(object);
  const world = new Environment(scene, () => root, { enabled: true }); world.prepare();
  const original = world.lights.get(object).light; let disposed = 0; const dispose = original.dispose.bind(original);
  original.dispose = () => { disposed++; dispose(); };
  object.userData.game.light = normalizeLight({ enabled: true, type: 'spot', intensity: 1200, angle: 25, penumbra: 0.8, direction: [1, 0, 0], offset: [10, 0, 0] });
  world.prepare(); const spot = world.lights.get(object).light;
  assert.equal(disposed, 1); assert.equal(original.parent, null); assert.equal(spot.isSpotLight, true);
  assert.ok(Math.abs(spot.position.z + 10) < 1e-8); assert.ok(Math.abs(spot.angle - 25 * Math.PI / 180) < 1e-8);
  assert.equal(spot.penumbra, 0.8); assert.ok(Math.abs(spot.target.position.z + 110) < 1e-8);
  object.userData.game.light.type = 'directional'; world.prepare(); const sun = world.lights.get(object).light;
  assert.equal(sun.isDirectionalLight, true); assert.equal(spot.parent, null); assert.equal(sun.shadow.camera.right, 256);
  world.dispose(); disposeGameObject(root);
});

test('light snapshots retain parameters, shadow policy, and target relationships after JSON export', async () => {
  const root = new THREE.Group(); root.position.set(10, 0, 0);
  const light = new THREE.SpotLight('#ff9933', 1200, 500, 0.4, 0.2, 1.7); light.castShadow = true; light.position.set(0, 40, 0); root.add(light);
  light.target.position.set(30, 0, 10); // Target is outside the source graph.
  const copy = cloneGameObject(root); const cloned = copy.children.find(node => node.isSpotLight);
  assert.equal(cloned.intensity, 1200); assert.equal(cloned.decay, 1.7); assert.equal(cloned.castShadow, true);
  assert.deepEqual(cloned.target.getWorldPosition(new THREE.Vector3()).toArray(), [30, 0, 10]);
  const restored = await parseGameObject(serializeGameObject(root)); const saved = restored.children.find(node => node.isSpotLight);
  assert.equal(saved.angle, 0.4); assert.equal(saved.penumbra, 0.2); assert.equal(saved.distance, 500);
  assert.ok(saved.target.parent); assert.deepEqual(saved.target.getWorldPosition(new THREE.Vector3()).toArray(), [30, 0, 10]);
  disposeGameObject(copy); disposeGameObject(restored); disposeGameObject(root);
});

test('particles use deterministic world positions, fade alpha to zero, pause when inactive, and release resources', () => {
  const source = new THREE.Object3D(); source.position.set(20, 40, 60);
  const data = { emitting: false, count: 8, area: [0, 0], lifetime: 1, speed: 10, spread: 0, additive: false };
  const first = new ParticleEmitter(source, data); const second = new ParticleEmitter(source, data);
  first.emit(4); second.emit(4); first.update(0); second.update(0);
  assert.equal(first.alive, 4); assert.deepEqual([...first.positions], [...second.positions]);
  assert.deepEqual([...first.positions.slice(0, 3)], [20, 40, 60]);
  assert.equal(first.material.blending, THREE.NormalBlending); assert.equal(first.geometry.attributes.color.itemSize, 4);
  first.update(0.25); assert.equal(first.colors[3], 0.75); assert.ok(first.positions[1] > 40);
  const before = [...first.positions]; first.update(1, false); assert.deepEqual([...first.positions], before); assert.equal(first.points.visible, false);
  first.update(1); assert.equal(first.alive, 0); assert.ok(first.colors.every((value, index) => index % 4 !== 3 || value === 0));
  const scene = new THREE.Scene(); scene.add(first.points); let disposed = 0;
  for (const resource of [first.geometry, first.material, first.material.map]) resource.addEventListener('dispose', () => disposed++);
  first.dispose(); assert.equal(scene.children.length, 0); assert.equal(disposed, 3); second.dispose();
});

test('particle budgets bound capacity and emitter count, and disabling a parent hides its particles', () => {
  const scene = new THREE.Scene(); const entities = Array.from({ length: 70 }, (_, index) => ({ id: String(index), object: new THREE.Object3D(), components: createGameComponents({ particles: { enabled: true, count: 16 } }) }));
  const warnings = []; let active = true;
  const manager = new ParticleManager(scene, entities, () => active, value => warnings.push(value));
  assert.equal(manager.emitters.size, 64); assert.equal(warnings.length, 1);
  manager.emit('0', 8); manager.update(0); assert.equal(manager.emitters.get('0').emitter.alive, 8);
  active = false; manager.update(1); assert.equal(manager.emitters.get('0').emitter.points.visible, false);
  assert.throws(() => manager.emit('missing', 1)); manager.dispose(); assert.equal(scene.children.length, 0);
  entities.forEach(entity => entity.components.particles.count = 2048);
  const large = new ParticleManager(scene, entities, () => true);
  assert.equal([...large.emitters.values()].reduce((sum, { emitter }) => sum + emitter.capacity, 0), 20000); large.dispose();
});

test('object scripts and HTML UI share world controls, and Play leaves authored settings and effects unchanged', () => {
  const root = new THREE.Group(); const object = mesh({ render: { visible: false }, particles: { enabled: true, emitting: false }, light: { enabled: true } }); root.add(object);
  const settings = createEngineSettings(); settings.environment = normalizeEnvironment({ enabled: true, dayNight: { enabled: true, hour: 12, duration: 24 } });
  const authoredGame = structuredClone(object.userData.game);
  const errors = []; const runtime = new GameRuntime(root, settings, { onError: message => errors.push(message) }); runtime.start();
  const api = runtime.api(runtime.entities[0]); const ui = runtime.interfaceApi({}); assert.equal(api.world, ui.world);
  assert.equal(runtime.entities[0].object.visible, false); api.emitParticles(6); runtime.update(1 / 60);
  assert.equal(runtime.particles.emitters.get(object.userData.game.id).emitter.alive, 6);
  assert.ok(api.world.hour > 12); runtime.setPaused(true); const hour = api.world.hour; const age = runtime.particles.emitters.get(object.userData.game.id).emitter.ages[0];
  runtime.update(0.1); assert.equal(api.world.hour, hour); assert.equal(runtime.particles.emitters.get(object.userData.game.id).emitter.ages[0], age);
  ui.world.setTime(0); ui.world.setCycleRunning(false); ui.world.setEnvironment({ ambientIntensity: 0.8 });
  assert.equal(api.world.hour, 0); assert.equal(api.world.cycling, false);
  ui.world.setLight(object.userData.game.id, { intensity: 20 }); ui.world.setPostProcessing({ enabled: true, bloom: 1.2 });
  assert.equal(runtime.postSettings.bloom, 1.2); assert.equal(settings.postProcessing.enabled, false);
  assert.equal(settings.environment.dayNight.hour, 12); assert.deepEqual(object.userData.game, authoredGame);
  runtime.render({ render() {} }); assert.equal(runtime.environment.lights.size, 1);
  assert.deepEqual(errors, []); runtime.dispose(); assert.equal(object.visible, true); assert.equal(root.children.length, 1); disposeGameObject(root);
});

test('post-processing resolution respects the effect scale and two-million-pixel intermediate budget', () => {
  assert.equal(postResolution(1000, 500, 1, 0.75), 0.75);
  const ratio = postResolution(3840, 2160, 2, 1); assert.ok(3840 * 2160 * ratio ** 2 <= 2000001);
});

test('visual effect actions target other objects and control particle bursts, lights, and the world clock in order', () => {
  const root = new THREE.Group(); const target = mesh({ id: 'effects', particles: { enabled: true, emitting: false } });
  const controller = mesh({ events: [{ when: 'start', actions: [
    { type: 'lightOn', target: 'effects' }, { type: 'particlesOn', target: 'effects' }, { type: 'particlesOff', target: 'effects' },
    { type: 'burstParticles', target: 'effects', amount: 9 }, { type: 'setTime', amount: 17 }, { type: 'cycleOff' },
  ] }] }); root.add(controller, target);
  const runtime = new GameRuntime(root, createEngineSettings()); runtime.start(); runtime.update(1 / 60);
  const effect = runtime.entities.find(item => item.id === 'effects'); assert.equal(effect.components.light.enabled, true);
  assert.equal(runtime.environment.hour, 17); assert.equal(runtime.environment.cycling, false);
  const emitter = runtime.particles.emitters.get('effects').emitter; assert.equal(emitter.alive, 9); assert.equal(emitter.settings.emitting, false);
  runtime.executeAction(runtime.entities[0], { type: 'lightOff', target: 'effects' }); assert.equal(effect.components.light.enabled, false);
  assert.throws(() => normalizeEventRules([{ when: 'start', actions: [{ type: 'setTime', amount: 25 }] }]));
  assert.throws(() => normalizeEventRules([{ when: 'start', actions: [{ type: 'burstParticles', amount: -1 }] }]));
  runtime.dispose(); disposeGameObject(root);
});
