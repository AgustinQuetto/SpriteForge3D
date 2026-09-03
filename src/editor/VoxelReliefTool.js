import * as THREE from 'three';
import { QuadFactory } from './QuadFactory.js';
import {
  countMask,
  ensureDepthMap,
  floodFill,
  getVoxelPaintImageData,
  getVoxelGridOrigin,
  hitToPixel,
  mergeSelection,
  pixelIndex,
  selectRect,
  selectSinglePixel,
} from './PixelUtils.js';

/** @typedef {'wand' | 'pixel' | 'area'} ReliefSelectionMode */

/**
 * VoxelReliefTool — Pixel/area/wand selection on voxel sprites + extract/subtract relief.
 */
export class VoxelReliefTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.active = false;
    this.interactionMode = 'direct';
    /** @type {ReliefSelectionMode} */
    this.selectionMode = 'wand';
    this.tolerance = 32;
    this.depthStep = 1;
    this.maxDepth = 64;
    this.targetMesh = null;

    this._overlayGroup = new THREE.Group();
    this._overlayGroup.name = 'VoxelSelectionOverlay';
    sceneManager.scene.add(this._overlayGroup);

    this._previewGroup = new THREE.Group();
    this._previewGroup.name = 'VoxelAreaPreview';
    sceneManager.scene.add(this._previewGroup);

    /** @type {{ mesh: THREE.Mesh, startCol: number, startRow: number, additive: boolean } | null} */
    this._areaDrag = null;
    /** @type {{ mesh: THREE.Mesh, pixel: { col: number, row: number }, localNormal: THREE.Vector3, startClientY: number, startDepth: number, currentDepth: number, pixelsPerLayer: number, speedMultiplier: number, selectionChanged: boolean } | null} */
    this._directDrag = null;

    this._faceHighlight = this._buildFaceHighlight();
    sceneManager.scene.add(this._faceHighlight);

    this.onSelectionChanged = null;
    this.onDepthApplied = null;
    this.onHoverChanged = null;
  }

  activate(mesh = null) {
    this.active = true;
    if (mesh?.userData?.voxelized) {
      this.targetMesh = mesh;
      ensureDepthMap(mesh);
      this._rebuildOverlay(mesh);
    }
  }

  deactivate() {
    this.active = false;
    this._areaDrag = null;
    this._directDrag = null;
    this.sceneManager.orbit.enabled = true;
    this._clearOverlay();
    this._clearPreview();
    this._clearFaceHighlight();
  }

  setTargetMesh(mesh) {
    this.targetMesh = mesh?.userData?.voxelized ? mesh : null;
    this._areaDrag = null;
    this._clearOverlay();
    this._clearPreview();
    if (this.targetMesh && this.active) {
      ensureDepthMap(this.targetMesh);
      this._rebuildOverlay(this.targetMesh);
    }
  }

  setInteractionMode(mode) {
    this.interactionMode = mode === 'select' ? 'select' : 'direct';
    this._areaDrag = null;
    this._directDrag = null;
    this.sceneManager.orbit.enabled = true;
    this._clearPreview();
    if (this.interactionMode !== 'direct') this._clearFaceHighlight();
  }

  setSelectionMode(mode) {
    if (mode === 'wand' || mode === 'pixel' || mode === 'area') {
      this.selectionMode = mode;
      this._areaDrag = null;
      this._clearPreview();
    }
  }

  setTolerance(value) {
    this.tolerance = Math.max(0, Math.min(255, value | 0));
  }

  setDepthStep(value) {
    this.depthStep = Math.max(1, Math.min(32, value | 0));
  }

  pickFace(clientX, clientY) {
    return this._pickVoxelHit(clientX, clientY);
  }

  /**
   * @returns {{ mesh: THREE.Mesh, pixel: { col: number, row: number } } | null}
   */
  _pickVoxelHit(clientX, clientY) {
    const rect = this.sceneManager.canvas.getBoundingClientRect();
    this.sceneManager.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.sceneManager.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.sceneManager.raycaster.setFromCamera(
      this.sceneManager.mouse,
      this.sceneManager.camera
    );

    const voxelMeshes = this.sceneManager.objects.filter(
      o => o.userData?.voxelized && o.userData?.type === 'voxel'
    );
    const intersects = this.sceneManager.raycaster.intersectObjects(voxelMeshes, false);
    if (!intersects.length) return null;

    const hit = intersects[0];
    const mesh = hit.object;
    const pixel = hitToPixel(mesh, hit.point);
    if (!pixel) return null;

    const localNormal = hit.face?.normal?.clone() || new THREE.Vector3(0, 0, 1);
    return { mesh, pixel, hit, localNormal };
  }

  _buildFaceHighlight() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffc857,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    face.name = 'VoxelReliefFaceHighlight';
    face.renderOrder = 1001;
    face.visible = false;
    face.userData.isEditorHelper = true;
    return face;
  }

  _clearFaceHighlight() {
    this._faceHighlight.visible = false;
    if (this.onHoverChanged) this.onHoverChanged(null);
  }

  _updateFaceHighlight(pick) {
    if (this.interactionMode !== 'direct' || !pick?.mesh || !pick.hit) {
      this._clearFaceHighlight();
      return;
    }

    const mesh = pick.mesh;
    const pixelSize = mesh.userData.voxelPixelSize || 1;
    const normal = pick.localNormal.clone().transformDirection(mesh.matrixWorld).normalize();
    this._faceHighlight.scale.set(pixelSize * 1.08, pixelSize * 1.08, 1);
    this._faceHighlight.position.copy(pick.hit.point).addScaledVector(normal, pixelSize * 0.035);
    this._faceHighlight.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this._faceHighlight.visible = true;

    if (this.onHoverChanged) {
      const width = mesh.userData.voxelImageWidth || 1;
      const pi = pick.pixel.row * width + pick.pixel.col;
      this.onHoverChanged({
        mesh,
        pixel: pick.pixel,
        depth: mesh.userData.voxelDepthMap?.[pi] || 0,
        dragging: !!this._directDrag,
      });
    }
  }

  _pixelsPerLayer(mesh) {
    const camera = this.sceneManager.camera;
    const canvas = this.sceneManager.canvas;
    const distance = camera.position.distanceTo(this.sceneManager.orbit.target);
    let worldPerPixel;
    if (camera.isPerspectiveCamera) {
      const fov = THREE.MathUtils.degToRad(camera.fov);
      worldPerPixel = (2 * Math.tan(fov / 2) * distance) / Math.max(1, canvas.clientHeight);
    } else {
      worldPerPixel = (camera.top - camera.bottom) / Math.max(1, canvas.clientHeight);
    }
    return Math.max(2, (mesh.userData.voxelPixelSize || 1) / Math.max(worldPerPixel, 0.0001));
  }

  _selectDirectFace(mesh, pixel) {
    const paintData = ensureDepthMap(mesh);
    if (!paintData) return false;
    const index = pixel.row * paintData.width + pixel.col;
    const wasSelected = paintData.selection[index] === 1 && countMask(paintData.selection) === 1;
    paintData.selection.fill(0);
    paintData.selection[index] = 1;
    this.targetMesh = mesh;
    this._rebuildOverlay(mesh);
    if (!wasSelected && this.onSelectionChanged) this.onSelectionChanged(mesh, 1);
    return !wasSelected;
  }

  _updateDirectDrag(clientX, clientY) {
    const drag = this._directDrag;
    if (!drag) return false;

    const layerDelta = Math.round((drag.startClientY - clientY) / drag.pixelsPerLayer) * drag.speedMultiplier;
    const nextDepth = Math.max(0, Math.min(this.maxDepth, drag.startDepth + layerDelta));
    if (nextDepth !== drag.currentDepth) {
      const delta = nextDepth - drag.currentDepth;
      if (QuadFactory.applyVoxelDepthDelta(drag.mesh, delta, this.maxDepth)) {
        drag.currentDepth = nextDepth;
        this._rebuildOverlay(drag.mesh);
      }
    }

    const pick = this._pickVoxelHit(clientX, clientY);
    if (pick?.mesh === drag.mesh && pick.pixel.col === drag.pixel.col && pick.pixel.row === drag.pixel.row) {
      this._updateFaceHighlight(pick);
    } else if (this.onHoverChanged) {
      this.onHoverChanged({ mesh: drag.mesh, pixel: drag.pixel, depth: drag.currentDepth, dragging: true });
    }
    return true;
  }

  /**
   * @param {'replace'|'add'|'remove'} mergeMode
   */
  _applyMask(mesh, newMask, mergeMode) {
    ensureDepthMap(mesh);
    const selection = mesh.userData.voxelSelection;
    mergeSelection(selection, newMask, mergeMode);

    const selectedCount = countMask(selection);
    this.targetMesh = mesh;
    this._rebuildOverlay(mesh);
    if (this.onSelectionChanged) {
      this.onSelectionChanged(mesh, selectedCount);
    }
    return { mesh, selectedCount };
  }

  /**
   * Click selection (wand / pixel modes).
   * @param {MouseEvent} modifiers — shiftKey, altKey
   */
  onClick(clientX, clientY, { shiftKey = false, altKey = false } = {}) {
    if (!this.active || this.selectionMode === 'area') return null;

    const pick = this._pickVoxelHit(clientX, clientY);
    if (!pick) return null;

    const { mesh, pixel } = pick;
    const imageData = getVoxelPaintImageData(mesh);
    if (!imageData) return null;

    const { data, width, height } = imageData;
    let newMask;

    if (this.selectionMode === 'pixel') {
      newMask = selectSinglePixel(data, width, height, pixel.col, pixel.row);
      if (countMask(newMask) === 0) return null;
    } else {
      newMask = floodFill(data, width, height, pixel.col, pixel.row, this.tolerance);
      if (countMask(newMask) === 0) return null;
    }

    const mergeMode = altKey ? 'remove' : (shiftKey ? 'add' : 'replace');
    const result = this._applyMask(mesh, newMask, mergeMode);
    return { ...result, pixel };
  }

  onMouseDown(clientX, clientY, { shiftKey = false } = {}) {
    if (!this.active) return false;

    if (this.interactionMode === 'direct') {
      const pick = this._pickVoxelHit(clientX, clientY);
      if (!pick) return false;

      const paintData = ensureDepthMap(pick.mesh);
      const index = paintData ? pick.pixel.row * paintData.width + pick.pixel.col : -1;
      if (!paintData || index < 0) return false;

      const selectionChanged = this._selectDirectFace(pick.mesh, pick.pixel);
      this._directDrag = {
        mesh: pick.mesh,
        pixel: pick.pixel,
        localNormal: pick.localNormal,
        startClientY: clientY,
        startDepth: paintData.depthMap[index] || 0,
        currentDepth: paintData.depthMap[index] || 0,
        pixelsPerLayer: this._pixelsPerLayer(pick.mesh),
        speedMultiplier: shiftKey ? 2 : 1,
        selectionChanged,
      };
      this.sceneManager.orbit.enabled = false;
      this._updateFaceHighlight(pick);
      return true;
    }

    if (this.selectionMode !== 'area') return false;

    const pick = this._pickVoxelHit(clientX, clientY);
    if (!pick) return false;

    this._areaDrag = {
      mesh: pick.mesh,
      startCol: pick.pixel.col,
      startRow: pick.pixel.row,
      additive: shiftKey,
    };
    this.targetMesh = pick.mesh;
    ensureDepthMap(pick.mesh);
    this.sceneManager.orbit.enabled = false;
    this._updateAreaPreview(pick.pixel.col, pick.pixel.row);
    return true;
  }

  onMouseMove(clientX, clientY) {
    if (!this.active) return false;

    if (this.interactionMode === 'direct') {
      if (this._directDrag) {
        this._updateDirectDrag(clientX, clientY);
        return {
          mesh: this._directDrag.mesh,
          pixel: this._directDrag.pixel,
          depth: this._directDrag.currentDepth,
          dragging: true,
        };
      }
      const pick = this._pickVoxelHit(clientX, clientY);
      this._updateFaceHighlight(pick);
      if (!pick) return null;
      const width = pick.mesh.userData.voxelImageWidth || 1;
      const pi = pick.pixel.row * width + pick.pixel.col;
      return {
        mesh: pick.mesh,
        pixel: pick.pixel,
        depth: pick.mesh.userData.voxelDepthMap?.[pi] || 0,
        dragging: false,
      };
    }

    if (!this._areaDrag) return false;

    const pick = this._pickVoxelHit(clientX, clientY);
    if (!pick || pick.mesh !== this._areaDrag.mesh) {
      this._updateAreaPreview(this._areaDrag.startCol, this._areaDrag.startRow);
      return true;
    }

    this._updateAreaPreview(pick.pixel.col, pick.pixel.row);
    return true;
  }

  onMouseUp(clientX, clientY) {
    if (this._directDrag) {
      const drag = this._directDrag;
      this._updateDirectDrag(clientX, clientY);
      this._directDrag = null;
      this.sceneManager.orbit.enabled = true;
      const changedDepth = drag.currentDepth !== drag.startDepth;
      if (!changedDepth && !drag.selectionChanged) return null;
      return {
        mesh: drag.mesh,
        pixel: drag.pixel,
        prevDepth: drag.startDepth,
        newDepth: drag.currentDepth,
        changedDepth,
      };
    }

    if (!this._areaDrag) return null;

    const { mesh, startCol, startRow, additive } = this._areaDrag;
    this._areaDrag = null;
    this._clearPreview();
    this.sceneManager.orbit.enabled = true;

    const pick = this._pickVoxelHit(clientX, clientY);
    const endCol = pick?.mesh === mesh ? pick.pixel.col : startCol;
    const endRow = pick?.mesh === mesh ? pick.pixel.row : startRow;

    const imageData = getVoxelPaintImageData(mesh);
    if (!imageData) return null;

    const { data, width, height } = imageData;
    const newMask = selectRect(data, width, height, startCol, startRow, endCol, endRow);
    if (countMask(newMask) === 0) return null;

    const mergeMode = additive ? 'add' : 'replace';
    return this._applyMask(mesh, newMask, mergeMode);
  }

  clearSelection(mesh = this.targetMesh) {
    if (!mesh?.userData?.voxelSelection) return;
    mesh.userData.voxelSelection.fill(0);
    this._rebuildOverlay(mesh);
    if (this.onSelectionChanged) this.onSelectionChanged(mesh, 0);
  }

  applyExtract(mesh = this.targetMesh) {
    return this._applyDepth(mesh, this.depthStep);
  }

  applySubtract(mesh = this.targetMesh) {
    return this._applyDepth(mesh, -this.depthStep);
  }

  _applyDepth(mesh, delta) {
    if (!mesh?.userData?.voxelized) return null;
    if (!countMask(mesh.userData.voxelSelection || [])) return null;

    const changed = QuadFactory.applyVoxelDepthDelta(mesh, delta, this.maxDepth);
    if (!changed) return null;

    this._rebuildOverlay(mesh);
    const result = { mesh, delta };
    if (this.onDepthApplied) this.onDepthApplied(result);
    return result;
  }

  updateSelectionOverlay(mesh) {
    if (mesh === this.targetMesh) this._rebuildOverlay(mesh);
  }

  _updateAreaPreview(endCol, endRow) {
    if (!this._areaDrag) return;

    const { mesh, startCol, startRow } = this._areaDrag;
    const imageData = getVoxelPaintImageData(mesh);
    if (!imageData) return;

    const { data, width, height } = imageData;
    const previewMask = selectRect(data, width, height, startCol, startRow, endCol, endRow);
    this._rebuildPreview(mesh, previewMask);
  }

  _rebuildPreview(mesh, previewMask) {
    this._clearPreview();
    if (!previewMask) return;

    const imageData = getVoxelPaintImageData(mesh);
    if (!imageData) return;

    const { width, height } = imageData;
    const pixelSize = mesh.userData.voxelPixelSize || 1;
    const depthMap = mesh.userData.voxelDepthMap;

    const { x: originX, y: originY } = getVoxelGridOrigin(mesh, width, height);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xffc857,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    mesh.updateMatrixWorld(true);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const pi = pixelIndex(col, row, width);
        if (!previewMask[pi]) continue;

        const depth = depthMap[pi] || 0;
        const boxDepth = pixelSize * (1 + depth);
        const voxelX = originX + col * pixelSize;
        const voxelY = originY + (height - 1 - row) * pixelSize;
        const voxelZ = (depth * pixelSize) / 2;

        const localPos = new THREE.Vector3(voxelX, voxelY, voxelZ);
        const worldPos = localPos.applyMatrix4(mesh.matrixWorld);

        const overlay = new THREE.Mesh(
          new THREE.BoxGeometry(pixelSize * 1.04, pixelSize * 1.04, boxDepth * 1.04),
          mat.clone()
        );
        overlay.position.copy(worldPos);
        overlay.quaternion.copy(mesh.quaternion);
        overlay.renderOrder = 997;
        this._previewGroup.add(overlay);
      }
    }
  }

  _rebuildOverlay(mesh) {
    this._clearOverlay();
    if (!mesh?.userData?.voxelSelection) return;

    const imageData = getVoxelPaintImageData(mesh);
    if (!imageData) return;

    const { width, height } = imageData;
    const pixelSize = mesh.userData.voxelPixelSize || 1;
    const depthMap = mesh.userData.voxelDepthMap;
    const selection = mesh.userData.voxelSelection;

    const { x: originX, y: originY } = getVoxelGridOrigin(mesh, width, height);

    const mat = new THREE.MeshBasicMaterial({
      color: 0x6382ff,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    mesh.updateMatrixWorld(true);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const pi = pixelIndex(col, row, width);
        if (!selection[pi]) continue;

        const depth = depthMap[pi] || 0;
        const boxDepth = pixelSize * (1 + depth);
        const voxelX = originX + col * pixelSize;
        const voxelY = originY + (height - 1 - row) * pixelSize;
        const voxelZ = (depth * pixelSize) / 2;

        const localPos = new THREE.Vector3(voxelX, voxelY, voxelZ);
        const worldPos = localPos.applyMatrix4(mesh.matrixWorld);

        const overlay = new THREE.Mesh(
          new THREE.BoxGeometry(pixelSize * 1.02, pixelSize * 1.02, boxDepth * 1.02),
          mat.clone()
        );
        overlay.position.copy(worldPos);
        overlay.quaternion.copy(mesh.quaternion);
        overlay.renderOrder = 998;
        this._overlayGroup.add(overlay);
      }
    }
  }

  _clearPreview() {
    while (this._previewGroup.children.length) {
      const child = this._previewGroup.children[0];
      child.geometry?.dispose();
      child.material?.dispose();
      this._previewGroup.remove(child);
    }
  }

  _clearOverlay() {
    while (this._overlayGroup.children.length) {
      const child = this._overlayGroup.children[0];
      child.geometry?.dispose();
      child.material?.dispose();
      this._overlayGroup.remove(child);
    }
  }

  dispose() {
    this._clearOverlay();
    this._clearPreview();
    this.sceneManager.scene.remove(this._overlayGroup);
    this.sceneManager.scene.remove(this._previewGroup);
    this.sceneManager.scene.remove(this._faceHighlight);
    this._faceHighlight.geometry.dispose();
    this._faceHighlight.material.dispose();
  }
}
