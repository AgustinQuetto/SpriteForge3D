import * as THREE from 'three';
import { QuadFactory } from './QuadFactory.js';
import { ensureVoxelPaintData, getVoxelGridOrigin, hitToPixel } from './PixelUtils.js';

/**
 * Paints a 2D pixel layer as small Minecraft-like blocks.
 * The tool intentionally works on the front face of a voxelized sprite so
 * the camera can stay in the editor's normal 3D orbit mode.
 */
export class VoxelBrushTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.active = false;
    this.targetMesh = null;
    this.brushSize = 1;
    this.mode = 'paint';
    this.color = { r: 99, g: 130, b: 255, a: 255 };
    this.dragging = false;
    this._strokeMode = 'paint';
    this._changedPixels = new Set();
    this._interactionPlane = null;

    this._previewGroup = new THREE.Group();
    this._previewGroup.name = 'VoxelBrushPreview';
    sceneManager.scene.add(this._previewGroup);
  }

  activate(mesh = null) {
    this.active = true;
    this.setTargetMesh(mesh);
  }

  deactivate() {
    this.active = false;
    this.dragging = false;
    this._clearPreview();
    this._removeInteractionPlane();
    this.targetMesh = null;
  }

  setTargetMesh(mesh) {
    if (mesh === this.targetMesh) {
      this._syncInteractionPlane();
      return;
    }
    this._removeInteractionPlane();
    this.targetMesh = mesh?.userData?.voxelized ? mesh : null;
    this._syncInteractionPlane();
    this._clearPreview();
  }

  setBrushSize(value) {
    this.brushSize = Math.max(1, Math.min(16, Math.round(Number(value) || 1)));
    this._updatePreviewForLastPick();
  }

  setMode(mode) {
    this.mode = mode === 'erase' ? 'erase' : 'paint';
  }

  setColor(value) {
    const hex = String(value || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return;
    this.color = {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 255,
    };
    this._updatePreviewForLastPick();
  }

  getColorHex() {
    return `#${[this.color.r, this.color.g, this.color.b]
      .map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  }

  _syncInteractionPlane() {
    if (!this.targetMesh || !this.active) return;
    const paintData = ensureVoxelPaintData(this.targetMesh);
    if (!paintData) return;

    if (!this._interactionPlane) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
        side: THREE.DoubleSide,
      });
      this._interactionPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      this._interactionPlane.name = 'VoxelBrushInteractionPlane';
      this._interactionPlane.userData.isEditorHelper = true;
    }

    const pixelSize = this.targetMesh.userData.voxelPixelSize || 1;
    this._interactionPlane.geometry.dispose();
    this._interactionPlane.geometry = new THREE.PlaneGeometry(
      paintData.width * pixelSize,
      paintData.height * pixelSize,
    );
    const pivot = this.targetMesh.userData.voxelPivotOffset || [0, 0];
    this._interactionPlane.position.set(
      -Number(pivot[0] || 0),
      paintData.height * pixelSize / 2 - Number(pivot[1] || 0),
      pixelSize / 2,
    );
    this.targetMesh.add(this._interactionPlane);
    this.targetMesh.updateMatrixWorld(true);
  }

  _removeInteractionPlane() {
    if (!this._interactionPlane) return;
    this._interactionPlane.parent?.remove(this._interactionPlane);
    this._interactionPlane.geometry?.dispose();
    this._interactionPlane.material?.dispose();
    this._interactionPlane = null;
  }

  _pickPixel(clientX, clientY) {
    if (!this.targetMesh || !this._interactionPlane) return null;
    const rect = this.sceneManager.canvas.getBoundingClientRect();
    this.sceneManager.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.sceneManager.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.sceneManager.raycaster.setFromCamera(this.sceneManager.mouse, this.sceneManager.camera);
    const hits = this.sceneManager.raycaster.intersectObject(this._interactionPlane, false);
    if (!hits.length) return null;

    const pixel = hitToPixel(this.targetMesh, hits[0].point);
    return pixel ? { pixel, hit: hits[0] } : null;
  }

  _forEachBrushPixel(center, callback) {
    const size = this.brushSize;
    const startCol = center.col - Math.floor(size / 2);
    const startRow = center.row - Math.floor(size / 2);
    for (let row = startRow; row < startRow + size; row++) {
      for (let col = startCol; col < startCol + size; col++) callback(col, row);
    }
  }

  _applyAt(pixel, mode = this.mode) {
    if (!this.targetMesh) return false;
    const paintData = ensureVoxelPaintData(this.targetMesh);
    if (!paintData) return false;
    let changed = false;

    this._forEachBrushPixel(pixel, (col, row) => {
      if (col < 0 || col >= paintData.width || row < 0 || row >= paintData.height) return;
      const pi = row * paintData.width + col;
      const ci = pi * 4;
      const previous = `${paintData.active[pi]}:${paintData.colors[ci]}:${paintData.colors[ci + 1]}:${paintData.colors[ci + 2]}`;
      const didChange = mode === 'erase'
        ? QuadFactory.setVoxelPixel(this.targetMesh, col, row, false)
        : QuadFactory.setVoxelPixel(this.targetMesh, col, row, true, this.color);
      const next = `${paintData.active[pi]}:${paintData.colors[ci]}:${paintData.colors[ci + 1]}:${paintData.colors[ci + 2]}`;
      if (didChange || previous !== next) {
        changed = true;
        this._changedPixels.add(pi);
      }
    });

    if (changed) {
      QuadFactory.rebuildVoxelGeometry(this.targetMesh);
      this._syncInteractionPlane();
    }
    return changed;
  }

  onMouseDown(clientX, clientY, { erase = false } = {}) {
    if (!this.active || !this.targetMesh) return false;
    const pick = this._pickPixel(clientX, clientY);
    if (!pick) return false;
    this.dragging = true;
    this._changedPixels.clear();
    this._strokeMode = erase ? 'erase' : this.mode;
    this.sceneManager.orbit.enabled = false;
    this._applyAt(pick.pixel, this._strokeMode);
    return true;
  }

  onMouseMove(clientX, clientY) {
    const pick = this._pickPixel(clientX, clientY);
    if (!pick) {
      this._clearPreview();
      return false;
    }
    this._rebuildPreview(pick.pixel, this.dragging ? this._strokeMode : this.mode);
    if (this.dragging) this._applyAt(pick.pixel, this._strokeMode);
    return true;
  }

  onMouseUp() {
    if (!this.dragging) return null;
    this.dragging = false;
    this.sceneManager.orbit.enabled = true;
    const result = this._changedPixels.size > 0
      ? { mesh: this.targetMesh, changedCount: this._changedPixels.size }
      : null;
    this._changedPixels.clear();
    return result;
  }

  onClick(clientX, clientY, options = {}) {
    if (!this.active || !this.targetMesh) return null;
    const pick = this._pickPixel(clientX, clientY);
    if (!pick) return null;
    this._changedPixels.clear();
    this._applyAt(pick.pixel, options.erase ? 'erase' : this.mode);
    return this._changedPixels.size ? { mesh: this.targetMesh, changedCount: this._changedPixels.size } : null;
  }

  _updatePreviewForLastPick() {
    // Preview is rebuilt on the next pointer event; clearing prevents a stale
    // brush size or colour from lingering after a control change.
    this._clearPreview();
  }

  _rebuildPreview(pixel, mode) {
    this._clearPreview();
    if (!this.targetMesh) return;
    const paintData = ensureVoxelPaintData(this.targetMesh);
    if (!paintData) return;
    const pixelSize = this.targetMesh.userData.voxelPixelSize || 1;
    const depthMap = this.targetMesh.userData.voxelDepthMap || new Uint16Array(paintData.width * paintData.height);
    const { x: originX, y: originY } = getVoxelGridOrigin(
      this.targetMesh,
      paintData.width,
      paintData.height,
    );
    const color = mode === 'erase' ? 0xff6677 : (this.color.r << 16) | (this.color.g << 8) | this.color.b;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: mode === 'erase' ? 0.25 : 0.45,
      depthWrite: false,
    });

    this.targetMesh.updateMatrixWorld(true);
    this._forEachBrushPixel(pixel, (col, row) => {
      if (col < 0 || col >= paintData.width || row < 0 || row >= paintData.height) return;
      const pi = row * paintData.width + col;
      const depth = depthMap[pi] || 0;
      const boxDepth = pixelSize * (1 + depth);
      const localPos = new THREE.Vector3(
        originX + col * pixelSize,
        originY + (paintData.height - 1 - row) * pixelSize,
        depth * pixelSize / 2,
      ).applyMatrix4(this.targetMesh.matrixWorld);
      const overlay = new THREE.Mesh(
        new THREE.BoxGeometry(pixelSize * 1.04, pixelSize * 1.04, boxDepth * 1.04),
        material.clone(),
      );
      overlay.position.copy(localPos);
      overlay.quaternion.copy(this.targetMesh.getWorldQuaternion(new THREE.Quaternion()));
      overlay.renderOrder = 999;
      this._previewGroup.add(overlay);
    });
  }

  _clearPreview() {
    while (this._previewGroup.children.length) {
      const child = this._previewGroup.children[0];
      child.geometry?.dispose();
      child.material?.dispose();
      this._previewGroup.remove(child);
    }
  }

  dispose() {
    this.deactivate();
    this._previewGroup.removeFromParent();
  }
}
