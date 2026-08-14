import * as THREE from 'three';

const FORMAT = 'voxel-binary-sparse-v1';
const AXES = ['x', 'y', 'z'];

const FACE_DEFINITIONS = [
  { neighbour: [1, 0, 0], normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { neighbour: [-1, 0, 0], normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { neighbour: [0, 1, 0], normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { neighbour: [0, -1, 0], normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { neighbour: [0, 0, 1], normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { neighbour: [0, 0, -1], normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

function voxelKey(x, y, z) {
  return `${x},${y},${z}`;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

/** Validate and normalize a voxel-binary-sparse-v1 document. */
export function parseVoxelJSON(source) {
  const data = typeof source === 'string' ? JSON.parse(source) : source;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Voxel JSON must contain an object');
  }
  if (data.format !== FORMAT) {
    throw new Error(`Unsupported voxel format: ${data.format || 'missing format'}`);
  }

  const dimensions = {};
  for (const axis of AXES) {
    dimensions[axis] = requirePositiveInteger(data.dimensions?.[axis], `dimensions.${axis}`);
  }

  if (!Array.isArray(data.order) || data.order.length !== 3
      || new Set(data.order).size !== 3 || !AXES.every(axis => data.order.includes(axis))) {
    throw new Error('order must contain x, y and z exactly once');
  }
  if (!Array.isArray(data.filledVoxels)) {
    throw new Error('filledVoxels must be an array');
  }

  const seen = new Set();
  const voxels = [];
  for (let index = 0; index < data.filledVoxels.length; index++) {
    const tuple = data.filledVoxels[index];
    if (!Array.isArray(tuple) || tuple.length !== 3 || !tuple.every(Number.isInteger)) {
      throw new Error(`filledVoxels[${index}] must contain three integers`);
    }

    const voxel = { x: 0, y: 0, z: 0 };
    data.order.forEach((axis, tupleIndex) => { voxel[axis] = tuple[tupleIndex]; });
    for (const axis of AXES) {
      if (voxel[axis] < 0 || voxel[axis] >= dimensions[axis]) {
        throw new Error(`filledVoxels[${index}] is outside dimensions on axis ${axis}`);
      }
    }

    const key = voxelKey(voxel.x, voxel.y, voxel.z);
    if (!seen.has(key)) {
      seen.add(key);
      voxels.push(voxel);
    }
  }

  if (voxels.length === 0) {
    throw new Error('filledVoxels must contain at least one voxel');
  }

  return {
    format: FORMAT,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Voxel Model',
    dimensions,
    order: [...data.order],
    voxels,
  };
}

/** Build one exportable mesh, emitting only faces exposed to air. */
export function createVoxelMesh(source, options = {}) {
  const model = source?.voxels ? source : parseVoxelJSON(source);
  const voxelSize = Number(options.voxelSize ?? 1);
  if (!Number.isFinite(voxelSize) || voxelSize <= 0) {
    throw new Error('voxelSize must be a positive number');
  }

  const occupied = new Set(model.voxels.map(({ x, y, z }) => voxelKey(x, y, z)));
  const positions = [];
  const normals = [];
  const indices = [];
  let vertexOffset = 0;

  const originX = -model.dimensions.x * voxelSize / 2;
  const originZ = -model.dimensions.z * voxelSize / 2;

  for (const voxel of model.voxels) {
    for (const face of FACE_DEFINITIONS) {
      const nx = voxel.x + face.neighbour[0];
      const ny = voxel.y + face.neighbour[1];
      const nz = voxel.z + face.neighbour[2];
      if (occupied.has(voxelKey(nx, ny, nz))) continue;

      for (const corner of face.corners) {
        positions.push(
          originX + (voxel.x + corner[0]) * voxelSize,
          (voxel.y + corner[1]) * voxelSize,
          originZ + (voxel.z + corner[2]) * voxelSize,
        );
        normals.push(...face.normal);
      }
      indices.push(
        vertexOffset, vertexOffset + 1, vertexOffset + 2,
        vertexOffset, vertexOffset + 2, vertexOffset + 3,
      );
      vertexOffset += 4;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const color = options.color ?? 0x8fb3d9;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = model.name;
  mesh.userData.type = 'voxel-json';
  mesh.userData.voxelFormat = model.format;
  mesh.userData.voxelCount = model.voxels.length;
  mesh.userData.voxelSize = voxelSize;
  mesh.userData.originalWidth = model.dimensions.x * voxelSize;
  mesh.userData.originalHeight = model.dimensions.y * voxelSize;
  mesh.userData.extrusionDepth = model.dimensions.z * voxelSize;
  mesh.userData.voxelSource = {
    format: model.format,
    name: model.name,
    dimensions: { ...model.dimensions },
    order: [...model.order],
    filledVoxels: model.voxels.map(voxel => model.order.map(axis => voxel[axis])),
  };
  return mesh;
}

