import * as THREE from 'three';
import { findNearestVertex } from './CutUtils.js';

/**
 * DrawingTool — Line and Rectangle drawing on the XZ ground plane (Y=0).
 * Produces flat polygon faces that can later be extruded with PushPullTool.
 */
export class DrawingTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.mode = null; // 'line' | 'rectangle' | null

    // Committed points on XZ plane
    this.points = [];

    // Preview geometry group (added to scene, NOT exportGroup)
    this.previewGroup = new THREE.Group();
    this.previewGroup.name = 'DrawingPreview';
    sceneManager.scene.add(this.previewGroup);

    // Preview mesh references
    this._previewLine = null;      // Live edge from last point to cursor
    this._committedLines = null;   // All committed edges
    this._startIndicator = null;   // Sphere at first point
    this._cursorIndicator = null;  // Sphere at cursor
    this._rectPreview = null;      // Rectangle outline preview

    // Rectangle first corner
    this._rectStart = null;

    this._buildIndicators();
  }

  // ─────────────────────────────────────────── Public API ──

  activate(mode) {
    this.mode = mode;
    this._reset();
    this.sceneManager.orbit.enabled = false;
    this._setVisible(true);
  }

  deactivate() {
    this.mode = null;
    this._reset();
    this.sceneManager.orbit.enabled = true;
    this._setVisible(false);
  }

  /** Grid snap — always on while drawing, regardless of snapEnabled toggle. */
  _snapPos(worldPos) {
    const s = this.sceneManager.snapSize;
    return worldPos.clone().set(
      Math.round(worldPos.x / s) * s,
      worldPos.y,
      Math.round(worldPos.z / s) * s
    );
  }

  /** Returns snapped position with vertex snap taking priority over grid snap. */
  _resolveSnap(worldPos) {
    const gridSnapped = this._snapPos(worldPos);
    const vertexSnap = findNearestVertex(
      worldPos,
      this.sceneManager.objects,
      Math.max(this.sceneManager.snapSize * 0.6, 16)
    );
    // Color feedback: green = vertex snap, blue = grid snap
    this._cursorIndicator.material.color.setHex(vertexSnap ? 0x4ae68a : 0x6382ff);
    return vertexSnap ?? gridSnapped;
  }

  /** Called on every canvas mousemove while a draw mode is active. */
  onMouseMove(worldPos) {
    if (!this.mode || !worldPos) return;

    const pos = this._resolveSnap(worldPos);

    // Update cursor indicator
    this._cursorIndicator.position.set(pos.x, pos.y, pos.z);
    this._cursorIndicator.visible = true;

    if (this.mode === 'line') {
      this._updateLinePreview(pos);
    } else if (this.mode === 'rectangle') {
      this._updateRectPreview(pos);
    }
  }

  /** Called on canvas click while a draw mode is active. */
  onClick(worldPos) {
    if (!this.mode || !worldPos) return;

    const pos = this._resolveSnap(worldPos);

    if (this.mode === 'line') {
      this._handleLineClick(pos);
    } else if (this.mode === 'rectangle') {
      this._handleRectClick(pos);
    }
  }

  // ─────────────────────────────────────────── Line Tool ──

  _handleLineClick(worldPos) {
    const pt = worldPos.clone();

    // Need at least 3 points before we can close
    if (this.points.length >= 3) {
      const snap = this._getCloseThreshold();
      if (pt.distanceTo(this.points[0]) < snap) {
        this._closeLine();
        return;
      }
    }

    this.points.push(pt);
    this._rebuildCommittedLines();

    // Show start indicator on first point
    if (this.points.length === 1) {
      this._startIndicator.position.copy(pt);
      this._startIndicator.visible = true;
    }
  }

  _updateLinePreview(worldPos) {
    if (this.points.length === 0) return;

    const last = this.points[this.points.length - 1];
    const positions = new Float32Array([
      last.x, last.y, last.z,
      worldPos.x, worldPos.y, worldPos.z,
    ]);

    if (!this._previewLine) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x6382ff, transparent: true, opacity: 0.7 });
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

  _rebuildCommittedLines() {
    if (this._committedLines) {
      this._committedLines.geometry.dispose();
      this.previewGroup.remove(this._committedLines);
    }

    if (this.points.length < 2) return;

    const flat = [];
    for (const p of this.points) flat.push(p.x, p.y, p.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flat), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xe4e8f1, transparent: true, opacity: 0.9 });
    this._committedLines = new THREE.Line(geo, mat);
    this.previewGroup.add(this._committedLines);
  }

  _closeLine() {
    if (this.points.length < 3) return;

    const shape = this._buildShape(this.points);
    const mesh = this._createFaceMesh(shape, this.points);

    this._reset();
    this.sceneManager.orbit.enabled = false; // stays in draw mode

    // Return mesh so main.js can add to scene and history
    if (this.onFaceCreated) this.onFaceCreated(mesh);
  }

  // ─────────────────────────────────────────── Rectangle Tool ──

  _handleRectClick(worldPos) {
    if (!this._rectStart) {
      this._rectStart = worldPos.clone();
    } else {
      const a = this._rectStart;
      const b = worldPos;
      const pts = [
        new THREE.Vector3(a.x, 0, a.z),
        new THREE.Vector3(b.x, 0, a.z),
        new THREE.Vector3(b.x, 0, b.z),
        new THREE.Vector3(a.x, 0, b.z),
      ];
      const shape = this._buildShape(pts);
      const mesh = this._createFaceMesh(shape, pts);

      this._reset();
      this.sceneManager.orbit.enabled = false;

      if (this.onFaceCreated) this.onFaceCreated(mesh);
    }
  }

  _updateRectPreview(worldPos) {
    if (!this._rectStart) return;

    const a = this._rectStart;
    const b = worldPos;
    const corners = [
      a.x, 0, a.z,
      b.x, 0, a.z,
      b.x, 0, b.z,
      a.x, 0, b.z,
      a.x, 0, a.z, // close
    ];

    if (!this._rectPreview) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(corners), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x6382ff, transparent: true, opacity: 0.8 });
      this._rectPreview = new THREE.Line(geo, mat);
      this.previewGroup.add(this._rectPreview);
    } else {
      this._rectPreview.geometry.setAttribute(
        'position', new THREE.BufferAttribute(new Float32Array(corners), 3)
      );
      this._rectPreview.geometry.attributes.position.needsUpdate = true;
    }
    this._rectPreview.visible = true;
  }

  // ─────────────────────────────────────────── Mesh Creation ──

  /**
   * Builds a THREE.Shape from an array of Vector3 points on the XZ plane.
   * Shape coordinates: (point.x, point.z)
   */
  _buildShape(pts) {
    // Shape coords are (x, -z) so that after rotateX(-PI/2) the face
    // lands correctly on the XZ plane with extrusion going upward (+Y).
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, -pts[0].z);
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(pts[i].x, -pts[i].z);
    }
    shape.closePath();
    return shape;
  }

  /**
   * Creates a flat mesh from a THREE.Shape, lying on the XZ plane.
   */
  _createFaceMesh(shape, pts) {
    const geo = new THREE.ShapeGeometry(shape);
    // Rotate from XY plane to XZ plane
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x8890a4,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'PolygonFace';
    mesh.castShadow = false;
    mesh.userData = {
      type: 'polygon',
      shape,            // Store for Push/Pull re-extrusion
      shapePoints: pts.map(p => p.clone()),
      extrusionDepth: 0,
    };

    return mesh;
  }

  // ─────────────────────────────────────────── Internals ──

  _buildIndicators() {
    const dotGeo = new THREE.SphereGeometry(2, 8, 8);

    // Start point indicator (green)
    const startMat = new THREE.MeshBasicMaterial({ color: 0x4ae68a });
    this._startIndicator = new THREE.Mesh(dotGeo, startMat);
    this._startIndicator.visible = false;
    this.previewGroup.add(this._startIndicator);

    // Cursor indicator (accent blue)
    const cursorMat = new THREE.MeshBasicMaterial({ color: 0x6382ff });
    this._cursorIndicator = new THREE.Mesh(dotGeo.clone(), cursorMat);
    this._cursorIndicator.visible = false;
    this.previewGroup.add(this._cursorIndicator);
  }

  _getCloseThreshold() {
    // Use half the snap size, minimum 8 units
    return Math.max(8, this.sceneManager.snapSize / 2);
  }

  _reset() {
    this.points = [];
    this._rectStart = null;

    // Remove preview meshes
    if (this._previewLine) {
      this._previewLine.geometry.dispose();
      this.previewGroup.remove(this._previewLine);
      this._previewLine = null;
    }
    if (this._committedLines) {
      this._committedLines.geometry.dispose();
      this.previewGroup.remove(this._committedLines);
      this._committedLines = null;
    }
    if (this._rectPreview) {
      this._rectPreview.geometry.dispose();
      this.previewGroup.remove(this._rectPreview);
      this._rectPreview = null;
    }

    this._startIndicator.visible = false;
    this._cursorIndicator.visible = false;
  }

  _setVisible(visible) {
    this.previewGroup.visible = visible;
  }

  dispose() {
    this.sceneManager.scene.remove(this.previewGroup);
  }
}
