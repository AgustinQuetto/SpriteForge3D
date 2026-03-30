import * as THREE from 'three';
import { SceneManager } from './core/SceneManager.js';
import { QuadFactory } from './editor/QuadFactory.js';
import { HistoryManager } from './editor/HistoryManager.js';
import { AssetPanel } from './ui/AssetPanel.js';
import { PropertiesPanel } from './ui/PropertiesPanel.js';
import { SceneHierarchy } from './ui/SceneHierarchy.js';
import { GLTFExportManager } from './export/GLTFExportManager.js';
import { OBJExportManager } from './export/OBJExportManager.js';
import { GodotExportManager } from './export/GodotExportManager.js';
import { VertexEditor } from './editor/VertexEditor.js';
import { UVExporter } from './export/UVExporter.js';
import { DrawingTool } from './editor/DrawingTool.js';
import { PushPullTool } from './editor/PushPullTool.js';

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

let activeTransformMode = 'translate';
let isVertexEditMode = false;

// Drawing & Push/Pull tools
const drawingTool = new DrawingTool(scene);
const pushPullTool = new PushPullTool(scene);

// Current tool mode: 'transform' | 'line' | 'rectangle' | 'push-pull'
let toolMode = 'transform';

function setToolMode(mode) {
  toolMode = mode;

  // Deactivate previous modes
  drawingTool.deactivate();
  pushPullTool.deactivate();

  const viewport = document.getElementById('viewport');
  viewport.classList.remove('cursor-crosshair', 'cursor-push-pull');

  // Reset draw button active states
  ['btn-tool-line', 'btn-tool-rectangle', 'btn-tool-push-pull'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });

  if (mode === 'line') {
    drawingTool.activate('line');
    viewport.classList.add('cursor-crosshair');
    document.getElementById('btn-tool-line')?.classList.add('active');
    showToast('Line Tool — click to place points, click start to close');
  } else if (mode === 'rectangle') {
    drawingTool.activate('rectangle');
    viewport.classList.add('cursor-crosshair');
    document.getElementById('btn-tool-rectangle')?.classList.add('active');
    showToast('Rectangle Tool — click two corners to create a face');
  } else if (mode === 'push-pull') {
    pushPullTool.activate();
    viewport.classList.add('cursor-push-pull');
    document.getElementById('btn-tool-push-pull')?.classList.add('active');
    scene.orbit.enabled = false;
    showToast('Push/Pull — hover a face and drag to extrude');
  } else {
    // transform mode
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
      scene.removeObject(mesh);
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

// ──────────────────────────────────────────────
//  Callbacks & Wiring
// ──────────────────────────────────────────────

// When selection changes in SceneManager → update panels
// When selection changes in SceneManager → update panels
scene.onSelectionChanged = (selection) => {
  if (selection.length === 1) {
    propsPanel.showProperties(selection[0]);
  } else if (selection.length > 1) {
    propsPanel.showProperties({ name: `${selection.length} objects selected`, isMulti: true });
  } else {
    propsPanel.showEmpty();
  }
  hierarchy.refresh();
};

// When transform gizmo moves an object → update property inputs
// When transform gizmo moves an object → update property inputs
scene.onObjectChanged = () => {
  if (scene.selectedObjects.length === 1 && !isVertexEditMode) {
    propsPanel.updateFromTransform(scene.selectedObjects[0]);
  }
};

// When transform gizmo moves a vertex control point
scene.onVertexChanged = (controlPoint) => {
  vertexEditor.updateMeshGeometry(controlPoint);
};

// When user clicks an asset thumbnail → just highlights it
assetPanel.onAssetSelected = (asset) => {
  // Selected asset will be used when clicking on the canvas
};

// Duplicate/delete from properties panel
propsPanel.onDuplicate = (mesh) => duplicateSelected();
propsPanel.onDelete = (mesh) => deleteSelected();

// Apply texture from properties panel
propsPanel.onApplyTexture = async (mesh) => {
  const asset = assetPanel.selectedAsset;
  if (!asset) {
    showToast('Select an asset in the left panel first!');
    return;
  }
  
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
  
  // Re-render properties to update the apply texture button state
  propsPanel.showProperties(mesh);
  showToast(`Applied texture "${asset.name}" to ${mesh.name}`);
  
  // Record in history
  history.push({
    label: `Apply Texture`,
    undo: () => {
      // Basic undo strategy (would need full material snapshot for complex undos)
      showToast('Undo texture apply not fully supported yet');
    },
    redo: () => {
      QuadFactory.applyTexture(mesh, tex);
      propsPanel.showProperties(mesh);
    }
  });
};

// Scene hierarchy selection
hierarchy.onSelect = (obj) => {
  propsPanel.showProperties(obj);
};

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
  } else if (toolMode === 'push-pull') {
    pushPullTool.onMouseMove(e.clientX, e.clientY);
    // Update cursor based on whether a face is hovered
    const viewport = document.getElementById('viewport');
    viewport.classList.toggle('cursor-push-pull-active', !!pushPullTool._hoveredData);
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (toolMode === 'push-pull' && e.button === 0) {
    pushPullTool.onMouseDown(e.clientX, e.clientY);
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
    const additive = e.ctrlKey || e.metaKey;
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

canvasContainer.addEventListener('drop', (e) => {
  e.preventDefault();
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
    const files = [...e.dataTransfer.files].filter(f => f.type === 'image/png');
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

    if (scene.snapEnabled) {
      mesh.position.x = Math.round(mesh.position.x / scene.snapSize) * scene.snapSize;
      mesh.position.y = Math.round(mesh.position.y / scene.snapSize) * scene.snapSize;
      mesh.position.z = Math.round(mesh.position.z / scene.snapSize) * scene.snapSize;
    }
  }

  scene.addObject(mesh);
  scene.selectObject(mesh, false);
  hierarchy.refresh();

  // Record in history
  history.push({
    label: `Create ${mesh.name}`,
    undo: () => {
      scene.removeObject(mesh);
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

    if (scene.snapEnabled) {
      mesh.position.x = Math.round(mesh.position.x / scene.snapSize) * scene.snapSize;
      mesh.position.y = Math.round(mesh.position.y / scene.snapSize) * scene.snapSize;
      mesh.position.z = Math.round(mesh.position.z / scene.snapSize) * scene.snapSize;
    }

    scene.addObject(mesh);
    createdMeshes.push(mesh);
  });

  scene.selectObject(createdMeshes[createdMeshes.length - 1]);
  hierarchy.refresh();

  history.push({
    label: `Create ${count} assets`,
    undo: () => {
      createdMeshes.forEach(m => scene.removeObject(m));
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
  scene.selectObject(mesh);
  hierarchy.refresh();

  history.push({
    label: `Create ${mesh.name}`,
    undo: () => { scene.removeObject(mesh); hierarchy.refresh(); },
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
      clones.forEach(c => scene.removeObject(c)); 
      hierarchy.refresh(); 
    },
    redo: () => { 
      clones.forEach(c => scene.addObject(c)); 
      hierarchy.refresh(); 
    }
  });
 
  showToast(`Duplicated ${selection.length} object(s)`);
}

function deleteSelected() {
  const selection = [...scene.selectedObjects];
  if (selection.length === 0) return;
 
  const count = selection.length;
  // Store data for undo
  const records = selection.map(obj => ({
    obj,
    name: obj.name,
    parent: obj.parent,
    pos: obj.position.clone(),
    rot: obj.rotation.clone(),
    scl: obj.scale.clone()
  }));
 
  selection.forEach(obj => scene.removeObject(obj));
  hierarchy.refresh();
 
  history.push({
    label: `Delete ${count} objects`,
    undo: () => {
      records.forEach(r => {
        r.obj.position.copy(r.pos);
        r.obj.rotation.copy(r.rot);
        r.obj.scale.copy(r.scl);
        scene.addObject(r.obj);
      });
      hierarchy.refresh();
    },
    redo: () => {
      records.forEach(r => scene.removeObject(r.obj));
      hierarchy.refresh();
    }
  });
 
  showToast(`Deleted ${count} object(s)`);
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

// Draw tool buttons
document.getElementById('btn-tool-line').addEventListener('click', () => setToolMode('line'));
document.getElementById('btn-tool-rectangle').addEventListener('click', () => setToolMode('rectangle'));
document.getElementById('btn-tool-push-pull').addEventListener('click', () => setToolMode('push-pull'));

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

// Grid size
document.getElementById('input-grid-size').addEventListener('change', (e) => {
  const size = parseFloat(e.target.value) || 32;
  scene.updateGrid(size);
  showToast(`Grid size updated to ${size}px`);
});
 
// Snap toggle
let snapOn = false;
document.getElementById('btn-snap').addEventListener('click', () => {
  snapOn = !snapOn;
  scene.setSnap(snapOn);
  document.getElementById('btn-snap').classList.toggle('active', snapOn);
  showToast(snapOn ? 'Snap ON' : 'Snap OFF');
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
document.getElementById('btn-export-gltf').addEventListener('click', async () => {
  showToast('Exporting GLTF...');
  try {
    await GLTFExportManager.export(scene.exportGroup, 'sprite3d-model');
    showToast('GLTF exported!');
  } catch (e) {
    showToast('Export failed: ' + e.message);
  }
});

document.getElementById('btn-export-obj').addEventListener('click', () => {
  showToast('Exporting OBJ...');
  try {
    OBJExportManager.export(scene.exportGroup, 'sprite3d-model');
    showToast('OBJ exported!');
  } catch (e) {
    showToast('Export failed: ' + e.message);
  }
});

document.getElementById('btn-export-godot').addEventListener('click', async () => {
  showToast('Exporting Godot MeshLibrary...');
  try {
    await GodotExportManager.exportLibrary(scene.exportGroup, 'sprite3d_meshlibrary');
    showToast('Godot MeshLibrary exported!');
  } catch (e) {
    showToast('Export failed: ' + e.message);
  }
});

// ──────────────────────────────────────────────
//  Keyboard Shortcuts
// ──────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  // Ignore if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key.toLowerCase()) {
    case 'w': setTransformBtn('translate'); break;
    case 'e': setTransformBtn('rotate'); break;
    case 'r': setTransformBtn('scale'); break;
    case 'g':
      snapOn = !snapOn;
      scene.setSnap(snapOn);
      document.getElementById('btn-snap').classList.toggle('active', snapOn);
      showToast(snapOn ? 'Snap ON' : 'Snap OFF');
      break;
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
    case 'escape':
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

// ──────────────────────────────────────────────
//  Project Save / Load
// ──────────────────────────────────────────────

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

  const project = {
    version: 1,
    assets: assetPanel.assets.map(a => ({
      name: a.name,
      dataUrl: a.dataUrl
    })),
    objects: scene.objects.map(obj => {
      const pos = obj.position;
      const rot = obj.rotation;
      const scl = obj.scale;
      return {
        name: obj.name,
        type: obj.userData.type,
        textureName: obj.userData.textureName || '',
        originalWidth: obj.userData.originalWidth,
        originalHeight: obj.userData.originalHeight,
        extrusionDepth: obj.userData.extrusionDepth,
        position: [pos.x, pos.y, pos.z],
        rotation: [rot.x, rot.y, rot.z],
        scale: [scl.x, scl.y, scl.z],
        uvRepeat: obj.userData.uvRepeat || [1, 1],
        uvOffset: obj.userData.uvOffset || [0, 0]
      };
    })
  };

  const json = JSON.stringify(project);

  if (fileHandle) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
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
    showToast('Project saved!');
  }
}

function loadProject(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const project = JSON.parse(e.target.result);
      if (!project.assets || !project.objects) throw new Error('Invalid project file');
      
      // Clear current state
      scene.clear();
      hierarchy.refresh();
      history.clear();
      propsPanel.showEmpty();
      
      // Clear UI assets
      assetPanel.assets = [];
      assetPanel.selectedAsset = null;
      document.getElementById('asset-grid').innerHTML = '';
      
      // Load images asynchronously
      let loadedAssets = 0;
      const totalAssets = project.assets.length;
      
      if (totalAssets === 0) {
        reconstructObjects(project.objects);
        return;
      }
      
      project.assets.forEach(assetData => {
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
          
          loadedAssets++;
          if (loadedAssets === totalAssets) {
            reconstructObjects(project.objects);
          }
        };
        img.src = assetData.dataUrl;
      });
      
    } catch (err) {
      showToast('Error loading project');
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function reconstructObjects(objectDataList) {
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
    
    if (data.type === 'plane') mesh = QuadFactory.createPlane(data.originalWidth, data.originalHeight);
    else if (data.type === 'cube') mesh = QuadFactory.createCube(data.originalWidth, data.originalHeight, data.extrusionDepth);
    else if (data.type === 'cylinder') mesh = QuadFactory.createCylinder(data.originalWidth/2, data.originalHeight);
    else if (data.type === 'quad' || data.type === 'box') {
       if (baseTex) {
         mesh = QuadFactory.createQuad(baseTex, data.name);
       } else {
          mesh = QuadFactory.createPlane(data.originalWidth, data.originalHeight);
       }
    } else continue;
    
    mesh.name = data.name;
    mesh.position.set(...data.position);
    mesh.rotation.set(...data.rotation);
    mesh.scale.set(...data.scale);
    
    // Apply texture to primitives
    if (baseTex && (data.type === 'plane' || data.type === 'cube' || data.type === 'cylinder')) {
        QuadFactory.applyTexture(mesh, baseTex);
    }
    
    // Re-apply extrusion if it was an extruded quad
    if (data.type === 'box' && data.extrusionDepth > 0 && baseTex) {
       QuadFactory.extrudeQuad(mesh, data.extrusionDepth);
    }
    
    // Setup and apply UV Mapping (Tiling/Offset)
    mesh.userData.uvRepeat = data.uvRepeat || [1, 1];
    mesh.userData.uvOffset = data.uvOffset || [0, 0];

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
  }
  
  hierarchy.refresh();
  showToast('Project loaded successfully');
}

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

// ──────────────────────────────────────────────
//  Render Loop
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
//  Context Menu
// ──────────────────────────────────────────────
 
const contextMenu = document.getElementById('context-menu');
let contextTarget = null;

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
  if (!picked) {
    contextMenu.style.display = 'none';
    return;
  }
 
  contextTarget = picked;
  scene.selectObject(picked, false); // select it
 
  contextMenu.style.display = 'block';
  
  // Ensure menu stays within screen bounds
  const menuWidth = 180; 
  const menuHeight = 200;
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
});
 
document.getElementById('menu-duplicate').addEventListener('click', () => {
  duplicateSelected();
  contextMenu.style.display = 'none';
});
 
document.getElementById('menu-delete').addEventListener('click', () => {
  deleteSelected();
  contextMenu.style.display = 'none';
});
 
document.getElementById('menu-export-uv').addEventListener('click', async () => {
  const target = contextTarget;
  if (target) {
    try {
      const resolution = getRecommendedUVResolution(target);
      await UVExporter.generateRealLayout(target, resolution);
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

        try {
          // Keep loading flow identical to export flow:
          // always ensure real UVs exist before applying custom texture.
          await UVExporter.applyRealUVToMesh(target);
        } catch (unwrapErr) {
          showToast(`Failed to apply real UV on ${target.name}: ${unwrapErr.message}`);
          return;
        }
 
        UVExporter.applyAtlas(target, texture);
        showToast(`Custom texture applied to ${target.name}`);
      };
      img.src = rev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
  contextMenu.style.display = 'none';
});
 
function animate() {
  requestAnimationFrame(animate);
  scene.render();
}
 
animate();

// Initial UI state
showToast('Sprite3D ready — drop PNG files to begin');

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
