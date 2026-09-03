import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { applyAssetSnap } from '../editor/AssetSnap.js';

function disposeObject3D(root) {
  root?.traverse?.(node => {
    node.geometry?.dispose();
    if (Array.isArray(node.material)) node.material.forEach(material => material?.dispose());
    else node.material?.dispose();
  });
}

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.objects = [];
    this.groups = [];          // THREE.Group containers in the scene
    this.selectedObjects = []; // Array of selected meshes/groups
    this.gridVisible = true;
    this.snapEnabled = false;
    this.scaleSnapEnabled = false;
    this.assetSnapEnabled = false;
    this.snapSize = 32.0;
    this.cameraMode = 'perspective';
    this.cameraMoveVelocity = new THREE.Vector3();
    this.cameraMoveSpeed = 240;
    this.cameraMoveBoost = 4;
    this.cameraMoveAcceleration = 14;
    this.cameraMoveDeceleration = 18;
    this.cameraWorldUp = new THREE.Vector3(0, 1, 0);

    // Group for temporary multi-selection transformation
    this.tempSelectionGroup = new THREE.Group();
    this.tempSelectionGroup.name = 'TempSelectionGroup';

    this._initRenderer();
    this._initScene();
    this._initGrid(this.snapSize);
    this._initCameras();
    this._initControls();
    this._initLights();
    this._initRaycaster();

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0d0f13, 1);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    // Exportable group — only objects added here get exported
    this.exportGroup = new THREE.Group();
    this.exportGroup.name = 'ExportGroup';
    this.scene.add(this.exportGroup);

    // Reference images are editor guides, never exportable scene objects.
    this.referenceGroup = new THREE.Group();
    this.referenceGroup.name = 'ReferenceImages';
    this.scene.add(this.referenceGroup);
    this.scene.add(this.tempSelectionGroup);
  }

  _initCameras() {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;

    // Perspective camera
    this.perspCamera = new THREE.PerspectiveCamera(50, aspect, 1, 10000);
    this.perspCamera.position.set(256, 256, 256);
    this.perspCamera.lookAt(0, 0, 0);

    // Orthographic camera
    const frustum = 256;
    this.orthoCamera = new THREE.OrthographicCamera(
      -frustum * aspect, frustum * aspect,
      frustum, -frustum,
      1, 10000
    );
    this.orthoCamera.position.set(256, 256, 256);
    this.orthoCamera.lookAt(0, 0, 0);

    this.camera = this.perspCamera;
  }

  _initControls() {
    // Orbit controls
    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 10;
    this.orbit.maxDistance = 2000;

    // Transform controls
    this.transformControls = new TransformControls(this.camera, this.canvas);
    this.transformControls.setSize(1.0);
    this.scene.add(this.transformControls.getHelper());

    this.transformControls.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;

      if (e.value && this.onTransformStart) {
        this.onTransformStart(this.transformControls.object);
      }

      // When dragging STOPS, if we were using the temp group,
      // unpack and re-pack so gizmo stays in place.
      if (!e.value && this.tempSelectionGroup.children.length > 0) {
        this._unpackTempGroup();
        this._packTempGroup();
      }

      if (!e.value && this.onTransformEnd) {
        this.onTransformEnd(this.transformControls.object);
      }
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (this.transformControls.mode === 'translate') {
        const obj = this.transformControls.object;
        if (obj) {
          if (this.snapEnabled) {
            if (obj === this.tempSelectionGroup) {
              obj.position.x = Math.round(obj.position.x / this.snapSize) * this.snapSize;
              obj.position.y = Math.round(obj.position.y / this.snapSize) * this.snapSize;
              obj.position.z = Math.round(obj.position.z / this.snapSize) * this.snapSize;
            } else {
              this.snapObjectToGrid(obj);
            }
          }

          if (this.assetSnapEnabled) {
            this.snapObjectToAssets(obj);
          }
        }
      } else if (this.transformControls.mode === 'scale' && this.snapEnabled && this.scaleSnapEnabled) {
        const obj = this.transformControls.object;
        if (obj) {
          this.snapObjectScaleToGrid(obj);
          this.snapObjectToGrid(obj);
        }
      }
      
      this.selectedObjects.forEach(obj => {
        if (obj.userData.isVertexControl && this.onVertexChanged) {
          this.onVertexChanged(obj);
        }
      });
      
      if (this.onObjectChanged) {
        this.onObjectChanged();
      }
    });
  }

  /**
   * Snap an object's position so its bounding dimensions fit exactly inside grid cells.
   * - Objects with odd cell width (e.g. 1 cell wide = 32px) align to cell centers.
   * - Objects with even cell width (e.g. 2 cells wide = 64px) align to grid lines.
   * - Takes into account rotation around Y axis.
   */
  snapObjectToGrid(mesh, customSnapSize = null) {
    if (!mesh) return;
    const snapSize = customSnapSize || this.snapSize;
    if (!snapSize) return;

    // A separated voxel piece keeps the source sprite dimensions for UV and
    // paint coordinates, so snapping must measure its actual visible bounds.
    let width = mesh.userData.voxelDerivedPiece
      ? undefined
      : mesh.userData.originalWidth;
    let depth = mesh.userData.extrusionDepth || 0;

    if (width === undefined && mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      width = (box.max.x - box.min.x) * mesh.scale.x;
      depth = (box.max.z - box.min.z) * mesh.scale.z;
    } else if (width === undefined) {
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      width = size.x;
      depth = size.z;
    } else {
      width = (width || 32) * mesh.scale.x;
      depth = depth * mesh.scale.z;
    }

    const sin = Math.abs(Math.sin(mesh.rotation.y));
    const cos = Math.abs(Math.cos(mesh.rotation.y));

    let effWidthX = width;
    let effDepthZ = depth;

    if (sin > cos) {
      effWidthX = depth;
      effDepthZ = width;
    }

    const pos = mesh.position;

    // X Alignment
    const numCellsX = Math.max(1, Math.round(effWidthX / snapSize));
    if (numCellsX % 2 === 1) {
      pos.x = (Math.floor(pos.x / snapSize) + 0.5) * snapSize;
    } else {
      pos.x = Math.round(pos.x / snapSize) * snapSize;
    }

    // Y Alignment
    pos.y = Math.round(pos.y / snapSize) * snapSize;

    // Z Alignment
    if (effDepthZ > 0.001) {
      const numCellsZ = Math.max(1, Math.round(effDepthZ / snapSize));
      if (numCellsZ % 2 === 1) {
        pos.z = (Math.floor(pos.z / snapSize) + 0.5) * snapSize;
      } else {
        pos.z = Math.round(pos.z / snapSize) * snapSize;
      }
    } else {
      pos.z = Math.round(pos.z / snapSize) * snapSize;
    }
  }

  /**
   * Snap an object's dimensions to whole grid cells while scaling.
   * Planes use their X/Y dimensions, while volumetric meshes also use Z.
   * Scene groups are measured in world space so multi-selection scaling works.
   */
  snapObjectScaleToGrid(mesh, customSnapSize = null) {
    if (!mesh) return;
    const snapSize = customSnapSize || this.snapSize;
    if (!snapSize) return;

    const isGroup = mesh === this.tempSelectionGroup
      || mesh.userData?.isSceneGroup
      || mesh.userData?.type === 'imported-3d';
    const dimensions = new THREE.Vector3();

    if (isGroup) {
      new THREE.Box3().setFromObject(mesh).getSize(dimensions);
    } else if (mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox.getSize(dimensions);
      dimensions.multiply(mesh.scale).set(
        Math.abs(dimensions.x),
        Math.abs(dimensions.y),
        Math.abs(dimensions.z),
      );
    } else {
      return;
    }

    ['x', 'y', 'z'].forEach(axis => {
      const currentSize = dimensions[axis];
      if (currentSize <= 0.0001) return;

      const targetSize = Math.max(snapSize, Math.round(currentSize / snapSize) * snapSize);
      mesh.scale[axis] *= targetSize / currentSize;
    });
  }

  _initGrid(cellSize = 32.0) {
    if (this.grid) this.scene.remove(this.grid);
 
    const size = 1024;
    const divisions = Math.floor(size / cellSize);
    this.grid = new THREE.GridHelper(size, divisions, 0x444455, 0x24242e);
    this.grid.rotation.x = 0; // It's on XZ plane by default
    this.scene.add(this.grid);
    
    // Axis helper
    const axisHelper = new THREE.AxesHelper(64);
    axisHelper.position.set(0, 0.05, 0);
    this.scene.add(axisHelper);
  }
 
  updateGrid(cellSize) {
    this.snapSize = cellSize;
    this._initGrid(cellSize);
    if (this.snapEnabled) {
      this.transformControls.setTranslationSnap(cellSize);
      this.selectedObjects.forEach(obj => {
        if (this.scaleSnapEnabled) this.snapObjectScaleToGrid(obj);
        this.snapObjectToGrid(obj);
      });
    }
  }

  _initLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.4);
    dir.position.set(5, 10, 5);
    this.scene.add(dir);
  }

  _initRaycaster() {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
  }

  _onResize() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;

    this.renderer.setSize(w, h);

    const aspect = w / h;
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    const frustum = 256;
    this.orthoCamera.left = -frustum * aspect;
    this.orthoCamera.right = frustum * aspect;
    this.orthoCamera.top = frustum;
    this.orthoCamera.bottom = -frustum;
    this.orthoCamera.updateProjectionMatrix();
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    const oldPos = this.camera.position.clone();
    const oldTarget = this.orbit.target.clone();

    if (mode === 'perspective') {
      this.camera = this.perspCamera;
    } else {
      this.camera = this.orthoCamera;
    }

    this.camera.position.copy(oldPos);
    this.orbit.object = this.camera;
    this.orbit.target.copy(oldTarget);
    this.orbit.update();

    this.transformControls.camera = this.camera;

    const infoEl = document.getElementById('info-camera');
    if (infoEl) infoEl.textContent = mode === 'perspective' ? 'Perspective' : 'Orthographic';
  }

  /**
   * Move the camera independently from its zoom distance.
   * WASD input is expressed as a direction and translated together with the
   * orbit target, so OrbitControls keeps the same view while navigation speed
   * remains stable at every zoom level.
   */
  updateCameraMovement(keys, deltaTime) {
    if (this.transformControls.dragging) {
      this.cameraMoveVelocity.set(0, 0, 0);
      return;
    }

    const inputX = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    const inputZ = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);
    const hasInput = inputX !== 0 || inputZ !== 0;

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    // Keep editor navigation parallel to the ground plane. Looking downward
    // should not make W move the camera into the floor.
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    else forward.normalize();

    const right = new THREE.Vector3().crossVectors(forward, this.cameraWorldUp).normalize();
    const desiredDirection = new THREE.Vector3()
      .addScaledVector(right, inputX)
      .addScaledVector(forward, -inputZ);
    if (desiredDirection.lengthSq() > 1e-8) desiredDirection.normalize();

    const speed = this.cameraMoveSpeed * (keys.has('shift') ? this.cameraMoveBoost : 1);
    const desiredVelocity = desiredDirection.multiplyScalar(hasInput ? speed : 0);
    const response = 1 - Math.exp(-(hasInput ? this.cameraMoveAcceleration : this.cameraMoveDeceleration) * deltaTime);
    this.cameraMoveVelocity.lerp(desiredVelocity, response);

    if (this.cameraMoveVelocity.lengthSq() < 0.0001) {
      this.cameraMoveVelocity.set(0, 0, 0);
      return;
    }

    const movement = this.cameraMoveVelocity.clone().multiplyScalar(deltaTime);
    this.camera.position.add(movement);
    this.orbit.target.add(movement);
    this.orbit.update();
  }

  setTransformMode(mode) {
    this.transformControls.setMode(mode);
  }

  setSnap(enabled) {
    this.snapEnabled = enabled;
    if (enabled) {
      this.transformControls.setTranslationSnap(this.snapSize);
      this.transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
      if (this.scaleSnapEnabled) {
        this.selectedObjects.forEach(obj => this.snapObjectScaleToGrid(obj));
      }
      this.selectedObjects.forEach(obj => this.snapObjectToGrid(obj));
    } else {
      this.transformControls.setTranslationSnap(null);
      this.transformControls.setRotationSnap(null);
    }
  }

  setScaleSnap(enabled) {
    this.scaleSnapEnabled = enabled;
    if (enabled && this.snapEnabled) {
      this.selectedObjects.forEach(obj => {
        this.snapObjectScaleToGrid(obj);
        this.snapObjectToGrid(obj);
      });
    }
  }

  setAssetSnap(enabled) {
    this.assetSnapEnabled = enabled;
  }

  getAssetSnapThreshold() {
    return Math.max(8, this.snapSize * 0.75);
  }

  /**
   * Snap a mesh (or selection group) to nearby asset edges/corners.
   */
  snapObjectToAssets(obj) {
    if (!obj) return false;

    const threshold = this.getAssetSnapThreshold();
    let movingMeshes = [];
    let staticMeshes = [];

    if (obj === this.tempSelectionGroup) {
      movingMeshes = [...obj.children];
      staticMeshes = this.objects.filter(mesh => !movingMeshes.includes(mesh));
    } else {
      movingMeshes = [obj];
      staticMeshes = this.objects.filter(mesh => mesh !== obj);
    }

    if (!movingMeshes.length || !staticMeshes.length) return false;
    return applyAssetSnap(movingMeshes, staticMeshes, threshold, obj);
  }

  toggleGrid() {
    this.gridVisible = !this.gridVisible;
    this.grid.visible = this.gridVisible;
    return this.gridVisible;
  }

  addObject(mesh) {
    this.exportGroup.add(mesh);
    this.objects.push(mesh);
    this._updateObjectCount();
  }

  addReference(mesh) {
    this.referenceGroup.add(mesh);
  }

  removeReference(mesh, { dispose = true } = {}) {
    if (!mesh) return;
    this.referenceGroup.remove(mesh);
    if (dispose) {
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
      else mesh.material?.dispose();
    }
  }

  removeObject(mesh, { dispose = true } = {}) {
    if (this.selectedObjects.includes(mesh)) {
      this.deselectObject(mesh);
    }
 
    if (mesh.parent) mesh.parent.remove(mesh);
    const idx = this.objects.indexOf(mesh);
    if (idx >= 0) this.objects.splice(idx, 1);

    if (dispose) {
      disposeObject3D(mesh);
    }

    this._updateObjectCount();
  }

  selectObject(mesh, additive = false) {
    if (!additive) {
      this.deselectObject();
    }
 
    if (mesh && !this.selectedObjects.includes(mesh)) {
      this.selectedObjects.push(mesh);
    }
 
    this._updateTransformControls();
    if (this.onSelectionChanged) this.onSelectionChanged(this.selectedObjects);
  }
 
  deselectObject(mesh = null) {
    if (mesh) {
      const idx = this.selectedObjects.indexOf(mesh);
      if (idx >= 0) this.selectedObjects.splice(idx, 1);
    } else {
      this.selectedObjects = [];
    }
 
    this._updateTransformControls();
    if (this.onSelectionChanged) this.onSelectionChanged(this.selectedObjects);
  }
 
  _updateTransformControls() {
    this.transformControls.detach();
    this._unpackTempGroup(); // Always reset first
 
    if (this.selectedObjects.length === 0) {
      // Nothing selected
    } else if (this.selectedObjects.length === 1) {
      this.transformControls.attach(this.selectedObjects[0]);
    } else {
      // Multiple selection
      this._packTempGroup();
      this.transformControls.attach(this.tempSelectionGroup);
    }
  }
 
  _packTempGroup() {
    if (this.selectedObjects.length < 2) return;

    // Center group position by averaging
    const center = new THREE.Vector3();
    this.selectedObjects.forEach(obj => {
      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);
      center.add(worldPos);
    });
    center.divideScalar(this.selectedObjects.length);

    this.tempSelectionGroup.position.copy(center);
    this.tempSelectionGroup.rotation.set(0, 0, 0);
    this.tempSelectionGroup.scale.set(1, 1, 1);
    this.tempSelectionGroup.updateMatrixWorld();

    this.selectedObjects.forEach(obj => {
      obj.userData._origParent = obj.parent; // remember where to return it
      this.tempSelectionGroup.attach(obj);
    });
  }

  _unpackTempGroup() {
    const objs = [...this.tempSelectionGroup.children];
    objs.forEach(obj => {
      const dest = obj.userData._origParent || this.exportGroup;
      dest.attach(obj);
      delete obj.userData._origParent;
    });
  }

  pickObject(clientX, clientY, customObjects = null) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(customObjects || this.objects, true);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      if (!customObjects) {
        const object = hit.userData?.importedRoot || hit;
        let parent = object.parent;
        while (parent && parent !== this.exportGroup) {
          if (parent.userData?.isSceneGroup) return parent;
          parent = parent.parent;
        }
        return object;
      }
      return hit;
    }
    return null;
  }

  // ──────────────────────────────────────────── Groups ──

  createGroup(name, items) {
    const group = new THREE.Group();
    group.name = name || 'Group';
    group.userData.isSceneGroup = true;

    // Position at average world center of items
    const center = new THREE.Vector3();
    items.forEach(obj => {
      const wp = new THREE.Vector3();
      obj.getWorldPosition(wp);
      center.add(wp);
    });
    center.divideScalar(items.length);
    group.position.copy(center);

    this.exportGroup.add(group);
    this.groups.push(group);

    items.forEach(obj => {
      group.attach(obj); // preserves world transform
    });

    return group;
  }

  dissolveGroup(group) {
    const children = [...group.children];
    children.forEach(obj => {
      this.exportGroup.attach(obj); // back to exportGroup, world transform preserved
    });
    this.exportGroup.remove(group);
    const idx = this.groups.indexOf(group);
    if (idx >= 0) this.groups.splice(idx, 1);
    return children;
  }

  restoreGroup(group, children) {
    if (!group) return;
    if (!this.groups.includes(group)) this.groups.push(group);
    if (group.parent !== this.exportGroup) this.exportGroup.add(group);
    (children || []).forEach(child => group.attach(child));
  }

  removeGroup(group) {
    if (this.selectedObjects.includes(group)) {
      this.deselectObject(group);
    }
    const children = [...group.children];
    children.forEach(child => {
      const idx = this.objects.indexOf(child);
      if (idx >= 0) this.objects.splice(idx, 1);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
    this.exportGroup.remove(group);
    const idx = this.groups.indexOf(group);
    if (idx >= 0) this.groups.splice(idx, 1);
    this._updateObjectCount();
  }

  /**
   * Like pickObject but returns the full intersection record, including face data.
   * Used by PushPullTool to detect which face was hit.
   */
  pickFaceData(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.objects, true);
    return intersects[0] ?? null;
  }

  getWorldPositionFromScreen(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Intersect with ground plane (y=0)
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersection = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(groundPlane, intersection);

    return intersection;
  }

  _updateObjectCount() {
    const el = document.getElementById('info-objects');
    if (el) el.textContent = `${this.objects.length} object${this.objects.length !== 1 ? 's' : ''}`;
  }

  clear() {
    this.deselectObject();
    [...this.referenceGroup.children].forEach(reference => this.removeReference(reference));
    const grps = [...this.groups];
    for (const g of grps) this.removeGroup(g);
    const objs = [...this.objects];
    for (const obj of objs) this.removeObject(obj);
  }

  render() {
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.orbit.dispose();
    this.transformControls.dispose();
    this.renderer.dispose();
  }
}
