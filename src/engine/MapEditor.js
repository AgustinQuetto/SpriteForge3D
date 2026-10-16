import * as THREE from 'three';
import { createGameComponents } from './GameComponents.js';
import { anchorMapCell, gridCoordinate, reconcileMapCells } from './MapPlacement.js';

export function cellAt(position, size, layer = 'Ground', elevation = 0) {
  return { x: gridCoordinate(position.x, size), z: gridCoordinate(position.z, size), size, layer, elevation };
}

export function sameCell(a, b) {
  return a && b && a.x === b.x && a.z === b.z && a.size === b.size && a.layer === b.layer && a.elevation === b.elevation;
}

const cellKey = cell => JSON.stringify([cell.layer, cell.elevation, cell.size, cell.x, cell.z]);

export function createMapTile(kind, cell, color = '#556b4b') {
  const height = kind === 'wall' ? cell.size : Math.max(1, cell.size / 16);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(cell.size, height, cell.size),
    new THREE.MeshStandardMaterial({ color, roughness: 1 }),
  );
  mesh.position.set((cell.x + 0.5) * cell.size, cell.elevation + height / 2, (cell.z + 0.5) * cell.size);
  mesh.name = `${kind === 'wall' ? 'Wall' : 'Ground'} ${cell.x},${cell.z}`;
  mesh.userData = {
    type: 'engine-object', mapCell: { ...cell, anchor: [0, -height / 2, 0] },
    game: createGameComponents({ collider: { mode: kind === 'wall' ? 'solid' : 'none', size: [cell.size, cell.size], offset: [0, 0], height, offsetY: -height / 2 } }),
  };
  return mesh;
}

// A stroke is a single history entry, including replacement of existing cells.
export class MapEditor {
  constructor(scene, history, onChange) {
    Object.assign(this, { scene, history, onChange });
    this.stroke = null;
  }

  begin() {
    if (!this.stroke) {
      if (this.scene.selectedObjects?.length) this.scene.deselectObject();
      reconcileMapCells(this.scene.objects);
      this.stroke = { added: [], removed: [], visited: new Set() };
      this.index = new Map();
      for (const object of this.scene.objects) {
        const cell = object.userData.mapCell;
        if (!cell) continue;
        const key = cellKey(cell); if (!this.index.has(key)) this.index.set(key, []);
        this.index.get(key).push(object);
      }
    }
  }

  paint(cell, create, erase = false) {
    this.begin();
    const key = cellKey(cell);
    if (this.stroke.visited.has(key)) return;
    const current = this.index.get(key) || [];
    if (current.some(object => this.scene.canEditObject && !this.scene.canEditObject(object))) throw new Error('La celda contiene una pieza oculta o bloqueada.');
    // Build before removing anything so a failed import leaves the map intact.
    const object = erase ? null : create(cell);
    if (!erase && !object?.isObject3D) throw new Error('El recurso no produjo un objeto válido.');
    this.stroke.visited.add(key);
    for (const previous of current) {
      this.stroke.removed.push({ object: previous, parent: previous.parent });
      this.scene.removeObject(previous, { dispose: false });
    }
    if (!erase) {
      object.userData.mapCell = { ...cell };
      this.scene.addObject(object);
      anchorMapCell(object, cell);
      this.stroke.added.push(object);
      this.index.set(key, [object]);
    } else {
      this.index.delete(key);
    }
    this.onChange();
  }

  end() {
    if (!this.stroke) return;
    const { added, removed } = this.stroke;
    this.stroke = null;
    this.index = null;
    if (!added.length && !removed.length) return;
    const restore = ({ object, parent }) => {
      this.scene.addObject(object);
      parent?.add(object);
    };
    this.history.push({
      label: 'Paint map',
      undo: () => {
        added.forEach(object => this.scene.removeObject(object, { dispose: false }));
        removed.forEach(restore);
        this.onChange();
      },
      redo: () => {
        removed.forEach(({ object }) => this.scene.removeObject(object, { dispose: false }));
        added.forEach(object => this.scene.addObject(object));
        this.onChange();
      },
    });
  }
}
