import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * Build local snap anchors for a sprite mesh (bottom-center pivot).
 */
function getLocalAnchors(mesh) {
  const w = (mesh.userData.originalWidth || 32) * mesh.scale.x;
  const h = (mesh.userData.originalHeight || 32) * mesh.scale.y;
  const depth = (mesh.userData.extrusionDepth || 0) * mesh.scale.z;
  const hd = depth > 0.001 ? depth / 2 : 0;
  const hw = w / 2;
  const hm = h / 2;

  const anchors = [
    // Bottom corners & center
    [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd],
    [-hw, 0, 0], [hw, 0, 0], [0, 0, -hd], [0, 0, hd], [0, 0, 0],
    // Top corners & center
    [-hw, h, -hd], [hw, h, -hd], [hw, h, hd], [-hw, h, hd],
    [-hw, h, 0], [hw, h, 0], [0, h, -hd], [0, h, hd], [0, h, 0],
    // Vertical edge midpoints
    [-hw, hm, -hd], [hw, hm, -hd], [hw, hm, hd], [-hw, hm, hd],
    [-hw, hm, 0], [hw, hm, 0], [0, hm, -hd], [0, hm, hd], [0, hm, 0],
  ];

  return anchors.map(([x, y, z]) => new THREE.Vector3(x, y, z));
}

function getWorldAnchors(mesh) {
  mesh.updateMatrixWorld(true);
  return getLocalAnchors(mesh).map(local => local.clone().applyMatrix4(mesh.matrixWorld));
}

function getWorldAabb(corners) {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (const p of corners) {
    min.min(p);
    max.max(p);
  }

  return { min, max };
}

function aabbOverlap(a, b, margin = 0) {
  return (
    a.min.x - margin <= b.max.x &&
    a.max.x + margin >= b.min.x &&
    a.min.y - margin <= b.max.y &&
    a.max.y + margin >= b.min.y &&
    a.min.z - margin <= b.max.z &&
    a.max.z + margin >= b.min.z
  );
}

function axisDelta(axis, value) {
  const delta = new THREE.Vector3();
  delta[axis] = value;
  return delta;
}

/**
 * Find the best positional offset to align moving mesh(es) with nearby assets.
 * Uses anchor-to-anchor and edge-to-edge matching in world space.
 */
export function computeAssetSnapDelta(movingMeshes, staticMeshes, threshold) {
  if (!movingMeshes.length || !staticMeshes.length || threshold <= 0) return null;

  const movingAnchors = movingMeshes.flatMap(getWorldAnchors);
  const staticAnchors = staticMeshes.flatMap(getWorldAnchors);

  let bestDelta = null;
  let bestDist = threshold;

  // Anchor-to-anchor (corners, edge midpoints — good for L/V joins)
  for (const moving of movingAnchors) {
    for (const target of staticAnchors) {
      const delta = _v.subVectors(target, moving);
      const dist = delta.length();
      if (dist < bestDist) {
        bestDist = dist;
        bestDelta = delta.clone();
      }
    }
  }

  const movingCorners = movingAnchors;
  const staticCorners = staticAnchors;
  const movingBox = getWorldAabb(movingCorners);
  const staticBox = getWorldAabb(staticCorners);
  const overlapMargin = threshold;

  // Edge-to-edge alignment on world axes (good for side-by-side walls)
  for (const axis of ['x', 'y', 'z']) {
    const pairs = [
      [movingBox.min[axis], staticBox.max[axis]],
      [movingBox.max[axis], staticBox.min[axis]],
      [movingBox.min[axis], staticBox.min[axis]],
      [movingBox.max[axis], staticBox.max[axis]],
    ];

    for (const [movingVal, staticVal] of pairs) {
      const diff = staticVal - movingVal;
      const dist = Math.abs(diff);
      if (dist >= bestDist) continue;

      const shiftedMin = movingBox.min.clone();
      const shiftedMax = movingBox.max.clone();
      shiftedMin[axis] += diff;
      shiftedMax[axis] += diff;
      const shiftedBox = { min: shiftedMin, max: shiftedMax };

      if (!aabbOverlap(shiftedBox, staticBox, overlapMargin)) continue;

      bestDist = dist;
      bestDelta = axisDelta(axis, diff);
    }
  }

  if (!bestDelta || bestDist >= threshold) return null;
  return bestDelta;
}

/**
 * Apply asset snap by moving the dragged object (mesh or selection group).
 */
export function applyAssetSnap(movingMeshes, staticMeshes, threshold, positionTarget) {
  const meshes = Array.isArray(movingMeshes) ? movingMeshes : [movingMeshes];
  if (!meshes.length || !positionTarget) return false;

  const delta = computeAssetSnapDelta(meshes, staticMeshes, threshold);
  if (!delta) return false;

  positionTarget.position.add(delta);
  positionTarget.updateMatrixWorld(true);
  return true;
}
