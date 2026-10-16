import { colliderBounds } from './Colliders.js';

// A broad phase only: exact overlap, height and mask checks remain in runtime.
// Large colliders/queries use a bounded fallback instead of filling millions of cells.
export class ColliderIndex {
  constructor(cellSize = 32) {
    this.cellSize = Number.isFinite(cellSize) && cellSize > 0 ? Math.max(1, cellSize) : 32; this.cells = new Map(); this.large = new Set();
    this.entries = new Map(); this.cache = new WeakMap();
  }

  bounds(entity) {
    const object = entity.object; const collider = entity.components.collider; object.updateWorldMatrix(true, false);
    const matrix = object.matrixWorld.elements; const shape = [collider.size[0], collider.size[1], collider.offset[0], collider.offset[1], collider.height, collider.offsetY];
    const previous = this.cache.get(entity);
    if (previous && matrix.every((value, index) => value === previous.matrix[index]) && shape.every((value, index) => value === previous.shape[index])) return previous.bounds;
    const bounds = colliderBounds(object, collider); this.cache.set(entity, { matrix: matrix.slice(), shape, bounds }); return bounds;
  }

  keys(bounds) {
    if (!Object.values(bounds).every(Number.isFinite)) return null;
    const minX = Math.floor(bounds.minX / this.cellSize); const maxX = Math.floor(bounds.maxX / this.cellSize);
    const minZ = Math.floor(bounds.minZ / this.cellSize); const maxZ = Math.floor(bounds.maxZ / this.cellSize);
    if (![minX, maxX, minZ, maxZ].every(Number.isSafeInteger)) return null;
    if ((maxX - minX + 1) * (maxZ - minZ + 1) > 1024) return null;
    const keys = [];
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) keys.push(`${x},${z}`);
    return keys;
  }

  remove(entry) {
    if (entry.keys) for (const key of entry.keys) {
      const cell = this.cells.get(key); cell.delete(entry); if (!cell.size) this.cells.delete(key);
    }
    else this.large.delete(entry);
    this.entries.delete(entry.entity);
  }

  sync(entities, isActive) {
    const active = new Set();
    for (const [order, entity] of entities.entries()) {
      if (entity.components.collider.mode === 'none' || !isActive(entity)) continue;
      active.add(entity); const bounds = this.bounds(entity); const previous = this.entries.get(entity);
      if (previous?.bounds === bounds) { previous.order = order; continue; }
      if (previous) this.remove(previous);
      const entry = { entity, order, bounds, keys: this.keys(bounds) }; this.entries.set(entity, entry);
      if (!entry.keys) this.large.add(entry);
      else for (const key of entry.keys) {
        if (!this.cells.has(key)) this.cells.set(key, new Set()); this.cells.get(key).add(entry);
      }
    }
    for (const [entity, entry] of this.entries) if (!active.has(entity)) this.remove(entry);
  }

  query(bounds) {
    const keys = this.keys(bounds);
    if (!keys) return [...this.entries.values()].sort((a, b) => a.order - b.order);
    const candidates = new Set(this.large);
    for (const key of keys) for (const entry of this.cells.get(key) || []) candidates.add(entry);
    return [...candidates].sort((a, b) => a.order - b.order);
  }

  clear() { this.entries.clear(); this.cells.clear(); this.large.clear(); this.cache = new WeakMap(); }
}
