import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { buildAsciiFBX, buildUnityTextureMeta } from '../src/export/FBXExportManager.js';

function parseFBX(root) {
  const bytes = new TextEncoder().encode(buildAsciiFBX(root));
  const parsed = new FBXLoader().parse(bytes.buffer, '');
  parsed.updateMatrixWorld(true);
  return parsed;
}

function worldPositions(mesh) {
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.index;
  const count = index ? index.count : position.count;
  const result = [];

  for (let offset = 0; offset < count; offset += 1) {
    const sourceIndex = index ? index.getX(offset) : offset;
    result.push(new THREE.Vector3().fromBufferAttribute(position, sourceIndex).applyMatrix4(mesh.matrixWorld));
  }
  return result;
}

function assertPositionsAlmostEqual(actual, expected, epsilon = 1e-5) {
  assert.equal(actual.length, expected.length);
  actual.forEach((position, index) => {
    assert.ok(
      position.distanceTo(expected[index]) <= epsilon,
      `vertex ${index} differs: ${position.toArray()} != ${expected[index].toArray()}`,
    );
  });
}

test('builds an ASCII FBX with hierarchy, mesh data, normals, UVs and materials', () => {
  const root = new THREE.Group();
  const group = new THREE.Group();
  group.name = 'Casa';
  group.position.set(10, 2, -3);

  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), material);
  mesh.name = 'Pieza';
  group.add(mesh);
  root.add(group);

  const fbx = buildAsciiFBX(root);

  assert.match(fbx, /FBXVersion: 7300/);
  assert.match(fbx, /Documents:\s*\{/);
  assert.match(fbx, /References:\s*\{/);
  assert.match(fbx, /PropertyTemplate: "FbxNode"/);
  assert.match(fbx, /Geometry::Pieza_Geometry/);
  assert.match(fbx, /Model::Casa/);
  assert.match(fbx, /Model::Pieza/);
  assert.match(fbx, /PolygonVertexIndex:/);
  assert.match(fbx, /LayerElementNormal: 0/);
  assert.match(fbx, /LayerElementUV: 0/);
  assert.match(fbx, /ShadingModel: "phong"/);
  assert.match(fbx, /P: "Lcl Translation", "Lcl Translation", "", "A",10,2,-3/);
  assert.match(fbx, /P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0/);
  assert.match(fbx, /P: "RotationOrder", "enum", "", "A",0/);
  assert.match(fbx, /P: "InheritType", "enum", "", "A",1/);
  assert.match(fbx, /C: "OO", \d+, \d+/);
});

test('generates FBX that Three.js can parse back into a mesh hierarchy', () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.name = 'RoundTrip';
  root.add(mesh);

  const parsed = new FBXLoader().parse(new TextEncoder().encode(buildAsciiFBX(root)).buffer, '');
  let meshCount = 0;
  parsed.traverse(node => {
    if (node.isMesh) meshCount += 1;
  });

  assert.equal(meshCount, 1);
});

test('preserves world-space geometry after a round trip with compound rotations', () => {
  const root = new THREE.Group();
  const parent = new THREE.Group();
  parent.name = 'RotatedParent';
  parent.position.set(4, -2, 3);
  parent.rotation.set(0.23, -0.61, 0.42);

  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.75, 2.5, 16),
    new THREE.MeshBasicMaterial(),
  );
  cylinder.name = 'RotatedCylinder';
  cylinder.position.set(-1, 2, 0.5);
  cylinder.rotation.set(-0.37, 0.82, 1.16);
  parent.add(cylinder);
  root.add(parent);
  root.updateMatrixWorld(true);

  const sourcePositions = worldPositions(cylinder);
  const parsed = parseFBX(root);
  const parsedCylinder = parsed.getObjectByName('RotatedCylinder');

  assert.ok(parsedCylinder);
  assertPositionsAlmostEqual(worldPositions(parsedCylinder), sourcePositions);
});

test('preserves child geometry below a rotated non-uniformly scaled parent', () => {
  const root = new THREE.Group();
  const parent = new THREE.Group();
  parent.name = 'ScaledParent';
  parent.position.set(-3, 5, 2);
  parent.rotation.set(0.18, 0.49, -0.72);
  parent.scale.set(2, 0.75, 1.25);

  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 3, 12),
    new THREE.MeshBasicMaterial(),
  );
  cylinder.name = 'NestedCylinder';
  cylinder.position.set(1, -2, 4);
  cylinder.rotation.set(0.67, -0.31, 0.94);
  cylinder.scale.set(0.8, 1.4, 0.6);
  parent.add(cylinder);
  root.add(parent);
  root.updateMatrixWorld(true);

  const sourcePositions = worldPositions(cylinder);
  const parsed = parseFBX(root);
  const parsedCylinder = parsed.getObjectByName('NestedCylinder');

  assert.ok(parsedCylinder);
  assertPositionsAlmostEqual(worldPositions(parsedCylinder), sourcePositions);
});

test('writes Unity texture references for data-url materials', () => {
  const root = new THREE.Group();
  const texture = new THREE.Texture({
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  });
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  root.add(mesh);

  const fbx = buildAsciiFBX(root, { texturePrefix: '7009' });

  assert.match(fbx, /RelativeFilename: "7009_texture_1\.png"/);
  assert.match(fbx, /C: "OP", \d+, \d+, "DiffuseColor"/);
  assert.doesNotMatch(fbx, /Content:/);
});

test('generates a Unity sidecar that preserves pixel-art texture data', () => {
  const meta = buildUnityTextureMeta({ filename: '7009_texture_1.png', width: 96, height: 31 });

  assert.match(meta, /^fileFormatVersion: 2/m);
  assert.match(meta, /^guid: [0-9a-f]{32}$/m);
  assert.match(meta, /enableMipMap: 0/);
  assert.match(meta, /sRGBTexture: 1/);
  assert.match(meta, /filterMode: 0/);
  assert.match(meta, /nPOTScale: 0/);
  assert.match(meta, /maxTextureSize: 128/);
  assert.match(meta, /textureCompression: 0/);
});

test('rejects an FBX export when the hierarchy has no meshes', () => {
  assert.throws(() => buildAsciiFBX(new THREE.Group()), /No meshes found/);
});
