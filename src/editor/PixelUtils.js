/**
 * PixelUtils — Image sampling, flood-fill selection, and voxel coordinate mapping.
 */

export const ALPHA_THRESHOLD = 30;

/**
 * Read RGBA pixel data from a mesh's source texture.
 * @returns {{ data: Uint8ClampedArray, width: number, height: number } | null}
 */
export function getImageDataFromMesh(mesh) {
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
  return { data, width, height };
}

export function pixelIndex(col, row, imgW) {
  return row * imgW + col;
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
  const imgW = mesh.userData.originalWidth
    ? Math.round(mesh.userData.originalWidth / (mesh.userData.voxelPixelSize || 1))
    : null;
  const imgH = mesh.userData.originalHeight
    ? Math.round(mesh.userData.originalHeight / (mesh.userData.voxelPixelSize || 1))
    : null;

  const texture = mesh.userData.texture?.image;
  const width = texture ? (texture.naturalWidth || texture.width) : imgW;
  const height = texture ? (texture.naturalHeight || texture.height) : imgH;
  if (!width || !height) return null;

  const pixelSize = mesh.userData.voxelPixelSize || 1;
  const local = hitPointWorld.clone();
  mesh.worldToLocal(local);

  const originX = -width * pixelSize / 2 + pixelSize / 2;
  const originY = pixelSize / 2;

  const col = Math.round((local.x - originX) / pixelSize);
  const row = height - 1 - Math.round((local.y - originY) / pixelSize);

  if (col < 0 || col >= width || row < 0 || row >= height) return null;
  return { col, row };
}

/**
 * Ensure mesh has a depth map aligned to its texture dimensions.
 */
export function ensureDepthMap(mesh) {
  const imageData = getImageDataFromMesh(mesh);
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

/** Count set bits in a Uint8Array mask. */
export function countMask(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

/** Clone depth map and selection for undo snapshots. */
export function cloneVoxelState(mesh) {
  return {
    depthMap: mesh.userData.voxelDepthMap ? new Uint16Array(mesh.userData.voxelDepthMap) : null,
    selection: mesh.userData.voxelSelection ? new Uint8Array(mesh.userData.voxelSelection) : null,
  };
}

export function restoreVoxelState(mesh, state) {
  if (state.depthMap) mesh.userData.voxelDepthMap = new Uint16Array(state.depthMap);
  if (state.selection) mesh.userData.voxelSelection = new Uint8Array(state.selection);
}
