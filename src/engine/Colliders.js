import * as THREE from 'three';
import { cloneGameObject, disposeGameObject } from './GameAssets.js';
import { SpriteAnimator } from './SpriteAnimation.js';

export function normalizeCollider(data = {}) {
  const collider = { mode: 'none', size: [24, 24], offset: [0, 0], height: 32, offsetY: 0, respectHeight: false, group: 1, mask: 255, ...structuredClone(data) };
  if (!['none', 'solid', 'trigger'].includes(collider.mode)) throw new Error('Invalid collider mode');
  for (const key of ['size', 'offset']) if (!Array.isArray(collider[key]) || collider[key].length !== 2 || collider[key].some(value => !Number.isFinite(value) || Math.abs(value) > 100000)) throw new Error('Colliders require finite X/Z pairs');
  if (collider.size.some(value => value < 0.01) || !Number.isFinite(collider.height) || collider.height < 0.01 || collider.height > 100000) throw new Error('Collider dimensions must be positive');
  if (!Number.isFinite(collider.offsetY) || Math.abs(collider.offsetY) > 100000) throw new Error('Invalid collider Y offset');
  if (typeof collider.respectHeight !== 'boolean') throw new Error('Invalid collider height policy');
  if (![1, 2, 4, 8, 16, 32, 64, 128].includes(collider.group) || !Number.isInteger(collider.mask) || collider.mask < 0 || collider.mask > 255) throw new Error('Invalid collision group or mask');
  return collider;
}

export function colliderBounds(object, collider) {
  object.updateWorldMatrix(true, false);
  const e = object.matrixWorld.elements; const x = collider.offset[0]; const y = collider.offsetY + collider.height / 2; const z = collider.offset[1];
  const hx = collider.size[0] / 2; const hy = collider.height / 2; const hz = collider.size[1] / 2;
  const cx = e[0] * x + e[4] * y + e[8] * z + e[12]; const cy = e[1] * x + e[5] * y + e[9] * z + e[13]; const cz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const dx = Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz;
  const dy = Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz;
  const dz = Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz;
  return { minX: cx - dx, maxX: cx + dx, minY: cy - dy, maxY: cy + dy, minZ: cz - dz, maxZ: cz + dz };
}

export function overlapsXZ(a, b) {
  return a.minX < b.maxX - 1e-7 && a.maxX > b.minX + 1e-7 && a.minZ < b.maxZ - 1e-7 && a.maxZ > b.minZ + 1e-7;
}

export function collidersMatch(a, b, aBounds, bBounds) {
  if (!(a.mask & b.group) || !(b.mask & a.group)) return false;
  return !(a.respectHeight || b.respectHeight) || (aBounds.minY < bBounds.maxY - 1e-7 && aBounds.maxY > bBounds.minY + 1e-7);
}

export function overlapCorrection(a, b) {
  if (!overlapsXZ(a, b)) return null;
  return [
    { x: b.minX - a.maxX, z: 0 }, { x: b.maxX - a.minX, z: 0 },
    { x: 0, z: b.minZ - a.maxZ }, { x: 0, z: b.maxZ - a.minZ },
  ].sort((first, second) => Math.hypot(first.x, first.z) - Math.hypot(second.x, second.z))[0];
}

export function fitColliderToVisual(object, animation) {
  const copy = cloneGameObject(object);
  try {
    copy.position.set(0, 0, 0); copy.quaternion.identity(); copy.scale.set(1, 1, 1);
    if (animation) new SpriteAnimator(copy, animation);
    const bounds = new THREE.Box3().setFromObject(copy);
    if (bounds.isEmpty()) throw new Error('El objeto no tiene geometría para ajustar.');
    const size = bounds.getSize(new THREE.Vector3()); const center = bounds.getCenter(new THREE.Vector3());
    return { size: [Math.max(0.1, size.x), size.z > 0.01 ? size.z : Math.max(1, size.x * 0.4)], offset: [center.x, center.z], height: Math.max(0.1, size.y), offsetY: bounds.min.y };
  } finally { disposeGameObject(copy); }
}

export class ColliderOverlay {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'EditorColliderOverlay';
    scene.add(this.group);
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.geometry = new THREE.EdgesGeometry(box); box.dispose();
    this.materials = {
      solid: new THREE.LineBasicMaterial({ color: '#7ba7ff', depthTest: false, transparent: true, opacity: 0.7 }),
      trigger: new THREE.LineBasicMaterial({ color: '#ffca73', depthTest: false, transparent: true, opacity: 0.8 }),
      selected: new THREE.LineBasicMaterial({ color: '#8cffa9', depthTest: false }),
    };
    this.helpers = new Map();
  }

  update(items) {
    const active = new Set();
    for (const { object, collider, selected = false } of items) {
      if (collider.mode === 'none') continue;
      active.add(object.uuid);
      let helper = this.helpers.get(object.uuid);
      if (!helper) {
        helper = new THREE.LineSegments(this.geometry, this.materials.solid);
        helper.renderOrder = 1001;
        this.helpers.set(object.uuid, helper); this.group.add(helper);
      }
      helper.material = this.materials[selected ? 'selected' : collider.mode];
      const bounds = colliderBounds(object, collider);
      helper.position.set((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2);
      helper.scale.set(Math.max(0.01, bounds.maxX - bounds.minX), Math.max(0.01, bounds.maxY - bounds.minY), Math.max(0.01, bounds.maxZ - bounds.minZ));
    }
    for (const [id, helper] of this.helpers) if (!active.has(id)) { helper.removeFromParent(); this.helpers.delete(id); }
  }

  dispose() {
    this.group.removeFromParent(); this.helpers.clear();
    this.geometry.dispose(); Object.values(this.materials).forEach(material => material.dispose());
  }
}
