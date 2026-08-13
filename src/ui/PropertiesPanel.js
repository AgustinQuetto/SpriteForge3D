import { QuadFactory } from '../editor/QuadFactory.js';

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
    this.onDuplicate = null;
    this.onDelete = null;
    this.onApplyTexture = null;

    this.showEmpty();
  }

  showEmpty() {
    this.currentMesh = null;
    this.body.innerHTML = '<div class="prop-empty">Select an object</div>';
  }

  showProperties(mesh) {
    if (!mesh) { this.showEmpty(); return; }
    this.currentMesh = mesh;

    const pos = mesh.position;
    const rot = mesh.rotation;
    const scl = mesh.scale;
    const depth = mesh.userData.extrusionDepth || 0;
    const objType = mesh.userData.type || 'quad';
    const hasTexture = !!(mesh.userData.texture);

    // Show extrusion only for quads (flat planes that can be extruded)
    const showExtrusion = (objType === 'quad' || objType === 'box');

    this.body.innerHTML = `
      <div class="prop-section">
        <div class="prop-section-title">Name</div>
        <input type="text" class="prop-input" id="prop-name" value="${mesh.name}" style="width:100%;margin-bottom:8px">
      </div>

      <div class="prop-section">
        <div class="prop-section-title">Position</div>
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
        <div class="prop-section-title">Rotation (°)</div>
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
        <div class="prop-section-title">Scale</div>
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

      ${showExtrusion ? `
      <div class="prop-section">
        <div class="prop-section-title">Extrusion (Thickness / Grosor)</div>
        <div class="prop-slider-row">
          <span class="prop-slider-label">Depth</span>
          <input type="range" class="prop-slider" id="prop-extrude" min="0" max="128" step="1" value="${depth}">
          <input type="number" class="prop-input" id="prop-extrude-num" min="0" max="512" step="1" value="${depth.toFixed(1)}" style="width:60px;margin-left:8px">
        </div>
        <div class="prop-row" style="margin-top:8px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text-secondary)">
            <input type="checkbox" id="prop-texture-sides" ${mesh.userData.textureSides !== false ? 'checked' : ''}>
            Pattern on side faces (Patrón)
          </label>
        </div>
        <div class="prop-row" style="margin-top:6px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text-secondary)">
            <input type="checkbox" id="prop-voxelize" ${mesh.userData.voxelized ? 'checked' : ''} ${!hasTexture ? 'disabled' : ''}>
            <span style="display:flex;flex-direction:column;gap:1px">
              <strong style="color:var(--text);font-weight:600">Voxelize (Pixel Cubes)</strong>
              <span style="font-size:11px">Convierte cada píxel en un cubo 3D</span>
            </span>
          </label>
        </div>
        <small style="color:var(--text-muted);display:block;margin-top:4px;margin-bottom:8px">
          Extrudes flat sprites into 3D walls & tiles texture pattern seamlessly
        </small>
      </div>
      ` : ''}

      <div class="prop-section">
        <div class="prop-section-title">Texture</div>
        <div style="margin-bottom:8px;text-align:center;padding:6px;background:var(--bg-input);border-radius:var(--radius-sm);font-size:12px;color:var(--text-secondary)">
          ${hasTexture ? `✓ ${mesh.userData.textureName || 'Applied'}` : 'No texture'}
        </div>
        <button class="prop-btn prop-btn-accent" id="btn-apply-tex" style="margin-bottom:6px">
          <span class="material-symbols-rounded">texture</span>
          Apply Selected Asset
        </button>
        <small style="color:var(--text-muted);display:block;margin-top:-2px;margin-bottom:8px">
          Select an asset in the left panel first
        </small>
      </div>

      ${hasTexture ? `
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
      </div>
      ` : ''}

      <div class="prop-section">
        <div class="prop-section-title">Actions</div>
        <button class="prop-btn" id="btn-duplicate" style="margin-bottom:6px">
          <span class="material-symbols-rounded">content_copy</span>
          Duplicate (Ctrl+D)
        </button>
        <button class="prop-btn" id="btn-delete" style="color:var(--danger)">
          <span class="material-symbols-rounded">delete</span>
          Delete (Del)
        </button>
      </div>
    `;

    this._bindInputs(mesh);
  }

  _bindInputs(mesh) {
    // Name
    this._on('prop-name', 'input', (e) => { mesh.name = e.target.value; });

    // Position
    this._on('prop-px', 'change', (e) => { mesh.position.x = parseFloat(e.target.value) || 0; });
    this._on('prop-py', 'change', (e) => { mesh.position.y = parseFloat(e.target.value) || 0; });
    this._on('prop-pz', 'change', (e) => { mesh.position.z = parseFloat(e.target.value) || 0; });

    // Rotation
    this._on('prop-rx', 'change', (e) => { mesh.rotation.x = (parseFloat(e.target.value) || 0) * Math.PI / 180; });
    this._on('prop-ry', 'change', (e) => { mesh.rotation.y = (parseFloat(e.target.value) || 0) * Math.PI / 180; });
    this._on('prop-rz', 'change', (e) => { mesh.rotation.z = (parseFloat(e.target.value) || 0) * Math.PI / 180; });

    // Scale
    this._on('prop-sx', 'change', (e) => { mesh.scale.x = parseFloat(e.target.value) || 1; });
    this._on('prop-sy', 'change', (e) => { mesh.scale.y = parseFloat(e.target.value) || 1; });
    this._on('prop-sz', 'change', (e) => { mesh.scale.z = parseFloat(e.target.value) || 1; });

    // Extrusion slider & numeric input
    const slider = document.getElementById('prop-extrude');
    const numInput = document.getElementById('prop-extrude-num');
    const texSidesCheckbox = document.getElementById('prop-texture-sides');

    const applyExtrusion = (newDepth) => {
      const textureSides = texSidesCheckbox ? texSidesCheckbox.checked : true;
      QuadFactory.extrudeQuad(mesh, newDepth, textureSides);
      if (this.onExtrusionChanged) this.onExtrusionChanged(mesh, newDepth);
    };

    if (slider) {
      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) || 0;
        if (numInput) numInput.value = val.toFixed(1);
        applyExtrusion(val);
      });
    }

    if (numInput) {
      numInput.addEventListener('change', (e) => {
        const val = Math.max(0, parseFloat(e.target.value) || 0);
        if (slider) slider.value = Math.min(128, val);
        applyExtrusion(val);
      });
    }

    if (texSidesCheckbox) {
      texSidesCheckbox.addEventListener('change', () => {
        const d = mesh.userData.extrusionDepth || 0;
        applyExtrusion(d);
      });
    }

    // Voxelize toggle
    const voxelizeCheckbox = document.getElementById('prop-voxelize');
    if (voxelizeCheckbox) {
      voxelizeCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          QuadFactory.voxelizeSprite(mesh);
          // Disable extrusion controls while voxelized
          if (slider) slider.disabled = true;
          if (numInput) numInput.disabled = true;
          if (texSidesCheckbox) texSidesCheckbox.disabled = true;
        } else {
          QuadFactory.devoxelizeSprite(mesh);
          if (slider) slider.disabled = false;
          if (numInput) numInput.disabled = false;
          if (texSidesCheckbox) texSidesCheckbox.disabled = false;
        }
        if (this.onVoxelizeChanged) this.onVoxelizeChanged(mesh, e.target.checked);
      });
    }

    // Apply texture
    this._on('btn-apply-tex', 'click', () => {
      if (this.onApplyTexture) this.onApplyTexture(mesh);
    });

    // Texture Mapping
    const updateTextureMapping = () => {
      const rx = parseFloat(document.getElementById('prop-tex-rx')?.value ?? 1);
      const ry = parseFloat(document.getElementById('prop-tex-ry')?.value ?? 1);
      const ox = parseFloat(document.getElementById('prop-tex-ox')?.value ?? 0);
      const oy = parseFloat(document.getElementById('prop-tex-oy')?.value ?? 0);

      mesh.userData.uvRepeat = [rx, ry];
      mesh.userData.uvOffset = [ox, oy];

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
    };

    this._on('prop-tex-rx', 'change', updateTextureMapping);
    this._on('prop-tex-ry', 'change', updateTextureMapping);
    this._on('prop-tex-ox', 'change', updateTextureMapping);
    this._on('prop-tex-oy', 'change', updateTextureMapping);

    // Duplicate
    this._on('btn-duplicate', 'click', () => {
      if (this.onDuplicate) this.onDuplicate(mesh);
    });

    // Delete
    this._on('btn-delete', 'click', () => {
      if (this.onDelete) this.onDelete(mesh);
    });
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
  }
}
