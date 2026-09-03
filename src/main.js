import * as THREE from 'three';
import { SceneManager } from './core/SceneManager.js';
import { QuadFactory } from './editor/QuadFactory.js';
import { HistoryManager } from './editor/HistoryManager.js';
import { AssetPanel } from './ui/AssetPanel.js';
import { PropertiesPanel } from './ui/PropertiesPanel.js';
import { SceneHierarchy } from './ui/SceneHierarchy.js';
import { GLTFExportManager } from './export/GLTFExportManager.js';
import { OBJExportManager } from './export/OBJExportManager.js';
import { FBXExportManager } from './export/FBXExportManager.js';
import { GodotExportManager } from './export/GodotExportManager.js';
import { UnrealExportManager } from './export/UnrealExportManager.js';
import { createExportScope } from './export/ExportScope.js';
import { VertexEditor } from './editor/VertexEditor.js';
import { UVExporter } from './export/UVExporter.js';
import { DrawingTool } from './editor/DrawingTool.js';
import { PushPullTool } from './editor/PushPullTool.js';
import { CutTool } from './editor/CutTool.js';
import { VoxelReliefTool } from './editor/VoxelReliefTool.js';
import { VoxelBrushTool } from './editor/VoxelBrushTool.js';
import {
  cloneVoxelState,
  restoreVoxelState,
  countMask,
  loadImageFromFile,
  splitVoxelStateBySelection,
} from './editor/PixelUtils.js';
import { createVoxelMesh } from './import/VoxelJSONLoader.js';
import {
  MODEL_ACCEPT,
  MODEL_EXTENSIONS,
  importModelFile,
  importModelSource,
} from './import/ModelImporter.js';

// ──────────────────────────────────────────────
//  Initialize Systems
// ──────────────────────────────────────────────

const canvas = document.getElementById('viewport');
const scene = new SceneManager(canvas);
const history = new HistoryManager();
const assetPanel = new AssetPanel();
const propsPanel = new PropertiesPanel(scene);
const hierarchy = new SceneHierarchy(scene);
const vertexEditor = new VertexEditor(scene.scene);

const AUTOSAVE_STORAGE_KEY = 'spriteforge3d.autosave.v1';
let autosaveTimer = null;
let isRestoringProject = false;

function scheduleAutosave() {
  if (isRestoringProject) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    persistProjectSnapshot();
  }, 350);
}

function persistProjectSnapshot(project = null) {
  if (isRestoringProject) return;
  try {
    const snapshot = project || serializeProject();
    snapshot.savedAt = Date.now();
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // localStorage can be unavailable or full (for example with very large sprites).
    console.warn('Could not autosave project:', err);
  }
}

function flushAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  persistProjectSnapshot();
}

// History is the common mutation boundary for most editor operations.
// Wrapping it keeps autosave in sync with undo/redo as well.
const originalHistoryPush = history.push.bind(history);
history.push = (action) => {
  originalHistoryPush(action);
  scheduleAutosave();
};
const originalHistoryUndo = history.undo.bind(history);
history.undo = () => {
  const action = originalHistoryUndo();
  if (action) scheduleAutosave();
  return action;
};
const originalHistoryRedo = history.redo.bind(history);
history.redo = () => {
  const action = originalHistoryRedo();
  if (action) scheduleAutosave();
  return action;
};

let activeTransformMode = 'translate';
let isVertexEditMode = false;

// Drawing & Push/Pull tools
const drawingTool = new DrawingTool(scene);
const pushPullTool = new PushPullTool(scene);
const cutTool = new CutTool(scene);
const voxelReliefTool = new VoxelReliefTool(scene);
const voxelBrushTool = new VoxelBrushTool(scene);

// Current tool mode: 'transform' | 'line' | 'rectangle' | 'push-pull' | 'cut' | 'voxel-relief' | 'voxel-brush' | 'reference'
let toolMode = 'transform';
let reliefAreaDragged = false;
let reliefDirectSnapshot = null;
let brushStrokeSnapshot = null;
let transformGestureSnapshot = null;
let vertexGestureSnapshot = null;
let reliefSelectionSnapshot = null;

function captureTransformSnapshot(objects) {
  return (objects || []).map(mesh => ({
    mesh,
    matrix: mesh.matrixWorld.clone(),
  }));
}

function restoreTransformSnapshot(snapshot) {
  for (const state of snapshot || []) {
    if (!state.mesh) continue;
    const mesh = state.mesh;
    if (state.matrix) {
      mesh.parent?.updateMatrixWorld(true);
      const parentInverse = mesh.parent
        ? mesh.parent.matrixWorld.clone().invert()
        : new THREE.Matrix4().identity();
      const localMatrix = parentInverse.multiply(state.matrix);
      localMatrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    } else {
      mesh.position.set(...state.position);
      mesh.rotation.set(...state.rotation);
      mesh.scale.set(...state.scale);
    }
    state.mesh.updateMatrixWorld(true);
    updateTextureRepeatForScale(state.mesh);
  }
  if (scene.selectedObjects.length === 1) propsPanel.updateFromTransform(scene.selectedObjects[0]);
}

function transformSnapshotsDiffer(before, after) {
  if (!before || before.length !== after.length) return true;
  return before.some((state, index) => {
    const current = after[index];
    if (state.mesh !== current.mesh) return true;
    if (state.matrix && current.matrix) {
      return state.matrix.elements.some((value, i) => value !== current.matrix.elements[i]);
    }
    return state.position.some((value, i) => value !== current.position[i])
      || state.rotation.some((value, i) => value !== current.rotation[i])
      || state.scale.some((value, i) => value !== current.scale[i]);
  });
}

function pushTransformHistory(label, before, after) {
  if (!transformSnapshotsDiffer(before, after)) return;
  history.push({
    label,
    undo: () => restoreTransformSnapshot(before),
    redo: () => restoreTransformSnapshot(after),
  });
}

function applyTextureMapping(mesh, mapping) {
  mesh.userData.uvRepeat = [...mapping.repeat];
  mesh.userData.uvOffset = [...mapping.offset];
  if (mapping.baseUV) mesh.userData.textureRepeatBaseUV = [...mapping.baseUV];
  const apply = (mat) => {
    if (!mat?.map) return;
    mat.map.wrapS = THREE.RepeatWrapping;
    mat.map.wrapT = THREE.RepeatWrapping;
    mat.map.repeat.set(...mesh.userData.uvRepeat);
    mat.map.offset.set(...mesh.userData.uvOffset);
    mat.map.needsUpdate = true;
  };
  if (Array.isArray(mesh.material)) mesh.material.forEach(apply);
  else apply(mesh.material);
}

function updateTextureRepeatForScale(mesh) {
  const userData = mesh?.userData;
  if (!userData?.textureRepeatOnScale) return;

  const baseScale = userData.textureRepeatBaseScale || [mesh.scale.x, mesh.scale.y];
  const baseUV = userData.textureRepeatBaseUV || userData.uvRepeat || [1, 1];
  const scaleRatioX = Math.abs(mesh.scale.x / (baseScale[0] || 1));
  const scaleRatioY = Math.abs(mesh.scale.y / (baseScale[1] || 1));

  applyTextureMapping(mesh, {
    repeat: [baseUV[0] * scaleRatioX, baseUV[1] * scaleRatioY],
    offset: userData.uvOffset || [0, 0],
  });
}

function restoreTextureRepeatState(mesh, state) {
  const userData = mesh.userData;
  userData.textureRepeatOnScale = !!state.enabled;
  userData.textureRepeatBaseScale = [...(state.baseScale || [mesh.scale.x, mesh.scale.y])];
  userData.textureRepeatBaseUV = [...(state.baseUV || state.repeat || userData.uvRepeat || [1, 1])];
  applyTextureMapping(mesh, {
    repeat: state.repeat || userData.uvRepeat || [1, 1],
    offset: userData.uvOffset || [0, 0],
  });
}

function cloneMaterials(material) {
  const clone = (source) => {
    const copy = source?.clone();
    if (copy?.map) copy.map = copy.map.clone();
    return copy;
  };
  return Array.isArray(material) ? material.map(clone) : clone(material);
}

function captureMeshAppearance(mesh) {
  return {
    geometry: mesh.geometry?.clone(),
    material: cloneMaterials(mesh.material),
    realUVApplied: !!mesh.userData.realUVApplied,
    uvLayoutType: mesh.userData.uvLayoutType || '',
    texture: mesh.userData.texture || null,
    textureName: mesh.userData.textureName || '',
    type: mesh.userData.type,
    extrusionDepth: mesh.userData.extrusionDepth || 0,
    textureSides: mesh.userData.textureSides !== false,
    uvRepeat: [...(mesh.userData.uvRepeat || [1, 1])],
    uvOffset: [...(mesh.userData.uvOffset || [0, 0])],
  };
}

function restoreMeshAppearance(mesh, snapshot) {
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) mesh.material.forEach(material => material?.dispose());
  else mesh.material?.dispose();
  mesh.geometry = snapshot.geometry?.clone();
  mesh.material = cloneMaterials(snapshot.material);
  mesh.userData.realUVApplied = snapshot.realUVApplied;
  mesh.userData.uvLayoutType = snapshot.uvLayoutType;
  mesh.userData.texture = snapshot.texture;
  mesh.userData.textureName = snapshot.textureName;
  mesh.userData.type = snapshot.type;
  mesh.userData.extrusionDepth = snapshot.extrusionDepth;
  mesh.userData.textureSides = snapshot.textureSides;
  mesh.userData.uvRepeat = [...snapshot.uvRepeat];
  mesh.userData.uvOffset = [...snapshot.uvOffset];
  propsPanel.showProperties(mesh);
}

function pushAppearanceHistory(mesh, label, before, after) {
  history.push({
    label,
    undo: () => restoreMeshAppearance(mesh, before),
    redo: () => restoreMeshAppearance(mesh, after),
  });
}

function pushVoxelStateHistory(mesh, label, before, after) {
  history.push({
    label,
    undo: () => {
      restoreVoxelState(mesh, before);
      QuadFactory.rebuildVoxelGeometry(mesh);
      voxelReliefTool.updateSelectionOverlay(mesh);
      propsPanel.showProperties(mesh);
      hierarchy.refresh();
    },
    redo: () => {
      restoreVoxelState(mesh, after);
      QuadFactory.rebuildVoxelGeometry(mesh);
      voxelReliefTool.updateSelectionOverlay(mesh);
      propsPanel.showProperties(mesh);
      hierarchy.refresh();
    },
  });
}

function applyExtrusionState(mesh, state) {
  QuadFactory.extrudeQuad(mesh, state.depth, state.textureSides);
  propsPanel.showProperties(mesh);
}

function restoreVoxelizedState(mesh, enabled, state) {
  if (enabled) {
    if (!mesh.userData.voxelized) QuadFactory.voxelizeSprite(mesh, mesh.userData.voxelPixelSize || 1);
    restoreVoxelState(mesh, state || {});
    QuadFactory.rebuildVoxelGeometry(mesh);
  } else if (mesh.userData.voxelized) {
    QuadFactory.devoxelizeSprite(mesh);
  }
  propsPanel.showProperties(mesh);
  voxelReliefTool.updateSelectionOverlay(mesh);
}

function voxelizeWithHistory(mesh) {
  if (!mesh || mesh.userData.voxelized || !mesh.userData.texture) return false;
  const before = cloneVoxelState(mesh);
  const wasVoxelized = !!mesh.userData.voxelized;
  QuadFactory.voxelizeSprite(mesh);
  const after = cloneVoxelState(mesh);
  history.push({
    label: 'Voxelize Sprite',
    undo: () => restoreVoxelizedState(mesh, wasVoxelized, before),
    redo: () => restoreVoxelizedState(mesh, true, after),
  });
  propsPanel.showProperties(mesh);
  return true;
}

function reliefModeLabel(mode) {
  if (mode === 'pixel') return 'Píxel';
  if (mode === 'area') return 'Área';
  return 'Varita';
}

function updateReliefFloatPanel(info = null) {
  const panel = document.getElementById('relief-float-panel');
  if (!panel) return;
  const visible = toolMode === 'voxel-relief' && propsPanel.reliefInteractionMode === 'direct';
  panel.hidden = !visible;
  if (!visible) return;

  const target = document.getElementById('relief-float-target');
  const status = document.getElementById('relief-float-status');
  if (!info) {
    if (target) target.textContent = 'Apuntá a una cara voxel';
    if (status) status.textContent = 'Hover para elegir una cara';
    return;
  }

  const { mesh, pixel, depth = 0, dragging = false } = info;
  if (target) target.textContent = mesh?.name || 'Cara voxel';
  if (status) {
    status.textContent = `${dragging ? 'Editando' : 'Cara'} · pixel ${pixel.col + 1}, ${pixel.row + 1} · profundidad ${depth}`;
  }
}

function setToolMode(mode) {
  toolMode = mode;

  // Deactivate previous modes
  drawingTool.deactivate();
  pushPullTool.deactivate();
  cutTool.deactivate();
  voxelReliefTool.deactivate();
  voxelBrushTool.deactivate();

  const viewport = document.getElementById('viewport');
  viewport.classList.remove('cursor-crosshair', 'cursor-push-pull', 'cursor-voxel-relief', 'cursor-voxel-relief-direct', 'cursor-voxel-brush');

  // Reset draw button active states
  ['btn-tool-line', 'btn-tool-rectangle', 'btn-tool-push-pull', 'btn-tool-cut', 'btn-tool-voxel-relief', 'btn-tool-voxel-brush', 'btn-tool-reference'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });

  if (mode === 'line') {
    scene.transformControls.detach();
    drawingTool.activate('line');
    viewport.classList.add('cursor-crosshair');
    document.getElementById('btn-tool-line')?.classList.add('active');
    showToast('Line Tool — click to place points, click start to close');
  } else if (mode === 'rectangle') {
    scene.transformControls.detach();
    drawingTool.activate('rectangle');
    viewport.classList.add('cursor-crosshair');
    document.getElementById('btn-tool-rectangle')?.classList.add('active');
    showToast('Rectangle Tool — click two corners to create a face');
  } else if (mode === 'push-pull') {
    scene.transformControls.detach();
    pushPullTool.activate();
    viewport.classList.add('cursor-push-pull');
    document.getElementById('btn-tool-push-pull')?.classList.add('active');
    scene.orbit.enabled = false;
    showToast('Push/Pull — hover a face and drag to extrude');
  } else if (mode === 'cut') {
    scene.transformControls.detach();
    cutTool.activate();
    viewport.classList.add('cursor-crosshair');
    document.getElementById('btn-tool-cut')?.classList.add('active');
    showToast('Cut Tool — click two points to slice meshes');
  } else if (mode === 'voxel-relief') {
    scene.transformControls.detach();
    const target = scene.selectedObjects.length === 1 && scene.selectedObjects[0].userData.voxelized
      ? scene.selectedObjects[0]
      : null;
    voxelReliefTool.activate(target);
    voxelReliefTool.setInteractionMode(propsPanel.reliefInteractionMode);
    voxelReliefTool.setSelectionMode(propsPanel.reliefSelectionMode);
    viewport.classList.add(propsPanel.reliefInteractionMode === 'direct' ? 'cursor-voxel-relief-direct' : 'cursor-voxel-relief');
    document.getElementById('btn-tool-voxel-relief')?.classList.add('active');
    scene.orbit.enabled = true;
    updateReliefFloatPanel();
    showToast(target
      ? (propsPanel.reliefInteractionMode === 'direct'
        ? 'Relieve directo — apuntá una cara y arrastrá arriba/abajo'
        : `Voxel Relief (${reliefModeLabel(propsPanel.reliefSelectionMode)}) — selecciona y usa Extract/Subtract`)
      : 'Primero convertí el sprite en vóxeles desde Ajustes');
  } else if (mode === 'voxel-brush') {
    scene.transformControls.detach();
    let target = scene.selectedObjects.length === 1 ? scene.selectedObjects[0] : null;
    if (target && !target.userData.voxelized && target.userData.texture) {
      voxelizeWithHistory(target);
    }
    target = target?.userData?.voxelized ? target : null;
    voxelBrushTool.activate(target);
    viewport.classList.add('cursor-voxel-brush');
    document.getElementById('btn-tool-voxel-brush')?.classList.add('active');
    scene.orbit.enabled = true;
    if (target) showToast('Brush activo — click y arrastrá para pintar píxeles');
    else showToast('Seleccioná un sprite voxelizado para usar el brush');
  } else if (mode === 'reference') {
    scene.transformControls.detach();
    document.getElementById('btn-tool-reference')?.classList.add('active');
    showToast('Elegí una imagen para colocarla como referencia');
  } else {
    // transform mode — re-attach gizmo to whatever is selected
    scene._updateTransformControls();
    scene.orbit.enabled = true;
  }
}

// Wire face creation from drawing tool to scene + history
drawingTool.onFaceCreated = (mesh) => {
  scene.addObject(mesh);
  scene.selectObject(mesh, false);
  hierarchy.refresh();

  history.push({
    label: 'Draw Face',
    undo: () => {
      scene.removeObject(mesh, { dispose: false });
      scene.deselectObject();
      hierarchy.refresh();
    },
    redo: () => {
      scene.addObject(mesh);
      scene.selectObject(mesh, false);
      hierarchy.refresh();
    },
  });
  showToast('Face created — use Push/Pull to extrude');
};

cutTool.onCutComplete = (results) => {
  if (!results.length) {
    showToast('Cut line did not intersect any mesh');
    return;
  }

  const originals = results.map(r => r.original);
  const pieces = results.flatMap(r => r.pieces);

  originals.forEach(m => scene.removeObject(m, { dispose: false }));
  scene.deselectObject();
  pieces.forEach(m => {
    scene.addObject(m);
    scene.selectObject(m, true);
  });
  hierarchy.refresh();

  history.push({
    label: 'Cut',
    undo: () => {
      pieces.forEach(m => scene.removeObject(m, { dispose: false }));
      scene.deselectObject();
      originals.forEach(m => scene.addObject(m));
      hierarchy.refresh();
    },
    redo: () => {
      originals.forEach(m => scene.removeObject(m, { dispose: false }));
      scene.deselectObject();
      pieces.forEach(m => {
        scene.addObject(m);
        scene.selectObject(m, true);
      });
      hierarchy.refresh();
    },
  });

  showToast(`Cut into ${pieces.length} piece${pieces.length !== 1 ? 's' : ''}`);
};

// ──────────────────────────────────────────────
//  Callbacks & Wiring
// ──────────────────────────────────────────────

// When selection changes in SceneManager → update panels
// When selection changes in SceneManager → update panels
scene.onSelectionChanged = (selection) => {
  if (selection.length === 1) {
    propsPanel.showProperties(selection[0]);
    if (toolMode === 'voxel-relief') {
      voxelReliefTool.setTargetMesh(selection[0].userData.voxelized ? selection[0] : null);
    }
    if (toolMode === 'voxel-brush') {
      voxelBrushTool.setTargetMesh(selection[0].userData.voxelized ? selection[0] : null);
    }
  } else if (selection.length > 1) {
    propsPanel.showProperties({ name: `${selection.length} objects selected`, isMulti: true });
  } else {
    propsPanel.showEmpty();
  }
  hierarchy.refresh();
  updateGroupingActions(selection);
  updateExportScopeLabel();
  updateBeginnerGuide();
};

// When transform gizmo moves an object → update property inputs
// When transform gizmo moves an object → update property inputs
scene.onTransformStart = () => {
  if (isVertexEditMode && vertexEditor.activeMesh) {
    vertexGestureSnapshot = vertexEditor.captureGeometryState(vertexEditor.activeMesh);
    return;
  }
  transformGestureSnapshot = captureTransformSnapshot(scene.selectedObjects);
};

scene.onTransformEnd = () => {
  if (isVertexEditMode && vertexGestureSnapshot) {
    const before = vertexGestureSnapshot;
    const after = vertexEditor.captureGeometryState(before.mesh);
    const changed = before.positions.some((value, index) => value !== after.positions[index]);
    if (changed) {
      history.push({
        label: 'Edit Vertices',
        undo: () => vertexEditor.restoreGeometryState(before),
        redo: () => vertexEditor.restoreGeometryState(after),
      });
    }
    vertexGestureSnapshot = null;
    return;
  }

  if (transformGestureSnapshot) {
    pushTransformHistory(
      `${activeTransformMode[0].toUpperCase()}${activeTransformMode.slice(1)} Object`,
      transformGestureSnapshot,
      captureTransformSnapshot(scene.selectedObjects),
    );
    transformGestureSnapshot = null;
  }
};

scene.onObjectChanged = () => {
  scene.selectedObjects.forEach(updateTextureRepeatForScale);
  if (scene.selectedObjects.length === 1 && !isVertexEditMode) {
    propsPanel.updateFromTransform(scene.selectedObjects[0]);
  }
  scheduleAutosave();
};

// When transform gizmo moves a vertex control point
scene.onVertexChanged = (controlPoint) => {
  vertexEditor.updateMeshGeometry(controlPoint);
};

// When user clicks an asset thumbnail → just highlights it
assetPanel.onAssetSelected = (asset) => {
  if (toolMode === 'reference') {
    placeReferenceImage(asset);
    assetPanel.clearSelection();
    setToolMode('transform');
    showToast(`Referencia "${asset.name}" colocada`);
  }
};

assetPanel.onModelSelected = async (asset) => {
  const rect = canvas.getBoundingClientRect();
  const worldPos = scene.getWorldPositionFromScreen(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  await placeModelAsset(asset, worldPos);
};

assetPanel.onAssetsChanged = () => scheduleAutosave();

// Importing from the beginner entry point is intentionally one-step: once a
// PNG is loaded, place it in the center and make it ready to edit.
assetPanel.onAssetsImported = (assets) => {
  const rect = canvas.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  if (assets.length === 1) {
    placeAsset(assets[0], centerX, centerY);
  } else {
    placeAssetsGrid(assets, centerX, centerY);
  }

  assetPanel.clearSelection();
  updateBeginnerGuide();
};

assetPanel.onModelFilesImported = async (files) => {
  const rect = canvas.getBoundingClientRect();
  const worldPos = scene.getWorldPositionFromScreen(
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  for (const file of files) {
    await import3DFile(file, worldPos);
  }
};

// Duplicate/delete from properties panel
propsPanel.onDuplicate = (mesh) => duplicateSelected();
propsPanel.onDelete = () => deleteSelected({ forceObjects: true });

propsPanel.onPropertyChanged = (mesh, change) => {
  if (change.kind === 'transform') {
    const scaleChanged = change.before.scale.some((value, index) => value !== change.after.scale[index]);
    if (scaleChanged && scene.snapEnabled && scene.scaleSnapEnabled) {
      scene.snapObjectScaleToGrid(mesh);
      scene.snapObjectToGrid(mesh);
    }

    const after = scaleChanged && scene.snapEnabled && scene.scaleSnapEnabled
      ? {
          position: [mesh.position.x, mesh.position.y, mesh.position.z],
          rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
          scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
        }
      : change.after;
    updateTextureRepeatForScale(mesh);
    propsPanel.updateFromTransform(mesh);
    pushTransformHistory('Transform Object', [{ mesh, ...change.before }], [{ mesh, ...after }]);
  } else if (change.kind === 'name') {
    history.push({
      label: 'Rename Object',
      undo: () => { mesh.name = change.before; hierarchy.refresh(); propsPanel.showProperties(mesh); },
      redo: () => { mesh.name = change.after; hierarchy.refresh(); propsPanel.showProperties(mesh); },
    });
  } else if (change.kind === 'extrusion') {
    history.push({
      label: 'Extrusion',
      undo: () => applyExtrusionState(mesh, change.before),
      redo: () => applyExtrusionState(mesh, change.after),
    });
  } else if (change.kind === 'mapping') {
    history.push({
      label: 'Texture Mapping',
      undo: () => { applyTextureMapping(mesh, change.before); propsPanel.showProperties(mesh); },
      redo: () => { applyTextureMapping(mesh, change.after); propsPanel.showProperties(mesh); },
    });
  } else if (change.kind === 'repeat-scale') {
    history.push({
      label: 'Texture Scale Mode',
      undo: () => { restoreTextureRepeatState(mesh, change.before); propsPanel.showProperties(mesh); },
      redo: () => { restoreTextureRepeatState(mesh, change.after); propsPanel.showProperties(mesh); },
    });
  }
};

propsPanel.onVoxelizeChanged = (mesh, enabled, wasVoxelized, beforeState) => {
  const afterState = cloneVoxelState(mesh);
  history.push({
    label: enabled ? 'Voxelize Sprite' : 'Devoxelize Sprite',
    undo: () => restoreVoxelizedState(mesh, wasVoxelized, beforeState),
    redo: () => restoreVoxelizedState(mesh, enabled, afterState),
  });
  hierarchy.refresh();
};

function applyReliefDepthWithHistory(mesh, delta) {
  const prev = cloneVoxelState(mesh);
  voxelReliefTool.setTargetMesh(mesh);
  const result = delta >= 0
    ? voxelReliefTool.applyExtract(mesh)
    : voxelReliefTool.applySubtract(mesh);
  if (!result) {
    showToast('Seleccioná una cara o píxeles antes de aplicar profundidad');
    return;
  }
  const after = cloneVoxelState(mesh);
  voxelReliefTool.updateSelectionOverlay(mesh);
  history.push({
    label: delta >= 0 ? 'Voxel Extract' : 'Voxel Subtract',
    undo: () => {
      restoreVoxelState(mesh, prev);
      QuadFactory.rebuildVoxelGeometry(mesh);
      voxelReliefTool.updateSelectionOverlay(mesh);
      propsPanel.updateReliefSelectionCount(countMask(mesh.userData.voxelSelection || []));
    },
    redo: () => {
      restoreVoxelState(mesh, after);
      QuadFactory.rebuildVoxelGeometry(mesh);
      voxelReliefTool.updateSelectionOverlay(mesh);
    },
  });
  showToast(`${delta >= 0 ? 'Extraído' : 'Sustraído'} ${Math.abs(result.delta)} capa${Math.abs(result.delta) !== 1 ? 's' : ''}`);
}

propsPanel.onReliefExtract = (mesh) => applyReliefDepthWithHistory(mesh, voxelReliefTool.depthStep);
propsPanel.onReliefSubtract = (mesh) => applyReliefDepthWithHistory(mesh, -voxelReliefTool.depthStep);

function uniqueSceneObjectName(baseName) {
  const usedNames = new Set([
    ...scene.objects.map(object => object.name),
    ...scene.groups.map(group => group.name),
  ]);
  if (!usedNames.has(baseName)) return baseName;
  let suffix = 2;
  while (usedNames.has(`${baseName} ${suffix}`)) suffix += 1;
  return `${baseName} ${suffix}`;
}

function separateVoxelSelection(mesh) {
  if (!mesh?.userData?.voxelized) return;
  const before = cloneVoxelState(mesh);
  mesh.updateWorldMatrix(true, false);
  const originalWorld = mesh.matrixWorld.clone();
  const result = QuadFactory.splitVoxelSelection(
    mesh,
    uniqueSceneObjectName(`${mesh.name || 'Voxel'} - Pieza`),
  );
  if (!result) {
    showToast('Seleccioná uno o más vóxeles antes de separar la pieza');
    return;
  }

  const { piece, movedCount, localPivotDelta } = result;
  const pieceWorld = originalWorld.clone().multiply(
    new THREE.Matrix4().makeTranslation(
      localPivotDelta.x,
      localPivotDelta.y,
      localPivotDelta.z,
    ),
  );
  scene.addObject(piece);
  scene.exportGroup.updateWorldMatrix(true, false);
  const pieceLocal = scene.exportGroup.matrixWorld.clone().invert().multiply(pieceWorld);
  pieceLocal.decompose(piece.position, piece.quaternion, piece.scale);
  piece.updateMatrixWorld(true);

  const after = cloneVoxelState(mesh);
  scene.selectObject(piece, false);
  hierarchy.refresh();

  const restoreOriginal = (state) => {
    restoreVoxelState(mesh, state);
    QuadFactory.rebuildVoxelGeometry(mesh);
  };

  history.push({
    label: 'Separate Voxel Selection',
    undo: () => {
      scene.removeObject(piece, { dispose: false });
      restoreOriginal(before);
      scene.selectObject(mesh, false);
      voxelReliefTool.updateSelectionOverlay(mesh);
      hierarchy.refresh();
    },
    redo: () => {
      restoreOriginal(after);
      restoreObjectFromHistory(piece);
      scene.selectObject(piece, false);
      voxelReliefTool.updateSelectionOverlay(piece);
      hierarchy.refresh();
    },
  });

  showToast(`${movedCount} vóxel${movedCount !== 1 ? 'es' : ''} separado${movedCount !== 1 ? 's' : ''} en "${piece.name}"`);
}

function deleteVoxelSelection(mesh) {
  if (!mesh?.userData?.voxelized) return;
  const width = mesh.userData.voxelImageWidth;
  const height = mesh.userData.voxelImageHeight;
  const result = splitVoxelStateBySelection({
    active: mesh.userData.voxelActiveMap,
    selection: mesh.userData.voxelSelection,
    depthMap: mesh.userData.voxelDepthMap,
    colors: mesh.userData.voxelColorMap,
    width,
    height,
  });
  if (!result) {
    showToast('No hay vóxeles seleccionados para borrar');
    return;
  }

  const before = cloneVoxelState(mesh);
  restoreVoxelState(mesh, result.remaining);
  QuadFactory.rebuildVoxelGeometry(mesh);
  voxelReliefTool.updateSelectionOverlay(mesh);
  const after = cloneVoxelState(mesh);
  pushVoxelStateHistory(mesh, 'Delete Selected Voxels', before, after);
  propsPanel.showProperties(mesh);
  hierarchy.refresh();
  showToast(`${result.movedCount} vóxel${result.movedCount !== 1 ? 'es' : ''} borrado${result.movedCount !== 1 ? 's' : ''}`);
}

propsPanel.onReliefSeparate = (mesh) => separateVoxelSelection(mesh);

propsPanel.onReliefClearSelection = (mesh) => {
  const before = cloneVoxelState(mesh);
  voxelReliefTool.clearSelection(mesh);
  const after = cloneVoxelState(mesh);
  pushVoxelStateHistory(mesh, 'Clear Voxel Selection', before, after);
  propsPanel.updateReliefSelectionCount(0);
  hierarchy.refresh();
};

propsPanel.onReliefToleranceChanged = (value) => {
  voxelReliefTool.setTolerance(value);
};

propsPanel.onReliefDepthStepChanged = (value) => {
  voxelReliefTool.setDepthStep(value);
};

propsPanel.onReliefActivateTool = () => {
  setToolMode('voxel-relief');
};

propsPanel.onReliefInteractionModeChanged = (mode) => {
  voxelReliefTool.setInteractionMode(mode);
  const viewport = document.getElementById('viewport');
  viewport?.classList.toggle('cursor-voxel-relief-direct', mode === 'direct' && toolMode === 'voxel-relief');
  viewport?.classList.toggle('cursor-voxel-relief', mode === 'select' && toolMode === 'voxel-relief');
  updateReliefFloatPanel();
  if (toolMode === 'voxel-relief') {
    showToast(mode === 'direct'
      ? 'Relieve directo: arrastrá una cara para extraer o sustraer'
      : 'Selección avanzada: elegí Varita, Píxel o Área');
  }
};

propsPanel.onReliefSelectionModeChanged = (mode) => {
  voxelReliefTool.setSelectionMode(mode);
  if (toolMode === 'voxel-relief') {
    showToast(`Modo selección: ${reliefModeLabel(mode)}`);
  }
};

propsPanel.onBrushActivateTool = (mesh) => {
  scene.selectObject(mesh, false);
  setToolMode('voxel-brush');
};

propsPanel.onBrushSizeChanged = (value) => voxelBrushTool.setBrushSize(value);
propsPanel.onBrushColorChanged = (value) => voxelBrushTool.setColor(value);
propsPanel.onBrushModeChanged = (mode) => voxelBrushTool.setMode(mode);

function captureVoxelHeightSnapshot(mesh) {
  return {
    ...cloneVoxelState(mesh),
    source: mesh.userData.voxelHeightmapSource ?? null,
    name: mesh.userData.voxelHeightmapName ?? null,
    image: mesh.userData.voxelHeightmapImage ?? null,
    max: mesh.userData.voxelHeightMax ?? 8,
    invert: !!mesh.userData.voxelHeightInvert,
  };
}

function restoreVoxelHeightSnapshot(mesh, snap) {
  restoreVoxelState(mesh, snap);
  mesh.userData.voxelHeightmapSource = snap.source;
  mesh.userData.voxelHeightmapName = snap.name;
  mesh.userData.voxelHeightmapImage = snap.image;
  mesh.userData.voxelHeightMax = snap.max;
  mesh.userData.voxelHeightInvert = snap.invert;
  if (mesh.userData.voxelized) QuadFactory.rebuildVoxelGeometry(mesh);
  voxelReliefTool.updateSelectionOverlay(mesh);
  propsPanel.showProperties(mesh);
}

function reapplyVoxelHeight(mesh, params) {
  if (params.type === 'luminance') {
    QuadFactory.applyHeightmapFromLuminance(mesh, {
      maxDepth: params.maxDepth,
      invert: params.invert,
    });
  } else if (params.type === 'file' && params.image) {
    QuadFactory.applyHeightmap(mesh, params.image, {
      maxDepth: params.maxDepth,
      invert: params.invert,
      sourceName: params.sourceName,
    });
  } else if (params.type === 'clear') {
    QuadFactory.clearVoxelDepth(mesh);
  }
  voxelReliefTool.updateSelectionOverlay(mesh);
  propsPanel.showProperties(mesh);
}

function pushVoxelHeightHistory(mesh, label, snap, params) {
  history.push({
    label,
    undo: () => restoreVoxelHeightSnapshot(mesh, snap),
    redo: () => reapplyVoxelHeight(mesh, params),
  });
}

propsPanel.onReliefApplyLuminance = (mesh) => {
  if (!mesh.userData.voxelized) {
    showToast('Voxeliza el sprite primero');
    return;
  }
  const maxDepth = mesh.userData.voxelHeightMax ?? 8;
  const invert = !!mesh.userData.voxelHeightInvert;
  const snap = captureVoxelHeightSnapshot(mesh);
  const params = { type: 'luminance', maxDepth, invert };

  QuadFactory.applyHeightmapFromLuminance(mesh, params);
  voxelReliefTool.updateSelectionOverlay(mesh);
  pushVoxelHeightHistory(mesh, 'Heightmap Luminance', snap, params);
  propsPanel.showProperties(mesh);
  showToast('Volumen aplicado desde luminancia del sprite');
};

propsPanel.onReliefLoadHeightmap = (mesh) => {
  if (!mesh.userData.voxelized) {
    showToast('Voxeliza el sprite primero');
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      const maxDepth = mesh.userData.voxelHeightMax ?? 8;
      const invert = !!mesh.userData.voxelHeightInvert;
      const snap = captureVoxelHeightSnapshot(mesh);
      const params = {
        type: 'file',
        maxDepth,
        invert,
        image: img,
        sourceName: file.name,
      };

      QuadFactory.applyHeightmap(mesh, img, {
        maxDepth,
        invert,
        sourceName: file.name,
      });
      voxelReliefTool.updateSelectionOverlay(mesh);
      pushVoxelHeightHistory(mesh, 'Load Heightmap', snap, params);
      propsPanel.showProperties(mesh);
      showToast(`Heightmap "${file.name}" aplicado`);
    } catch (err) {
      showToast(`Error al cargar heightmap: ${err.message}`);
    }
  };
  input.click();
};

propsPanel.onReliefClearHeightmap = (mesh) => {
  if (!mesh.userData.voxelized) return;
  const snap = captureVoxelHeightSnapshot(mesh);
  const params = { type: 'clear' };
  QuadFactory.clearVoxelDepth(mesh);
  voxelReliefTool.updateSelectionOverlay(mesh);
  pushVoxelHeightHistory(mesh, 'Clear Heightmap', snap, params);
  propsPanel.showProperties(mesh);
  showToast('Volumen eliminado');
};

propsPanel.onReliefHeightSettingsChanged = (mesh, { maxDepth, invert }, { recordHistory = false } = {}) => {
  if (!mesh.userData.voxelized) return;
  if (!mesh.userData.voxelHeightmapSource && !mesh.userData.voxelHeightmapImage) return;

  if (recordHistory) {
    const snap = captureVoxelHeightSnapshot(mesh);
    const params = mesh.userData.voxelHeightmapSource === 'luminance'
      ? { type: 'luminance', maxDepth, invert }
      : {
          type: 'file',
          maxDepth,
          invert,
          image: mesh.userData.voxelHeightmapImage,
          sourceName: mesh.userData.voxelHeightmapName,
        };
    mesh.userData.voxelHeightMax = maxDepth;
    mesh.userData.voxelHeightInvert = invert;
    QuadFactory.reapplyHeightmap(mesh);
    voxelReliefTool.updateSelectionOverlay(mesh);
    pushVoxelHeightHistory(mesh, 'Heightmap Settings', snap, params);
    return;
  }

  mesh.userData.voxelHeightMax = maxDepth;
  mesh.userData.voxelHeightInvert = invert;
  QuadFactory.reapplyHeightmap(mesh);
  voxelReliefTool.updateSelectionOverlay(mesh);
  scheduleAutosave();
};

// Apply texture from properties panel
propsPanel.onApplyTexture = async (mesh) => {
  const asset = assetPanel.selectedAsset;
  if (!asset) {
    showToast('Select an asset in the left panel first!');
    return;
  }

  const before = captureMeshAppearance(mesh);

  // Clone texture so each object has its own material
  const tex = asset.texture.clone();
  tex.needsUpdate = true;

  try {
    // Keep same behavior as context menu "Load Custom Texture":
    // ensure real UVs before applying texture.
    await UVExporter.applyRealUVToMesh(mesh);
  } catch (unwrapErr) {
    showToast(`Failed to prepare UVs on ${mesh.name}: ${unwrapErr.message}`);
    return;
  }

  UVExporter.applyAtlas(mesh, tex);
  mesh.userData.texture = tex;
  mesh.userData.textureName = asset.name;
  const after = captureMeshAppearance(mesh);

  // Re-render properties to update the apply texture button state
  propsPanel.showProperties(mesh);
  showToast(`Applied texture "${asset.name}" to ${mesh.name}`);

  pushAppearanceHistory(mesh, 'Apply Texture', before, after);
};

// Scene hierarchy selection
hierarchy.onSelect = (obj) => {
  propsPanel.showProperties(obj);
};

hierarchy.onDelete = (obj) => {
  if (!scene.selectedObjects.includes(obj)) scene.selectObject(obj, false);
  deleteSelected({ forceObjects: true });
};

hierarchy.onSelectVoxels = (mesh) => {
  propsPanel.reliefInteractionMode = 'select';
  voxelReliefTool.setInteractionMode('select');
  scene.selectObject(mesh, false);
  propsPanel.showProperties(mesh);
  setToolMode('voxel-relief');
};

hierarchy.onDeleteVoxels = (mesh) => deleteVoxelSelection(mesh);

function selectHierarchyItems(items) {
  scene.deselectObject();
  const focusedItem = items[items.length - 1];
  if (focusedItem) scene.selectObject(focusedItem, false);
}

function restoreHierarchyParents(states) {
  scene.deselectObject();
  states.forEach(({ item, parent }) => {
    (parent || scene.exportGroup).attach(item);
  });
  selectHierarchyItems(states.map(state => state.item));
  hierarchy.refresh();
}

function moveHierarchyItems(items, targetGroup = null) {
  const movable = [...new Set(items)].filter(item => item && !item.userData?.isSceneGroup);
  if (movable.length === 0) return;

  scene.deselectObject();
  const destination = targetGroup || scene.exportGroup;
  const states = movable.map(item => ({ item, parent: item.parent }));
  if (states.every(({ parent }) => parent === destination)) return;

  movable.forEach(item => destination.attach(item));
  selectHierarchyItems(movable);
  hierarchy.refresh();

  history.push({
    label: targetGroup ? 'Move Into Group' : 'Remove From Group',
    undo: () => restoreHierarchyParents(states),
    redo: () => {
      scene.deselectObject();
      movable.forEach(item => destination.attach(item));
      selectHierarchyItems(movable);
      hierarchy.refresh();
    },
  });
  showToast(targetGroup
    ? `${movable.length} pieza${movable.length !== 1 ? 's' : ''} movida${movable.length !== 1 ? 's' : ''} a "${targetGroup.name}"`
    : `${movable.length} pieza${movable.length !== 1 ? 's' : ''} fuera del grupo`);
}

function createGroupFromDrop(items, target) {
  const members = [...new Set([...items, target])].filter(item => item && !item.userData?.isSceneGroup);
  if (members.length < 2) return;

  scene.deselectObject();
  const previousParents = members.map(item => ({ item, parent: item.parent }));
  const group = scene.createGroup(`Grupo ${scene.groups.length + 1}`, members);
  group.userData._expanded = true;
  scene.selectObject(group, false);
  hierarchy.refresh();

  history.push({
    label: 'Group by Drag and Drop',
    undo: () => {
      scene.deselectObject();
      previousParents.forEach(({ item, parent }) => (parent || scene.exportGroup).attach(item));
      scene.exportGroup.remove(group);
      const index = scene.groups.indexOf(group);
      if (index >= 0) scene.groups.splice(index, 1);
      selectHierarchyItems(members);
      hierarchy.refresh();
    },
    redo: () => {
      scene.deselectObject();
      scene.restoreGroup(group, members);
      scene.selectObject(group, false);
      hierarchy.refresh();
    },
  });
  showToast(`Grupo creado con ${members.length} piezas`);
}

hierarchy.onDropCreateGroup = (items, target) => createGroupFromDrop(items, target);
hierarchy.onDropToGroup = (items, group) => moveHierarchyItems(items, group);
hierarchy.onDropToRoot = (items) => moveHierarchyItems(items, null);

// ──────────────────────────────────────────────
//  Canvas Click → Place or Select
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
//  Canvas Mouse Events for Drawing & Push/Pull
// ──────────────────────────────────────────────

canvas.addEventListener('mousemove', (e) => {
  if (toolMode === 'line' || toolMode === 'rectangle') {
    const worldPos = scene.getWorldPositionFromScreen(e.clientX, e.clientY);
    if (worldPos) drawingTool.onMouseMove(worldPos);
  } else if (toolMode === 'cut') {
    cutTool.onMouseMove(e.clientX, e.clientY);
  } else if (toolMode === 'push-pull') {
    pushPullTool.onMouseMove(e.clientX, e.clientY);
    const viewport = document.getElementById('viewport');
    viewport.classList.toggle('cursor-push-pull-active', !!pushPullTool._hoveredData);
  } else if (toolMode === 'voxel-relief') {
    const reliefHover = voxelReliefTool.onMouseMove(e.clientX, e.clientY);
    if (propsPanel.reliefInteractionMode === 'direct') {
      updateReliefFloatPanel(reliefHover?.mesh ? reliefHover : null);
    }
  } else if (toolMode === 'voxel-brush') {
    voxelBrushTool.onMouseMove(e.clientX, e.clientY);
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (toolMode === 'push-pull' && e.button === 0) {
    pushPullTool.onMouseDown(e.clientX, e.clientY);
  } else if (toolMode === 'voxel-relief' && e.button === 0 && propsPanel.reliefInteractionMode === 'direct') {
    const picked = voxelReliefTool.pickFace(e.clientX, e.clientY);
    const before = picked?.mesh ? cloneVoxelState(picked.mesh) : null;
    const candidate = voxelReliefTool.onMouseDown(e.clientX, e.clientY, { shiftKey: e.shiftKey });
    if (candidate) {
      reliefDirectSnapshot = before;
    }
  } else if (toolMode === 'voxel-relief' && e.button === 0 && voxelReliefTool.selectionMode === 'area') {
    reliefAreaDragged = false;
    const candidate = scene.pickObject(e.clientX, e.clientY);
    reliefSelectionSnapshot = candidate?.userData?.voxelized ? cloneVoxelState(candidate) : null;
    if (voxelReliefTool.onMouseDown(e.clientX, e.clientY, { shiftKey: e.shiftKey })) {
      reliefAreaDragged = true;
    }
  } else if (toolMode === 'voxel-brush' && e.button === 0) {
    if (!voxelBrushTool.targetMesh) {
      const picked = scene.pickObject(e.clientX, e.clientY);
      if (picked?.userData?.texture) {
        if (!picked.userData.voxelized) voxelizeWithHistory(picked);
        scene.selectObject(picked, false);
        scene.transformControls.detach();
        voxelBrushTool.setTargetMesh(picked);
        propsPanel.showProperties(picked);
      }
    }
    const target = voxelBrushTool.targetMesh;
    brushStrokeSnapshot = target ? cloneVoxelState(target) : null;
    if (!voxelBrushTool.onMouseDown(e.clientX, e.clientY, { erase: e.shiftKey })) {
      brushStrokeSnapshot = null;
    }
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (toolMode === 'push-pull' && e.button === 0) {
    const result = pushPullTool.onMouseUp();
    if (result) {
      const { mesh, prevDepth, newDepth, faceNormal, materialIndex } = result;
      history.push({
        label: 'Push/Pull',
        undo: () => pushPullTool._applyExtrusion(mesh, faceNormal, materialIndex, prevDepth),
        redo: () => pushPullTool._applyExtrusion(mesh, faceNormal, materialIndex, newDepth),
      });
    }
  } else if (toolMode === 'voxel-relief' && e.button === 0 && propsPanel.reliefInteractionMode === 'direct') {
    const result = voxelReliefTool.onMouseUp(e.clientX, e.clientY);
    if (result) {
      const mesh = result.mesh;
      scene.selectObject(mesh, false);
      propsPanel.updateReliefSelectionCount(countMask(mesh.userData.voxelSelection || []));
      const after = cloneVoxelState(mesh);
      if (reliefDirectSnapshot) {
        history.push({
          label: result.changedDepth ? 'Voxel Direct Relief' : 'Select Voxel Face',
          undo: () => {
            restoreVoxelState(mesh, reliefDirectSnapshot);
            QuadFactory.rebuildVoxelGeometry(mesh);
            voxelReliefTool.updateSelectionOverlay(mesh);
            propsPanel.showProperties(mesh);
          },
          redo: () => {
            restoreVoxelState(mesh, after);
            QuadFactory.rebuildVoxelGeometry(mesh);
            voxelReliefTool.updateSelectionOverlay(mesh);
            propsPanel.showProperties(mesh);
          },
        });
      }
      updateReliefFloatPanel({
        mesh,
        pixel: result.pixel,
        depth: result.newDepth,
        dragging: false,
      });
      if (result.changedDepth) {
        const delta = result.newDepth - result.prevDepth;
        showToast(`${delta >= 0 ? 'Extraído' : 'Sustraído'} ${Math.abs(delta)} capa${Math.abs(delta) !== 1 ? 's' : ''}`);
      }
    }
    hierarchy.refresh();
    reliefDirectSnapshot = null;
  } else if (toolMode === 'voxel-relief' && e.button === 0 && voxelReliefTool.selectionMode === 'area') {
    const result = voxelReliefTool.onMouseUp(e.clientX, e.clientY);
    if (result) {
      scene.selectObject(result.mesh, false);
      propsPanel.updateReliefSelectionCount(result.selectedCount);
      if (reliefSelectionSnapshot) {
        pushVoxelStateHistory(result.mesh, 'Voxel Area Selection', reliefSelectionSnapshot, cloneVoxelState(result.mesh));
      }
      reliefSelectionSnapshot = null;
      showToast(`Selected ${result.selectedCount} pixel${result.selectedCount !== 1 ? 's' : ''} (area)`);
      hierarchy.refresh();
    } else {
      reliefSelectionSnapshot = null;
    }
  } else if (toolMode === 'voxel-brush' && e.button === 0) {
    const result = voxelBrushTool.onMouseUp();
    if (result && brushStrokeSnapshot) {
      const mesh = result.mesh;
      const after = cloneVoxelState(mesh);
      history.push({
        label: 'Pixel Brush',
        undo: () => {
          restoreVoxelState(mesh, brushStrokeSnapshot);
          QuadFactory.rebuildVoxelGeometry(mesh);
          propsPanel.showProperties(mesh);
        },
        redo: () => {
          restoreVoxelState(mesh, after);
          QuadFactory.rebuildVoxelGeometry(mesh);
          propsPanel.showProperties(mesh);
        },
      });
      propsPanel.showProperties(mesh);
      hierarchy.refresh();
      showToast(`${result.changedCount} pixel${result.changedCount !== 1 ? 'es' : ''} actualizado${result.changedCount !== 1 ? 's' : ''}`);
    }
    brushStrokeSnapshot = null;
  }
});

canvas.addEventListener('click', (e) => {
  // Don't interfere with transform gizmo
  if (scene.transformControls.dragging) return;

  // Route to drawing tools
  if (toolMode === 'line' || toolMode === 'rectangle') {
    const worldPos = scene.getWorldPositionFromScreen(e.clientX, e.clientY);
    if (worldPos) drawingTool.onClick(worldPos);
    return;
  }

  if (toolMode === 'push-pull') return; // handled by mousedown/up

  if (toolMode === 'voxel-brush') return; // handled by mousedown/up

  if (toolMode === 'cut') {
    cutTool.onClick(e.clientX, e.clientY);
    return;
  }

  if (toolMode === 'voxel-relief') {
    if (propsPanel.reliefInteractionMode === 'direct') return;
    if (voxelReliefTool.selectionMode === 'area') return;
    if (reliefAreaDragged) {
      reliefAreaDragged = false;
      return;
    }
    const candidate = scene.pickObject(e.clientX, e.clientY);
    const beforeSelection = candidate?.userData?.voxelized ? cloneVoxelState(candidate) : null;
    const result = voxelReliefTool.onClick(e.clientX, e.clientY, {
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    });
    if (result) {
      scene.selectObject(result.mesh, false);
      propsPanel.updateReliefSelectionCount(result.selectedCount);
      if (beforeSelection) {
        pushVoxelStateHistory(result.mesh, 'Voxel Selection', beforeSelection, cloneVoxelState(result.mesh));
      }
      const mode = reliefModeLabel(voxelReliefTool.selectionMode);
      showToast(`${mode}: ${result.selectedCount} pixel${result.selectedCount !== 1 ? 's' : ''} selected`);
      hierarchy.refresh();
    } else {
      showToast('Click a voxelized sprite to select pixels');
    }
    return;
  }

  if (isVertexEditMode) {
    const picked = scene.pickObject(e.clientX, e.clientY, vertexEditor.controlPoints);
    if (picked) {
      scene.transformControls.attach(picked);
    } else {
      scene.transformControls.detach();
    }
    return;
  }

  const picked = scene.pickObject(e.clientX, e.clientY);

  if (picked) {
    const additive = e.shiftKey;
    scene.selectObject(picked, additive);
  } else {
    const selectedAssets = assetPanel.selectedAssets;

    // Prioritize deselecting current 3D objects if anything is selected
    if (scene.selectedObjects.length > 0) {
      scene.deselectObject();
      propsPanel.showEmpty();
      hierarchy.refresh();
    }
    // If nothing 3D is selected and we have active assets, place them
    else if (selectedAssets && selectedAssets.length > 0) {
      if (selectedAssets.length === 1) {
        placeAsset(selectedAssets[0], e.clientX, e.clientY);
      } else {
        placeAssetsGrid(selectedAssets, e.clientX, e.clientY);
      }
      assetPanel.clearSelection(); // Prevent multiple accidental placements
    }
    // Otherwise just deselect/clear
    else {
      scene.deselectObject();
      propsPanel.showEmpty();
      hierarchy.refresh();
    }
  }
});

// ──────────────────────────────────────────────
//  Canvas Drag & Drop (from asset panel)
// ──────────────────────────────────────────────

const canvasContainer = document.getElementById('canvas-container');

canvasContainer.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

canvasContainer.addEventListener('drop', async (e) => {
  e.preventDefault();
  const modelIndex = e.dataTransfer.getData('application/x-spriteforge-model');
  if (modelIndex !== '') {
    const modelAsset = assetPanel.getModelAssetByIndex(parseInt(modelIndex, 10));
    if (modelAsset) {
      const worldPos = scene.getWorldPositionFromScreen(e.clientX, e.clientY);
      await placeModelAsset(modelAsset, worldPos);
    }
    return;
  }

  const idxStr = e.dataTransfer.getData('text/plain');
  const idx = parseInt(idxStr, 10);
  if (isNaN(idx)) return;

  const asset = assetPanel.getAssetByIndex(idx);
  if (asset) {
    placeAsset(asset, e.clientX, e.clientY);
  }
});

// ──────────────────────────────────────────────
//  Also allow dropping PNGs directly on canvas
// ──────────────────────────────────────────────

canvasContainer.addEventListener('drop', async (e) => {
  if (e.dataTransfer.files.length > 0) {
    const droppedFiles = [...e.dataTransfer.files];
    const voxelFiles = droppedFiles.filter(file =>
      file.type === 'application/json' || file.name.toLowerCase().endsWith('.json')
    );
    const modelFiles = droppedFiles.filter(file => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      return MODEL_EXTENSIONS.includes(extension);
    });
    const files = droppedFiles.filter(f => f.type === 'image/png');

    if (voxelFiles.length > 0) {
      const worldPos = scene.getWorldPositionFromScreen(e.clientX, e.clientY);
      let offsetX = 0;
      for (const file of voxelFiles) {
        const mesh = await importVoxelFile(file, worldPos
          ? { x: worldPos.x + offsetX, y: 0, z: worldPos.z }
          : null);
        if (mesh) offsetX += mesh.userData.originalWidth + 1;
      }
    }

    if (modelFiles.length > 0) {
      const worldPos = scene.getWorldPositionFromScreen(e.clientX, e.clientY);
      for (const file of modelFiles) {
        await import3DFile(file, worldPos
          ? { x: worldPos.x, y: worldPos.y, z: worldPos.z }
          : null);
      }
    }

    if (files.length === 0) return;

    const loadedAssets = await Promise.all(files.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            const texture = new THREE.Texture(img);
            texture.needsUpdate = true;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestMipMapLinearFilter;

            const name = file.name.replace('.png', '');
            const asset = { name, texture, image: img, dataUrl: ev.target.result };
            resolve(asset);
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      });
    }));

    if (loadedAssets.length > 0) {
      if (loadedAssets.length === 1) {
        placeAsset(loadedAssets[0], e.clientX, e.clientY);
      } else {
        placeAssetsGrid(loadedAssets, e.clientX, e.clientY);
      }
    }
  }
}, true);

// ──────────────────────────────────────────────
//  Place Asset
// ──────────────────────────────────────────────

function snapPlacedMesh(mesh) {
  if (scene.snapEnabled) scene.snapObjectToGrid(mesh);
  if (scene.assetSnapEnabled) scene.snapObjectToAssets(mesh);
}

function placeAsset(asset, clientX, clientY) {
  // Clone the texture so each quad has its own material
  const tex = asset.texture.clone();
  tex.needsUpdate = true;

  const segInput = document.getElementById('input-segments');
  const segments = segInput ? Math.max(1, Math.min(16, parseInt(segInput.value, 10) || 1)) : 1;

  const mesh = QuadFactory.createQuad(tex, asset.name, 1, segments);

  // Raycast to find world position on ground
  const worldPos = scene.getWorldPositionFromScreen(clientX, clientY);
  if (worldPos) {
    mesh.position.set(worldPos.x, 0, worldPos.z);
  }

  scene.addObject(mesh);
  if (worldPos) snapPlacedMesh(mesh);
  scene.selectObject(mesh, false);
  hierarchy.refresh();

  // Record in history
  history.push({
    label: `Create ${mesh.name}`,
    undo: () => {
      scene.removeObject(mesh, { dispose: false });
      hierarchy.refresh();
    },
    redo: () => {
      scene.addObject(mesh);
      hierarchy.refresh();
    }
  });

  showToast(`Created "${mesh.name}"`);
}

function placeAssetsGrid(assets, clientX, clientY) {
  if (!assets || assets.length === 0) return;
  if (assets.length === 1) {
    placeAsset(assets[0], clientX, clientY);
    return;
  }

  const worldPos = scene.getWorldPositionFromScreen(clientX, clientY);
  if (!worldPos) return;

  const segInput = document.getElementById('input-segments');
  const segments = segInput ? Math.max(1, Math.min(16, parseInt(segInput.value, 10) || 1)) : 1;

  const count = assets.length;
  const cols = Math.ceil(Math.sqrt(count));
  const spacing = scene.snapEnabled ? scene.snapSize : 1;

  // Center the grid around the clicked position
  const startX = worldPos.x - ((cols - 1) * spacing) / 2;
  const startZ = worldPos.z - ((Math.ceil(count / cols) - 1) * spacing) / 2;

  const createdMeshes = [];

  assets.forEach((asset, i) => {
    const tex = asset.texture.clone();
    tex.needsUpdate = true;
    const mesh = QuadFactory.createQuad(tex, asset.name, 1, segments);

    const r = Math.floor(i / cols);
    const c = i % cols;

    mesh.position.set(startX + c * spacing, 0, startZ + r * spacing);

    scene.addObject(mesh);
    snapPlacedMesh(mesh);
    createdMeshes.push(mesh);
  });

  scene.selectObject(createdMeshes[createdMeshes.length - 1]);
  hierarchy.refresh();

  history.push({
    label: `Create ${count} assets`,
    undo: () => {
      createdMeshes.forEach(m => scene.removeObject(m, { dispose: false }));
      hierarchy.refresh();
    },
    redo: () => {
      createdMeshes.forEach(m => scene.addObject(m));
      hierarchy.refresh();
    }
  });

  showToast(`Created ${count} assets in grid`);
}

// ──────────────────────────────────────────────
//  Add Primitives
// ──────────────────────────────────────────────

function placePrimitive(type) {
  let mesh;
  const segInput = document.getElementById('input-segments');
  const segments = segInput ? Math.max(1, Math.min(16, parseInt(segInput.value, 10) || 1)) : 1;

  if (type === 'plane') mesh = QuadFactory.createPlane(1, 1, segments);
  else if (type === 'cube') mesh = QuadFactory.createCube(1, 1, 1, segments);
  else if (type === 'cylinder') mesh = QuadFactory.createCylinder();
  else return;

  // Place it slightly in front of the camera focus or at origin
  mesh.position.set(0, 0, 0);

  scene.addObject(mesh);
  snapPlacedMesh(mesh);
  scene.selectObject(mesh);
  hierarchy.refresh();

  history.push({
    label: `Create ${mesh.name}`,
    undo: () => { scene.removeObject(mesh, { dispose: false }); hierarchy.refresh(); },
    redo: () => { scene.addObject(mesh); hierarchy.refresh(); }
  });

  showToast(`Created ${mesh.name}`);
}

document.getElementById('btn-add-plane').addEventListener('click', () => placePrimitive('plane'));
document.getElementById('btn-add-cube').addEventListener('click', () => placePrimitive('cube'));
document.getElementById('btn-add-cylinder').addEventListener('click', () => placePrimitive('cylinder'));

// ──────────────────────────────────────────────
//  Duplicate / Delete
// ──────────────────────────────────────────────

function duplicateSelected() {
  const selection = [...scene.selectedObjects];
  if (selection.length === 0) return;

  const clones = selection.map(obj => QuadFactory.duplicate(obj));

  scene.deselectObject();
  clones.forEach(clone => {
    scene.addObject(clone);
    scene.selectObject(clone, true); // additive selection
  });

  hierarchy.refresh();

  history.push({
    label: `Duplicate ${selection.length} objects`,
    undo: () => {
      clones.forEach(c => scene.removeObject(c, { dispose: false }));
      hierarchy.refresh();
    },
    redo: () => {
      clones.forEach(c => restoreObjectFromHistory(c));
      hierarchy.refresh();
    }
  });

  showToast(`Duplicated ${selection.length} object(s)`);
}

function detachObjectForHistory(obj) {
  scene.deselectObject(obj);
  if (obj.userData.isSceneGroup) {
    if (obj.parent) obj.parent.remove(obj);
    const groupIndex = scene.groups.indexOf(obj);
    if (groupIndex >= 0) scene.groups.splice(groupIndex, 1);
  } else {
    if (obj.parent) obj.parent.remove(obj);
    const objectIndex = scene.objects.indexOf(obj);
    if (objectIndex >= 0) scene.objects.splice(objectIndex, 1);
  }
  scene._updateObjectCount();
}

function restoreObjectFromHistory(obj) {
  if (obj.userData.isSceneGroup) {
    if (!scene.groups.includes(obj)) scene.groups.push(obj);
    if (obj.parent !== scene.exportGroup) scene.exportGroup.add(obj);
  } else {
    if (!scene.objects.includes(obj)) scene.objects.push(obj);
    if (obj.parent !== scene.exportGroup && !obj.parent?.userData?.isSceneGroup) {
      scene.exportGroup.add(obj);
    }
  }
  scene._updateObjectCount();
}

function deleteSelected({ forceObjects = false } = {}) {
  const selection = [...scene.selectedObjects];
  if (selection.length === 0) return;

  const voxelTarget = selection.length === 1 && selection[0].userData?.voxelized
    ? selection[0]
    : null;
  const selectedVoxelCount = voxelTarget?.userData?.voxelSelection
    ? countMask(voxelTarget.userData.voxelSelection)
    : 0;
  if (!forceObjects && toolMode === 'voxel-relief' && selectedVoxelCount > 0) {
    deleteVoxelSelection(voxelTarget);
    return;
  }

  const count = selection.length;

  selection.forEach(detachObjectForHistory);
  hierarchy.refresh();

  history.push({
    label: `Delete ${count} object(s)`,
    undo: () => {
      selection.forEach(restoreObjectFromHistory);
      selection.forEach(obj => scene.selectObject(obj, true));
      hierarchy.refresh();
    },
    redo: () => {
      selection.forEach(detachObjectForHistory);
      hierarchy.refresh();
    }
  });

  showToast(`Deleted ${count} object(s)`);
}

function updateGroupingActions(selection = scene.selectedObjects) {
  const selected = selection || [];
  const hasGroup = selected.some(object => object.userData?.isSceneGroup);
  const hasGroupedObject = selected.some(object => object.parent?.userData?.isSceneGroup);
  const canGroup = selected.length >= 2 && !hasGroup && !hasGroupedObject;
  const canUngroup = selected.some(object => object.userData?.isSceneGroup);

  const groupButton = document.getElementById('btn-group-selected');
  const ungroupButton = document.getElementById('btn-ungroup-selected');
  if (groupButton) groupButton.disabled = !canGroup;
  if (ungroupButton) ungroupButton.disabled = !canUngroup;
}

function groupSelected() {
  const selection = [...scene.selectedObjects];
  const hasGroupedObject = selection.some(object => object.parent?.userData?.isSceneGroup);
  if (selection.length < 2 || selection.some(object => object.userData?.isSceneGroup) || hasGroupedObject) {
    showToast('Seleccioná 2 o más objetos sin agrupar');
    return;
  }

  const group = scene.createGroup(`Group ${scene.groups.length + 1}`, selection);
  scene.deselectObject();
  scene.selectObject(group, false);
  hierarchy.refresh();
  updateGroupingActions();

  history.push({
    label: 'Group',
    undo: () => {
      const children = scene.dissolveGroup(group);
      scene.deselectObject();
      children.forEach(c => scene.selectObject(c, true));
      hierarchy.refresh();
    },
    redo: () => {
      scene.restoreGroup(group, selection);
      scene.deselectObject();
      scene.selectObject(group, false);
      hierarchy.refresh();
    }
  });

  showToast(`Agrupados ${selection.length} objetos`);
}

function ungroupSelected() {
  const groups = scene.selectedObjects.filter(o => o.userData.isSceneGroup);
  if (groups.length === 0) {
    showToast('Select a group to ungroup');
    return;
  }

  const groupStates = groups.map(group => ({ group, children: [...group.children] }));
  groupStates.forEach(({ group }) => {
    const children = scene.dissolveGroup(group);
    scene.deselectObject(group);
    children.forEach(c => scene.selectObject(c, true));
  });
  hierarchy.refresh();

  history.push({
    label: 'Ungroup',
    undo: () => {
      groupStates.forEach(({ group, children }) => scene.restoreGroup(group, children));
      scene.deselectObject();
      groupStates.forEach(({ group }) => scene.selectObject(group, true));
      hierarchy.refresh();
    },
    redo: () => {
      groupStates.forEach(({ group }) => scene.dissolveGroup(group));
      scene.deselectObject();
      groupStates.forEach(({ children }) => children.forEach(child => scene.selectObject(child, true)));
      hierarchy.refresh();
    }
  });

  showToast('Ungrouped');
  updateGroupingActions();
}

// ──────────────────────────────────────────────
//  Toolbar Buttons
// ──────────────────────────────────────────────

function setTransformBtn(mode) {
  activeTransformMode = mode;
  scene.setTransformMode(mode);
  document.querySelectorAll('#btn-translate, #btn-rotate, #btn-scale').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-${mode}`).classList.add('active');
  // Exit any active drawing/push-pull mode
  if (toolMode !== 'transform') setToolMode('transform');
}

document.getElementById('btn-translate').addEventListener('click', () => setTransformBtn('translate'));
document.getElementById('btn-rotate').addEventListener('click', () => setTransformBtn('rotate'));
document.getElementById('btn-scale').addEventListener('click', () => setTransformBtn('scale'));
document.getElementById('btn-group-selected').addEventListener('click', groupSelected);
document.getElementById('btn-ungroup-selected').addEventListener('click', ungroupSelected);

// Draw tool buttons
document.getElementById('btn-tool-line').addEventListener('click', () => setToolMode('line'));
document.getElementById('btn-tool-rectangle').addEventListener('click', () => setToolMode('rectangle'));
document.getElementById('btn-tool-push-pull').addEventListener('click', () => setToolMode('push-pull'));
document.getElementById('btn-tool-cut').addEventListener('click', () => setToolMode('cut'));
document.getElementById('btn-tool-voxel-relief').addEventListener('click', () => setToolMode('voxel-relief'));
document.getElementById('btn-tool-voxel-brush').addEventListener('click', () => setToolMode('voxel-brush'));
document.getElementById('btn-relief-float-extract')?.addEventListener('click', () => {
  const mesh = voxelReliefTool.targetMesh;
  if (mesh) applyReliefDepthWithHistory(mesh, voxelReliefTool.depthStep);
});
document.getElementById('btn-relief-float-subtract')?.addEventListener('click', () => {
  const mesh = voxelReliefTool.targetMesh;
  if (mesh) applyReliefDepthWithHistory(mesh, -voxelReliefTool.depthStep);
});
document.getElementById('btn-relief-float-exit')?.addEventListener('click', () => setToolMode('transform'));
document.getElementById('btn-tool-reference').addEventListener('click', () => {
  setToolMode('reference');
  document.getElementById('file-reference-image').click();
});

// Vertex Edit toggle
document.getElementById('btn-vertex-edit').addEventListener('click', () => {
  isVertexEditMode = !isVertexEditMode;
  document.getElementById('btn-vertex-edit').classList.toggle('active', isVertexEditMode);

  if (isVertexEditMode) {
    if (scene.selectedObjects.length === 1) {
      vertexEditor.enable(scene.selectedObjects[0]);
      scene.transformControls.detach();
      setTransformBtn('translate');
      showToast('Vertex Edit Mode: Click spherical handles to deform');
    } else {
      isVertexEditMode = false;
      document.getElementById('btn-vertex-edit').classList.remove('active');
      showToast('Select a single object first');
    }
  } else {
    const activeMesh = vertexEditor.activeMesh;
    vertexEditor.disable();
    if (activeMesh) {
      scene.selectObject(activeMesh);
    }
    showToast('Exited Vertex Edit Mode');
  }
});

function refreshScaleDependentTextures() {
  scene.selectedObjects.forEach(obj => {
    updateTextureRepeatForScale(obj);
    propsPanel.updateFromTransform(obj);
  });
  scheduleAutosave();
}

// Grid size
document.getElementById('input-grid-size').addEventListener('change', (e) => {
  const size = parseFloat(e.target.value) || 32;
  scene.updateGrid(size);
  refreshScaleDependentTextures();
  showToast(`Grid size updated to ${size}px`);
});

// Snap toggle
let snapOn = false;
document.getElementById('btn-snap').addEventListener('click', () => {
  snapOn = !snapOn;
  scene.setSnap(snapOn);
  refreshScaleDependentTextures();
  document.getElementById('btn-snap').classList.toggle('active', snapOn);
  showToast(snapOn ? 'Snap to Grid ON' : 'Snap to Grid OFF');
});

let scaleSnapOn = false;
document.getElementById('input-snap-scale').addEventListener('change', (e) => {
  scaleSnapOn = e.target.checked;
  scene.setScaleSnap(scaleSnapOn);
  refreshScaleDependentTextures();
  showToast(scaleSnapOn
    ? 'Scale snap ON — el tamaño se ajusta al grid'
    : 'Scale snap OFF');
});

let assetSnapOn = false;
document.getElementById('btn-snap-asset').addEventListener('click', () => {
  assetSnapOn = !assetSnapOn;
  scene.setAssetSnap(assetSnapOn);
  document.getElementById('btn-snap-asset').classList.toggle('active', assetSnapOn);
  showToast(assetSnapOn ? 'Snap to Asset ON' : 'Snap to Asset OFF');
});

// Grid toggle
document.getElementById('btn-grid').addEventListener('click', () => {
  const vis = scene.toggleGrid();
  document.getElementById('btn-grid').classList.toggle('active', vis);
});

// Camera mode
document.getElementById('btn-camera-persp').addEventListener('click', () => {
  scene.setCameraMode('perspective');
  document.getElementById('btn-camera-persp').classList.add('active');
  document.getElementById('btn-camera-ortho').classList.remove('active');
});
document.getElementById('btn-camera-ortho').addEventListener('click', () => {
  scene.setCameraMode('orthographic');
  document.getElementById('btn-camera-ortho').classList.add('active');
  document.getElementById('btn-camera-persp').classList.remove('active');
});

// Undo / Redo
document.getElementById('btn-undo').addEventListener('click', () => {
  const action = history.undo();
  if (action) showToast(`Undo: ${action.label}`);
});
document.getElementById('btn-redo').addEventListener('click', () => {
  const action = history.redo();
  if (action) showToast(`Redo: ${action.label}`);
});

// Export
function exportFilename(defaultFilename) {
  if (scene.selectedObjects.length === 0) return defaultFilename;

  const name = scene.selectedObjects.length === 1
    ? scene.selectedObjects[0].name
    : `selection-${scene.selectedObjects.length}`;
  const safeName = String(name || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return safeName || defaultFilename;
}

function prepareExport(defaultFilename) {
  const scope = createExportScope(scene);
  if (!scope.hasContent) throw new Error('No hay objetos para exportar');
  return {
    ...scope,
    filename: exportFilename(defaultFilename),
  };
}

function updateExportScopeLabel() {
  const label = document.getElementById('export-scope-label');
  if (!label) return;

  const selection = scene.selectedObjects || [];
  if (selection.length === 0) {
    label.textContent = 'Escena completa';
    label.title = 'No hay selección: se exporta toda la escena';
  } else if (selection.length === 1 && selection[0].userData?.isSceneGroup) {
    label.textContent = `Grupo seleccionado: ${selection[0].name}`;
    label.title = 'Se exporta únicamente este grupo';
  } else if (selection.length === 1) {
    label.textContent = `Objeto seleccionado: ${selection[0].name}`;
    label.title = 'Se exporta únicamente este objeto';
  } else {
    label.textContent = `${selection.length} objetos seleccionados`;
    label.title = 'Se exportan únicamente los objetos seleccionados';
  }
}

document.getElementById('btn-export-gltf').addEventListener('click', async () => {
  try {
    const target = prepareExport('sprite3d-model');
    showToast(`Exportando ${target.label} como GLTF...`);
    await GLTFExportManager.export(target.group, target.filename);
    showToast('GLTF exportado');
  } catch (e) {
    showToast('No se pudo exportar: ' + e.message);
  }
});

document.getElementById('btn-export-obj').addEventListener('click', async () => {
  try {
    const target = prepareExport('sprite3d-model');
    showToast(`Exportando ${target.label} como OBJ...`);
    await OBJExportManager.export(target.group, target.filename);
    showToast('OBJ exportado');
  } catch (e) {
    showToast('No se pudo exportar: ' + e.message);
  }
});

document.getElementById('btn-export-fbx').addEventListener('click', async () => {
  try {
    const target = prepareExport('sprite3d-model');
    showToast(`Exportando ${target.label} como FBX...`);
    const result = await FBXExportManager.export(target.group, target.filename);
    if (result) {
      showToast(result.textureCount
        ? `FBX + PNG + .meta exportados (${result.textureCount} textura${result.textureCount === 1 ? '' : 's'})`
        : 'FBX exportado');
    }
  } catch (e) {
    showToast('No se pudo exportar: ' + e.message);
  }
});

document.getElementById('btn-export-godot').addEventListener('click', async () => {
  try {
    const target = prepareExport('sprite3d_meshlibrary');
    showToast(`Exportando ${target.label} como Godot MeshLibrary...`);
    await GodotExportManager.exportLibrary(target.group, target.filename);
    showToast('Godot MeshLibrary exportada');
  } catch (e) {
    showToast('No se pudo exportar: ' + e.message);
  }
});

// ──────────────────────────────────────────────
//  Keyboard Shortcuts
// ──────────────────────────────────────────────

const cameraKeys = new Set();
const cameraMovementKeys = new Set(['w', 'a', 's', 'd', 'shift']);

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (cameraMovementKeys.has(key)) cameraKeys.delete(key);
});

document.getElementById('btn-export-unreal').addEventListener('click', async () => {
  try {
    const target = prepareExport('spriteforge-unreal');
    showToast(`Exportando ${target.label} para Unreal Engine...`);
    await UnrealExportManager.exportStaticMesh(target.group, target.filename);
    showToast('GLB listo para importar en Unreal Engine');
  } catch (e) {
    showToast('No se pudo exportar: ' + e.message);
  }
});

window.addEventListener('blur', () => cameraKeys.clear());

window.addEventListener('keydown', (e) => {
  // Ignore if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const key = e.key.toLowerCase();
  if (!e.ctrlKey && !e.metaKey && !e.altKey && cameraMovementKeys.has(key)) {
    cameraKeys.add(key);
    e.preventDefault();
    return;
  }

  switch (key) {
    case 'e': setTransformBtn('rotate'); break;
    case 'r': setTransformBtn('scale'); break;
    case 'delete':
    case 'backspace':
      deleteSelected();
      break;
    case 'd':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        duplicateSelected();
      }
      break;
    case 'g':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
        break;
      }
      // plain G → snap toggle (handled below, don't break)
      snapOn = !snapOn;
      scene.setSnap(snapOn);
      document.getElementById('btn-snap').classList.toggle('active', snapOn);
      showToast(snapOn ? 'Snap ON' : 'Snap OFF');
      break;
    case 'z':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) {
          const a = history.redo();
          if (a) showToast(`Redo: ${a.label}`);
        } else {
          const a = history.undo();
          if (a) showToast(`Undo: ${a.label}`);
        }
      }
      break;
    case 'l':
      setToolMode('line');
      break;
    case 'b':
      setToolMode('rectangle');
      break;
    case 'p':
      setToolMode('push-pull');
      break;
    case 'c':
      setToolMode('cut');
      break;
    case 'm':
      setToolMode('voxel-relief');
      break;
    case 'v':
      setToolMode('voxel-brush');
      break;
    case 'q':
      e.preventDefault();
      openToolWheel(lastPointerPosition.x, lastPointerPosition.y);
      break;
    case 'escape':
      if (toolWheel && !toolWheel.hidden) {
        closeToolWheel();
        break;
      }
      if (toolMode !== 'transform') {
        setToolMode('transform');
        showToast('Returned to Transform mode');
      } else {
        scene.deselectObject();
        propsPanel.showEmpty();
        hierarchy.refresh();
      }
      break;
  }
});

// Prevent context menu on canvas
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ──────────────────────────────────────────────
//  Toast Notifications
// ──────────────────────────────────────────────

let toastTimeout = null;

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (toast) toast.remove();

  toast = document.createElement('div');
  toast.classList.add('toast');
  toast.innerHTML = `<span class="material-symbols-rounded">check_circle</span>${message}`;
  document.body.appendChild(toast);

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.remove(); }, 2500);
}

window.showToast = showToast;

// ──────────────────────────────────────────────
//  Project Save / Load
// ──────────────────────────────────────────────

function getMeshTextureDataUrl(mesh) {
  const images = [
    mesh.userData.textureImage,
    mesh.userData.texture?.image,
    ...(Array.isArray(mesh.material)
      ? mesh.material.map(material => material?.map?.image)
      : [mesh.material?.map?.image]),
  ];

  for (const image of images) {
    const source = image?.currentSrc || image?.src;
    if (typeof source === 'string' && source.startsWith('data:')) return source;
  }
  return null;
}

function serializeProject() {
  const assets = new Map(
    assetPanel.assets.map(asset => [asset.name, {
      name: asset.name,
      dataUrl: asset.dataUrl,
    }]),
  );

  // Textures loaded directly on an object also need to be embedded.
  scene.objects.forEach(obj => {
    const textureName = obj.userData.textureName || '';
    const dataUrl = getMeshTextureDataUrl(obj);
    if (textureName && dataUrl && !assets.has(textureName)) {
      assets.set(textureName, { name: textureName, dataUrl });
    }
  });

  return {
    version: 2,
    assets: [...assets.values()],
    modelAssets: assetPanel.modelAssets.map(asset => ({
      name: asset.name,
      format: asset.format,
      sourceBase64: asset.sourceBase64,
    })),
    objects: scene.objects.map(obj => {
      const pos = obj.position;
      const rot = obj.rotation;
      const scl = obj.scale;
      const importedAsset = obj.userData.type === 'imported-3d'
        ? assetPanel.modelAssets.find(asset => asset.name === obj.userData.imported3DName)
        : null;
      return {
        name: obj.name,
        type: obj.userData.type,
        imported3DFormat: obj.userData.imported3DFormat || null,
        imported3DAssetName: importedAsset?.name || null,
        imported3DSource: importedAsset ? null : (obj.userData.imported3DSource || null),
        textureName: obj.userData.textureName || '',
        originalWidth: obj.userData.originalWidth,
        originalHeight: obj.userData.originalHeight,
        extrusionDepth: obj.userData.extrusionDepth,
        textureSides: obj.userData.textureSides !== false,
        realUVApplied: !!obj.userData.realUVApplied,
        uvLayoutType: obj.userData.uvLayoutType || '',
        position: [pos.x, pos.y, pos.z],
        rotation: [rot.x, rot.y, rot.z],
        scale: [scl.x, scl.y, scl.z],
        uvRepeat: obj.userData.uvRepeat || [1, 1],
        uvOffset: obj.userData.uvOffset || [0, 0],
        textureRepeatOnScale: !!obj.userData.textureRepeatOnScale,
        textureRepeatBaseScale: obj.userData.textureRepeatBaseScale || null,
        textureRepeatBaseUV: obj.userData.textureRepeatBaseUV || null,
        voxelSource: obj.userData.voxelSource || null,
        voxelSize: obj.userData.voxelSize || 1,
        voxelized: !!obj.userData.voxelized,
        voxelPixelSize: obj.userData.voxelPixelSize || 1,
        voxelUsesUVRepeat: !!obj.userData.voxelUsesUVRepeat,
        voxelRepeat: obj.userData.voxelRepeat || null,
        voxelScaleCompensation: obj.userData.voxelScaleCompensation || null,
        voxelSourceScale: obj.userData.voxelSourceScale || null,
        voxelPreviousTextureRepeatOnScale: obj.userData.voxelPreviousTextureRepeatOnScale ?? null,
        voxelPreviousTextureRepeatBaseScale: obj.userData.voxelPreviousTextureRepeatBaseScale || null,
        voxelPreviousTextureRepeatBaseUV: obj.userData.voxelPreviousTextureRepeatBaseUV || null,
        voxelActiveMap: obj.userData.voxelActiveMap ? Array.from(obj.userData.voxelActiveMap) : null,
        voxelColorMap: obj.userData.voxelColorMap ? Array.from(obj.userData.voxelColorMap) : null,
        voxelDepthMap: obj.userData.voxelDepthMap ? Array.from(obj.userData.voxelDepthMap) : null,
        voxelPivotOffset: obj.userData.voxelPivotOffset || null,
        voxelDerivedPiece: !!obj.userData.voxelDerivedPiece,
        voxelHeightmapSource: obj.userData.voxelHeightmapSource || null,
        voxelHeightmapName: obj.userData.voxelHeightmapName || null,
        voxelHeightMax: obj.userData.voxelHeightMax ?? 8,
        voxelHeightInvert: !!obj.userData.voxelHeightInvert,
        voxelColor: obj.userData.type === 'voxel-json' && obj.material?.color
          ? obj.material.color.getHex()
          : null,
      };
    }),
    groups: scene.groups.map(group => ({
      name: group.name,
      position: [group.position.x, group.position.y, group.position.z],
      rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
      scale: [group.scale.x, group.scale.y, group.scale.z],
      children: group.children
        .map(child => scene.objects.indexOf(child))
        .filter(index => index >= 0),
    })),
  };
}

async function saveProject() {
  let fileHandle = null;
  if (window.showSaveFilePicker) {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: 'project.s3d',
        types: [{
          description: 'Sprite3D Project',
          accept: { 'application/json': ['.s3d'] }
        }]
      });
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
      return; // cancelled by user
    }
  }

  showToast('Saving project...');

  const project = serializeProject();

  const json = JSON.stringify(project);

  if (fileHandle) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      persistProjectSnapshot(project);
      showToast('Project saved!');
    } catch (err) {
      console.error(err);
      showToast('Error writing to file');
    }
  } else {
    // Fallback for browsers without File System Access API
    const blob = new Blob([json], { type: 'application/json' });
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'project.s3d';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 1000);
    };
    reader.readAsDataURL(blob);
    persistProjectSnapshot(project);
    showToast('Project saved!');
  }
}

function newProject() {
  const hasProjectContent = scene.objects.length > 0
    || scene.referenceGroup.children.length > 0
    || assetPanel.assets.length > 0
    || assetPanel.modelAssets.length > 0;

  if (hasProjectContent && !window.confirm('¿Crear un proyecto nuevo? Se quitará el contenido actual del editor.')) {
    return;
  }

  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  isRestoringProject = true;
  try {
    vertexEditor.disable();
    isVertexEditMode = false;
    document.getElementById('btn-vertex-edit')?.classList.remove('active');

    scene.clear();
    history.clear();

    assetPanel.assets.forEach(asset => asset.texture?.dispose());
    assetPanel.assets = [];
    assetPanel.clearSelection();
    if (assetPanel.assetGrid) assetPanel.assetGrid.innerHTML = '';
    assetPanel.clearModelAssets();

    transformGestureSnapshot = null;
    vertexGestureSnapshot = null;
    reliefDirectSnapshot = null;
    reliefSelectionSnapshot = null;
    brushStrokeSnapshot = null;

    setToolMode('transform');
    propsPanel.showEmpty();
    hierarchy.refresh();
  } finally {
    isRestoringProject = false;
  }

  persistProjectSnapshot({
    version: 2,
    assets: [],
    modelAssets: [],
    objects: [],
    groups: [],
  });
  updateBeginnerGuide();
  showToast('Nuevo proyecto listo');
}

function loadProject(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      restoreProjectData(JSON.parse(e.target.result), { announce: true });
    } catch (err) {
      showToast('Error loading project');
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function restoreProjectData(project, { announce = false } = {}) {
  if (!project?.assets || !project?.objects) throw new Error('Invalid project file');

  isRestoringProject = true;

  // Clear current state.
  scene.clear();
  hierarchy.refresh();
  history.clear();
  propsPanel.showEmpty();

  // Clear UI assets.
  assetPanel.assets = [];
  assetPanel.selectedAsset = null;
  document.getElementById('asset-grid').innerHTML = '';
  assetPanel.clearModelAssets();
  (Array.isArray(project.modelAssets) ? project.modelAssets : []).forEach(asset => {
    assetPanel.addModelAsset(asset);
  });

  const finish = async () => {
    try {
      const restoredObjects = await reconstructObjects(project.objects);
      restoreGroups(project.groups, restoredObjects);
      persistProjectSnapshot(project);
      if (typeof updateBeginnerGuide === 'function') updateBeginnerGuide();
      if (announce) showToast('Project loaded successfully');
    } catch (err) {
      console.error('Could not restore project objects:', err);
      showToast(`No se pudo restaurar un modelo: ${err.message}`);
    } finally {
      isRestoringProject = false;
    }
  };

  const assetDataList = Array.isArray(project.assets) ? project.assets : [];
  if (assetDataList.length === 0) {
    finish();
    return;
  }

  let loadedAssets = 0;
  const handleAssetLoaded = () => {
    loadedAssets += 1;
    if (loadedAssets === assetDataList.length) finish();
  };

  assetDataList.forEach(assetData => {
    const img = new Image();
    img.onload = () => {
      const texture = new THREE.Texture(img);
      texture.needsUpdate = true;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestMipMapLinearFilter;

      const asset = { name: assetData.name, texture, image: img, dataUrl: assetData.dataUrl };
      assetPanel.assets.push(asset);
      assetPanel._addThumbnail(asset);
      handleAssetLoaded();
    };
    img.onerror = handleAssetLoaded;
    img.src = assetData.dataUrl;
  });
}

function restoreAutosavedProject() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    if (!raw) return;
    const project = JSON.parse(raw);
    if (!project?.objects?.length && !project?.assets?.length) return;
    restoreProjectData(project, { announce: false });
    showToast('Borrador recuperado automáticamente');
  } catch (err) {
    console.warn('Could not restore autosaved project:', err);
  }
}

async function reconstructObjects(objectDataList) {
  const reconstructedObjects = [];
  for (const data of objectDataList) {
    let mesh;
    let baseTex = null;
    if (data.textureName) {
      const asset = assetPanel.assets.find(a => a.name === data.textureName);
      if (asset) {
        baseTex = asset.texture.clone();
        baseTex.needsUpdate = true;
      }
    }

    const importedSource = data.imported3DSource || (
      data.imported3DAssetName
        ? assetPanel.modelAssets.find(asset => asset.name === data.imported3DAssetName)?.sourceBase64
        : null
    );

    if (data.type === 'imported-3d' && importedSource) {
      const imported = await importModelSource(importedSource, {
        name: data.name,
        format: data.imported3DFormat,
      });
      mesh = imported.root;
      mesh.userData.imported3DFormat = data.imported3DFormat || imported.format;
      mesh.userData.imported3DSource = importedSource;
      mesh.userData.imported3DName = data.imported3DAssetName || data.name;
      assetPanel.addModelAsset({
        name: data.imported3DAssetName || data.name,
        format: data.imported3DFormat || imported.format,
        sourceBase64: importedSource,
      });
    } else if (data.type === 'voxel-json' && data.voxelSource) {
      mesh = createVoxelMesh(data.voxelSource, {
        voxelSize: data.voxelSize || 1,
        color: data.voxelColor ?? 0x8fb3d9,
      });
    } else if (data.type === 'voxel' && baseTex) {
      mesh = QuadFactory.createQuad(baseTex, data.textureName || data.name);
      mesh.scale.set(...(data.scale || [1, 1, 1]));
      mesh.userData.uvRepeat = data.uvRepeat || [1, 1];
      mesh.userData.uvOffset = data.uvOffset || [0, 0];
      mesh.userData.textureRepeatOnScale = !!data.textureRepeatOnScale;
      mesh.userData.voxelUsesUVRepeat = !!data.voxelUsesUVRepeat;
      mesh.userData.voxelRepeat = data.voxelRepeat || mesh.userData.uvRepeat;
      mesh.userData.voxelScaleCompensation = data.voxelScaleCompensation || (
        data.voxelUsesUVRepeat ? data.voxelRepeat : null
      );
      mesh.userData.voxelSourceScale = data.voxelSourceScale || null;
      mesh.userData.voxelPreviousTextureRepeatOnScale = data.voxelPreviousTextureRepeatOnScale ?? null;
      mesh.userData.voxelPreviousTextureRepeatBaseScale = data.voxelPreviousTextureRepeatBaseScale || null;
      mesh.userData.voxelPreviousTextureRepeatBaseUV = data.voxelPreviousTextureRepeatBaseUV || null;
      QuadFactory.voxelizeSprite(mesh, data.voxelPixelSize || 1, {
        preserveScale: true,
        repeatInfo: data.voxelRepeat || data.uvRepeat || [1, 1],
      });
    } else if (data.type === 'plane') mesh = QuadFactory.createPlane(data.originalWidth, data.originalHeight);
    else if (data.type === 'cube') mesh = QuadFactory.createCube(data.originalWidth, data.originalHeight, data.extrusionDepth);
    else if (data.type === 'cylinder') mesh = QuadFactory.createCylinder(data.originalWidth / 2, data.originalHeight);
    else if (data.type === 'quad' || data.type === 'box') {
      if (baseTex) {
        mesh = QuadFactory.createQuad(baseTex, data.textureName || data.name);
      } else {
        mesh = QuadFactory.createPlane(data.originalWidth, data.originalHeight);
      }
    } else continue;

    mesh.name = data.name;
    mesh.userData.textureName = data.textureName || '';
    mesh.position.set(...data.position);
    mesh.rotation.set(...data.rotation);
    mesh.scale.set(...data.scale);

    // Project files rebuild primitive geometry instead of serializing its
    // buffers. Restore the UV layout before restoring the texture so a
    // cylinder keeps the same wall/top/bottom atlas after reopening a file.
    if (data.realUVApplied && mesh.geometry) {
      await UVExporter.applyRealUVToMesh(mesh);
    }

    // Apply texture to primitives
    if (baseTex && (data.type === 'plane' || data.type === 'cube' || data.type === 'cylinder')) {
      QuadFactory.applyTexture(mesh, baseTex);
    }

    // Re-apply extrusion if it was an extruded quad
    if (data.type === 'box' && data.extrusionDepth > 0 && baseTex) {
      QuadFactory.extrudeQuad(mesh, data.extrusionDepth, data.textureSides !== false);
    }

    if (data.type === 'voxel' && mesh.userData.voxelized) {
      if (Array.isArray(data.voxelActiveMap)) mesh.userData.voxelActiveMap = new Uint8Array(data.voxelActiveMap);
      if (Array.isArray(data.voxelColorMap)) mesh.userData.voxelColorMap = new Uint8Array(data.voxelColorMap);
      if (Array.isArray(data.voxelDepthMap)) mesh.userData.voxelDepthMap = new Uint16Array(data.voxelDepthMap);
      mesh.userData.voxelPivotOffset = Array.isArray(data.voxelPivotOffset)
        ? [...data.voxelPivotOffset]
        : null;
      mesh.userData.voxelDerivedPiece = !!data.voxelDerivedPiece;
      mesh.userData.voxelHeightmapSource = data.voxelHeightmapSource || null;
      mesh.userData.voxelHeightmapName = data.voxelHeightmapName || null;
      mesh.userData.voxelHeightMax = data.voxelHeightMax ?? 8;
      mesh.userData.voxelHeightInvert = !!data.voxelHeightInvert;
      QuadFactory.rebuildVoxelGeometry(mesh);
    }

    // Setup and apply UV Mapping (Tiling/Offset)
    mesh.userData.uvRepeat = data.uvRepeat || [1, 1];
    mesh.userData.uvOffset = data.uvOffset || [0, 0];
    mesh.userData.textureRepeatOnScale = !!data.textureRepeatOnScale;
    mesh.userData.textureRepeatBaseScale = data.textureRepeatBaseScale || [mesh.scale.x, mesh.scale.y];
    mesh.userData.textureRepeatBaseUV = data.textureRepeatBaseUV || [...mesh.userData.uvRepeat];

    const applyMappingToMaterial = (mat) => {
      if (mat && mat.map) {
        mat.map.repeat.set(mesh.userData.uvRepeat[0], mesh.userData.uvRepeat[1]);
        mat.map.offset.set(mesh.userData.uvOffset[0], mesh.userData.uvOffset[1]);
        mat.map.needsUpdate = true;
      }
    };

    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(applyMappingToMaterial);
    } else {
      applyMappingToMaterial(mesh.material);
    }

    scene.addObject(mesh);
    reconstructedObjects.push(mesh);
  }

  hierarchy.refresh();
  return reconstructedObjects;
}

function restoreGroups(groupDataList, restoredObjects) {
  if (!Array.isArray(groupDataList)) return;

  for (const data of groupDataList) {
    const group = new THREE.Group();
    group.name = data.name || 'Group';
    group.userData.isSceneGroup = true;
    group.position.set(...(data.position || [0, 0, 0]));
    group.rotation.set(...(data.rotation || [0, 0, 0]));
    group.scale.set(...(data.scale || [1, 1, 1]));
    scene.exportGroup.add(group);
    scene.groups.push(group);

    (data.children || []).forEach(index => {
      const child = restoredObjects[index];
      if (child) group.add(child);
    });
  }

  hierarchy.refresh();
}

document.getElementById('btn-new-project').addEventListener('click', newProject);
document.getElementById('btn-save-project').addEventListener('click', saveProject);

document.getElementById('btn-load-project').addEventListener('click', () => {
  document.getElementById('file-load-project').click();
});

document.getElementById('file-load-project').addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    loadProject(e.target.files[0]);
    e.target.value = ''; // reset
  }
});

async function importVoxelFile(file, position = null) {
  try {
    const mesh = createVoxelMesh(await file.text());
    if (position) mesh.position.set(position.x, position.y, position.z);

    scene.addObject(mesh);
    scene.selectObject(mesh, false);
    hierarchy.refresh();

    history.push({
      label: `Import ${mesh.name}`,
      undo: () => {
        scene.removeObject(mesh, { dispose: false });
        hierarchy.refresh();
      },
      redo: () => {
        scene.addObject(mesh);
        scene.selectObject(mesh, false);
        hierarchy.refresh();
      },
    });

    showToast(`Imported "${mesh.name}" (${mesh.userData.voxelCount} voxels)`);
    return mesh;
  } catch (err) {
    console.error(err);
    showToast(`Could not import voxels: ${err.message}`);
    return null;
  }
}

async function import3DFile(file, position = null) {
  try {
    const imported = await importModelFile(file);
    assetPanel.addModelAsset(imported);
    return addImportedModel(imported, position);
  } catch (err) {
    console.error(err);
    showToast(`No se pudo importar "${file.name}": ${err.message}`);
    return null;
  }
}

async function placeModelAsset(asset, position = null) {
  if (!asset?.sourceBase64) return null;
  try {
    const imported = await importModelSource(asset.sourceBase64, {
      name: asset.name,
      format: asset.format,
    });
    return addImportedModel({
      ...imported,
      name: asset.name,
      format: asset.format,
      sourceBase64: asset.sourceBase64,
    }, position);
  } catch (err) {
    console.error(err);
    showToast(`No se pudo colocar "${asset.name}": ${err.message}`);
    return null;
  }
}

function addImportedModel(imported, position = null) {
  const mesh = imported.root;
  mesh.userData.imported3DFormat = imported.format;
  mesh.userData.imported3DSource = imported.sourceBase64;
  mesh.userData.imported3DName = imported.name;
  if (position) mesh.position.set(position.x, position.y, position.z);

  scene.addObject(mesh);
  scene.selectObject(mesh, false);
  hierarchy.refresh();
  scheduleAutosave();

  history.push({
    label: `Import ${mesh.name}`,
    undo: () => {
      scene.removeObject(mesh, { dispose: false });
      hierarchy.refresh();
    },
    redo: () => {
      scene.addObject(mesh);
      scene.selectObject(mesh, false);
      hierarchy.refresh();
    },
  });

  const triangleCount = countImportedTriangles(mesh);
  showToast(`Importado "${mesh.name}"${triangleCount ? ` (${triangleCount.toLocaleString()} triángulos)` : ''}`);
  return mesh;
}

function countImportedTriangles(root) {
  let count = 0;
  root.traverse(node => {
    if (!node.isMesh || !node.geometry) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    count += node.geometry.index ? node.geometry.index.count / 3 : position.count / 3;
  });
  return Math.round(count);
}

function placeReferenceImage(asset) {
  if (!asset?.image) return null;
  const texture = asset.texture.clone();
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;

  const width = asset.image.naturalWidth || asset.image.width;
  const height = asset.image.naturalHeight || asset.image.height;
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, height / 2, 0);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const reference = new THREE.Mesh(geometry, material);
  reference.name = `Reference: ${asset.name}`;
  reference.userData.isReference = true;
  reference.renderOrder = -1;

  const target = scene.selectedObjects.length === 1 ? scene.selectedObjects[0] : null;
  if (target) {
    reference.position.copy(target.position);
    reference.position.z -= 0.75;
    reference.rotation.copy(target.rotation);
  } else {
    const rect = canvas.getBoundingClientRect();
    const worldPos = scene.getWorldPositionFromScreen(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (worldPos) reference.position.set(worldPos.x, 0, worldPos.z);
  }

  scene.addReference(reference);
  history.push({
    label: 'Place Reference Image',
    undo: () => scene.removeReference(reference, { dispose: false }),
    redo: () => scene.addReference(reference),
  });
  return reference;
}

document.getElementById('file-reference-image').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const image = await loadImageFromFile(file);
    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    placeReferenceImage({ name: file.name, image, texture });
    setToolMode('transform');
    showToast(`Referencia "${file.name}" colocada`);
  } catch (err) {
    setToolMode('transform');
    showToast(`No se pudo cargar la referencia: ${err.message}`);
  }
});

document.getElementById('btn-import-voxels').addEventListener('click', () => {
  document.getElementById('file-import-voxels').click();
});

document.getElementById('file-import-voxels').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (file) await importVoxelFile(file);
  e.target.value = '';
});

document.getElementById('btn-import-3d').addEventListener('click', () => {
  document.getElementById('file-import-3d').click();
});

document.getElementById('file-import-3d').addEventListener('change', async (e) => {
  for (const file of e.target.files || []) await import3DFile(file);
  e.target.value = '';
});

document.getElementById('file-import-3d').accept = MODEL_ACCEPT;

// ──────────────────────────────────────────────
//  Render Loop
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
//  Context Menu
// ──────────────────────────────────────────────

const contextMenu = document.getElementById('context-menu');
let contextTarget = null;
const toolWheel = document.getElementById('tool-wheel');
const toolWheelLauncher = document.getElementById('btn-tool-wheel');
let lastPointerPosition = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
};

canvas.addEventListener('pointermove', (event) => {
  lastPointerPosition = { x: event.clientX, y: event.clientY };
});

function closeToolWheel() {
  if (toolWheel) toolWheel.hidden = true;
}

function openToolWheel(clientX, clientY) {
  if (!toolWheel) return;
  const size = 232;
  const margin = 8;
  const left = Math.max(margin, Math.min(window.innerWidth - size - margin, clientX - size / 2));
  const top = Math.max(margin, Math.min(window.innerHeight - size - margin, clientY - size / 2));
  toolWheel.style.left = `${left}px`;
  toolWheel.style.top = `${top}px`;
  toolWheel.hidden = false;

  toolWheel.querySelectorAll('[data-wheel-tool]').forEach(button => {
    const selectedTool = button.dataset.wheelTool;
    const active = toolMode === 'transform'
      ? selectedTool === activeTransformMode
      : selectedTool === toolMode;
    button.classList.toggle('active', active);
  });
  toolWheel.querySelector('.tool-wheel-item.active, .tool-wheel-item')?.focus({ preventScroll: true });
}

toolWheelLauncher?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (toolWheel?.hidden) openToolWheel(lastPointerPosition.x, lastPointerPosition.y);
  else closeToolWheel();
});

document.getElementById('btn-tool-wheel-close')?.addEventListener('click', closeToolWheel);

toolWheel?.addEventListener('click', (event) => {
  event.stopPropagation();
  const button = event.target.closest('[data-wheel-tool]');
  if (!button) return;
  const selectedTool = button.dataset.wheelTool;
  if (['translate', 'rotate', 'scale'].includes(selectedTool)) setTransformBtn(selectedTool);
  else setToolMode(selectedTool);
  closeToolWheel();
});

function getRecommendedUVResolution(mesh) {
  const maps = [];
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((mat) => {
      if (mat?.map?.image) maps.push(mat.map.image);
    });
  } else if (mesh.material?.map?.image) {
    maps.push(mesh.material.map.image);
  }

  const maxTextureSide = maps.reduce((acc, img) => {
    const w = Number(img.width) || 0;
    const h = Number(img.height) || 0;
    return Math.max(acc, w, h);
  }, 0);

  if (maxTextureSide <= 0) return 2048;
  return THREE.MathUtils.clamp(maxTextureSide, 512, 4096);
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();

  const picked = scene.pickObject(e.clientX, e.clientY);
  if (!picked || e.shiftKey) {
    contextMenu.style.display = 'none';
    openToolWheel(e.clientX, e.clientY);
    return;
  }

  closeToolWheel();

  contextTarget = picked;
  // Add to selection additively if not already selected, else keep current selection
  if (!scene.selectedObjects.includes(picked)) {
    scene.selectObject(picked, false);
  }

  // Show/hide group-specific items
  const sel = scene.selectedObjects;
  const hasGroup = sel.some(o => o.userData.isSceneGroup);
  const hasGroupedObject = sel.some(o => o.parent?.userData?.isSceneGroup);
  const canGroup = sel.length >= 2 && !hasGroup && !hasGroupedObject;
  document.getElementById('menu-group').style.display = canGroup ? '' : 'none';
  document.getElementById('menu-ungroup').style.display = hasGroup ? '' : 'none';

  contextMenu.style.display = 'block';

  const menuWidth = 180;
  const menuHeight = 240;
  let left = e.clientX;
  let top = e.clientY;

  if (left + menuWidth > window.innerWidth) left -= menuWidth;
  if (top + menuHeight > window.innerHeight) top -= menuHeight;

  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
});

// Hide menu on click elsewhere
window.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    contextMenu.style.display = 'none';
  }
  if (!toolWheel?.contains(e.target) && e.target !== toolWheelLauncher) closeToolWheel();
});

document.getElementById('menu-duplicate').addEventListener('click', () => {
  duplicateSelected();
  contextMenu.style.display = 'none';
});

document.getElementById('menu-delete').addEventListener('click', () => {
  deleteSelected({ forceObjects: true });
  contextMenu.style.display = 'none';
});

document.getElementById('menu-group').addEventListener('click', () => {
  groupSelected();
  contextMenu.style.display = 'none';
});

document.getElementById('menu-ungroup').addEventListener('click', () => {
  ungroupSelected();
  contextMenu.style.display = 'none';
});

document.getElementById('menu-export-uv').addEventListener('click', async () => {
  const target = contextTarget;
  if (target) {
    try {
      const resolution = getRecommendedUVResolution(target);
      const before = captureMeshAppearance(target);
      await UVExporter.generateRealLayout(target, resolution);
      pushAppearanceHistory(target, 'Generate Real UV', before, captureMeshAppearance(target));
      showToast(`Real UV layout exported (${resolution}px) for ${target.name}`);
    } catch (err) {
      try {
        UVExporter.generateTemplate(target, 2048);
        showToast(`Real UV failed, exported fallback template for ${target.name}`);
      } catch (fallbackErr) {
        showToast(`UV export failed: ${fallbackErr.message || err.message}`);
      }
    }
  }
  contextMenu.style.display = 'none';
});

document.getElementById('menu-load-texture').addEventListener('click', () => {
  const target = contextTarget;
  if (!target) {
    contextMenu.style.display = 'none';
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (rev) => {
      const img = new Image();
      img.onload = async () => {
        const texture = new THREE.Texture(img);
        texture.needsUpdate = true;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestMipMapLinearFilter;

        const before = captureMeshAppearance(target);
        try {
          // Keep loading flow identical to export flow:
          // always ensure real UVs exist before applying custom texture.
          await UVExporter.applyRealUVToMesh(target);
        } catch (unwrapErr) {
          showToast(`Failed to apply real UV on ${target.name}: ${unwrapErr.message}`);
          return;
        }

        UVExporter.applyAtlas(target, texture);
        target.userData.texture = texture;
        target.userData.textureName = file.name;
        pushAppearanceHistory(target, 'Apply Custom Texture', before, captureMeshAppearance(target));
        showToast(`Custom texture applied to ${target.name}`);
      };
      img.src = rev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
  contextMenu.style.display = 'none';
});

const cameraClock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  scene.updateCameraMovement(cameraKeys, Math.min(cameraClock.getDelta(), 0.05));
  scene.render();
}

animate();

// Beginner guidance and zero-friction entry points
const welcomeCard = document.getElementById('welcome-card');
const contextHintText = document.getElementById('context-hint-text');
const exportMenuButton = document.getElementById('menu-btn-export');
const workflowSteps = {
  import: document.querySelector('[data-step="import"]'),
  edit: document.querySelector('[data-step="edit"]'),
  export: document.querySelector('[data-step="export"]'),
};

function setWorkflowState(activeStep, completedSteps = []) {
  Object.entries(workflowSteps).forEach(([name, element]) => {
    if (!element) return;
    element.classList.toggle('active', name === activeStep);
    element.classList.toggle('complete', completedSteps.includes(name));
    const number = element.querySelector('.workflow-number');
    if (number) number.textContent = completedSteps.includes(name) ? '✓' : String(['import', 'edit', 'export'].indexOf(name) + 1);
  });
}

function updateBeginnerGuide() {
  const objectCount = scene.exportGroup.children.length;
  const hasObjects = objectCount > 0;
  const hasSelection = scene.selectedObjects.length > 0;

  welcomeCard?.classList.toggle('is-hidden', hasObjects);
  welcomeCard?.setAttribute('aria-hidden', String(hasObjects));
  if (exportMenuButton) {
    exportMenuButton.disabled = !hasObjects;
    exportMenuButton.title = hasObjects ? 'Exportar modelo' : 'Primero importá o creá un objeto';
  }

  if (!hasObjects) {
    setWorkflowState('import');
    if (contextHintText) contextHintText.textContent = 'Importá un sprite para empezar.';
  } else if (hasSelection) {
    setWorkflowState('edit', ['import']);
    if (contextHintText) contextHintText.textContent = 'Usá Volumen para dar profundidad. Los ajustes técnicos están plegados.';
  } else {
    setWorkflowState('edit', ['import']);
    if (contextHintText) contextHintText.textContent = 'Seleccioná un objeto para continuar editándolo.';
  }
}

document.getElementById('btn-quick-import')?.addEventListener('click', () => {
  document.getElementById('file-input')?.click();
});

document.getElementById('btn-quick-voxel')?.addEventListener('click', () => {
  document.getElementById('file-import-voxels')?.click();
});

document.getElementById('btn-quick-demo')?.addEventListener('click', () => {
  placePrimitive('cube');
  updateBeginnerGuide();
});

exportMenuButton?.addEventListener('click', () => {
  if (scene.exportGroup.children.length === 0) return;
  updateExportScopeLabel();
  setWorkflowState('export', ['import', 'edit']);
  if (contextHintText) contextHintText.textContent = 'Elegí GLTF para uso general, OBJ o FBX para compatibilidad, o Godot GridMap.';
});

const sceneTreeObserver = new MutationObserver(updateBeginnerGuide);
sceneTreeObserver.observe(document.getElementById('scene-tree'), { childList: true, subtree: true });

// Initial UI state
updateGroupingActions();
updateExportScopeLabel();
updateBeginnerGuide();
showToast('Todo listo: importá un PNG y lo ubicamos por vos.');

window.addEventListener('pagehide', flushAutosave);
window.addEventListener('beforeunload', flushAutosave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAutosave();
});

restoreAutosavedProject();

// ── Dropdown Menu System ──────────────────────────────────────────────────────
const menuGroups = document.querySelectorAll('.menu-group');

function closeAllDropdowns(except = null) {
  menuGroups.forEach(group => {
    if (group === except) return;
    group.querySelector('.menu-btn')?.classList.remove('open');
    group.querySelector('.dropdown')?.classList.remove('open');
  });
}

menuGroups.forEach(group => {
  const btn = group.querySelector('.menu-btn');
  const dropdown = group.querySelector('.dropdown');
  if (!btn || !dropdown) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
      dropdown.classList.add('open');
      btn.classList.add('open');
    }
  });

  // Close dropdown when an action item is clicked (not inputs)
  dropdown.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => closeAllDropdowns());
  });

  // Prevent clicks inside dropdown from bubbling to document close handler
  dropdown.addEventListener('click', (e) => e.stopPropagation());
});

document.addEventListener('click', () => closeAllDropdowns());
