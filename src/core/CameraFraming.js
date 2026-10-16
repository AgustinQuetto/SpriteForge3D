import { Box3, Vector3, MathUtils } from 'three';

export function frameCamera(camera, target, objects) {
  const bounds = new Box3();
  for (const object of objects) { object.updateWorldMatrix(true, true); bounds.expandByObject(object); }
  if (bounds.isEmpty()) return null;
  const center = bounds.getCenter(new Vector3()); const radius = Math.max(0.1, bounds.getSize(new Vector3()).length() / 2);
  if (!center.toArray().every(Number.isFinite) || !Number.isFinite(radius)) return null;
  const direction = camera.position.clone().sub(target);
  if (direction.lengthSq() < 1e-8) direction.set(1, 1, 1); direction.normalize();
  let distance;
  if (camera.isPerspectiveCamera) {
    const vertical = MathUtils.degToRad(camera.getEffectiveFOV());
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    distance = Math.max(10, radius * 1.15 / Math.sin(Math.min(vertical, horizontal) / 2));
  } else {
    camera.zoom = Math.min(camera.right - camera.left, camera.top - camera.bottom) / (radius * 2.3);
    distance = Math.max(10, radius * 4);
  }
  target.copy(center); camera.position.copy(center).addScaledVector(direction, distance);
  camera.far = Math.max(10000, distance + radius * 3);
  camera.near = Math.min(camera.near, Math.max(0.01, distance - radius * 2));
  camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return { center, radius, distance };
}
