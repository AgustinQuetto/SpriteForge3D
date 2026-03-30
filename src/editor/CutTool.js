import * as THREE from 'three';
import { findNearestVertex, meshToXZPolygon, getMeshHeight, buildPolygonMesh, splitPolygon } from './CutUtils.js';

/**
 * CutTool — Two-click line cut that splits intersected meshes into two pieces.
 * Usage: activate() → click A → click B → onCutComplete(results) fired.
 */
export class CutTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.active = false;

    this._pointA = null;

    // Preview group (not in exportGroup)
    this.previewGroup = new THREE.Group();
    this.previewGroup.name = 'CutPreview';
    sceneManager.scene.add(this.previewGroup);

    this._previewLine = null;
    this._pointAIndicator = null;
    this._cursorIndicator = null;

    this._buildIndicators();

    /** Fired after second click with results array. */
    this.onCutComplete = null;
  }

  // ─────────────────────────────────────────── Public API ──

  activate() {
    this.active = true;
    this._pointA = null;
    this.sceneManager.orbit.enabled = false;
    this.previewGroup.visible = true;
    this._cursorIndicator.visible = false;
    this._pointAIndicator.visible = false;
    if (this._previewLine) this._previewLine.visible = false;
  }

  deactivate() {
    this.active = false;
    this._pointA = null;
    this.sceneManager.orbit.enabled = true;
    this.previewGroup.visible = false;
    if (this._previewLine) this._previewLine.visible = false;
  }

  onMouseMove(clientX, clientY) {
    if (!this.active) return;

    const worldPos = this.sceneManager.getWorldPositionFromScreen(clientX, clientY);
    if (!worldPos) return;

    const snapped = this._snapPos(worldPos);

    // Update cursor indicator color: green = vertex snap, blue = grid snap
    const vertexSnap = findNearestVertex(
      worldPos,
      this.sceneManager.objects,
      Math.max(this.sceneManager.snapSize * 0.6, 16)
    );
    const pos = vertexSnap ?? snapped;
    this._cursorIndicator.position.copy(pos);
    this._cursorIndicator.material.color.setHex(vertexSnap ? 0x4ae68a : 0x6382ff);
    this._cursorIndicator.visible = true;

    // Update preview line from A to cursor
    if (this._pointA) {
      this._updatePreviewLine(this._pointA, pos);
    }
  }

  onClick(clientX, clientY) {
    if (!this.active) return;

    const worldPos = this.sceneManager.getWorldPositionFromScreen(clientX, clientY);
    if (!worldPos) return;

    const snapped = this._snapPos(worldPos);
    const vertexSnap = findNearestVertex(
      worldPos,
      this.sceneManager.objects,
      Math.max(this.sceneManager.snapSize * 0.6, 16)
    );
    const pos = vertexSnap ?? snapped;

    if (!this._pointA) {
      // First click — store point A
      this._pointA = pos.clone();
      this._pointAIndicator.position.copy(this._pointA);
      this._pointAIndicator.visible = true;
    } else {
      // Second click — execute cut
      const results = this._executeCut(this._pointA, pos);

      // Reset state before firing callback
      this._pointA = null;
      this._pointAIndicator.visible = false;
      if (this._previewLine) this._previewLine.visible = false;

      if (this.onCutComplete) this.onCutComplete(results);
    }
  }

  // ─────────────────────────────────────────── Cut Logic ──

  _executeCut(A, B) {
    const results = [];

    for (const mesh of [...this.sceneManager.objects]) {
      const pts = meshToXZPolygon(mesh);
      if (!pts) continue;

      const split = splitPolygon(pts, A.x, A.z, B.x, B.z);
      if (!split) continue;

      const height = getMeshHeight(mesh);
      const m1 = buildPolygonMesh(split[0], height, mesh);
      const m2 = buildPolygonMesh(split[1], height, mesh);

      // Copy world position/rotation/scale so pieces land in the right place
      m1.position.copy(mesh.position);
      m1.rotation.copy(mesh.rotation);
      m1.scale.copy(mesh.scale);
      m2.position.copy(mesh.position);
      m2.rotation.copy(mesh.rotation);
      m2.scale.copy(mesh.scale);

      results.push({ original: mesh, pieces: [m1, m2] });
    }

    return results;
  }

  // ─────────────────────────────────────────── Snap ──

  _snapPos(worldPos) {
    const s = this.sceneManager.snapSize;
    return new THREE.Vector3(
      Math.round(worldPos.x / s) * s,
      worldPos.y,
      Math.round(worldPos.z / s) * s
    );
  }

  // ─────────────────────────────────────────── Preview ──

  _updatePreviewLine(from, to) {
    const positions = new Float32Array([
      from.x, 0.1, from.z,
      to.x,   0.1, to.z,
    ]);

    if (!this._previewLine) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xff6b6b });
      this._previewLine = new THREE.Line(geo, mat);
      this.previewGroup.add(this._previewLine);
    } else {
      this._previewLine.geometry.setAttribute(
        'position', new THREE.BufferAttribute(positions, 3)
      );
      this._previewLine.geometry.attributes.position.needsUpdate = true;
    }
    this._previewLine.visible = true;
  }

  _buildIndicators() {
    const geo = new THREE.SphereGeometry(2.5, 8, 8);

    // Point A indicator (green)
    this._pointAIndicator = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x4ae68a }));
    this._pointAIndicator.visible = false;
    this.previewGroup.add(this._pointAIndicator);

    // Cursor indicator (blue by default)
    this._cursorIndicator = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: 0x6382ff }));
    this._cursorIndicator.visible = false;
    this.previewGroup.add(this._cursorIndicator);
  }

  dispose() {
    this.sceneManager.scene.remove(this.previewGroup);
  }
}
