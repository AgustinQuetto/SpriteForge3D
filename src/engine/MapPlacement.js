import { Matrix4, Vector3 } from 'three';

export function gridCoordinate(value, size) {
  const scaled = value / size; const nearest = Math.round(scaled);
  return Math.floor(Math.abs(scaled - nearest) < 1e-9 ? nearest : scaled);
}

export function validateMapCell(cell) {
  if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.z) || !Number.isFinite(cell.size) || cell.size <= 0
    || !Number.isFinite(cell.elevation) || typeof cell.layer !== 'string') throw new Error('Invalid map cell');
  if (cell.anchor !== undefined && (!Array.isArray(cell.anchor) || cell.anchor.length !== 3 || !cell.anchor.every(Number.isFinite))) throw new Error('Invalid map placement anchor');
}

export function anchorMapCell(object, cell) {
  object.updateWorldMatrix(true, false);
  const matrix = object.matrixWorld;
  const world = new Vector3((cell.x + 0.5) * cell.size, cell.elevation, (cell.z + 0.5) * cell.size);
  const determinant = matrix.determinant();
  const anchor = Number.isFinite(determinant) && determinant ? world.applyMatrix4(new Matrix4().copy(matrix).invert()) : new Vector3();
  if (!anchor.toArray().every(Number.isFinite)) anchor.set(0, 0, 0);
  object.userData.mapCell = { ...cell, anchor: anchor.toArray() };
  return object.userData.mapCell;
}

export function reconcileMapCell(object) {
  const cell = object.userData.mapCell; if (!cell) return false;
  validateMapCell(cell); object.updateWorldMatrix(true, false);
  if (!object.matrixWorld.elements.every(Number.isFinite)) return false;
  if (!cell.anchor) {
    // Legacy placements did not store a support point. Adopt the current pivot
    // on XZ and the saved elevation, preserving the established editing plane.
    const point = new Vector3().setFromMatrixPosition(object.matrixWorld); point.y = cell.elevation;
    const determinant = object.matrixWorld.determinant();
    if (Number.isFinite(determinant) && determinant) point.applyMatrix4(new Matrix4().copy(object.matrixWorld).invert());
    else point.set(0, 0, 0);
    if (!point.toArray().every(Number.isFinite)) point.set(0, 0, 0);
    cell.anchor = point.toArray();
  }
  const point = new Vector3().fromArray(cell.anchor).applyMatrix4(object.matrixWorld);
  if (!point.toArray().every(Number.isFinite)) return false;
  const x = gridCoordinate(point.x, cell.size); const z = gridCoordinate(point.z, cell.size);
  const elevation = Math.abs(point.y) < 1e9 ? Math.round(point.y * 1e6) / 1e6 : point.y;
  const changed = x !== cell.x || z !== cell.z || elevation !== cell.elevation;
  Object.assign(cell, { x, z, elevation: elevation || 0 }); return changed;
}

export function reconcileMapCells(roots) {
  const seen = new Set(); let changed = false;
  for (const root of roots) root.traverse(object => {
    if (seen.has(object)) return; seen.add(object);
    changed = reconcileMapCell(object) || changed;
  });
  return changed;
}
