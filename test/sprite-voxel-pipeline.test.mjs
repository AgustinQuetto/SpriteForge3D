import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPaletteTexture,
  buildSpriteVoxelMesh,
  encodeGlb,
} from '../src/automation/SpriteVoxelPipeline.js';
import { buildAssemblyMesh } from '../src/automation/AssemblyPipeline.js';

test('builds a culled voxel extrusion with Argentum scale and canonical framing', () => {
  const image = {
    width: 3,
    height: 3,
    data: new Uint8Array([
      0, 0, 0, 0,       255, 0, 0, 255,  0, 0, 0, 0,
      0, 255, 0, 255,   0, 0, 255, 255,  0, 0, 0, 0,
      0, 0, 0, 0,       0, 0, 0, 0,      0, 0, 0, 0,
    ]),
  };

  const mesh = buildSpriteVoxelMesh(image, { pixelsPerCentimetre: 0.6, depthPixels: 3 });

  assert.equal(mesh.metadata.geometry.opaquePixels, 3);
  assert.equal(mesh.metadata.geometry.triangles, 28);
  assert.equal(mesh.uvs.length, mesh.metadata.geometry.vertices * 2);
  assert.deepEqual(mesh.metadata.transparentPadding, { left: 0, right: 1, top: 0, bottom: 1 });
  assert.equal(mesh.metadata.dimensionsCentimetres.width, 3.3333333333333335);
  assert.equal(mesh.metadata.dimensionsCentimetres.height, 3.3333333333333335);
  assert.equal(mesh.metadata.dimensionsCentimetres.depth, 5);
});

test('encodes a valid GLB 2.0 container with vertex colours', () => {
  const image = { width: 1, height: 1, data: new Uint8Array([18, 52, 86, 255]) };
  const mesh = buildSpriteVoxelMesh(image);
  const glb = encodeGlb(mesh, { name: 'single_pixel', unlit: true });

  assert.ok(mesh.colors[0] > 0 && mesh.colors[0] < 1);
  assert.equal(mesh.colors[3], 1);
  assert.equal(mesh.metadata.colourEncoding, 'linear-float-from-srgb-png');
  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  assert.ok(glb.includes(Buffer.from('KHR_materials_unlit')));
});

test('builds a deterministic sRGB palette atlas and maps UV0 to texel centres', () => {
  const image = {
    width: 2,
    height: 1,
    data: new Uint8Array([18, 52, 86, 255, 220, 170, 40, 255]),
  };
  const mesh = buildSpriteVoxelMesh(image);
  const palette = buildPaletteTexture(mesh, { maximumWidth: 16 });

  assert.deepEqual([palette.width, palette.height, palette.colours], [2, 1, 2]);
  assert.deepEqual([...palette.data.slice(0, 8)], [18, 52, 86, 255, 220, 170, 40, 255]);
  assert.equal(mesh.uvs.length, mesh.metadata.geometry.vertices * 2);
  assert.ok(mesh.uvs.every((value) => value > 0 && value < 1));
  assert.equal(mesh.metadata.palette.sampling, 'nearest-clamp-no-mips');
});

test('rejects an empty transparent sprite', () => {
  assert.throws(
    () => buildSpriteVoxelMesh({ width: 1, height: 1, data: new Uint8Array(4) }),
    /no pixels/,
  );
});

test('creates rounded automatic relief while preserving the front pixel grid', () => {
  const data = new Uint8Array(5 * 5 * 4);
  for (let pixel = 0; pixel < 25; pixel += 1) {
    data[pixel * 4] = 128;
    data[pixel * 4 + 1] = 128;
    data[pixel * 4 + 2] = 128;
    data[pixel * 4 + 3] = 255;
  }
  const mesh = buildSpriteVoxelMesh(
    { width: 5, height: 5, data },
    { reliefMode: 'auto', maxDepthPixels: 8 },
  );

  assert.equal(mesh.metadata.mode, 'auto-relief');
  assert.equal(mesh.metadata.depth.maximumPixels, 8);
  assert.ok(mesh.metadata.depth.minimumPixels < mesh.metadata.depth.maximumPixels);
  assert.equal(mesh.metadata.dimensionsCentimetres.depth, 13.333333333333334);
  assert.ok(mesh.metadata.geometry.triangles > 100);
});

test('assembles procedural pixel parts in centimetre coordinates', async () => {
  const mesh = await buildAssemblyMesh({
    name: 'test_bench',
    pixelsPerCentimetre: 1,
    parts: [
      {
        name: 'top',
        generator: 'pixel-box',
        widthPixels: 10,
        heightPixels: 4,
        depthPixels: 2,
        colour: [100, 60, 30, 255],
        rotationDegrees: [-90, 0, 0],
        positionCentimetres: [0, 10, 2],
      },
      {
        name: 'leg',
        generator: 'pixel-box',
        widthPixels: 2,
        heightPixels: 10,
        depthPixels: 2,
        colour: [80, 45, 20, 255],
      },
    ],
  }, async () => null);

  assert.equal(mesh.metadata.mode, 'composite-assembly');
  assert.equal(mesh.metadata.geometry.parts, 2);
  assert.ok(mesh.metadata.geometry.triangles > 0);
  assert.ok(mesh.metadata.dimensionsCentimetres.height >= 10);
});
