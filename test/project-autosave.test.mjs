import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectAutosave } from '../src/project/ProjectAutosave.js';

function stores() {
  const values = new Map(); let record = null;
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const durable = { async read() { return record; }, async write(value) { record = value; } };
  return { storage, durable, values, autosave: new ProjectAutosave({ storage, durable }) };
}

test('large drafts use durable storage and recover after recreating the autosave coordinator', async () => {
  const { storage, durable, autosave, values } = stores();
  const document = { savedAt: 5, objects: [{ geometry: 'x'.repeat(1200000) }] };
  assert.equal(await autosave.save(document), 'indexedDB');
  assert.ok(values.values().next().value.length < 100);
  assert.deepEqual(JSON.parse(await new ProjectAutosave({ storage, durable }).read()), document);
});

test('legacy localStorage drafts migrate and a newer successful fallback takes precedence', async () => {
  const { autosave, storage, values } = stores(); const original = { version: 3, savedAt: 2, objects: [] };
  storage.setItem(autosave.key, JSON.stringify(original)); assert.deepEqual(JSON.parse(await autosave.read()), original);
  await autosave.save({ savedAt: 3, objects: [] });
  storage.setItem(autosave.key, JSON.stringify({ savedAt: 4, objects: ['newer'] }));
  assert.deepEqual(JSON.parse(await autosave.read()).objects, ['newer']); assert.equal(values.size, 1);
});

test('blocked durable storage falls back for small projects while large failures are reported', async () => {
  const { autosave, durable } = stores(); durable.write = async () => { throw new Error('Disk full'); };
  durable.read = async () => { throw new Error('Unavailable'); };
  assert.equal(await autosave.save({ savedAt: 1, objects: [] }), 'localStorage');
  assert.deepEqual(JSON.parse(await autosave.read()).objects, []);
  await assert.rejects(autosave.save({ savedAt: 2, data: 'x'.repeat(1200000) }), /Disk full/);
  assert.equal(JSON.parse(await autosave.read()).savedAt, 1);
});

test('queued writes retain request order and recover after a failed write', async () => {
  const { autosave, durable } = stores(); const writes = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  durable.write = async record => { writes.push(record.savedAt); if (record.savedAt === 1) { await gate; throw new Error('Failed first'); } };
  const first = autosave.save({ savedAt: 1, data: 'x'.repeat(1200000) });
  const second = autosave.save({ savedAt: 2, objects: ['latest'] });
  release(); await assert.rejects(first, /Failed first/); assert.equal(await second, 'indexedDB');
  assert.deepEqual(writes, [1, 2]); assert.equal(JSON.parse(await autosave.read()).savedAt, 2);
});

test('a missing durable draft never silently restores an older fallback after a large save', async () => {
  const { autosave, durable } = stores(); await autosave.save({ savedAt: 1, objects: ['old'] });
  await autosave.save({ savedAt: 2, data: 'x'.repeat(1200000) });
  durable.read = async () => null; await assert.rejects(autosave.read(), /could not be recovered/);
});

test('corrupt draft records and read failures are preserved for explicit recovery', async () => {
  const { autosave, storage, durable } = stores(); storage.setItem(autosave.key, '{broken json');
  assert.equal(await autosave.read(), '{broken json');
  durable.read = async () => ({ savedAt: 10 }); await assert.rejects(autosave.read(), /Invalid saved draft/);
  assert.equal(storage.getItem(autosave.key), '{broken json');
  const missing = stores(); missing.durable.read = async () => { throw new Error('Disk unavailable'); };
  await assert.rejects(missing.autosave.read(), /Disk unavailable/);
});
