import { QuadFactory } from '../editor/QuadFactory.js';
import { cloneVoxelState } from '../editor/PixelUtils.js';

/**
 * PropertiesPanel — Shows selected object properties with transform inputs, 
 * extrusion slider, texture application, and action buttons.
 */
export class PropertiesPanel {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.body = document.getElementById('properties-body');
    this.currentMesh = null;
    this.onExtrusionChanged = null;
    this.onPropertyChanged = null;
    this.onVoxelizeChanged = null;
    this.onDuplicate = null;
    this.onDelete = null;
    this.onApplyTexture = null;
    this.onReliefExtract = null;
    this.onReliefSubtract = null;
    this.onReliefSeparate = null;
    this.onReliefClearSelection = null;
    this.onReliefToleranceChanged = null;
    this.onReliefDepthStepChanged = null;
    this.onReliefActivateTool = null;
    this.onReliefInteractionModeChanged = null;
    this.onReliefSelectionModeChanged = null;
    this.onReliefLoadHeightmap = null;
    this.onReliefApplyLuminance = null;
    this.onReliefClearHeightmap = null;
    this.onReliefHeightSettingsChanged = null;
    this.onBrushActivateTool = null;
    this.onBrushSizeChanged = null;
    this.onBrushColorChanged = null;
    this.onBrushModeChanged = null;
    this.reliefSelectionMode = 'wand';
    this.reliefInteractionMode = 'direct';
    this.brushSize = 1;
    this.brushColor = '#6382ff';
    this.brushMode = 'paint';

    this.showEmpty();
  }

  showEmpty() {
    this.currentMesh = null;
    this.body.innerHTML = '<div class="prop-empty"><strong>Sin selección</strong><span>Elegí un objeto en la escena para editarlo.</span></div>';
  }

  showProperties(mesh) {
    if (!mesh) { this.showEmpty(); return; }
    this.currentMesh = mesh;

    const pos = mesh.position;
    const rot = mesh.rotation;
    const scl = mesh.scale;
    const isSceneGroup = !!mesh.userData?.isSceneGroup;
    const depth = mesh.userData.extrusionDepth || 0;
    const objType = mesh.userData.type || 'quad';
    const hasTexture = !!(mesh.userData.texture);

    // Show extrusion only for quads (flat planes that can be extruded)
    const showExtrusion = !isSceneGroup && (objType === 'quad' || objType === 'box');
    const showVoxelRelief = !isSceneGroup && objType === 'voxel';
    const selectedPixels = mesh.userData.voxelSelection
      ? mesh.userData.voxelSelection.reduce((n, v) => n + (v ? 1 : 0), 0)
      : 0;
    const heightMax = mesh.userData.voxelHeightMax ?? 8;
    const heightInvert = !!mesh.userData.voxelHeightInvert;
    const heightmapLabel = mesh.userData.voxelHeightmapName
      ? mesh.userData.voxelHeightmapName
      : 'None';

    this.body.innerHTML = `
      <div class="prop-section">
        <div class="prop-section-title">Nombre</div>
        <input type="text" class="prop-input" id="prop-name" value="${mesh.name}" style="width:100%;margin-bottom:8px">
      </div>

      ${isSceneGroup ? `
      <div class="prop-section group-summary">
        <div class="prop-section-title">Grupo</div>
        <div style="font-size:12px;color:var(--text-secondary)">
          ${mesh.children.length} objeto${mesh.children.length !== 1 ? 's' : ''} agrupado${mesh.children.length !== 1 ? 's' : ''}
        </div>
        <small style="display:block;margin-top:6px;color:var(--text-muted)">
          Al exportar se incluir&aacute; &uacute;nicamente este grupo.
        </small>
      </div>
      ` : ''}

      <details class="properties-advanced">
        <summary>Posición, rotación y escala</summary>
        <div class="prop-section">
        <div class="prop-section-title">Posición</div>
        <div class="prop-row">
          <span class="prop-label x">X</span>
          <input type="number" step="0.1" class="prop-input" id="prop-px" value="${pos.x.toFixed(3)}">
        </div>
        <div class="prop-row">
          <span class="prop-label y">Y</span>
          <input type="number" step="0.1" class="prop-input" id="prop-py" value="${pos.y.toFixed(3)}">
        </div>
        <div class="prop-row">
          <span class="prop-label z">Z</span>
          <input type="number" step="0.1" class="prop-input" id="prop-pz" value="${pos.z.toFixed(3)}">
        </div>
      </div>

        <div class="prop-section">
        <div class="prop-section-title">Rotación (°)</div>
        <div class="prop-row">
          <span class="prop-label x">X</span>
          <input type="number" step="5" class="prop-input" id="prop-rx" value="${(rot.x * 180 / Math.PI).toFixed(1)}">
        </div>
        <div class="prop-row">
          <span class="prop-label y">Y</span>
          <input type="number" step="5" class="prop-input" id="prop-ry" value="${(rot.y * 180 / Math.PI).toFixed(1)}">
        </div>
        <div class="prop-row">
          <span class="prop-label z">Z</span>
          <input type="number" step="5" class="prop-input" id="prop-rz" value="${(rot.z * 180 / Math.PI).toFixed(1)}">
        </div>
      </div>

        <div class="prop-section">
        <div class="prop-section-title">Escala</div>
        <div class="prop-row">
          <span class="prop-label x">X</span>
          <input type="number" step="0.1" class="prop-input" id="prop-sx" value="${scl.x.toFixed(3)}">
        </div>
        <div class="prop-row">
          <span class="prop-label y">Y</span>
          <input type="number" step="0.1" class="prop-input" id="prop-sy" value="${scl.y.toFixed(3)}">
        </div>
        <div class="prop-row">
          <span class="prop-label z">Z</span>
          <input type="number" step="0.1" class="prop-input" id="prop-sz" value="${scl.z.toFixed(3)}">
        </div>
        </div>
      </details>

      ${showExtrusion ? `
      <div class="prop-section">
        <div class="prop-section-title">Volumen</div>
        <div class="prop-slider-row">
          <span class="prop-slider-label">Grosor</span>
          <input type="range" class="prop-slider" id="prop-extrude" min="0" max="128" step="1" value="${depth}">
          <input type="number" class="prop-input" id="prop-extrude-num" min="0" max="512" step="1" value="${depth.toFixed(1)}" style="width:60px;margin-left:8px">
        </div>
        <div class="prop-row" style="margin-top:8px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text-secondary)">
            <input type="checkbox" id="prop-texture-sides" ${mesh.userData.textureSides !== false ? 'checked' : ''}>
            Repetir textura en los laterales
          </label>
        </div>
        <div class="prop-row" style="margin-top:6px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text-secondary)">
            <input type="checkbox" id="prop-voxelize" ${mesh.userData.voxelized ? 'checked' : ''} ${!hasTexture ? 'disabled' : ''}>
            <span style="display:flex;flex-direction:column;gap:1px">
              <strong style="color:var(--text-primary);font-weight:600">Convertir en vóxeles</strong>
              <span style="font-size:11px">Cada píxel se vuelve un cubo 3D</span>
            </span>
          </label>
        </div>
        <small style="color:var(--text-muted);display:block;margin-top:4px;margin-bottom:8px">
          Deslizá para dar profundidad al sprite.
        </small>
      </div>
      ` : ''}

      ${showVoxelRelief ? `
      <div class="prop-section">
        <div class="prop-section-title">Pixel Brush</div>
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <button type="button" class="prop-btn relief-mode-btn ${this.brushMode === 'paint' ? 'active' : ''}" id="btn-brush-paint" style="flex:1;padding:6px 4px;font-size:11px">
            <span class="material-symbols-rounded" style="font-size:16px">brush</span>
            Pintar
          </button>
          <button type="button" class="prop-btn relief-mode-btn ${this.brushMode === 'erase' ? 'active' : ''}" id="btn-brush-erase" style="flex:1;padding:6px 4px;font-size:11px">
            <span class="material-symbols-rounded" style="font-size:16px">ink_eraser</span>
            Borrar
          </button>
        </div>
        <div class="prop-slider-row">
          <span class="prop-slider-label">Tamaño</span>
          <input type="range" class="prop-slider" id="prop-brush-size" min="1" max="16" step="1" value="${this.brushSize}">
          <input type="number" class="prop-input" id="prop-brush-size-num" min="1" max="16" step="1" value="${this.brushSize}" style="width:60px;margin-left:8px">
        </div>
        <div class="prop-row" style="margin-top:8px">
          <span class="prop-label" style="width:52px">Color</span>
          <input type="color" id="prop-brush-color" value="${this.brushColor}" style="width:42px;height:30px;padding:2px;border:1px solid var(--border);border-radius:5px;background:var(--bg-input);cursor:pointer">
          <small style="color:var(--text-muted)">Click y arrastrá sobre el sprite</small>
        </div>
        <button class="prop-btn prop-btn-accent" id="btn-brush-activate" style="margin-top:8px;margin-bottom:12px">
          <span class="material-symbols-rounded">brush</span>
          Activar brush (V)
        </button>

        <div class="prop-section-title">Voxel Relief (Relieve)</div>
        <div class="relief-interaction-card">
          <div class="relief-interaction-title">Modo de trabajo</div>
          <div class="relief-interaction-row">
            <button type="button" class="prop-btn relief-interaction-btn ${this.reliefInteractionMode === 'direct' ? 'active' : ''}" data-relief-interaction="direct">
              <span class="material-symbols-rounded">open_in_full</span>
              Relieve directo
            </button>
            <button type="button" class="prop-btn relief-interaction-btn ${this.reliefInteractionMode === 'select' ? 'active' : ''}" data-relief-interaction="select">
              <span class="material-symbols-rounded">select_all</span>
              Selección avanzada
            </button>
          </div>
          <small class="relief-interaction-help" id="prop-relief-interaction-help">
            ${this.reliefInteractionMode === 'direct'
              ? 'Apuntá una cara voxel y arrastrá: arriba extrae, abajo sustrae.'
              : 'Conserva Varita, Píxel y Área para seleccionar varias caras antes de aplicar profundidad.'}
          </small>
        </div>
        <div id="relief-selection-controls" style="${this.reliefInteractionMode === 'select' ? '' : 'display:none'}">
        <div class="prop-section-title" style="margin-top:0;margin-bottom:6px;font-size:11px;color:var(--text-muted)">Selection mode</div>
        <div class="relief-mode-row" style="display:flex;gap:4px;margin-bottom:10px">
          <button type="button" class="prop-btn relief-mode-btn ${this._reliefModeActive('wand')}" data-relief-mode="wand" style="flex:1;padding:6px 4px;font-size:11px">
            <span class="material-symbols-rounded" style="font-size:16px">auto_fix</span>
            Wand
          </button>
          <button type="button" class="prop-btn relief-mode-btn ${this._reliefModeActive('pixel')}" data-relief-mode="pixel" style="flex:1;padding:6px 4px;font-size:11px">
            <span class="material-symbols-rounded" style="font-size:16px">ads_click</span>
            Pixel
          </button>
          <button type="button" class="prop-btn relief-mode-btn ${this._reliefModeActive('area')}" data-relief-mode="area" style="flex:1;padding:6px 4px;font-size:11px">
            <span class="material-symbols-rounded" style="font-size:16px">crop_free</span>
            Area
          </button>
        </div>
        <div class="prop-slider-row" id="prop-relief-tolerance-row">
          <span class="prop-slider-label">Tolerance</span>
          <input type="range" class="prop-slider" id="prop-relief-tolerance" min="0" max="128" step="1" value="32">
          <input type="number" class="prop-input" id="prop-relief-tolerance-num" min="0" max="255" step="1" value="32" style="width:60px;margin-left:8px">
        </div>
        <div class="prop-slider-row" style="margin-top:8px">
          <span class="prop-slider-label">Depth step</span>
          <input type="range" class="prop-slider" id="prop-relief-depth-step" min="1" max="8" step="1" value="1">
          <input type="number" class="prop-input" id="prop-relief-depth-step-num" min="1" max="32" step="1" value="1" style="width:60px;margin-left:8px">
        </div>
        <small style="color:var(--text-muted);display:block;margin-top:6px;margin-bottom:8px" id="prop-relief-hint">
          ${this._reliefModeHint()}
        </small>
        <div style="margin-bottom:8px;font-size:12px;color:var(--text-secondary)" id="prop-relief-selection-count">
          ${selectedPixels} pixel${selectedPixels !== 1 ? 's' : ''} selected
        </div>
        <button class="prop-btn prop-btn-accent" id="btn-relief-wand" style="margin-bottom:6px">
          <span class="material-symbols-rounded">draw</span>
          Activate Relief Tool (M)
        </button>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <button class="prop-btn" id="btn-relief-extract" style="flex:1">
            <span class="material-symbols-rounded">add</span>
            Extract (+)
          </button>
          <button class="prop-btn" id="btn-relief-subtract" style="flex:1">
            <span class="material-symbols-rounded">remove</span>
            Subtract (−)
          </button>
        </div>
        <button class="prop-btn prop-btn-accent" id="btn-relief-separate" style="margin-bottom:6px" ${selectedPixels === 0 ? 'disabled' : ''}>
          <span class="material-symbols-rounded">call_split</span>
          Separar selección como pieza
        </button>
        <button class="prop-btn" id="btn-relief-clear">
          <span class="material-symbols-rounded">deselect</span>
          Clear Selection
        </button>
        </div>
        <div class="dropdown-divider" style="margin:12px 0;opacity:0.35"></div>
        <div class="prop-section-title" style="margin-bottom:6px">Heightmap (Mapa de grises)</div>
        <div style="margin-bottom:8px;font-size:12px;color:var(--text-secondary);word-break:break-all">
          ${heightmapLabel}
        </div>
        <div class="prop-slider-row">
          <span class="prop-slider-label">Max height</span>
          <input type="range" class="prop-slider" id="prop-height-max" min="0" max="32" step="1" value="${heightMax}">
          <input type="number" class="prop-input" id="prop-height-max-num" min="0" max="64" step="1" value="${heightMax}" style="width:60px;margin-left:8px">
        </div>
        <div class="prop-row" style="margin-top:8px;margin-bottom:8px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text-secondary)">
            <input type="checkbox" id="prop-height-invert" ${heightInvert ? 'checked' : ''}>
            Invert (negro = alto)
          </label>
        </div>
        <small style="color:var(--text-muted);display:block;margin-bottom:8px">
          Blanco = máximo volumen. Solo afecta píxeles opacos del sprite.
        </small>
        <button class="prop-btn" id="btn-height-luminance" style="margin-bottom:6px">
          <span class="material-symbols-rounded">gradient</span>
          Apply from sprite luminance
        </button>
        <button class="prop-btn" id="btn-height-load" style="margin-bottom:6px">
          <span class="material-symbols-rounded">upload</span>
          Load grayscale PNG…
        </button>
        <button class="prop-btn" id="btn-height-clear">
          <span class="material-symbols-rounded">layers_clear</span>
          Clear volume / heightmap
        </button>
      </div>
      ` : ''}

      ${!isSceneGroup ? `<div class="prop-section">
        <div class="prop-section-title">Textura</div>
        <div style="margin-bottom:8px;text-align:center;padding:6px;background:var(--bg-input);border-radius:var(--radius-sm);font-size:12px;color:var(--text-secondary)">
          ${hasTexture ? `✓ ${mesh.userData.textureName || 'Aplicada'}` : 'Sin textura'}
        </div>
        <button class="prop-btn prop-btn-accent" id="btn-apply-tex" style="margin-bottom:6px">
          <span class="material-symbols-rounded">texture</span>
          Aplicar sprite seleccionado
        </button>
        <small style="color:var(--text-muted);display:block;margin-top:-2px;margin-bottom:8px">
          Elegí primero un sprite del panel izquierdo.
        </small>
      </div>
      ` : ''}

      ${!isSceneGroup && hasTexture ? `
      <div class="prop-section">
        <div class="prop-section-title">Texture Mapping</div>
        <div class="prop-row">
          <span class="prop-label" style="width:40px">Scale X</span>
          <input type="number" step="0.1" class="prop-input" id="prop-tex-rx" value="${(mesh.userData.uvRepeat && mesh.userData.uvRepeat[0] !== undefined) ? mesh.userData.uvRepeat[0] : 1}">
        </div>
        <div class="prop-row">
          <span class="prop-label" style="width:40px">Scale Y</span>
          <input type="number" step="0.1" class="prop-input" id="prop-tex-ry" value="${(mesh.userData.uvRepeat && mesh.userData.uvRepeat[1] !== undefined) ? mesh.userData.uvRepeat[1] : 1}">
        </div>
        <div class="prop-row" style="margin-top:4px">
          <span class="prop-label" style="width:40px">Offset X</span>
          <input type="number" step="0.1" class="prop-input" id="prop-tex-ox" value="${(mesh.userData.uvOffset && mesh.userData.uvOffset[0] !== undefined) ? mesh.userData.uvOffset[0] : 0}">
        </div>
        <div class="prop-row">
          <span class="prop-label" style="width:40px">Offset Y</span>
          <input type="number" step="0.1" class="prop-input" id="prop-tex-oy" value="${(mesh.userData.uvOffset && mesh.userData.uvOffset[1] !== undefined) ? mesh.userData.uvOffset[1] : 0}">
        </div>
        <div class="prop-row" style="margin-top:8px;display:block">
          <label style="display:flex;align-items:flex-start;gap:6px;font-size:12px;cursor:pointer;color:var(--text-secondary)">
            <input type="checkbox" id="prop-tex-repeat-scale" ${mesh.userData.textureRepeatOnScale ? 'checked' : ''}>
            <span style="display:flex;flex-direction:column;gap:2px">
              <strong style="color:var(--text-primary);font-weight:600">Repetir al redimensionar</strong>
              <span style="font-size:11px;color:var(--text-muted)">Mantiene el tamaño visual de una textura seamless al escalar.</span>
            </span>
          </label>
        </div>
      </div>
      ` : ''}

      <div class="prop-section">
        <div class="prop-section-title">Acciones</div>
        <button class="prop-btn" id="btn-duplicate" style="margin-bottom:6px">
          <span class="material-symbols-rounded">content_copy</span>
          Duplicar (Ctrl+D)
        </button>
        <button class="prop-btn" id="btn-delete" style="color:var(--danger)">
          <span class="material-symbols-rounded">delete</span>
          Eliminar (Supr)
        </button>
      </div>
    `;

    this._bindInputs(mesh);
    if (showVoxelRelief) {
      this._bindBrushControls(mesh);
      this._bindReliefControls(mesh);
    }
  }

  _bindBrushControls(mesh) {
    const sizeSlider = document.getElementById('prop-brush-size');
    const sizeInput = document.getElementById('prop-brush-size-num');
    const syncSize = (value) => {
      this.brushSize = Math.max(1, Math.min(16, Math.round(Number(value) || 1)));
      if (sizeSlider) sizeSlider.value = this.brushSize;
      if (sizeInput) sizeInput.value = this.brushSize;
      if (this.onBrushSizeChanged) this.onBrushSizeChanged(this.brushSize);
    };

    sizeSlider?.addEventListener('input', (e) => syncSize(e.target.value));
    sizeInput?.addEventListener('change', (e) => syncSize(e.target.value));
    this._on('prop-brush-color', 'input', (e) => {
      this.brushColor = e.target.value;
      if (this.onBrushColorChanged) this.onBrushColorChanged(this.brushColor);
    });
    this._on('btn-brush-paint', 'click', () => {
      this.brushMode = 'paint';
      if (this.onBrushModeChanged) this.onBrushModeChanged(this.brushMode);
      this.showProperties(mesh);
    });
    this._on('btn-brush-erase', 'click', () => {
      this.brushMode = 'erase';
      if (this.onBrushModeChanged) this.onBrushModeChanged(this.brushMode);
      this.showProperties(mesh);
    });
    this._on('btn-brush-activate', 'click', () => {
      if (this.onBrushActivateTool) this.onBrushActivateTool(mesh);
    });
  }

  _bindInputs(mesh) {
    // Name
    const nameInput = document.getElementById('prop-name');
    let nameBefore = mesh.name;
    nameInput?.addEventListener('focus', () => { nameBefore = mesh.name; });
    nameInput?.addEventListener('input', (e) => { mesh.name = e.target.value; });
    nameInput?.addEventListener('change', () => {
      const after = mesh.name;
      this._emitPropertyChanged(mesh, 'name', nameBefore, after, 'Rename');
      nameBefore = after;
    });

    // Position
    const transformBefore = () => this._captureTransform(mesh);
    const applyPosition = (axis, value) => {
      const before = transformBefore();
      mesh.position[axis] = value;
      this._emitPropertyChanged(mesh, 'transform', before, transformBefore(), 'Transform');
    };
    this._on('prop-px', 'change', (e) => applyPosition('x', parseFloat(e.target.value) || 0));
    this._on('prop-py', 'change', (e) => applyPosition('y', parseFloat(e.target.value) || 0));
    this._on('prop-pz', 'change', (e) => applyPosition('z', parseFloat(e.target.value) || 0));

    // Rotation
    const setRotation = (axis, value) => {
      const before = transformBefore();
      mesh.rotation[axis] = value;
      this._emitPropertyChanged(mesh, 'transform', before, transformBefore(), 'Transform');
    };
    this._on('prop-rx', 'change', (e) => setRotation('x', (parseFloat(e.target.value) || 0) * Math.PI / 180));
    this._on('prop-ry', 'change', (e) => setRotation('y', (parseFloat(e.target.value) || 0) * Math.PI / 180));
    this._on('prop-rz', 'change', (e) => setRotation('z', (parseFloat(e.target.value) || 0) * Math.PI / 180));

    // Scale
    const setScale = (axis, value) => {
      const before = transformBefore();
      mesh.scale[axis] = value;
      this._emitPropertyChanged(mesh, 'transform', before, transformBefore(), 'Transform');
    };
    this._on('prop-sx', 'change', (e) => setScale('x', parseFloat(e.target.value) || 1));
    this._on('prop-sy', 'change', (e) => setScale('y', parseFloat(e.target.value) || 1));
    this._on('prop-sz', 'change', (e) => setScale('z', parseFloat(e.target.value) || 1));

    // Extrusion slider & numeric input
    const slider = document.getElementById('prop-extrude');
    const numInput = document.getElementById('prop-extrude-num');
    const texSidesCheckbox = document.getElementById('prop-texture-sides');
    let extrusionBefore = this._captureExtrusion(mesh, texSidesCheckbox);

    const applyExtrusion = (newDepth) => {
      const textureSides = texSidesCheckbox ? texSidesCheckbox.checked : true;
      QuadFactory.extrudeQuad(mesh, newDepth, textureSides);
    };

    const beginExtrusionEdit = () => {
      extrusionBefore = this._captureExtrusion(mesh, texSidesCheckbox);
    };
    const commitExtrusionEdit = () => {
      const after = this._captureExtrusion(mesh, texSidesCheckbox);
      this._emitPropertyChanged(mesh, 'extrusion', extrusionBefore, after, 'Extrusion');
      extrusionBefore = after;
      if (this.onExtrusionChanged) this.onExtrusionChanged(mesh, after.depth);
    };

    if (slider) {
      slider.addEventListener('focus', beginExtrusionEdit);
      slider.addEventListener('pointerdown', beginExtrusionEdit);
      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) || 0;
        if (numInput) numInput.value = val.toFixed(1);
        applyExtrusion(val);
      });
      slider.addEventListener('change', commitExtrusionEdit);
    }

    if (numInput) {
      numInput.addEventListener('focus', beginExtrusionEdit);
      numInput.addEventListener('change', (e) => {
        const val = Math.max(0, parseFloat(e.target.value) || 0);
        if (slider) slider.value = Math.min(128, val);
        applyExtrusion(val);
        commitExtrusionEdit();
      });
    }

    if (texSidesCheckbox) {
      texSidesCheckbox.addEventListener('focus', beginExtrusionEdit);
      texSidesCheckbox.addEventListener('pointerdown', beginExtrusionEdit);
      texSidesCheckbox.addEventListener('change', () => {
        const d = mesh.userData.extrusionDepth || 0;
        applyExtrusion(d);
        commitExtrusionEdit();
      });
    }

    // Voxelize toggle
    const voxelizeCheckbox = document.getElementById('prop-voxelize');
    if (voxelizeCheckbox) {
      voxelizeCheckbox.addEventListener('change', (e) => {
        const wasVoxelized = !!mesh.userData.voxelized;
        const beforeVoxelState = cloneVoxelState(mesh);
        if (e.target.checked) {
          QuadFactory.voxelizeSprite(mesh);
          if (slider) slider.disabled = true;
          if (numInput) numInput.disabled = true;
          if (texSidesCheckbox) texSidesCheckbox.disabled = true;
        } else {
          QuadFactory.devoxelizeSprite(mesh);
          if (slider) slider.disabled = false;
          if (numInput) numInput.disabled = false;
          if (texSidesCheckbox) texSidesCheckbox.disabled = false;
        }
        if (this.onVoxelizeChanged) {
          this.onVoxelizeChanged(mesh, e.target.checked, wasVoxelized, beforeVoxelState);
        }
        this.showProperties(mesh);
      });
    }

    // Apply texture
    this._on('btn-apply-tex', 'click', () => {
      if (this.onApplyTexture) this.onApplyTexture(mesh);
    });

    // Texture Mapping
    const updateTextureMapping = () => {
      const before = {
        repeat: [...(mesh.userData.uvRepeat || [1, 1])],
        offset: [...(mesh.userData.uvOffset || [0, 0])],
        baseUV: [...(mesh.userData.textureRepeatBaseUV || mesh.userData.uvRepeat || [1, 1])],
      };
      const rx = parseFloat(document.getElementById('prop-tex-rx')?.value ?? 1);
      const ry = parseFloat(document.getElementById('prop-tex-ry')?.value ?? 1);
      const ox = parseFloat(document.getElementById('prop-tex-ox')?.value ?? 0);
      const oy = parseFloat(document.getElementById('prop-tex-oy')?.value ?? 0);

      mesh.userData.uvRepeat = [rx, ry];
      mesh.userData.uvOffset = [ox, oy];

      if (mesh.userData.textureRepeatOnScale) {
        const baseScale = mesh.userData.textureRepeatBaseScale || [mesh.scale.x, mesh.scale.y];
        mesh.userData.textureRepeatBaseUV = [
          rx / Math.abs(mesh.scale.x / (baseScale[0] || 1)),
          ry / Math.abs(mesh.scale.y / (baseScale[1] || 1)),
        ];
      }

      const applyMappingToMaterial = (mat) => {
        if (mat && mat.map) {
          mat.map.repeat.set(rx, ry);
          mat.map.offset.set(ox, oy);
          mat.map.needsUpdate = true;
        }
      };

      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(applyMappingToMaterial);
      } else {
        applyMappingToMaterial(mesh.material);
      }

      this._emitPropertyChanged(mesh, 'mapping', before, {
        repeat: [...mesh.userData.uvRepeat],
        offset: [...mesh.userData.uvOffset],
        baseUV: [...(mesh.userData.textureRepeatBaseUV || [1, 1])],
      }, 'Texture Mapping');
    };

    this._on('prop-tex-rx', 'change', updateTextureMapping);
    this._on('prop-tex-ry', 'change', updateTextureMapping);
    this._on('prop-tex-ox', 'change', updateTextureMapping);
    this._on('prop-tex-oy', 'change', updateTextureMapping);

    const repeatOnScaleCheckbox = document.getElementById('prop-tex-repeat-scale');
    if (repeatOnScaleCheckbox) {
      repeatOnScaleCheckbox.addEventListener('change', (e) => {
        const before = {
          enabled: !!mesh.userData.textureRepeatOnScale,
          baseScale: [...(mesh.userData.textureRepeatBaseScale || [mesh.scale.x, mesh.scale.y])],
          baseUV: [...(mesh.userData.textureRepeatBaseUV || mesh.userData.uvRepeat || [1, 1])],
          repeat: [...(mesh.userData.uvRepeat || [1, 1])],
        };

        mesh.userData.textureRepeatOnScale = e.target.checked;
        if (e.target.checked) {
          mesh.userData.textureRepeatBaseScale = [mesh.scale.x, mesh.scale.y];
          mesh.userData.textureRepeatBaseUV = [...(mesh.userData.uvRepeat || [1, 1])];
        }

        const after = {
          enabled: !!mesh.userData.textureRepeatOnScale,
          baseScale: [...(mesh.userData.textureRepeatBaseScale || [mesh.scale.x, mesh.scale.y])],
          baseUV: [...(mesh.userData.textureRepeatBaseUV || mesh.userData.uvRepeat || [1, 1])],
          repeat: [...(mesh.userData.uvRepeat || [1, 1])],
        };
        this._emitPropertyChanged(mesh, 'repeat-scale', before, after, 'Texture Scale Mode');
      });
    }

    // Duplicate
    this._on('btn-duplicate', 'click', () => {
      if (this.onDuplicate) this.onDuplicate(mesh);
    });

    // Delete
    this._on('btn-delete', 'click', () => {
      if (this.onDelete) this.onDelete(mesh);
    });
  }

  _bindReliefControls(mesh) {
    const tolSlider = document.getElementById('prop-relief-tolerance');
    const tolNum = document.getElementById('prop-relief-tolerance-num');
    const stepSlider = document.getElementById('prop-relief-depth-step');
    const stepNum = document.getElementById('prop-relief-depth-step-num');
    const tolRow = document.getElementById('prop-relief-tolerance-row');
    const selectionControls = document.getElementById('relief-selection-controls');

    document.querySelectorAll('.relief-interaction-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.reliefInteraction === 'select' ? 'select' : 'direct';
        this.reliefInteractionMode = mode;
        document.querySelectorAll('.relief-interaction-btn').forEach(b => b.classList.toggle('active', b === btn));
        if (selectionControls) selectionControls.style.display = mode === 'select' ? '' : 'none';
        const help = document.getElementById('prop-relief-interaction-help');
        if (help) {
          help.textContent = mode === 'direct'
            ? 'Apuntá una cara voxel y arrastrá: arriba extrae, abajo sustrae.'
            : 'Conserva Varita, Píxel y Área para seleccionar varias caras antes de aplicar profundidad.';
        }
        if (this.onReliefInteractionModeChanged) this.onReliefInteractionModeChanged(mode);
      });
    });

    if (tolRow) {
      tolRow.style.display = this.reliefSelectionMode === 'wand' ? '' : 'none';
    }

    const syncTolerance = (val) => {
      const v = Math.max(0, Math.min(255, val | 0));
      if (tolSlider) tolSlider.value = Math.min(128, v);
      if (tolNum) tolNum.value = v;
      if (this.onReliefToleranceChanged) this.onReliefToleranceChanged(v);
    };

    if (tolSlider) {
      tolSlider.addEventListener('input', (e) => syncTolerance(parseInt(e.target.value, 10)));
    }
    if (tolNum) {
      tolNum.addEventListener('change', (e) => syncTolerance(parseInt(e.target.value, 10)));
    }

    const syncDepthStep = (val) => {
      const v = Math.max(1, Math.min(32, val | 0));
      if (stepSlider) stepSlider.value = Math.min(8, v);
      if (stepNum) stepNum.value = v;
      if (this.onReliefDepthStepChanged) this.onReliefDepthStepChanged(v);
    };

    if (stepSlider) {
      stepSlider.addEventListener('input', (e) => syncDepthStep(parseInt(e.target.value, 10)));
    }
    if (stepNum) {
      stepNum.addEventListener('change', (e) => syncDepthStep(parseInt(e.target.value, 10)));
    }

    document.querySelectorAll('.relief-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.reliefMode;
        if (!mode) return;
        this.reliefSelectionMode = mode;
        document.querySelectorAll('.relief-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (tolRow) tolRow.style.display = mode === 'wand' ? '' : 'none';
        const hint = document.getElementById('prop-relief-hint');
        if (hint) hint.textContent = this._reliefModeHint(mode);
        if (this.onReliefSelectionModeChanged) this.onReliefSelectionModeChanged(mode);
      });
    });

    this._on('btn-relief-wand', 'click', () => {
      if (this.onReliefActivateTool) this.onReliefActivateTool();
    });
    this._on('btn-relief-extract', 'click', () => {
      if (this.onReliefExtract) this.onReliefExtract(mesh);
    });
    this._on('btn-relief-subtract', 'click', () => {
      if (this.onReliefSubtract) this.onReliefSubtract(mesh);
    });
    this._on('btn-relief-separate', 'click', () => {
      if (this.onReliefSeparate) this.onReliefSeparate(mesh);
    });
    this._on('btn-relief-clear', 'click', () => {
      if (this.onReliefClearSelection) this.onReliefClearSelection(mesh);
    });

    this._bindHeightmapControls(mesh);
  }

  _bindHeightmapControls(mesh) {
    const maxSlider = document.getElementById('prop-height-max');
    const maxNum = document.getElementById('prop-height-max-num');
    const invertCheckbox = document.getElementById('prop-height-invert');

    const syncHeightSettings = (reapply, recordHistory = false) => {
      const maxDepth = Math.max(0, Math.min(64, parseInt(maxNum?.value ?? 8, 10) || 0));
      const invert = invertCheckbox?.checked ?? false;
      if (maxSlider) maxSlider.value = Math.min(32, maxDepth);
      if (maxNum) maxNum.value = maxDepth;
      if (reapply && this.onReliefHeightSettingsChanged) {
        this.onReliefHeightSettingsChanged(mesh, { maxDepth, invert }, { recordHistory });
      }
    };

    if (maxSlider) {
      maxSlider.addEventListener('input', (e) => {
        if (maxNum) maxNum.value = e.target.value;
        syncHeightSettings(true, false);
      });
      maxSlider.addEventListener('change', () => syncHeightSettings(true, true));
    }
    if (maxNum) {
      maxNum.addEventListener('change', () => syncHeightSettings(true, true));
    }
    if (invertCheckbox) {
      invertCheckbox.addEventListener('change', () => syncHeightSettings(true, true));
    }

    this._on('btn-height-luminance', 'click', () => {
      if (this.onReliefApplyLuminance) this.onReliefApplyLuminance(mesh);
    });
    this._on('btn-height-load', 'click', () => {
      if (this.onReliefLoadHeightmap) this.onReliefLoadHeightmap(mesh);
    });
    this._on('btn-height-clear', 'click', () => {
      if (this.onReliefClearHeightmap) this.onReliefClearHeightmap(mesh);
    });
  }

  _reliefModeActive(mode) {
    return this.reliefSelectionMode === mode ? 'active' : '';
  }

  _reliefModeHint(mode = this.reliefSelectionMode) {
    if (mode === 'pixel') {
      return 'Píxel: click selecciona un voxel. Shift+click suma, Alt+click quita.';
    }
    if (mode === 'area') {
      return 'Área: arrastra un rectángulo sobre el sprite. Shift+arrastrar suma a la selección.';
    }
    return 'Varita: click selecciona píxeles similares. Shift+click suma, Alt+click quita.';
  }

  _captureTransform(mesh) {
    return {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
    };
  }

  _captureExtrusion(mesh, sidesCheckbox = null) {
    return {
      depth: mesh.userData.extrusionDepth || 0,
      textureSides: sidesCheckbox ? sidesCheckbox.checked : mesh.userData.textureSides !== false,
    };
  }

  _emitPropertyChanged(mesh, kind, before, after, label) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (this.onPropertyChanged) this.onPropertyChanged(mesh, { kind, before, after, label });
  }

  _on(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  }

  updateFromTransform(mesh) {
    if (mesh !== this.currentMesh) return;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && el !== document.activeElement) el.value = val;
    };

    setVal('prop-px', mesh.position.x.toFixed(3));
    setVal('prop-py', mesh.position.y.toFixed(3));
    setVal('prop-pz', mesh.position.z.toFixed(3));
    setVal('prop-rx', (mesh.rotation.x * 180 / Math.PI).toFixed(1));
    setVal('prop-ry', (mesh.rotation.y * 180 / Math.PI).toFixed(1));
    setVal('prop-rz', (mesh.rotation.z * 180 / Math.PI).toFixed(1));
    setVal('prop-sx', mesh.scale.x.toFixed(3));
    setVal('prop-sy', mesh.scale.y.toFixed(3));
    setVal('prop-sz', mesh.scale.z.toFixed(3));
    if (mesh.userData.textureRepeatOnScale) {
      setVal('prop-tex-rx', (mesh.userData.uvRepeat?.[0] ?? 1).toFixed(3));
      setVal('prop-tex-ry', (mesh.userData.uvRepeat?.[1] ?? 1).toFixed(3));
    }
  }

  updateReliefSelectionCount(count) {
    const el = document.getElementById('prop-relief-selection-count');
    if (el) {
      el.textContent = `${count} pixel${count !== 1 ? 's' : ''} selected`;
    }
    const separateButton = document.getElementById('btn-relief-separate');
    if (separateButton) separateButton.disabled = count === 0;
  }
}
