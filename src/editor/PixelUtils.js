/**
 * PixelUtils — Image sampling, flood-fill selection, and voxel coordinate mapping.
 */

export const ALPHA_THRESHOLD = 30;

/**
 * Read RGBA pixel data from a mesh's source texture.
 * @returns {{ data: Uint8ClampedArray, width: number, height: number } | null}
 */
export function getImageDataFromMesh(mesh, { respectUV = false } = {}) {
  const texture = mesh.userData.texture;
  if (!texture?.image) return null;

  const img = texture.image;
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  if (!respectUV) return { data, width, height };

  const repeat = mesh.userData.uvRepeat || [1, 1];
  const offset = mesh.userData.uvOffset || [0, 0];
  const repeatX = Math.max(0.0001, Math.abs(Number(repeat[0]) || 1));
  const repeatY = Math.max(0.0001, Math.abs(Number(repeat[1]) || 1));
  const tiledWidth = Math.max(1, Math.round(width * repeatX));
  const tiledHeight = Math.max(1, Math.round(height * repeatY));

  if (tiledWidth === width && tiledHeight === height && offset[0] === 0 && offset[1] === 0) {
    return { data, width, height };
  }

  const tiledData = new Uint8ClampedArray(tiledWidth * tiledHeight * 4);
  const wrap = (value, size) => ((value % size) + size) % size;

  for (let row = 0; row < tiledHeight; row++) {
    const sourceV = ((row + 0.5) / tiledHeight) * repeatY + Number(offset[1] || 0);
    const sourceRow = wrap(Math.floor(sourceV * height), height);
    for (let col = 0; col < tiledWidth; col++) {
      const sourceU = ((col + 0.5) / tiledWidth) * repeatX + Number(offset[0] || 0);
      const sourceCol = wrap(Math.floor(sourceU * width), width);
      const sourceIndex = (sourceRow * width + sourceCol) * 4;
      const targetIndex = (row * tiledWidth + col) * 4;
      tiledData[targetIndex] = data[sourceIndex];
      tiledData[targetIndex + 1] = data[sourceIndex + 1];
      tiledData[targetIndex + 2] = data[sourceIndex + 2];
      tiledData[targetIndex + 3] = data[sourceIndex + 3];
    }
  }

  return { data: tiledData, width: tiledWidth, height: tiledHeight };
}

export function pixelIndex(col, row, imgW) {
  return row * imgW + col;
}

/**
 * Local-space centre of the first voxel in the editable image grid.
 * Derived pieces keep the full source image for UVs and painting, but shift
 * this grid so their transform pivot sits at the bottom-centre of the piece.
 */
export function getVoxelGridOrigin(mesh, width, height) {
  const pixelSize = mesh.userData.voxelPixelSize || 1;
  const pivot = mesh.userData.voxelPivotOffset || [0, 0];
  return {
    x: -width * pixelSize / 2 + pixelSize / 2 - Number(pivot[0] || 0),
    y: pixelSize / 2 - Number(pivot[1] || 0),
  };
}

/**
 * Max channel delta between two RGBA pixels (0–255 scale).
 */
export function colorDistance(r1, g1, b1, a1, r2, g2, b2, a2) {
  return Math.max(
    Math.abs(r1 - r2),
    Math.abs(g1 - g2),
    Math.abs(b1 - b2),
    Math.abs(a1 - a2)
  );
}

/**
 * Flood-fill connected pixels similar to the seed within tolerance.
 * @returns {Uint8Array} mask of size width*height (1 = selected)
 */
export function floodFill(data, width, height, seedCol, seedRow, tolerance) {
  const mask = new Uint8Array(width * height);
  const si = pixelIndex(seedCol, seedRow, width);
  const seedA = data[si * 4 + 3];
  if (seedA < ALPHA_THRESHOLD) return mask;

  const sr = data[si * 4];
  const sg = data[si * 4 + 1];
  const sb = data[si * 4 + 2];
  const sa = data[si * 4 + 3];

  const queue = [[seedCol, seedRow]];
  mask[si] = 1;
  let head = 0;

  while (head < queue.length) {
    const [col, row] = queue[head++];

    const neighbors = [
      [col - 1, row], [col + 1, row],
      [col, row - 1], [col, row + 1],
    ];

    for (const [nc, nr] of neighbors) {
      if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
      const ni = pixelIndex(nc, nr, width);
      if (mask[ni]) continue;

      const i = ni * 4;
      const a = data[i + 3];
      if (a < ALPHA_THRESHOLD) continue;

      const dist = colorDistance(
        sr, sg, sb, sa,
        data[i], data[i + 1], data[i + 2], a
      );
      if (dist > tolerance) continue;

      mask[ni] = 1;
      queue.push([nc, nr]);
    }
  }

  return mask;
}

/**
 * Mask with a single opaque pixel (or empty if transparent).
 */
export function selectSinglePixel(data, width, height, col, row) {
  const mask = new Uint8Array(width * height);
  if (col < 0 || col >= width || row < 0 || row >= height) return mask;
  const pi = pixelIndex(col, row, width);
  if (data[pi * 4 + 3] >= ALPHA_THRESHOLD) mask[pi] = 1;
  return mask;
}

/**
 * Rectangular selection of all opaque pixels within bounds (inclusive).
 */
export function selectRect(data, width, height, col0, row0, col1, row1) {
  const mask = new Uint8Array(width * height);
  const minCol = Math.max(0, Math.min(col0, col1));
  const maxCol = Math.min(width - 1, Math.max(col0, col1));
  const minRow = Math.max(0, Math.min(row0, row1));
  const maxRow = Math.min(height - 1, Math.max(row0, row1));

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const pi = pixelIndex(col, row, width);
      if (data[pi * 4 + 3] >= ALPHA_THRESHOLD) mask[pi] = 1;
    }
  }
  return mask;
}

/**
 * Merge a mask into mesh selection.
 * @param {'replace'|'add'|'remove'} mode
 */
export function mergeSelection(selection, newMask, mode) {
  if (mode === 'replace') {
    selection.fill(0);
    for (let i = 0; i < newMask.length; i++) {
      if (newMask[i]) selection[i] = 1;
    }
    return;
  }
  for (let i = 0; i < newMask.length; i++) {
    if (!newMask[i]) continue;
    if (mode === 'add') selection[i] = 1;
    else if (mode === 'remove') selection[i] = 0;
  }
}

/**
 * Convert a world-space hit point on a voxel mesh to pixel (col, row).
 * @returns {{ col: number, row: number } | null}
 */
export function hitToPixel(mesh, hitPointWorld) {
  const imgW = mesh.userData.voxelImageWidth || (mesh.userData.originalWidth
    ? Math.round(mesh.userData.originalWidth / (mesh.userData.voxelPixelSize || 1))
    : null);
  const imgH = mesh.userData.voxelImageHeight || (mesh.userData.originalHeight
    ? Math.round(mesh.userData.originalHeight / (mesh.userData.voxelPixelSize || 1))
    : null);

  const texture = mesh.userData.texture?.image;
  const width = mesh.userData.voxelImageWidth || (texture ? (texture.naturalWidth || texture.width) : imgW);
  const height = mesh.userData.voxelImageHeight || (texture ? (texture.naturalHeight || texture.height) : imgH);
  if (!width || !height) return null;

  const pixelSize = mesh.userData.voxelPixelSize || 1;
  const local = hitPointWorld.clone();
  mesh.worldToLocal(local);

  const { x: originX, y: originY } = getVoxelGridOrigin(mesh, width, height);

  const col = Math.round((local.x - originX) / pixelSize);
  const row = height - 1 - Math.round((local.y - originY) / pixelSize);

  if (col < 0 || col >= width || row < 0 || row >= height) return null;
  return { col, row };
}

/**
 * Ensure mesh has a depth map aligned to its texture dimensions.
 */
export function ensureDepthMap(mesh) {
  const imageData = getImageDataFromMesh(mesh, { respectUV: !!mesh.userData.voxelUsesUVRepeat });
  if (!imageData) return null;

  const { width, height, data } = imageData;
  const size = width * height;

  if (!mesh.userData.voxelDepthMap || mesh.userData.voxelDepthMap.length !== size) {
    const depthMap = new Uint16Array(size);
    mesh.userData.voxelDepthMap = depthMap;
    mesh.userData.voxelImageWidth = width;
    mesh.userData.voxelImageHeight = height;
  }

  if (!mesh.userData.voxelSelection || mesh.userData.voxelSelection.length !== size) {
    mesh.userData.voxelSelection = new Uint8Array(size);
  }

  return { depthMap: mesh.userData.voxelDepthMap, selection: mesh.userData.voxelSelection, data, width, height };
}

/**
 * Ensure the editable pixel layer used by the voxel brush exists.
 * The alpha channel of the source texture is only the initial state; after
 * this is created, the brush owns occupancy and colour for every pixel.
 */
export function ensureVoxelPaintData(mesh, suppliedImageData = null) {
  const imageData = suppliedImageData || getImageDataFromMesh(mesh, {
    respectUV: !!mesh.userData.voxelUsesUVRepeat,
  });
  if (!imageData) return null;

  const { data, width, height } = imageData;
  const size = width * height;
  const currentActive = mesh.userData.voxelActiveMap;
  const currentColors = mesh.userData.voxelColorMap;

  if (!(currentActive instanceof Uint8Array) || currentActive.length !== size
      || !(currentColors instanceof Uint8Array) || currentColors.length !== size * 4) {
    const active = new Uint8Array(size);
    const colors = new Uint8Array(size * 4);
    for (let i = 0; i < size; i++) {
      const src = i * 4;
      active[i] = data[src + 3] >= ALPHA_THRESHOLD ? 1 : 0;
      colors[src] = data[src];
      colors[src + 1] = data[src + 1];
      colors[src + 2] = data[src + 2];
      colors[src + 3] = data[src + 3];
    }
    mesh.userData.voxelActiveMap = active;
    mesh.userData.voxelColorMap = colors;
  }

  mesh.userData.voxelImageWidth = width;
  mesh.userData.voxelImageHeight = height;
  return {
    active: mesh.userData.voxelActiveMap,
    colors: mesh.userData.voxelColorMap,
    data,
    width,
    height,
  };
}

/** Return image data that treats brush-added pixels as opaque. */
export function getVoxelPaintImageData(mesh) {
  const paintData = ensureVoxelPaintData(mesh);
  if (!paintData) return null;

  const data = new Uint8ClampedArray(paintData.data);
  for (let i = 0; i < paintData.active.length; i++) {
    const ci = i * 4;
    if (paintData.active[i]) {
      data[ci] = paintData.colors[ci];
      data[ci + 1] = paintData.colors[ci + 1];
      data[ci + 2] = paintData.colors[ci + 2];
      data[ci + 3] = 255;
    } else {
      data[ci + 3] = 0;
    }
  }
  return { data, width: paintData.width, height: paintData.height };
}

/** Count set bits in a Uint8Array mask. */
export function countMask(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

/**
 * Partition an editable voxel layer using its current selection.
 * Selected active columns are removed from the remaining state and copied to
 * a new piece state. Both returned selections are cleared intentionally so a
 * second separation always requires an explicit new selection.
 */
export function splitVoxelStateBySelection({
  active,
  selection,
  depthMap = null,
  colors = null,
  width,
  height,
}) {
  const size = Number(width) * Number(height);
  if (!Number.isInteger(size) || size <= 0) return null;
  if (!active || active.length !== size || !selection || selection.length !== size) return null;
  if (depthMap && depthMap.length !== size) return null;
  if (colors && colors.length !== size * 4) return null;

  const remainingActive = new Uint8Array(active);
  const pieceActive = new Uint8Array(size);
  const remainingDepth = depthMap ? new Uint16Array(depthMap) : new Uint16Array(size);
  const pieceDepth = new Uint16Array(size);
  const remainingColors = colors ? new Uint8Array(colors) : null;
  const pieceColors = colors ? new Uint8Array(colors) : null;
  let movedCount = 0;
  let minCol = width;
  let maxCol = -1;
  let minRow = height;
  let maxRow = -1;

  for (let index = 0; index < size; index += 1) {
    if (!selection[index] || !active[index]) continue;
    const col = index % width;
    const row = Math.floor(index / width);
    remainingActive[index] = 0;
    pieceActive[index] = 1;
    pieceDepth[index] = depthMap?.[index] || 0;
    remainingDepth[index] = 0;
    movedCount += 1;
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  }

  if (movedCount === 0) return null;

  return {
    movedCount,
    remainingCount: countMask(remainingActive),
    bounds: { minCol, maxCol, minRow, maxRow },
    remaining: {
      active: remainingActive,
      selection: new Uint8Array(size),
      depthMap: remainingDepth,
      colors: remainingColors,
    },
    piece: {
      active: pieceActive,
      selection: new Uint8Array(size),
      depthMap: pieceDepth,
      colors: pieceColors,
    },
  };
}

/** Clone depth map and selection for undo snapshots. */
export function cloneVoxelState(mesh) {
  return {
    depthMap: mesh.userData.voxelDepthMap ? new Uint16Array(mesh.userData.voxelDepthMap) : null,
    selection: mesh.userData.voxelSelection ? new Uint8Array(mesh.userData.voxelSelection) : null,
    active: mesh.userData.voxelActiveMap ? new Uint8Array(mesh.userData.voxelActiveMap) : null,
    colors: mesh.userData.voxelColorMap ? new Uint8Array(mesh.userData.voxelColorMap) : null,
  };
}

export function restoreVoxelState(mesh, state) {
  if (state.depthMap) mesh.userData.voxelDepthMap = new Uint16Array(state.depthMap);
  if (state.selection) mesh.userData.voxelSelection = new Uint8Array(state.selection);
  if (state.active) mesh.userData.voxelActiveMap = new Uint8Array(state.active);
  if (state.colors) mesh.userData.voxelColorMap = new Uint8Array(state.colors);
}

/**
 * Perceived luminance from RGBA pixel (0–255).
 */
export function grayscaleFromRGBA(data, byteIndex) {
  const r = data[byteIndex];
  const g = data[byteIndex + 1];
  const b = data[byteIndex + 2];
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Read RGBA from any HTMLImageElement / canvas source.
 */
export function getImageDataFromSource(img) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

/**
 * Sample grayscale from a heightmap at sprite pixel coordinates.
 */
export function sampleHeightmapGrayscale(heightData, heightW, heightH, col, row, spriteW, spriteH) {
  const u = (col + 0.5) / spriteW;
  const v = (row + 0.5) / spriteH;
  const hc = Math.min(heightW - 1, Math.max(0, Math.floor(u * heightW)));
  const hr = Math.min(heightH - 1, Math.max(0, Math.floor(v * heightH)));
  return grayscaleFromRGBA(heightData, (hr * heightW + hc) * 4);
}

/**
 * Build depth map from sprite alpha mask + grayscale height source.
 * @param {object} opts
 * @param {number} opts.maxDepth — white (255) maps to this many extra layers
 * @param {boolean} opts.invert
 * @param {boolean} opts.onlyOpaque — skip transparent sprite pixels
 */
export function buildDepthMapFromHeightSource(
  spriteData, spriteW, spriteH,
  heightData, heightW, heightH,
  opts = {}
) {
  const maxDepth = Math.max(0, opts.maxDepth ?? 8);
  const invert = !!opts.invert;
  const onlyOpaque = opts.onlyOpaque !== false;
  const depthMap = new Uint16Array(spriteW * spriteH);

  for (let row = 0; row < spriteH; row++) {
    for (let col = 0; col < spriteW; col++) {
      const pi = pixelIndex(col, row, spriteW);
      const si = pi * 4;
      if (onlyOpaque && spriteData[si + 3] < ALPHA_THRESHOLD) continue;

      let gray = sampleHeightmapGrayscale(heightData, heightW, heightH, col, row, spriteW, spriteH);
      if (invert) gray = 255 - gray;

      depthMap[pi] = Math.round((gray / 255) * maxDepth);
    }
  }

  return depthMap;
}

/** Load an image file as HTMLImageElement. */
export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
