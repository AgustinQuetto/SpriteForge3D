import assert from 'node:assert/strict';
import test from 'node:test';
import { getVoxelGridOrigin, splitVoxelStateBySelection } from '../src/editor/PixelUtils.js';

test('moves only selected active voxel columns into an independent state', () => {
  const active = new Uint8Array([1, 1, 0, 1, 1, 1]);
  const selection = new Uint8Array([0, 1, 1, 1, 0, 1]);
  const depthMap = new Uint16Array([0, 2, 9, 3, 4, 5]);
  const colors = new Uint8Array(6 * 4).fill(127);

  const split = splitVoxelStateBySelection({
    active,
    selection,
    depthMap,
    colors,
    width: 3,
    height: 2,
  });

  assert.equal(split.movedCount, 3);
  assert.equal(split.remainingCount, 2);
  assert.deepEqual(split.bounds, { minCol: 0, maxCol: 2, minRow: 0, maxRow: 1 });
  assert.deepEqual([...split.remaining.active], [1, 0, 0, 0, 1, 0]);
  assert.deepEqual([...split.piece.active], [0, 1, 0, 1, 0, 1]);
  assert.deepEqual([...split.remaining.depthMap], [0, 0, 9, 0, 4, 0]);
  assert.deepEqual([...split.piece.depthMap], [0, 2, 0, 3, 0, 5]);
  assert.deepEqual([...split.remaining.selection], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...split.piece.selection], [0, 0, 0, 0, 0, 0]);

  // Source arrays stay intact for undo snapshots.
  assert.deepEqual([...active], [1, 1, 0, 1, 1, 1]);
  assert.deepEqual([...selection], [0, 1, 1, 1, 0, 1]);
});

test('does not create a piece when the selection has no active voxels', () => {
  const split = splitVoxelStateBySelection({
    active: new Uint8Array([1, 0]),
    selection: new Uint8Array([0, 1]),
    width: 2,
    height: 1,
  });
  assert.equal(split, null);
});

test('voxel grid origin accounts for the derived piece pivot', () => {
  const mesh = { userData: { voxelPixelSize: 2, voxelPivotOffset: [1, 4] } };
  assert.deepEqual(getVoxelGridOrigin(mesh, 4, 3), { x: -4, y: -3 });
});
