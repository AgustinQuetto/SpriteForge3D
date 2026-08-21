const GLTF_COMPONENT_FLOAT = 5126;
const GLTF_COMPONENT_UNSIGNED_INT = 5125;

function assertImage(image) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new TypeError('image must provide integer width and height');
  }

  if (!image.data || image.data.length !== image.width * image.height * 4) {
    throw new TypeError('image.data must contain RGBA bytes for every pixel');
  }
}

function pushFace(target, vertices, normal, color) {
  const vertexOffset = target.positions.length / 3;
  const faceUvs = [[0, 0], [1, 0], [1, 1], [0, 1]];

  for (let corner = 0; corner < vertices.length; corner += 1) {
    const vertex = vertices[corner];
    target.positions.push(...vertex);
    target.normals.push(...normal);
    target.colors.push(color[0], color[1], color[2], color[3]);
    target.uvs.push(...faceUvs[corner]);
  }

  target.indices.push(
    vertexOffset,
    vertexOffset + 1,
    vertexOffset + 2,
    vertexOffset,
    vertexOffset + 2,
    vertexOffset + 3,
  );
}

function findOpaqueBounds(image, alphaThreshold) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let opaquePixels = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.data[(y * image.width + x) * 4 + 3];
      if (alpha < alphaThreshold) continue;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      opaquePixels += 1;
    }
  }

  if (opaquePixels === 0) {
    throw new Error(`image has no pixels at or above alpha threshold ${alphaThreshold}`);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    opaquePixels,
  };
}

function isOpaque(image, x, y, alphaThreshold) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  return image.data[(y * image.width + x) * 4 + 3] >= alphaThreshold;
}

function srgbByteToLinearFloat(value) {
  const srgb = value / 255;
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4;
}

function linearFloatToSrgbByte(value) {
  const linear = clamp01(value);
  const srgb = linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * (linear ** (1 / 2.4)) - 0.055;
  return Math.max(0, Math.min(255, Math.round(srgb * 255)));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function buildAutoReliefDepthMap(image, alphaThreshold, maxDepthPixels) {
  const paddedWidth = image.width + 2;
  const paddedHeight = image.height + 2;
  const distances = new Float32Array(paddedWidth * paddedHeight);
  const infinity = image.width + image.height + 2;

  for (let y = 1; y < paddedHeight - 1; y += 1) {
    for (let x = 1; x < paddedWidth - 1; x += 1) {
      distances[y * paddedWidth + x] = isOpaque(image, x - 1, y - 1, alphaThreshold)
        ? infinity
        : 0;
    }
  }

  const diagonal = Math.SQRT2;
  for (let y = 1; y < paddedHeight - 1; y += 1) {
    for (let x = 1; x < paddedWidth - 1; x += 1) {
      const index = y * paddedWidth + x;
      if (distances[index] === 0) continue;
      distances[index] = Math.min(
        distances[index],
        distances[index - 1] + 1,
        distances[index - paddedWidth] + 1,
        distances[index - paddedWidth - 1] + diagonal,
        distances[index - paddedWidth + 1] + diagonal,
      );
    }
  }
  for (let y = paddedHeight - 2; y >= 1; y -= 1) {
    for (let x = paddedWidth - 2; x >= 1; x -= 1) {
      const index = y * paddedWidth + x;
      if (distances[index] === 0) continue;
      distances[index] = Math.min(
        distances[index],
        distances[index + 1] + 1,
        distances[index + paddedWidth] + 1,
        distances[index + paddedWidth + 1] + diagonal,
        distances[index + paddedWidth - 1] + diagonal,
      );
    }
  }

  let maximumDistance = 1;
  for (let row = 0; row < image.height; row += 1) {
    for (let column = 0; column < image.width; column += 1) {
      if (!isOpaque(image, column, row, alphaThreshold)) continue;
      maximumDistance = Math.max(
        maximumDistance,
        distances[(row + 1) * paddedWidth + column + 1],
      );
    }
  }

  const depthMap = new Uint16Array(image.width * image.height);
  let minimumDepth = maxDepthPixels;
  let maximumDepth = 1;
  for (let row = 0; row < image.height; row += 1) {
    for (let column = 0; column < image.width; column += 1) {
      if (!isOpaque(image, column, row, alphaThreshold)) continue;
      const pixelIndex = row * image.width + column;
      const colourIndex = pixelIndex * 4;
      const distance = distances[(row + 1) * paddedWidth + column + 1];
      const roundedProfile = Math.sqrt(distance / maximumDistance);
      const luminance = (
        image.data[colourIndex] * 0.2126
        + image.data[colourIndex + 1] * 0.7152
        + image.data[colourIndex + 2] * 0.0722
      ) / 255;
      const normalisedDepth = clamp01(
        roundedProfile + (luminance - 0.5) * 0.36 * (1 - roundedProfile),
      );
      const depth = Math.max(1, Math.round(normalisedDepth * maxDepthPixels));
      depthMap[pixelIndex] = depth;
      minimumDepth = Math.min(minimumDepth, depth);
      maximumDepth = Math.max(maximumDepth, depth);
    }
  }

  return { depthMap, minimumDepth, maximumDepth, maximumDistance };
}

/**
 * Builds a watertight, pixel-faithful extrusion. The front and rear surfaces keep
 * one flat-colored quad per source pixel, while hidden faces are culled.
 * Coordinates use glTF metres and a base-centred model pivot.
 */
export function buildSpriteVoxelMesh(image, options = {}) {
  assertImage(image);

  const pixelsPerCentimetre = Number(options.pixelsPerCentimetre ?? 0.6);
  const depthPixels = Number(options.depthPixels ?? 3);
  const reliefMode = options.reliefMode === 'auto' ? 'auto' : 'flat';
  const maxDepthPixels = Number(options.maxDepthPixels ?? 64);
  const alphaThreshold = Number(options.alphaThreshold ?? 1);

  if (!(pixelsPerCentimetre > 0)) throw new RangeError('pixelsPerCentimetre must be greater than zero');
  if (!(depthPixels > 0)) throw new RangeError('depthPixels must be greater than zero');
  if (!Number.isInteger(maxDepthPixels) || maxDepthPixels < 1 || maxDepthPixels > 2048) {
    throw new RangeError('maxDepthPixels must be an integer from 1 to 2048');
  }
  if (!Number.isInteger(alphaThreshold) || alphaThreshold < 1 || alphaThreshold > 255) {
    throw new RangeError('alphaThreshold must be an integer from 1 to 255');
  }

  const bounds = findOpaqueBounds(image, alphaThreshold);
  const pixelCentimetres = 1 / pixelsPerCentimetre;
  const pixelMetres = pixelCentimetres / 100;
  const relief = reliefMode === 'auto'
    ? buildAutoReliefDepthMap(image, alphaThreshold, maxDepthPixels)
    : null;
  const modelDepthPixels = relief ? relief.maximumDepth : depthPixels;
  const modelDepthMetres = modelDepthPixels * pixelMetres;
  const backDepth = -modelDepthMetres / 2;
  const supportCentrePixel = (bounds.minX + bounds.maxX + 1) / 2;
  const mesh = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  const depthAt = (column, row) => {
    if (!isOpaque(image, column, row, alphaThreshold)) return 0;
    if (!relief) return depthPixels;
    return relief.depthMap[row * image.width + column];
  };

  for (let row = bounds.minY; row <= bounds.maxY; row += 1) {
    for (let column = bounds.minX; column <= bounds.maxX; column += 1) {
      if (!isOpaque(image, column, row, alphaThreshold)) continue;

      const pixelOffset = (row * image.width + column) * 4;
      const color = [
        srgbByteToLinearFloat(image.data[pixelOffset]),
        srgbByteToLinearFloat(image.data[pixelOffset + 1]),
        srgbByteToLinearFloat(image.data[pixelOffset + 2]),
        image.data[pixelOffset + 3] / 255,
      ];
      const x0 = (column - supportCentrePixel) * pixelMetres;
      const x1 = x0 + pixelMetres;
      const y0 = (bounds.maxY - row) * pixelMetres;
      const y1 = y0 + pixelMetres;
      const frontDepth = backDepth + depthAt(column, row) * pixelMetres;

      pushFace(mesh, [
        [x0, y0, frontDepth], [x1, y0, frontDepth],
        [x1, y1, frontDepth], [x0, y1, frontDepth],
      ], [0, 0, 1], color);
      pushFace(mesh, [
        [x1, y0, backDepth], [x0, y0, backDepth],
        [x0, y1, backDepth], [x1, y1, backDepth],
      ], [0, 0, -1], color);

      const leftDepth = backDepth + depthAt(column - 1, row) * pixelMetres;
      if (frontDepth > leftDepth) {
        pushFace(mesh, [
          [x0, y0, leftDepth], [x0, y0, frontDepth],
          [x0, y1, frontDepth], [x0, y1, leftDepth],
        ], [-1, 0, 0], color);
      }
      const rightDepth = backDepth + depthAt(column + 1, row) * pixelMetres;
      if (frontDepth > rightDepth) {
        pushFace(mesh, [
          [x1, y0, frontDepth], [x1, y0, rightDepth],
          [x1, y1, rightDepth], [x1, y1, frontDepth],
        ], [1, 0, 0], color);
      }
      const bottomDepth = backDepth + depthAt(column, row + 1) * pixelMetres;
      if (frontDepth > bottomDepth) {
        pushFace(mesh, [
          [x0, y0, bottomDepth], [x1, y0, bottomDepth],
          [x1, y0, frontDepth], [x0, y0, frontDepth],
        ], [0, -1, 0], color);
      }
      const topDepth = backDepth + depthAt(column, row - 1) * pixelMetres;
      if (frontDepth > topDepth) {
        pushFace(mesh, [
          [x0, y1, frontDepth], [x1, y1, frontDepth],
          [x1, y1, topDepth], [x0, y1, topDepth],
        ], [0, 1, 0], color);
      }
    }
  }

  const padding = {
    left: bounds.minX,
    right: image.width - bounds.maxX - 1,
    top: bounds.minY,
    bottom: image.height - bounds.maxY - 1,
  };
  const canonicalCameraCentreMetres = {
    x: (image.width / 2 - supportCentrePixel) * pixelMetres,
    y: (image.height / 2 - padding.bottom) * pixelMetres,
    z: 0,
  };

  return {
    ...mesh,
    metadata: {
      schemaVersion: 1,
      mode: reliefMode === 'auto' ? 'auto-relief' : 'pixel-extrusion',
      sourceCanvas: { width: image.width, height: image.height },
      opaqueBounds: bounds,
      transparentPadding: padding,
      scale: {
        pixelsPerCentimetre,
        centimetresPerPixel: pixelCentimetres,
        metresPerPixel: pixelMetres,
      },
      colourEncoding: 'linear-float-from-srgb-png',
      depth: relief
        ? {
          algorithm: 'chamfer-distance-luminance',
          minimumPixels: relief.minimumDepth,
          maximumPixels: relief.maximumDepth,
          maximumInteriorDistancePixels: relief.maximumDistance,
          maximumCentimetres: relief.maximumDepth * pixelCentimetres,
        }
        : { pixels: depthPixels, centimetres: depthPixels * pixelCentimetres },
      pivot: 'base-support-centre',
      canonicalFrame: {
        orthographicHeightMetres: image.height * pixelMetres,
        aspectRatio: image.width / image.height,
        cameraCentreMetres: canonicalCameraCentreMetres,
      },
      dimensionsCentimetres: {
        width: bounds.width * pixelCentimetres,
        height: bounds.height * pixelCentimetres,
        depth: modelDepthPixels * pixelCentimetres,
      },
      geometry: {
        opaquePixels: bounds.opaquePixels,
        vertices: mesh.positions.length / 3,
        triangles: mesh.indices.length / 3,
      },
    },
  };
}

/**
 * Rewrites UV0 into a nearest-filtered colour-palette atlas. Vertex colours are
 * retained as the authoring/fallback representation, while the palette makes
 * the FBX -> Unreal path deterministic even when an importer drops COLOR_0.
 */
export function buildPaletteTexture(mesh, options = {}) {
  if (!mesh || mesh.colors.length / 4 !== mesh.positions.length / 3) {
    throw new TypeError('mesh must contain one RGBA colour per vertex');
  }

  const maximumWidth = Math.max(1, Math.floor(Number(options.maximumWidth ?? 256)));
  const keys = [];
  const paletteIndexByKey = new Map();
  const vertexPaletteIndices = new Uint32Array(mesh.colors.length / 4);

  for (let vertex = 0; vertex < vertexPaletteIndices.length; vertex += 1) {
    const offset = vertex * 4;
    const rgba = [
      linearFloatToSrgbByte(mesh.colors[offset]),
      linearFloatToSrgbByte(mesh.colors[offset + 1]),
      linearFloatToSrgbByte(mesh.colors[offset + 2]),
      Math.max(0, Math.min(255, Math.round(clamp01(mesh.colors[offset + 3]) * 255))),
    ];
    const key = rgba.join(',');
    let paletteIndex = paletteIndexByKey.get(key);
    if (paletteIndex === undefined) {
      paletteIndex = keys.length;
      paletteIndexByKey.set(key, paletteIndex);
      keys.push(rgba);
    }
    vertexPaletteIndices[vertex] = paletteIndex;
  }

  const width = Math.min(maximumWidth, Math.max(1, keys.length));
  const height = Math.max(1, Math.ceil(keys.length / width));
  const rgba = new Uint8Array(width * height * 4);
  mesh.uvs.length = 0;

  for (let index = 0; index < keys.length; index += 1) {
    rgba.set(keys[index], index * 4);
  }
  for (let vertex = 0; vertex < vertexPaletteIndices.length; vertex += 1) {
    const paletteIndex = vertexPaletteIndices[vertex];
    const column = paletteIndex % width;
    const row = Math.floor(paletteIndex / width);
    const cornerOffsets = [
      [-0.2, -0.2],
      [0.2, -0.2],
      [0.2, 0.2],
      [-0.2, 0.2],
    ];
    const [offsetX, offsetY] = cornerOffsets[vertex % 4];
    mesh.uvs.push(
      (column + 0.5 + offsetX) / width,
      (row + 0.5 + offsetY) / height,
    );
  }

  mesh.metadata.palette = {
    colours: keys.length,
    width,
    height,
    encoding: 'srgb-rgba8',
    uvChannel: 0,
    sampling: 'nearest-clamp-no-mips',
  };
  return { width, height, data: rgba, colours: keys.length };
}

function align4(value) {
  return (value + 3) & ~3;
}

function typedArrayBytes(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

export function encodeGlb(mesh, options = {}) {
  const name = options.name || 'SpriteForgeVoxel';
  const positions = Float32Array.from(mesh.positions);
  const normals = Float32Array.from(mesh.normals);
  const colors = Float32Array.from(mesh.colors);
  const uvs = Float32Array.from(mesh.uvs);
  const indices = Uint32Array.from(mesh.indices);
  const chunks = [
    { name: 'positions', bytes: typedArrayBytes(positions), target: 34962 },
    { name: 'normals', bytes: typedArrayBytes(normals), target: 34962 },
    { name: 'colors', bytes: typedArrayBytes(colors), target: 34962 },
    { name: 'uvs', bytes: typedArrayBytes(uvs), target: 34962 },
    { name: 'indices', bytes: typedArrayBytes(indices), target: 34963 },
  ];

  let binaryLength = 0;
  for (const chunk of chunks) {
    binaryLength = align4(binaryLength);
    chunk.byteOffset = binaryLength;
    binaryLength += chunk.bytes.length;
  }
  binaryLength = align4(binaryLength);

  const binary = Buffer.alloc(binaryLength);
  for (const chunk of chunks) chunk.bytes.copy(binary, chunk.byteOffset);

  const positionMin = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const positionMax = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[index + axis];
      positionMin[axis] = Math.min(positionMin[axis], value);
      positionMax[axis] = Math.max(positionMax[axis], value);
    }
  }
  const bufferViews = chunks.map((chunk) => ({
    buffer: 0,
    byteOffset: chunk.byteOffset,
    byteLength: chunk.bytes.length,
    target: chunk.target,
  }));
  const gltf = {
    asset: { version: '2.0', generator: 'SpriteForge3D AI Pipeline' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{
      name,
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2, TEXCOORD_0: 3 },
        indices: 4,
        material: 0,
        mode: 4,
      }],
    }],
    materials: [{
      name: `${name}_PixelColour`,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      doubleSided: true,
    }],
    buffers: [{ byteLength: binary.length }],
    bufferViews,
    accessors: [
      {
        bufferView: 0,
        componentType: GLTF_COMPONENT_FLOAT,
        count: positions.length / 3,
        type: 'VEC3',
        min: positionMin,
        max: positionMax,
      },
      {
        bufferView: 1,
        componentType: GLTF_COMPONENT_FLOAT,
        count: normals.length / 3,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        componentType: GLTF_COMPONENT_FLOAT,
        count: colors.length / 4,
        type: 'VEC4',
      },
      {
        bufferView: 3,
        componentType: GLTF_COMPONENT_FLOAT,
        count: uvs.length / 2,
        type: 'VEC2',
      },
      {
        bufferView: 4,
        componentType: GLTF_COMPONENT_UNSIGNED_INT,
        count: indices.length,
        type: 'SCALAR',
      },
    ],
    extras: { spriteForge: mesh.metadata },
  };

  if (options.unlit) {
    gltf.extensionsUsed = ['KHR_materials_unlit'];
    gltf.materials[0].extensions = { KHR_materials_unlit: {} };
  }

  const jsonPayload = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonLength = align4(jsonPayload.length);
  const json = Buffer.alloc(jsonLength, 0x20);
  jsonPayload.copy(json);

  const totalLength = 12 + 8 + json.length + 8 + binary.length;
  const glb = Buffer.alloc(totalLength);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const binaryHeader = 20 + json.length;
  glb.writeUInt32LE(binary.length, binaryHeader);
  glb.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(glb, binaryHeader + 8);

  return glb;
}
