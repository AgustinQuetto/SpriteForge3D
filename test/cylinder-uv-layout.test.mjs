import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CYLINDER_UV_REGIONS, createCylinderUVLayout } from '../src/export/CylinderUVLayout.js';

function boundsForGroup(geometry, materialIndex) {
  const group = geometry.groups.find(item => item.materialIndex === materialIndex);
  assert.ok(group, `missing cylinder group ${materialIndex}`);

  const uv = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  const bounds = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };

  for (let offset = group.start; offset < group.start + group.count; offset += 1) {
    const vertexIndex = index ? index.getX(offset) : offset;
    bounds.minU = Math.min(bounds.minU, uv.getX(vertexIndex));
    bounds.maxU = Math.max(bounds.maxU, uv.getX(vertexIndex));
    bounds.minV = Math.min(bounds.minV, uv.getY(vertexIndex));
    bounds.maxV = Math.max(bounds.maxV, uv.getY(vertexIndex));
  }
  return bounds;
}

function assertBoundsAlmostEqual(actual, expected, epsilon = 1e-6) {
  Object.keys(expected).forEach(key => {
    assert.ok(Math.abs(actual[key] - expected[key]) <= epsilon, `${key}: ${actual[key]} != ${expected[key]}`);
  });
}

test('packs the cylinder wall and both caps into stable independent UV regions', () => {
  const source = new THREE.CylinderGeometry(2, 2, 5, 16);
  const sourceUV = source.getAttribute('uv').array.slice();
  const result = createCylinderUVLayout(source);

  assertBoundsAlmostEqual(boundsForGroup(result, 0), CYLINDER_UV_REGIONS.side);
  assertBoundsAlmostEqual(boundsForGroup(result, 1), CYLINDER_UV_REGIONS.top);
  assertBoundsAlmostEqual(boundsForGroup(result, 2), CYLINDER_UV_REGIONS.bottom);
  assert.deepEqual(source.getAttribute('uv').array, sourceUV, 'source geometry must remain unchanged');
});

test('keeps cylinder positions, normals, indices and groups unchanged', () => {
  const source = new THREE.CylinderGeometry(1.5, 1.5, 4, 12);
  const result = createCylinderUVLayout(source);

  assert.deepEqual(result.getAttribute('position').array, source.getAttribute('position').array);
  assert.deepEqual(result.getAttribute('normal').array, source.getAttribute('normal').array);
  assert.deepEqual(result.getIndex().array, source.getIndex().array);
  assert.deepEqual(result.groups, source.groups);
});

test('rejects geometry without separate cylinder wall and cap groups', () => {
  assert.throws(
    () => createCylinderUVLayout(new THREE.PlaneGeometry(1, 1)),
    /separate wall and cap groups/,
  );
});
