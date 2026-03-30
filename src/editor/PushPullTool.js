import * as THREE from 'three';
import { QuadFactory } from './QuadFactory.js';

/**
 * PushPullTool — SketchUp-style face extrusion.
 * Hover over any face, click and drag to extrude it along its normal.
 * Supports: polygon faces (ShapeGeometry), quads (PlaneGeometry), boxes (BoxGeometry).
 */
export class PushPullTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.active = false;

    // Hover/drag state
    this._hoveredData = null;   // { mesh, faceNormal, materialIndex, hitPoint }
    this._dragData = null;      // same + { startDepth, dragPlane, currentDepth }

    // Highlight mesh — a flat indicator disc offset along face normal
    this._highlight = this._buildHighlightMesh();
    sceneManager.scene.add(this._highlight);

    // Saved material emissive state for hover feedback
    this._savedEmissive = null;
    this._savedEmissiveIndex = null;
  }

  // ──────────────────────────────────────────── Public API ──

  activate() {
    this.active = true;
    this._highlight.visible = false;
  }

  deactivate() {
    this.active = false;
    this._unhoverMesh();
    this._dragData = null;
    this._highlight.visible = false;
  }

  /**
   * Call on canvas mousemove. Returns true if the event was consumed.
   */
  onMouseMove(clientX, clientY) {
    if (!this.active) return false;

    // Update raycaster from SceneManager
    const rect = this.sceneManager.canvas.getBoundingClientRect();
    this.sceneManager.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.sceneManager.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.sceneManager.raycaster.setFromCamera(
      this.sceneManager.mouse,
      this.sceneManager.camera
    );

    if (this._dragData) {
      this._updateDrag(clientY);
    } else {
      this._updateHover();
    }
    return true;
  }

  /**
   * Call on canvas mousedown.
   */
  onMouseDown(clientX, clientY) {
    if (!this.active || !this._hoveredData) return false;

    const { mesh, faceNormal, materialIndex } = this._hoveredData;
    const startDepth = this._getDepthForFace(mesh, faceNormal, materialIndex);

    this._dragData = {
      mesh,
      faceNormal,
      materialIndex,
      startMouseY: clientY,   // screen-space Y at drag start
      startDepth,
      currentDepth: startDepth,
    };

    // Disable orbit during drag
    this.sceneManager.orbit.enabled = false;
    return true;
  }

  /**
   * Call on canvas mouseup. Returns committed { mesh, prevDepth, newDepth } or null.
   */
  onMouseUp() {
    if (!this._dragData) return null;

    const { mesh, faceNormal, materialIndex, startDepth, currentDepth } = this._dragData;
    this._dragData = null;
    this.sceneManager.orbit.enabled = false; // stays disabled (still in push-pull mode)

    if (Math.abs(currentDepth - startDepth) < 0.1) return null;

    return {
      mesh,
      faceNormal: faceNormal.clone(),
      materialIndex,
      prevDepth: startDepth,
      newDepth: currentDepth,
    };
  }

  // ──────────────────────────────────────────── Hover ──

  _updateHover() {
    const intersects = this.sceneManager.raycaster.intersectObjects(
      this.sceneManager.objects, false
    );

    if (intersects.length === 0) {
      this._unhoverMesh();
      this._highlight.visible = false;
      return;
    }

    const hit = intersects[0];
    const mesh = hit.object;
    const face = hit.face;
    if (!face) {
      this._unhoverMesh();
      return;
    }

    const worldNormal = face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
    const materialIndex = face.materialIndex ?? 0;

    // Avoid re-hover same face
    const same = this._hoveredData &&
      this._hoveredData.mesh === mesh &&
      this._hoveredData.materialIndex === materialIndex;

    if (!same) {
      this._unhoverMesh();
      this._hoverMesh(mesh, materialIndex);
    }

    this._hoveredData = {
      mesh,
      faceNormal: worldNormal,
      materialIndex,
      hitPoint: hit.point.clone(),
    };

    // Position highlight disc slightly above face
    this._highlight.position.copy(hit.point).addScaledVector(worldNormal, 1);
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(worldNormal.dot(up)) > 0.999) {
      this._highlight.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), worldNormal
      );
    } else {
      this._highlight.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), worldNormal
      );
    }
    this._highlight.visible = true;
  }

  _hoverMesh(mesh, matIndex) {
    const mat = Array.isArray(mesh.material)
      ? mesh.material[matIndex]
      : mesh.material;
    if (!mat) return;

    this._savedEmissive = mat.emissive ? mat.emissive.clone() : null;
    this._savedEmissiveIntensity = mat.emissiveIntensity ?? 0;
    this._savedEmissiveMesh = mesh;
    this._savedEmissiveIndex = matIndex;

    if (mat.emissive !== undefined) {
      mat.emissive.set(0x6382ff);
      mat.emissiveIntensity = 0.25;
    }
  }

  _unhoverMesh() {
    if (!this._savedEmissiveMesh) return;
    const mesh = this._savedEmissiveMesh;
    const mat = Array.isArray(mesh.material)
      ? mesh.material[this._savedEmissiveIndex]
      : mesh.material;

    if (mat && mat.emissive !== undefined) {
      if (this._savedEmissive) mat.emissive.copy(this._savedEmissive);
      mat.emissiveIntensity = this._savedEmissiveIntensity ?? 0;
    }

    this._savedEmissiveMesh = null;
    this._savedEmissive = null;
    this._savedEmissiveIndex = null;
    this._hoveredData = null;
  }

  // ──────────────────────────────────────────── Drag ──

  _updateDrag(clientY) {
    const { mesh, faceNormal, materialIndex, startMouseY, startDepth } = this._dragData;

    // Use screen-space Y delta so dragging up always extrudes along the face normal,
    // regardless of camera angle or face orientation.
    const pixelDelta = startMouseY - clientY; // positive = dragging up = extrude out
    const scale = this._dragScale();
    const newDepth = Math.max(0, startDepth + pixelDelta * scale);

    this._dragData.currentDepth = newDepth;
    this._applyExtrusion(mesh, faceNormal, materialIndex, newDepth);
  }

  /** World-units per screen pixel, based on camera distance to scene center. */
  _dragScale() {
    const cam = this.sceneManager.camera;
    const dist = cam.position.length();
    const canvas = this.sceneManager.canvas;
    // Approximate: half the vertical FOV in world units / half canvas height
    if (cam.isPerspectiveCamera) {
      const fovRad = (cam.fov * Math.PI) / 180;
      const worldHeight = 2 * Math.tan(fovRad / 2) * dist;
      return worldHeight / canvas.clientHeight;
    }
    // Orthographic: use the camera frustum height
    return (cam.top - cam.bottom) / canvas.clientHeight;
  }

  // ──────────────────────────────────────────── Extrusion ──

  _getDepthForFace(mesh, faceNormal, materialIndex) {
    const ud = mesh.userData;
    if (ud.type === 'polygon') return ud.extrusionDepth ?? 0;
    if (ud.type === 'quad')    return ud.extrusionDepth ?? 0;
    if (ud.type === 'box') {
      const p = mesh.geometry.parameters;
      const abs = faceNormal.clone().applyQuaternion(mesh.quaternion.clone().invert());
      const ax = Math.abs(abs.x), ay = Math.abs(abs.y), az = Math.abs(abs.z);
      if (ax >= ay && ax >= az) return p.width;
      if (ay >= ax && ay >= az) return p.height;
      return p.depth;
    }
    return 0;
  }

  _applyExtrusion(mesh, faceNormal, materialIndex, depth) {
    const ud = mesh.userData;

    if (ud.type === 'polygon') {
      this._extrudePolygon(mesh, depth);
    } else if (ud.type === 'quad') {
      QuadFactory.extrudeQuad(mesh, depth);
      ud.extrusionDepth = depth;
    } else if (ud.type === 'box') {
      this._extrudeBox(mesh, faceNormal, materialIndex, depth);
    }
  }

  _extrudePolygon(mesh, depth) {
    const shape = mesh.userData.shape;
    if (!shape) return;

    let geo;
    if (depth <= 0.01) {
      geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      mesh.userData.extrusionDepth = 0;
      mesh.userData.type = 'polygon';
    } else {
      geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      mesh.userData.extrusionDepth = depth;
      mesh.userData.type = 'polygon';
    }

    mesh.geometry.dispose();
    mesh.geometry = geo;
    mesh.geometry.computeVertexNormals();
  }

  _extrudeBox(mesh, faceNormal, materialIndex, newDim) {
    const p = mesh.geometry.parameters;
    const segments = p.widthSegments ?? 1;

    // Determine which dimension to change and in which direction
    // materialIndex: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z
    const axisData = [
      { axis: 'x', dim: 'width',  sign: +1 },  // 0: +X face
      { axis: 'x', dim: 'width',  sign: -1 },  // 1: -X face
      { axis: 'y', dim: 'height', sign: +1 },  // 2: +Y face
      { axis: 'y', dim: 'height', sign: -1 },  // 3: -Y face
      { axis: 'z', dim: 'depth',  sign: +1 },  // 4: +Z face
      { axis: 'z', dim: 'depth',  sign: -1 },  // 5: -Z face
    ];

    const info = axisData[materialIndex] ?? axisData[4];
    const { axis, dim, sign } = info;

    let newWidth  = p.width;
    let newHeight = p.height;
    let newDepth  = p.depth;

    const oldDim = p[dim];
    const delta = newDim - oldDim;

    if (dim === 'width')  newWidth  = newDim;
    if (dim === 'height') newHeight = newDim;
    if (dim === 'depth')  newDepth  = newDim;

    if (newWidth < 0.1 || newHeight < 0.1 || newDepth < 0.1) return;

    const newGeo = new THREE.BoxGeometry(
      newWidth, newHeight, newDepth,
      segments, segments, segments
    );
    newGeo.translate(0, newHeight / 2, 0);

    mesh.geometry.dispose();
    mesh.geometry = newGeo;

    // Shift position to keep opposite face anchored
    // Y axis: bottom pivot is fixed, no X/Z shift for Y
    if (dim !== 'height') {
      mesh.position[axis] += (delta / 2) * sign;
    }
    // For +Y face: top moves up, bottom stays → height grows, no position shift needed
    // For -Y face: bottom goes down while geometry is bottom-anchored → shift down
    if (dim === 'height' && sign === -1) {
      mesh.position.y -= delta;
    }

    // Update userData
    mesh.userData.originalWidth  = newWidth;
    mesh.userData.originalHeight = newHeight;
    mesh.userData.extrusionDepth = newDepth;

    // Preserve materials
    if (!Array.isArray(mesh.material)) {
      const edgeMat = new THREE.MeshStandardMaterial({ color: 0x3a3d4a, roughness: 1, metalness: 0 });
      mesh.material = [edgeMat, edgeMat, edgeMat, edgeMat, mesh.material.clone(), mesh.material.clone()];
    }
  }

  // ──────────────────────────────────────────── Internals ──

  _buildHighlightMesh() {
    const geo = new THREE.CircleGeometry(12, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x6382ff,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'PushPullHighlight';
    mesh.visible = false;
    mesh.renderOrder = 999;
    return mesh;
  }

  dispose() {
    this.sceneManager.scene.remove(this._highlight);
    this._highlight.geometry.dispose();
    this._highlight.material.dispose();
  }
}
