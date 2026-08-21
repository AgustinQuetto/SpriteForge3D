import {
  Euler,
  Matrix3,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { buildSpriteVoxelMesh } from './SpriteVoxelPipeline.js';

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hashNoise(x, y, seed) {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function validatePixelDimensions(part) {
  const width = Number(part.widthPixels);
  const height = Number(part.heightPixels);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`${part.name || 'part'} requires positive integer widthPixels and heightPixels`);
  }
  if (width * height > 4_000_000) throw new Error(`${part.name || 'part'} exceeds the 4M pixel safety limit`);
  return { width, height };
}

function makePixelBoxImage(part) {
  const { width, height } = validatePixelDimensions(part);
  const base = part.colour || [128, 128, 128, 255];
  const variation = Number(part.colourVariation ?? 0.12);
  const seed = Number(part.seed ?? 1);
  const grainScale = Math.max(1, Number(part.grainScalePixels ?? 12));
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const fine = hashNoise(x, y, seed) - 0.5;
      const grain = Math.sin((x / grainScale) * Math.PI * 2 + seed) * 0.35;
      const band = Math.sin((y / Math.max(2, grainScale * 0.7)) * Math.PI * 2 + seed * 0.4) * 0.15;
      const multiplier = 1 + (fine + grain + band) * variation;
      data[offset] = clampByte(base[0] * multiplier);
      data[offset + 1] = clampByte(base[1] * multiplier);
      data[offset + 2] = clampByte(base[2] * multiplier);
      data[offset + 3] = clampByte(base[3] ?? 255);
    }
  }

  return { width, height, data };
}

function makePixelDiscImage(part) {
  const { width, height } = validatePixelDimensions(part);
  const base = part.colour || [160, 168, 166, 255];
  const teeth = Math.max(0, Math.round(Number(part.teeth ?? 28)));
  const seed = Number(part.seed ?? 1);
  const data = new Uint8Array(width * height * 4);
  const centreX = width / 2;
  const centreY = height / 2;
  const radius = Math.min(width, height) / 2 - 1;
  const toothDepth = Math.max(1, Number(part.toothDepthPixels ?? 2));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x + 0.5 - centreX;
      const dy = y + 0.5 - centreY;
      const distance = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const toothWave = teeth ? (Math.sin(angle * teeth) > 0 ? toothDepth : 0) : 0;
      const localRadius = radius - toothDepth + toothWave;
      if (distance > localRadius) continue;

      const offset = (y * width + x) * 4;
      const radial = distance / Math.max(1, radius);
      const glint = Math.sin(angle * 5 + radial * 17 + seed) * 0.12;
      const ring = Math.sin(radial * Math.PI * 12) * 0.06;
      const multiplier = 0.82 + (1 - radial) * 0.18 + glint + ring;
      data[offset] = clampByte(base[0] * multiplier);
      data[offset + 1] = clampByte(base[1] * multiplier);
      data[offset + 2] = clampByte(base[2] * multiplier);
      data[offset + 3] = clampByte(base[3] ?? 255);
    }
  }

  return { width, height, data };
}

function partImage(part) {
  if (part.generator === 'pixel-box') return makePixelBoxImage(part);
  if (part.generator === 'pixel-disc') return makePixelDiscImage(part);
  return null;
}

function transformPartMesh(mesh, part) {
  const position = part.positionCentimetres || [0, 0, 0];
  const rotation = part.rotationDegrees || [0, 0, 0];
  const scale = Array.isArray(part.scale) ? part.scale : [part.scale ?? 1, part.scale ?? 1, part.scale ?? 1];
  const translation = new Vector3(position[0] / 100, position[1] / 100, position[2] / 100);
  const euler = new Euler(
    rotation[0] * Math.PI / 180,
    rotation[1] * Math.PI / 180,
    rotation[2] * Math.PI / 180,
    'XYZ',
  );
  const quaternion = new Quaternion().setFromEuler(euler);
  const matrix = new Matrix4().compose(translation, quaternion, new Vector3(...scale));
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  const point = new Vector3();
  const normal = new Vector3();

  const positions = [];
  const normals = [];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    point.set(mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]);
    point.applyMatrix4(matrix);
    positions.push(point.x, point.y, point.z);

    normal.set(mesh.normals[index], mesh.normals[index + 1], mesh.normals[index + 2]);
    normal.applyMatrix3(normalMatrix).normalize();
    normals.push(normal.x, normal.y, normal.z);
  }

  return { ...mesh, positions, normals };
}

function aggregateBounds(positions) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], positions[index + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[index + axis]);
    }
  }
  return { minimum, maximum };
}

/**
 * Creates a single vertex-colour mesh from sprite and procedural pixel parts.
 * Recipe coordinates are centimetres in glTF's Y-up coordinate system.
 */
export async function buildAssemblyMesh(recipe, loadImage) {
  if (!recipe || !Array.isArray(recipe.parts) || recipe.parts.length === 0) {
    throw new Error('assembly recipe must contain at least one part');
  }
  const pixelsPerCentimetre = Number(recipe.pixelsPerCentimetre ?? 0.6);
  const merged = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  const partMetadata = [];

  for (const part of recipe.parts) {
    let image = partImage(part);
    if (!image && part.source) image = await loadImage(part.source);
    if (!image) throw new Error(`${part.name || 'part'} requires source, pixel-box, or pixel-disc`);

    const sourceMesh = buildSpriteVoxelMesh(image, {
      pixelsPerCentimetre,
      depthPixels: Number(part.depthPixels ?? 3),
      reliefMode: part.relief === 'auto' ? 'auto' : 'flat',
      maxDepthPixels: Number(part.maxDepthPixels ?? 32),
      alphaThreshold: Number(part.alphaThreshold ?? 1),
    });
    const transformed = transformPartMesh(sourceMesh, part);
    const indexOffset = merged.positions.length / 3;
    merged.positions.push(...transformed.positions);
    merged.normals.push(...transformed.normals);
    merged.colors.push(...transformed.colors);
    merged.uvs.push(...transformed.uvs);
    merged.indices.push(...transformed.indices.map((index) => index + indexOffset));
    partMetadata.push({
      name: part.name || `part_${partMetadata.length + 1}`,
      source: part.source || part.generator,
      mode: sourceMesh.metadata.mode,
      geometry: sourceMesh.metadata.geometry,
      transform: {
        positionCentimetres: part.positionCentimetres || [0, 0, 0],
        rotationDegrees: part.rotationDegrees || [0, 0, 0],
        scale: part.scale ?? 1,
      },
    });
  }

  const bounds = aggregateBounds(merged.positions);
  merged.metadata = {
    schemaVersion: 1,
    mode: 'composite-assembly',
    name: recipe.name || 'SpriteForgeAssembly',
    pixelsPerCentimetre,
    pivot: recipe.pivot || 'recipe-origin',
    boundsMetres: bounds,
    dimensionsCentimetres: {
      width: (bounds.maximum[0] - bounds.minimum[0]) * 100,
      height: (bounds.maximum[1] - bounds.minimum[1]) * 100,
      depth: (bounds.maximum[2] - bounds.minimum[2]) * 100,
    },
    geometry: {
      parts: partMetadata.length,
      vertices: merged.positions.length / 3,
      triangles: merged.indices.length / 3,
    },
    parts: partMetadata,
  };
  return merged;
}
