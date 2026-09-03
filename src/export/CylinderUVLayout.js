import * as THREE from 'three';

export const CYLINDER_UV_LAYOUT_VERSION = 1;

// The wall occupies the left side of the atlas. Both caps use independent,
// square regions on the right so they never overlap the wall or each other.
export const CYLINDER_UV_REGIONS = Object.freeze({
  side: Object.freeze({ minU: 0.025, maxU: 0.64, minV: 0.025, maxV: 0.975 }),
  top: Object.freeze({ minU: 0.68, maxU: 0.975, minV: 0.535, maxV: 0.83 }),
  bottom: Object.freeze({ minU: 0.68, maxU: 0.975, minV: 0.17, maxV: 0.465 }),
});

function regionForMaterialIndex(materialIndex) {
  if (materialIndex === 1) return CYLINDER_UV_REGIONS.top;
  if (materialIndex === 2) return CYLINDER_UV_REGIONS.bottom;
  return CYLINDER_UV_REGIONS.side;
}

function remap(value, min, max) {
  return min + THREE.MathUtils.clamp(value, 0, 1) * (max - min);
}

/**
 * Return a cloned cylinder geometry with a stable, non-overlapping UV atlas.
 * Three.js CylinderGeometry already supplies distinct vertices and groups for
 * the wall (material 0), top (1), and bottom (2), so each island can be moved
 * without changing positions, normals, indices, or material assignments.
 */
export function createCylinderUVLayout(sourceGeometry) {
  const sourceUV = sourceGeometry?.getAttribute?.('uv');
  if (!sourceUV?.count) throw new Error('Cylinder geometry has no UV coordinates');

  const geometry = sourceGeometry.clone();
  const uv = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  const groups = geometry.groups || [];

  if (groups.length < 3) {
    throw new Error('Cylinder geometry must have separate wall and cap groups');
  }

  const assignedRegion = new Int8Array(uv.count);
  assignedRegion.fill(-1);

  groups.forEach(group => {
    const materialIndex = Number(group.materialIndex) || 0;
    if (materialIndex < 0 || materialIndex > 2) return;

    const region = regionForMaterialIndex(materialIndex);
    const end = group.start + group.count;
    for (let offset = group.start; offset < end; offset += 1) {
      const vertexIndex = index ? index.getX(offset) : offset;
      if (vertexIndex < 0 || vertexIndex >= uv.count) continue;

      if (assignedRegion[vertexIndex] !== -1 && assignedRegion[vertexIndex] !== materialIndex) {
        throw new Error('Cylinder wall and caps share UV vertices');
      }
      if (assignedRegion[vertexIndex] === materialIndex) continue;

      assignedRegion[vertexIndex] = materialIndex;
      uv.setXY(
        vertexIndex,
        remap(sourceUV.getX(vertexIndex), region.minU, region.maxU),
        remap(sourceUV.getY(vertexIndex), region.minV, region.maxV),
      );
    }
  });

  uv.needsUpdate = true;
  return geometry;
}

