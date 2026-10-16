import { Matrix4 } from 'three';

const residuals = new WeakMap();

// Keep the affine remainder when a rotated, non-uniformly scaled parent creates
// shear. Position/rotation/scale edits continue to work through updateMatrix().
export function setLocalMatrix(object, matrix) {
  matrix.decompose(object.position, object.quaternion, object.scale);
  if (!object.quaternion.toArray().every(Number.isFinite)) object.quaternion.identity();
  for (const axis of ['x', 'y', 'z']) if (!Number.isFinite(object.scale[axis]) || Math.abs(object.scale[axis]) < 1e-12) object.scale[axis] = 1;
  const composed = new Matrix4().compose(object.position, object.quaternion, object.scale);
  const remainder = composed.clone().invert().multiply(matrix);
  const hasRemainder = remainder.elements.some((value, index) => Math.abs(value - (index % 5 === 0 ? 1 : 0)) > 1e-9);
  if (hasRemainder) residuals.set(object, remainder);
  else residuals.delete(object);
  object.matrixAutoUpdate = true;
  object.updateMatrix = function () {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    const residual = residuals.get(this);
    if (residual) this.matrix.multiply(residual);
    this.matrixWorldNeedsUpdate = true;
  };
  object.matrix.copy(matrix);
  object.matrixWorldNeedsUpdate = true;
}

export function attachPreservingWorld(parent, object) {
  object.updateWorldMatrix(true, false);
  const world = object.matrixWorld.clone();
  parent.updateWorldMatrix(true, false);
  parent.add(object);
  setLocalMatrix(object, parent.matrixWorld.clone().invert().multiply(world));
}

export function authoredParent(object) {
  return object.userData._origParent || object.parent;
}

export function authoredMatrix(object) {
  object.updateWorldMatrix(true, false);
  const parent = authoredParent(object);
  parent?.updateWorldMatrix(true, false);
  return (parent ? parent.matrixWorld.clone().invert() : new Matrix4()).multiply(object.matrixWorld);
}
