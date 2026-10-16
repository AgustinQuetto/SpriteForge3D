import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { compileGameScript, createScriptHooks, indentScript, SCRIPT_TEMPLATES, scriptErrorMessage } from '../src/engine/GameScripts.js';
import { GameRuntime } from '../src/engine/GameRuntime.js';
import { createGameComponents, createEngineSettings } from '../src/engine/GameComponents.js';

test('syntax validation compiles without executing author code; templates produce valid lifecycle objects', () => {
  const messages = []; const api = { message: value => messages.push(value) };
  const factory = compileGameScript("api.message('executed'); return { start() {} };");
  assert.deepEqual(messages, []); factory(api); assert.deepEqual(messages, ['executed']);
  for (const template of SCRIPT_TEMPLATES) assert.equal(typeof createScriptHooks(template.source, api), 'object');
  assert.throws(() => compileGameScript('return { update( }'), SyntaxError);
});

test('invalid hook values, arrays, primitives and asynchronous factories report actionable errors', () => {
  for (const source of ['return [];', 'return false;', 'return 3;', 'return Promise.resolve({});']) assert.throws(() => createScriptHooks(source, {}), /objeto de hooks/);
  assert.throws(() => createScriptHooks('return { update: 42 };', {}), /update debe ser una función/);
  assert.deepEqual(createScriptHooks('', {}), {});
  assert.deepEqual(createScriptHooks('return null;', {}), {});
});

test('runtime errors include object, hook and source line once and tolerate non-Error throws', () => {
  const root = new THREE.Group(); const errors = [];
  for (const [name, script] of [
    ['Broken', 'return {\n  update(dt) {\n    throw new Error("Oops");\n  },\n};'],
    ['String throw', 'return { update() { throw "plain"; } };'],
    ['Undefined throw', 'return { update() { throw undefined; } };'],
    ['Invalid hooks', 'return { update: 3 };'],
  ]) { const object = new THREE.Object3D(); object.name = name; object.userData.game = createGameComponents({ script }); root.add(object); }
  const runtime = new GameRuntime(root, createEngineSettings(), { onError: value => errors.push(value) }); runtime.start();
  runtime.update(1 / 60); runtime.update(1 / 60);
  assert.ok(errors.includes('Broken / update: Oops (línea 3)'));
  assert.ok(errors.includes('String throw / update: plain'));
  assert.ok(errors.includes('Undefined throw / update: undefined'));
  assert.equal(errors.length, 4); assert.ok(errors[0].includes('Invalid hooks / compile'));
  runtime.dispose(); assert.equal(scriptErrorMessage(null), 'null');
});

test('indentation keeps selected content and excludes an unselected next line after a trailing newline', () => {
  const original = 'one\ntwo\nthree'; const indented = indentScript(original, 0, 8);
  assert.equal(indented.text, '  one\n  two\nthree');
  assert.equal(indented.text.slice(indented.start, indented.end), 'one\n  two\n');
  const restored = indentScript(indented.text, indented.start, indented.end, true); assert.equal(restored.text, original);
  const emptyLine = indentScript('\nnext', 0, 0); assert.equal(emptyLine.text, '  \nnext'); assert.equal(emptyLine.start, 2);
  assert.equal(indentScript(' x', 1, 1, true).text, 'x');
});
