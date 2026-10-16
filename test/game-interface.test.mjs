import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { GameRuntime } from '../src/engine/GameRuntime.js';
import { createEngineSettings, createGameComponents } from '../src/engine/GameComponents.js';
import { INTERFACE_EXAMPLE, normalizeGameInterface, isGameUIControl } from '../src/engine/GameInterface.js';
import { normalizeEngineSettings } from '../src/project/EngineSettings.js';

function setup(ui = INTERFACE_EXAMPLE, game = {}) {
  const nodes = Object.fromEntries(['#add', '#score', '#signal', '#pause'].map(id => [id, Object.assign(new EventTarget(), { textContent: '' })]));
  let disposed = 0; const errors = []; const messages = []; const states = [];
  const source = new THREE.Group(); const entity = new THREE.Object3D(); entity.name = 'Listener'; entity.userData.game = createGameComponents(game); source.add(entity);
  const runtime = new GameRuntime(source, { ...createEngineSettings(), ui }, {
    uiViewFactory: () => ({ root: { querySelector: selector => nodes[selector] }, dispose: () => disposed++ }),
    onError: value => errors.push(value), onMessage: value => messages.push(value), onStateChange: value => states.push(value.paused),
  });
  runtime.start(); return { runtime, nodes, errors, messages, states, disposed: () => disposed };
}

test('HTML event callbacks share variables and bidirectional signals with object scripts and visual events', () => {
  const { runtime, nodes, messages } = setup(INTERFACE_EXAMPLE, {
    events: [{ when: 'signal', signal: 'scoreChanged', action: 'message', value: 'Score: {score}' }],
    script: 'return { onEvent(name, data) { if (name === "scoreChanged") api.variables.received = data.score; } };',
  });
  nodes['#add'].dispatchEvent(new Event('click')); runtime.update(1 / 60);
  assert.equal(runtime.variables.score, 1); assert.equal(runtime.variables.received, 1);
  assert.equal(nodes['#score'].textContent, '1'); assert.equal(nodes['#signal'].textContent, 'Señal: 1'); assert.deepEqual(messages, ['Score: 1']);
  assert.equal(runtime.api(runtime.entities[0]).ui, runtime.interface.uiApi);
  runtime.interface.api.setEnabled(false, runtime.entities[0].id); assert.equal(runtime.entities[0].components.enabled, false);
  assert.equal(runtime.interface.api.find(runtime.entities[0].id), runtime.entities[0].object);
  assert.equal(runtime.interface.api.findTag('missing').length, 0); runtime.dispose();
});

test('pause menus keep updating and dispatching signals while simulation time and movement remain paused', () => {
  const { runtime, nodes, states } = setup(); runtime.update(1 / 60); const time = runtime.time;
  nodes['#pause'].dispatchEvent(new Event('click')); runtime.keyDown('d'); runtime.update(0.1);
  assert.equal(runtime.time, time); assert.equal(runtime.paused, true); assert.equal(nodes['#pause'].textContent, 'Continuar partida');
  nodes['#add'].dispatchEvent(new Event('click')); runtime.update(0.1); assert.equal(nodes['#signal'].textContent, 'Señal: 1');
  nodes['#pause'].dispatchEvent(new Event('click')); runtime.update(1 / 60);
  assert.equal(runtime.paused, false); assert.ok(runtime.time > time); assert.deepEqual(states, [true, false]); runtime.dispose();
});

test('UI startup signals reach object hooks initialized later, and recursive UI signals share the event budget', () => {
  const first = setup({ ...INTERFACE_EXAMPLE, script: 'return { start() { api.emit("ready"); } };' }, {
    script: 'return { onEvent(name) { if (name === "ready") api.variables.ready = 1; } };',
  });
  assert.equal(first.runtime.variables.ready, 1); first.runtime.dispose();
  const loop = setup({ ...INTERFACE_EXAMPLE, script: 'return { start() { api.emit("loop"); }, onEvent(name) { api.emit(name); } };' });
  assert.ok(loop.errors.some(message => message.includes('Event limit'))); assert.equal(loop.runtime.queue.length, 0); loop.runtime.dispose();
});

test('UI callback failures report context once, unregister broken listeners, and cleanup on stop', () => {
  const result = setup({ ...INTERFACE_EXAMPLE, script: 'return { start() { api.ui.on("#add", "click", () => { throw new Error("Button failed"); }); }, stop() { api.variables.stopped = 1; } };' });
  result.nodes['#add'].dispatchEvent(new Event('click')); result.nodes['#add'].dispatchEvent(new Event('click'));
  assert.equal(result.errors.length, 1); assert.ok(result.errors[0].includes('UI / click #add: Button failed'));
  result.runtime.dispose(); assert.equal(result.disposed(), 1); assert.equal(result.runtime.variables.stopped, 1);
  result.nodes['#add'].dispatchEvent(new Event('click')); assert.equal(result.errors.length, 1);
});

test('interface data round trips through settings while malformed values are rejected and old projects default to disabled UI', () => {
  const settings = normalizeEngineSettings(JSON.parse(JSON.stringify({ ...createEngineSettings(), ui: INTERFACE_EXAMPLE })));
  assert.deepEqual(settings.ui, INTERFACE_EXAMPLE); assert.equal(normalizeEngineSettings({}).ui.enabled, false);
  assert.throws(() => normalizeGameInterface({ enabled: 'yes' }), /enabled/);
  assert.throws(() => normalizeGameInterface({ script: 'x'.repeat(100001) }), /script/);
  assert.throws(() => normalizeGameInterface({ html: {} }), /html/);
});

test('asynchronous UI callback rejections are reported and remove the failed listener', async () => {
  const result = setup({ ...INTERFACE_EXAMPLE, script: 'return { start() { api.ui.on("#add", "click", async () => { throw new Error("Async UI failed"); }); } };' });
  result.nodes['#add'].dispatchEvent(new Event('click')); await Promise.resolve();
  assert.equal(result.errors.length, 1); assert.ok(result.errors[0].includes('Async UI failed'));
  result.nodes['#add'].dispatchEvent(new Event('click')); await Promise.resolve(); assert.equal(result.errors.length, 1);
  result.runtime.dispose();
});

test('keyboard control detection follows composed paths into shadow-DOM game controls', () => {
  assert.equal(isGameUIControl({ target: {}, composedPath: () => [{ matches: () => true }, {}] }), true);
  assert.equal(isGameUIControl({ target: { matches: () => false } }), false);
});
