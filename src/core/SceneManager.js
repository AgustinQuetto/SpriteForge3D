import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.objects = [];
    this.selectedObjects = []; // Array of selected meshes
    this.gridVisible = true;
    this.snapEnabled = false;
    this.snapSize = 32.0;
    this.cameraMode = 'perspective';

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

      // When dragging STOPS, if we were using the temp group, 
      // we need to make sure the objects keep their world positions.
      if (!e.value && this.selectedObjects.length > 1) {
        this._unpackTempGroup();
        // Re-attach to the group to keep the gizmo visible and ready for next drag
        this._packTempGroup();
      }
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (this.snapEnabled && this.transformControls.mode === 'translate') {
        const obj = this.transformControls.object;
        if (obj) {
          obj.position.x = Math.round(obj.position.x / this.snapSize) * this.snapSize;
          obj.position.y = Math.round(obj.position.y / this.snapSize) * this.snapSize;
          obj.position.z = Math.round(obj.position.z / this.snapSize) * this.snapSize;
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

  setTransformMode(mode) {
    this.transformControls.setMode(mode);
  }

  setSnap(enabled) {
    this.snapEnabled = enabled;
    if (enabled) {
      this.transformControls.setTranslationSnap(this.snapSize);
      this.transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
    } else {
      this.transformControls.setTranslationSnap(null);
      this.transformControls.setRotationSnap(null);
    }
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

  removeObject(mesh) {
    if (this.selectedObjects.includes(mesh)) {
      this.deselectObject(mesh);
    }
 
    if (mesh.parent) mesh.parent.remove(mesh);
    const idx = this.objects.indexOf(mesh);
    if (idx >= 0) this.objects.splice(idx, 1);

    // Dispose geometry & materials
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
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
      this.tempSelectionGroup.attach(obj);
    });
  }
 
  _unpackTempGroup() {
    const objs = [...this.tempSelectionGroup.children];
    objs.forEach(obj => {
      this.exportGroup.attach(obj);
    });
  }

  pickObject(clientX, clientY, customObjects = null) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(customObjects || this.objects, false);

    if (intersects.length > 0) {
      return intersects[0].object;
    }
    return null;
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
    // Copy the array because removeObject modifies it
    const objs = [...this.objects];
    for (const obj of objs) {
      this.removeObject(obj);
    }
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
