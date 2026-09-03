import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createExportScope } from '../src/export/ExportScope.js';

function createMesh(name, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.name = name;
  mesh.position.copy(position);
  return mesh;
}

test('uses the complete export group when there is no selection', () => {
  const exportGroup = new THREE.Group();
  exportGroup.add(createMesh('A', new THREE.Vector3(1, 0, 0)));
  const scope = createExportScope({ exportGroup, selectedObjects: [] });

  assert.equal(scope.group, exportGroup);
  assert.equal(scope.isSelection, false);
  assert.equal(scope.hasContent, true);
});

test('exports a selected group as one isolated unit', () => {
  const exportGroup = new THREE.Group();
  const group = new THREE.Group();
  group.name = 'Casa';
  group.position.set(10, 2, -4);
  group.add(createMesh('Puerta', new THREE.Vector3(2, 0, 1)));
  exportGroup.add(group);
  exportGroup.updateMatrixWorld(true);

  const scope = createExportScope({ exportGroup, selectedObjects: [group] });

  assert.equal(scope.isSelection, true);
  assert.equal(scope.group.children.length, 1);
  assert.equal(scope.group.children[0].name, 'Casa');
  assert.equal(scope.group.children[0].children.length, 1);
  assert.deepEqual(scope.group.children[0].children[0].getWorldPosition(new THREE.Vector3()).toArray(), [12, 2, -3]);
});

test('bakes world transforms for individually selected objects', () => {
  const exportGroup = new THREE.Group();
  const parent = new THREE.Group();
  parent.position.set(8, 0, 3);
  const mesh = createMesh('Pieza', new THREE.Vector3(2, 1, -1));
  parent.add(mesh);
  exportGroup.add(parent);
  exportGroup.updateMatrixWorld(true);

  const scope = createExportScope({ exportGroup, selectedObjects: [mesh] });
  const exportedMesh = scope.group.children[0];

  assert.equal(exportedMesh.name, 'Pieza');
  assert.deepEqual(exportedMesh.position.toArray(), [10, 1, 2]);
  assert.deepEqual(exportedMesh.getWorldPosition(new THREE.Vector3()).toArray(), [10, 1, 2]);
});

test('marks empty selected groups as not exportable', () => {
  const exportGroup = new THREE.Group();
  const emptyGroup = new THREE.Group();
  exportGroup.add(emptyGroup);

  const scope = createExportScope({ exportGroup, selectedObjects: [emptyGroup] });

  assert.equal(scope.hasContent, false);
});
