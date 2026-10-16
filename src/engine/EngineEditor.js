import * as THREE from 'three';
import { QuadFactory } from '../editor/QuadFactory.js';
import { createEngineSettings, createGameComponents, normalizeGameComponents } from './GameComponents.js';
import { cloneGameObject, reidentifyGameObjects } from './GameAssets.js';
import { cellAt, createMapTile, MapEditor } from './MapEditor.js';
import { GameRuntime } from './GameRuntime.js';
import { downloadGame } from './GameExport.js';
import { AnimationEditor } from './AnimationEditor.js';
import { MapLayers, MapLayerPanel } from './MapLayers.js';
import { VisualEventEditor } from './VisualEventEditor.js';
import { ColliderEditor } from './ColliderEditor.js';
import { ColliderOverlay, normalizeCollider } from './Colliders.js';
import { ResourceLibrary, ResourceLibraryPanel, disposeResources, prepareResources } from './ResourceLibrary.js';
import { renderResourceThumbnail } from './ResourceThumbnail.js';
import { normalizeEngineSettings } from '../project/EngineSettings.js';
import { MapBatchRenderer } from './MapBatchRenderer.js';
import { reconcileMapCells } from './MapPlacement.js';
import { ScriptEditor } from './ScriptEditor.js';
import { InterfaceEditor } from './InterfaceEditor.js';
import { isGameUIControl } from './GameInterface.js';
import { Environment } from './Environment.js';
import { PostProcessing } from './PostProcessing.js';
import { WorldEditor } from './WorldEditor.js';
import { ObjectEffectsEditor } from './ObjectEffectsEditor.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export class EngineEditor {
  constructor({ scene, history, assetPanel, onChange, onPreparePlay, onWorkflowChange = () => {}, toast }) {
    Object.assign(this, { scene, history, assetPanel, onChange, onPreparePlay, onWorkflowChange, toast });
    this.settings = createEngineSettings();
    this.mapRenderer = new MapBatchRenderer(scene.scene, () => [scene.exportGroup, scene.tempSelectionGroup]);
    this.environment = new Environment(scene.scene, () => [scene.exportGroup, scene.tempSelectionGroup], this.settings.environment, { editor: true, onError: message => this.toast(message) });
    for (const light of scene.editorLights || []) light.visible = false;
    this.environmentKey = JSON.stringify(this.settings.environment);
    scene.renderScene = (renderer, camera) => this.renderEditor(renderer, camera);
    this.onChange = () => { this.layerPanel?.sync(); onChange(); };
    this.layers = new MapLayers(scene, history, () => this.settings, () => this.onChange());
    scene.canEditObject = object => this.layers.isEditable(object);
    this.resources = new ResourceLibrary({ getSettings: () => this.settings, history,
      onChange: () => this.refreshTemplates(), thumbnail: root => renderResourceThumbnail(root, scene.renderer) });
    this.runtime = null;
    this.showColliders = false;
    this.mode = 'select';
    this.painting = false;
    this.startCell = null;
    this.lastCell = null;
    this.map = new MapEditor(scene, history, () => { this.sceneDirty = true; });
    scene.canvas.tabIndex = 0;
    scene.canvas.setAttribute('aria-label', 'Escena y juego');
    this.buildUI();
    this.bindInput();
    this.brush = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#9ab4ff', wireframe: true, depthTest: false }));
    this.brush.visible = false;
    this.brush.renderOrder = 1000;
    scene.scene.add(this.brush);
    this.editorColliderOverlay = new ColliderOverlay(scene.scene);
    this.refreshSelection();
  }

  buildUI() {
    document.body.classList.add('has-engine');
    this.bar = document.createElement('nav');
    this.bar.className = 'engine-toolbar';
    this.bar.setAttribute('aria-label', 'Herramientas de juego');
    this.bar.innerHTML = `<strong>GAME ENGINE <small>v2</small></strong>
      <button type="button" id="engine-select" class="active">Objetos</button>
      <button type="button" id="engine-paint">Pintar mapa</button>
      <button type="button" id="engine-erase">Borrar</button>
      <button type="button" id="engine-rectangle">Rectángulo</button>
      <button type="button" id="engine-colliders" aria-pressed="false">Colisiones</button>
      <button type="button" id="engine-frame" title="Encuadrar selección o mapa (F)">Encuadrar</button>
      <button type="button" id="engine-interface">Interfaz HTML</button>
      <button type="button" id="engine-world">Mundo y efectos</button>
      <span class="engine-spacer"></span>
      <button type="button" id="engine-demo">Ejemplo jugable</button>
      <button type="button" id="engine-export">Exportar juego</button>
      <button type="button" id="engine-play" class="engine-play">▶ Jugar</button>
      <button type="button" id="engine-pause" disabled>Pausar</button>
      <button type="button" id="engine-stop" disabled>■ Detener</button>`;
    document.body.append(this.bar);
    const panelSwitcher = document.createElement('nav');
    panelSwitcher.className = 'engine-panel-switcher';
    panelSwitcher.setAttribute('aria-label', 'Paneles del editor');
    panelSwitcher.innerHTML = '<button type="button" aria-controls="sidebar-left" aria-expanded="true">Biblioteca</button><button type="button" aria-controls="sidebar-right" aria-expanded="false">Inspector</button>';
    document.body.append(panelSwitcher);
    panelSwitcher.querySelector('[aria-controls="sidebar-left"]').onclick = event => {
      const hidden = document.body.classList.toggle('engine-library-hidden');
      event.currentTarget.setAttribute('aria-expanded', String(!hidden));
      this.scene._onResize();
    };
    panelSwitcher.querySelector('[aria-controls="sidebar-right"]').onclick = event => {
      const open = document.body.classList.toggle('engine-inspector-open');
      event.currentTarget.setAttribute('aria-expanded', String(open));
    };
    for (const mode of ['select', 'paint', 'erase', 'rectangle']) {
      this.bar.querySelector(`#engine-${mode}`).onclick = () => this.setMode(mode);
    }
    this.bar.querySelector('#engine-play').onclick = () => this.play();
    this.bar.querySelector('#engine-frame').onclick = () => this.frameView();
    const openPanel = selector => {
      const panel = this.palette.querySelector(selector); panel.open = true;
      document.body.classList.remove('engine-library-hidden');
      document.body.classList.remove('engine-inspector-open');
      document.querySelector('[aria-controls="sidebar-left"]').setAttribute('aria-expanded', 'true');
      document.querySelector('[aria-controls="sidebar-right"]').setAttribute('aria-expanded', 'false');
      this.scene._onResize();
      panel.scrollIntoView({ block: 'start' }); panel.querySelector('summary').focus();
    };
    this.bar.querySelector('#engine-interface').onclick = () => openPanel('.engine-interface-editor');
    this.bar.querySelector('#engine-world').onclick = () => openPanel('.engine-world-editor');
    this.bar.querySelector('#engine-colliders').onclick = event => {
      this.showColliders = !this.showColliders;
      event.currentTarget.setAttribute('aria-pressed', String(this.showColliders));
      event.currentTarget.classList.toggle('active', this.showColliders);
    };
    this.bar.querySelector('#engine-stop').onclick = () => this.stop();
    this.bar.querySelector('#engine-pause').onclick = () => {
      this.runtime.setPaused(!this.runtime.paused);
      this.bar.querySelector('#engine-pause').textContent = this.runtime.paused ? 'Continuar' : 'Pausar';
      this.updateStatus();
      this.scene.canvas.focus();
    };
    this.bar.querySelector('#engine-demo').onclick = () => this.addDemo();
    this.bar.querySelector('#engine-export').onclick = () => {
      this.finishStroke();
      this.scene.deselectObject(); // Unpack temporary multiselection transforms.
      try { downloadGame(this.scene.exportGroup, this.settings); this.hasTestedProject = true; this.onWorkflowChange(); this.toast('Juego exportado como HTML independiente.'); }
      catch (error) { this.toast(`No se pudo exportar: ${error.message}`); }
    };

    this.palette = document.createElement('section');
    this.palette.className = 'panel engine-panel';
    this.palette.innerHTML = `<h2 class="panel-header">Mapa y biblioteca</h2><div class="panel-body engine-form">
      <p>Pintá sobre el suelo. Arrastrá para un trazo; usá Rectángulo para rellenar.</p>
      <output id="engine-project-status" class="engine-project-status" aria-live="polite">Borrador local</output>
      <label>Recurso<select id="engine-resource"><option value="ground">Suelo</option><option value="wall">Pared sólida</option><option value="sprite">Sprite seleccionado</option></select></label>
      <label>Color<input id="engine-color" type="color" value="#647b50"></label>
      <div class="engine-fields"><label>Celda<input id="engine-cell" type="number" value="32" min="1" max="1024"></label><label>Altura Y<input id="engine-elevation" type="number" value="0" min="-10000" max="10000"></label></div>
      <div class="engine-layer-panel"></div>
      <button type="button" id="engine-capture">Guardar selección como recurso</button>
      <p id="engine-template-count">0 recursos guardados</p>
      <details class="engine-resource-manager"><summary>Administrar recursos</summary><div class="engine-resource-panel"></div></details>
      <details><summary>Cámara de juego</summary><label>Vista<select id="engine-camera"><option value="isometric">Isométrica</option><option value="top-down">Desde arriba</option></select></label>
      <label>Área visible<input id="engine-camera-size" type="number" min="32" max="2048" value="220"></label>
      <label class="engine-check"><input id="engine-follow" type="checkbox" checked> Seguir jugador</label></details>
      <details class="engine-performance"><summary>Rendimiento</summary>
      <label class="engine-check"><input id="engine-batch-map" type="checkbox" checked> Agrupar dibujo de celdas</label>
      <p>Reduce el trabajo de dibujo en mapas grandes. Las celdas se siguen editando y guardando por separado.</p>
      <output aria-label="Estadísticas de escena" class="engine-render-stats"></output></details>
      <details class="engine-world-editor"></details>
      <details class="engine-interface-editor"></details>
    </div>`;
    document.getElementById('sidebar-left').prepend(this.palette);
    this.worldPanel = new WorldEditor(this.palette.querySelector('.engine-world-editor'), () => this.settings, {
      apply: data => {
        const before = { environment: structuredClone(this.settings.environment), postProcessing: structuredClone(this.settings.postProcessing) };
        const after = structuredClone(data);
        const apply = value => { Object.assign(this.settings, structuredClone(value)); this.previewCycle = false; this.syncSettings(); this.onChange(); };
        apply(after); this.history.push({ label: 'World and effects', undo: () => apply(before), redo: () => apply(after) });
      },
      addLight: () => this.addEffectObject('light'), addEmitter: () => this.addEffectObject('particles'),
      preview: () => {
        if (!this.settings.environment.enabled || !this.settings.environment.dayNight.enabled) return this.worldPanel.error('Activá el ambiente y el ciclo, y aplicá el mundo primero.');
        this.previewCycle = !this.previewCycle;
        this.worldPanel.error(this.previewCycle ? 'Previsualizando el ciclo. La hora inicial guardada no cambia.' : 'Previsualización detenida.');
      },
    });
    this.interfacePanel = new InterfaceEditor(this.palette.querySelector('.engine-interface-editor'), () => this.settings, data => {
      const before = structuredClone(this.settings.ui); const after = structuredClone(data);
      const apply = value => { this.settings.ui = structuredClone(value); this.interfacePanel.sync(); };
      apply(after); this.history.push({ label: 'Game HTML interface', undo: () => apply(before), redo: () => apply(after) });
    });
    this.palette.querySelector('#engine-capture').onclick = () => this.captureTemplate();
    this.resourcePanel = new ResourceLibraryPanel(this.palette.querySelector('.engine-resource-panel'), this.resources, {
      selected: () => this.palette.querySelector('#engine-resource').value,
      select: id => { this.palette.querySelector('#engine-resource').value = id; },
      selection: () => this.scene.selectedObjects, onError: message => this.toast(message),
    });
    this.palette.querySelector('#engine-resource').addEventListener('change', () => this.resourcePanel.refresh());
    for (const element of this.palette.querySelectorAll('#engine-cell, #engine-elevation, #engine-camera, #engine-camera-size, #engine-follow, #engine-batch-map')) {
      element.addEventListener('change', () => this.changeSettings());
    }
    this.layerPanel = new MapLayerPanel(this.palette.querySelector('.engine-layer-panel'), this.layers, () => {
      this.finishStroke();
      this.onPreparePlay();
      this.scene.orbit.enabled = this.mode === 'select';
      if (this.mode !== 'select') this.scene.transformControls.detach();
    }, message => this.toast(message));
    this.inspector = document.createElement('section');
    this.inspector.className = 'panel engine-panel';
    document.getElementById('sidebar-right').prepend(this.inspector);
    this.hud = document.createElement('div');
    this.hud.className = 'engine-hud';
    this.hud.hidden = true;
    this.hud.innerHTML = '<strong class="engine-run-status"></strong><p>WASD / flechas: mover · E / espacio: interactuar · Esc: detener</p><output aria-live="polite"></output><pre class="engine-diagnostics" aria-live="polite"></pre>';
    document.getElementById('canvas-container').append(this.hud);
  }

  changeSettings() {
    this.finishStroke();
    const value = id => this.palette.querySelector(`#engine-${id}`).value;
    const cellSize = Number(value('cell')); const elevation = Number(value('elevation'));
    const cameraSize = Number(value('camera-size')); const layer = value('layer').trim();
    if (!(cellSize >= 1 && cellSize <= 1024 && elevation >= -10000 && elevation <= 10000 && cameraSize >= 32 && cameraSize <= 2048 && layer)) {
      this.toast('Revisá tamaño de celda, altura, capa y cámara.');
      this.syncSettings();
      return;
    }
    const before = this.serialize();
    Object.assign(this.settings, { cellSize, elevation, cameraSize, layer, camera: value('camera'), followPlayer: this.palette.querySelector('#engine-follow').checked, batchMap: this.palette.querySelector('#engine-batch-map').checked });
    const after = this.serialize();
    const apply = state => { this.settings = structuredClone(state); this.syncSettings(); this.onChange(); };
    this.history.push({ label: 'Game settings', undo: () => apply(before), redo: () => apply(after) });
    this.brush.visible = false;
  }

  syncSettings() {
    for (const [key, value] of Object.entries({ cell: this.settings.cellSize, elevation: this.settings.elevation, camera: this.settings.camera, 'camera-size': this.settings.cameraSize })) {
      this.palette.querySelector(`#engine-${key}`).value = value;
    }
    this.palette.querySelector('#engine-follow').checked = this.settings.followPlayer;
    this.palette.querySelector('#engine-batch-map').checked = this.settings.batchMap;
    this.interfacePanel?.sync();
    this.worldPanel?.sync();
    const key = JSON.stringify(this.settings.environment);
    if (key !== this.environmentKey) { this.environmentKey = key; this.environment.configure(this.settings.environment); this.mapRenderer.invalidate(); }
    this.layerPanel?.sync();
  }

  serialize() { return structuredClone(this.settings); }

  get templates() { return this.resources.cache; }

  async prepare(data, objects = [], signal) {
    const settings = normalizeEngineSettings(data || {}, objects);
    const library = await prepareResources(settings.templates, { signal });
    return { settings, library };
  }

  swapPrepared(prepared) {
    const previous = { settings: this.settings, library: this.resources.state(), hasTestedProject: this.hasTestedProject };
    this.settings = prepared.settings; this.resources.adopt(prepared.library);
    this.hasTestedProject = prepared.hasTestedProject === true;
    return previous;
  }

  refreshProjectUI() {
    this.previewCycle = false; this.environmentKey = null;
    this.mapRenderer.invalidate();
    this.syncSettings(); this.refreshTemplates(); this.refreshSelection();
    this.onWorkflowChange();
  }

  async restore(data) {
    this.stop();
    this.setMode('select');
    const prepared = await this.prepare(data, this.scene.objects);
    const previous = this.swapPrepared(prepared);
    try { this.refreshProjectUI(); }
    catch (error) { this.swapPrepared(previous); disposeResources(prepared.library); throw error; }
    disposeResources(previous.library);
  }

  refreshTemplates() {
    const select = this.palette.querySelector('#engine-resource');
    const previous = select.value;
    select.querySelectorAll('[data-template]').forEach(element => element.remove());
    for (const template of this.settings.templates) {
      const element = new Option(template.name, template.id);
      element.dataset.template = 'true';
      select.add(element);
    }
    if ([...select.options].some(item => item.value === previous)) select.value = previous;
    this.palette.querySelector('#engine-template-count').textContent = `${this.settings.templates.length} recursos guardados`;
    this.resourcePanel?.refresh();
  }

  captureTemplate() {
    const source = this.scene.selectedObjects[0];
    if (this.scene.selectedObjects.length !== 1) return this.toast('Seleccioná un objeto o grupo para guardarlo.');
    const template = this.resources.capture(source);
    this.palette.querySelector('#engine-resource').value = template.id;
    this.resourcePanel.refresh();
    this.toast('Recurso guardado. Elegí Pintar mapa para colocarlo.');
  }

  setMode(mode) {
    if (this.runtime) return;
    this.finishStroke();
    if (mode !== 'select') {
      this.onPreparePlay();
      if (this.scene.selectedObjects.length) this.scene.deselectObject();
    }
    this.mode = mode;
    this.scene.orbit.enabled = mode === 'select';
    if (mode !== 'select') this.scene.transformControls.detach();
    for (const name of ['select', 'paint', 'erase', 'rectangle']) this.bar.querySelector(`#engine-${name}`).classList.toggle('active', name === mode);
    if (this.brush) this.brush.visible = false;
    this.scene.canvas.style.cursor = mode === 'select' ? '' : 'crosshair';
    if (mode === 'select') this.scene._updateTransformControls();
    this.onWorkflowChange();
  }

  frameView() {
    if (this.runtime) return;
    if (!this.scene.frameObjects()) this.toast('Creá o seleccioná un objeto para encuadrarlo.');
    this.scene.canvas.focus();
  }

  cellFromEvent(event) {
    const canvas = this.scene.canvas;
    const rect = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.scene.camera);
    const point = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.settings.elevation), new THREE.Vector3());
    return point ? cellAt(point, this.settings.cellSize, this.settings.layer, this.settings.elevation) : null;
  }

  createStamp(cell) {
    const resource = this.palette.querySelector('#engine-resource').value;
    if (['ground', 'wall'].includes(resource)) return createMapTile(resource, cell, this.palette.querySelector('#engine-color').value);
    let object;
    if (resource === 'sprite') {
      const asset = this.assetPanel.selectedAsset;
      if (!asset) throw new Error('Seleccioná un sprite en la biblioteca.');
      object = QuadFactory.createQuad(asset.texture, asset.name);
      object.userData.game = createGameComponents();
    } else {
      const template = this.templates.get(resource);
      if (!template) throw new Error('Recurso no disponible.');
      object = cloneGameObject(template);
      object.name = this.resources.require(resource).name;
      reidentifyGameObjects(object);
      object.traverse(node => {
        delete node.userData.mapCell;
      });
    }
    object.position.set((cell.x + 0.5) * cell.size, cell.elevation, (cell.z + 0.5) * cell.size);
    return object;
  }

  paintCell(cell) {
    if (!this.layers.canPaint(cell.layer)) throw new Error('La capa está oculta o bloqueada.');
    this.map.paint(cell, () => this.createStamp(cell), this.mode === 'erase');
  }

  finishStroke() {
    this.painting = false;
    this.startCell = null;
    this.lastCell = null;
    this.map.end();
    if (this.sceneDirty) { this.sceneDirty = false; this.onChange(); }
  }

  bindInput() {
    const canvas = this.scene.canvas;
    const block = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    canvas.addEventListener('pointerdown', event => {
      if (this.runtime) { canvas.focus(); return block(event); }
      if (this.mode === 'select' || event.button !== 0) return;
      block(event);
      const cell = this.cellFromEvent(event);
      if (!cell) return;
      if (!this.layers.canPaint(cell.layer)) { this.toast('La capa está oculta o bloqueada.'); return; }
      canvas.setPointerCapture(event.pointerId);
      this.painting = true; this.startCell = cell; this.lastCell = cell;
      try { if (this.mode !== 'rectangle') this.paintCell(cell); }
      catch (error) { this.toast(error.message); this.finishStroke(); }
    }, true);
    canvas.addEventListener('pointermove', event => {
      if (this.runtime || this.mode === 'select') return;
      block(event);
      const cell = this.cellFromEvent(event);
      if (!cell) return;
      this.brush.visible = true;
      this.brush.material.color.set(this.layers.canPaint(cell.layer) ? '#9ab4ff' : '#ff867a');
      this.brush.position.set((cell.x + 0.5) * cell.size, cell.elevation + 1, (cell.z + 0.5) * cell.size);
      this.brush.scale.set(cell.size, 2, cell.size);
      if (!this.painting || this.mode === 'rectangle') return;
      try {
        const distance = Math.max(Math.abs(cell.x - this.lastCell.x), Math.abs(cell.z - this.lastCell.z));
        if (distance > 512) throw new Error('El trazo es demasiado grande.');
        for (let i = 1; i <= distance; i++) this.paintCell({ ...cell, x: Math.round(this.lastCell.x + (cell.x - this.lastCell.x) * i / distance), z: Math.round(this.lastCell.z + (cell.z - this.lastCell.z) * i / distance) });
        this.lastCell = cell;
      } catch (error) { this.toast(error.message); this.finishStroke(); }
    }, true);
    canvas.addEventListener('pointerup', event => {
      if (this.runtime) return block(event);
      if (this.mode === 'select') return;
      block(event);
      try {
        const end = this.cellFromEvent(event);
        if (this.painting && this.mode === 'rectangle' && end) {
          const start = this.startCell;
          if ((Math.abs(end.x - start.x) + 1) * (Math.abs(end.z - start.z) + 1) > 4096) throw new Error('Máximo 4096 celdas por rectángulo.');
          for (let x = Math.min(start.x, end.x); x <= Math.max(start.x, end.x); x++) {
            for (let z = Math.min(start.z, end.z); z <= Math.max(start.z, end.z); z++) this.paintCell({ ...end, x, z });
          }
        }
      } catch (error) { this.toast(error.message); }
      this.finishStroke();
    }, true);
    canvas.addEventListener('pointercancel', () => this.finishStroke(), true);
    canvas.addEventListener('lostpointercapture', () => this.finishStroke(), true);
    canvas.addEventListener('pointerleave', () => { this.brush.visible = false; });
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
      canvas.addEventListener(type, event => { if (this.runtime || this.mode !== 'select') block(event); }, true);
    }
    window.addEventListener('keydown', event => {
      if (!this.runtime) {
        if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) this.finishStroke();
        if (this.mode !== 'select' && event.key === 'Escape') { this.setMode('select'); block(event); }
        return;
      }
      if (event.key === 'Escape') { this.stop(); block(event); return; }
      if (event.key === 'Tab') { this.runtime.clearInput(); return; }
      if (isGameUIControl(event)) return;
      this.runtime.keyDown(event.key);
      block(event);
    }, true);
    window.addEventListener('keyup', event => {
      if (this.runtime) { this.runtime.keyUp(event.key); if (!isGameUIControl(event)) block(event); }
    }, true);
    window.addEventListener('blur', () => { this.runtime?.clearInput(); this.finishStroke(); });
  }

  refreshSelection() {
    if (this.runtime) return;
    this.animationEditor?.dispose();
    this.animationEditor = null;
    this.colliderEditor = null;
    this.visualEventEditor = null;
    this.scriptEditor = null;
    this.effectsEditor = null;
    this.editorColliderOverlay?.update([]);
    const object = this.scene.selectedObjects.length === 1 ? this.scene.selectedObjects[0] : null;
    this.inspector.innerHTML = '<h2 class="panel-header">Objeto de juego</h2>';
    const body = document.createElement('div');
    body.className = 'panel-body engine-form';
    this.inspector.append(body);
    if (!object) { body.innerHTML = '<p>Seleccioná un objeto para configurar su comportamiento.</p>'; return; }
    const game = normalizeGameComponents(object.userData.game || {});
    body.innerHTML = `<strong>${escapeHTML(object.name)}</strong>
      <p class="engine-map-location" hidden></p>
      <label>ID de objeto<input name="gameId" value="${escapeHTML(game.id)}" readonly></label>
      <label class="engine-check"><input name="enabled" type="checkbox" ${game.enabled ? 'checked' : ''}> Activo en el juego</label>
      <label>Etiqueta<input name="tag" value="${escapeHTML(game.tag)}" maxlength="100"></label>
      <label class="engine-check"><input name="player" type="checkbox" ${game.player.enabled ? 'checked' : ''}> Controlar con WASD / flechas</label>
      <label>Velocidad<input name="speed" type="number" min="0" max="10000" value="${game.player.speed}"></label>
      <details class="engine-collider-editor" open></details>
      <details class="engine-animation-editor"></details>
      <details class="engine-event-editor" open></details>
      <details class="engine-script-editor"></details>
      <div class="engine-object-effects"></div>
      <button type="button" class="engine-primary" id="engine-apply">Aplicar comportamiento</button>
      <output id="engine-form-error" aria-live="polite"></output>`;
    this.scriptEditor = new ScriptEditor(body.querySelector('.engine-script-editor'), game.script, object.name || 'Objeto');
    this.effectsEditor = new ObjectEffectsEditor(body.querySelector('.engine-object-effects'), game);
    this.refreshMapLocation();
    this.animationEditor = new AnimationEditor(body.querySelector('.engine-animation-editor'), object, game.animation);
    this.colliderEditor = new ColliderEditor(body.querySelector('.engine-collider-editor'), object, game.collider, () => this.animationEditor.read());
    const targets = [];
    this.scene.scene.traverse(node => { if (node.userData.game && node !== object) targets.push({ id: node.userData.game.id, name: node.name || node.userData.game.id }); });
    this.visualEventEditor = new VisualEventEditor(body.querySelector('.engine-event-editor'), game.events, targets, mode => this.colliderEditor.setMode(mode));
    body.querySelector('#engine-apply').onclick = () => {
      const value = name => body.querySelector(`[name="${name}"]`).value;
      const checked = name => body.querySelector(`[name="${name}"]`).checked;
      try {
        const next = normalizeGameComponents({ ...game, ...this.effectsEditor.read(), enabled: checked('enabled'), tag: value('tag'),
          player: { enabled: checked('player'), speed: Number(value('speed')) },
          collider: this.colliderEditor.read(),
          animation: this.animationEditor.read(),
          script: this.scriptEditor.read(), events: this.visualEventEditor.read(),
        });
        const previous = object.userData.game ? structuredClone(object.userData.game) : null;
        const apply = data => { if (data) object.userData.game = structuredClone(data); else delete object.userData.game; this.refreshSelection(); };
        apply(next);
        this.history.push({ label: 'Game object behavior', undo: () => apply(previous), redo: () => apply(next) });
        this.toast('Comportamiento aplicado. Probalo con Jugar.');
      } catch (error) { body.querySelector('#engine-form-error').textContent = error.message; }
    };
  }

  refreshMapLocation() {
    const label = this.inspector.querySelector('.engine-map-location'); if (!label) return;
    const cell = this.scene.selectedObjects.length === 1 && this.scene.selectedObjects[0].userData.mapCell;
    label.hidden = !cell;
    if (cell) label.textContent = `Celda ${cell.x}, ${cell.z} · ${cell.layer} · Altura ${cell.elevation}`;
  }

  reconcilePlacements(roots = this.scene.objects) {
    reconcileMapCells(roots); this.refreshMapLocation();
  }

  play() {
    if (this.runtime) return;
    this.setMode('select');
    this.onPreparePlay();
    this.savedSelection = [...this.scene.selectedObjects];
    this.scene.deselectObject();
    this.hud.querySelector('output').textContent = '';
    this.hud.querySelector('pre').textContent = '';
    let runtime;
    try {
      runtime = new GameRuntime(this.scene.exportGroup, this.settings, {
        uiHost: document.getElementById('canvas-container'),
        onStateChange: () => {
          if (!this.runtime) return;
          this.bar.querySelector('#engine-pause').textContent = this.runtime.paused ? 'Continuar' : 'Pausar'; this.updateStatus();
        },
        onMessage: message => { this.hud.querySelector('output').textContent = message; },
        onError: message => {
          const output = this.hud.querySelector('pre');
          output.textContent = (output.textContent + message + '\n').slice(-4000);
        },
      });
      this.runtime = runtime;
      runtime.start();
      this.runtimeColliderOverlay = new ColliderOverlay(runtime.scene);
    } catch (error) {
      runtime?.dispose(); this.runtime = null;
      this.toast(`No se pudo iniciar: ${error.message}`);
      return;
    }
    this.scene.orbit.enabled = false;
    this.postProcessing?.dispose(); this.postProcessing = null;
    this.scene.transformControls.enabled = false;
    for (const id of ['toolbar', 'sidebar-left', 'sidebar-right']) document.getElementById(id).inert = true;
    for (const button of this.bar.querySelectorAll('button')) button.disabled = !['engine-stop', 'engine-pause', 'engine-colliders'].includes(button.id);
    this.hud.hidden = false;
    document.body.classList.add('engine-playing');
    this.scene._onResize();
    this.scene.canvas.focus();
    this.updateStatus();
    this.hasTestedProject = true; this.onWorkflowChange();
  }

  updateStatus() {
    this.hud.querySelector('.engine-run-status').textContent = `${this.runtime?.paused ? 'PAUSA' : 'JUGANDO'} · ${this.runtime?.entities.length || 0} objetos`;
  }

  stop() {
    if (!this.runtime) return;
    this.runtimeColliderOverlay?.dispose();
    this.runtimeColliderOverlay = null;
    this.runtime.dispose(); this.runtime = null;
    this.scene.orbit.enabled = true;
    this.scene.transformControls.enabled = true;
    for (const id of ['toolbar', 'sidebar-left', 'sidebar-right']) document.getElementById(id).inert = false;
    for (const button of this.bar.querySelectorAll('button')) button.disabled = ['engine-stop', 'engine-pause'].includes(button.id);
    this.bar.querySelector('#engine-pause').textContent = 'Pausar';
    this.hud.hidden = true;
    document.body.classList.remove('engine-playing');
    this.scene._onResize();
    for (const object of this.savedSelection || []) this.scene.selectObject(object, true);
    this.refreshSelection();
    this.scene.canvas.focus();
    this.onWorkflowChange();
  }

  render(dt) {
    if (this.mapContentVersion !== this.scene.contentVersion) { this.mapContentVersion = this.scene.contentVersion; this.mapRenderer.invalidate(); }
    if (this.sceneDirty) { this.sceneDirty = false; this.onChange(); }
    if (!this.runtime) {
      if (this.previewCycle) this.environment.advance(dt);
      this.animationEditor?.update(dt);
      const items = [];
      const selected = this.scene.selectedObjects.length === 1 ? this.scene.selectedObjects[0] : null;
      if (this.showColliders) this.scene.scene.traverse(object => {
        if (object.userData.game && object.layers.mask && object !== selected) {
          items.push({ object, collider: normalizeCollider(object.userData.game.collider) });
        }
      });
      if (selected && this.colliderEditor) {
        try { items.push({ object: selected, collider: this.colliderEditor.read(), selected: true }); }
        catch { /* Incomplete numeric input must not interrupt rendering. */ }
      }
      this.editorColliderOverlay.update(items);
      return false;
    }
    this.runtime.update(dt);
    this.runtime.updateCamera(this.scene.canvas.clientWidth / this.scene.canvas.clientHeight);
    this.runtimeColliderOverlay.update(this.showColliders ? this.runtime.entities.filter(entity => this.runtime.isActive(entity)).map(entity => ({ object: entity.object, collider: entity.components.collider })) : []);
    this.runtime.render(this.scene.renderer);
    return true;
  }

  afterRender(dt) {
    this.statsElapsed = (this.statsElapsed || 0) + dt; this.statsFrames = (this.statsFrames || 0) + 1;
    if (this.statsElapsed < 1) return;
    const { cells, batches } = (this.runtime?.mapRenderer || this.mapRenderer).stats;
    this.palette.querySelector('.engine-render-stats').textContent = `${this.scene.objects.length} objetos · ${cells} celdas agrupadas en ${batches} lotes · ${this.scene.renderer.info.render.calls} llamadas de dibujo · ${(this.statsElapsed * 1000 / this.statsFrames).toFixed(1)} ms/cuadro`;
    this.statsElapsed = 0; this.statsFrames = 0;
    this.worldPanel.updateClock(this.runtime?.environment || this.environment, this.runtime?.particles, !!this.runtime || !!this.previewCycle);
  }

  renderEditor(renderer, camera) {
    this.environment.prepare(this.scene.orbit.target, this.settings.cameraSize);
    if (this.environmentRevision !== this.environment.revision) { this.environmentRevision = this.environment.revision; this.mapRenderer.invalidate(); }
    const settings = this.settings.postProcessing;
    if (settings.enabled && renderer.isWebGLRenderer) this.postProcessing ||= new PostProcessing(renderer);
    else if (this.postProcessing) { this.postProcessing.dispose(); this.postProcessing = null; }
    const draw = this.postProcessing ? { render: (scene, view) => this.postProcessing.render(scene, view, settings) } : renderer;
    this.environment.render(renderer, () => this.mapRenderer.render(draw, camera, this.settings.batchMap));
  }

  addEffectObject(kind) {
    if (this.runtime) return;
    this.setMode('select'); this.onPreparePlay();
    const object = new THREE.Mesh(new THREE.OctahedronGeometry(5), new THREE.MeshBasicMaterial({ color: kind === 'light' ? '#ffca85' : '#fc9570', wireframe: true }));
    object.name = kind === 'light' ? 'Point light' : 'Particle emitter';
    const selected = this.scene.selectedObjects[0];
    object.position.copy(selected ? selected.getWorldPosition(new THREE.Vector3()) : this.scene.orbit.target);
    object.position.y += kind === 'light' ? 48 : 8;
    object.userData = { type: 'engine-object', game: createGameComponents({
      render: { visible: false, castShadow: false, receiveShadow: false },
      ...(kind === 'light' ? { light: { enabled: true, offset: [0, 0, 0] } } : { particles: { enabled: true } }),
    }) };
    const add = () => { this.scene.addObject(object); this.onChange(); };
    const remove = () => { this.scene.removeObject(object, { dispose: false }); this.onChange(); };
    add(); this.history.push({ label: `Add ${kind}`, undo: remove, redo: add }); this.scene.selectObject(object);
    this.inspector.querySelector(kind === 'light' ? '.engine-light-fields' : '.engine-particle-fields').open = true;
    document.body.classList.add('engine-inspector-open');
    document.querySelector('[aria-controls="sidebar-right"]').setAttribute('aria-expanded', 'true');
    this.toast('Objeto creado. Ajustá sus efectos en el inspector y probá con Jugar.');
  }

  addDemo() {
    this.setMode('select');
    const size = this.settings.cellSize;
    // Place the example next to existing content, without replacing user work.
    const bounds = new THREE.Box3().setFromObject(this.scene.exportGroup);
    const origin = bounds.isEmpty() ? 0 : Math.ceil(bounds.max.x / size) + 3;
    const objects = [];
    for (let x = 0; x < 12; x++) for (let z = 0; z < 10; z++) {
      const cell = { x: origin + x, z, size, layer: 'Demo Ground', elevation: 0 };
      objects.push(createMapTile('ground', cell, (x + z) % 2 ? '#536b49' : '#5d7651'));
      if (x === 0 || x === 11 || z === 0 || z === 9 || (x === 6 && z > 2 && z < 7 && z !== 4)) {
        objects.push(createMapTile('wall', { ...cell, layer: 'Demo Walls' }, '#7b8b9a'));
      }
    }
    const player = new THREE.Mesh(new THREE.BoxGeometry(size * 0.6, size, size * 0.6), new THREE.MeshStandardMaterial({ color: '#8faaff' }));
    player.position.set((origin + 2.5) * size, size / 2 + 2, 4.5 * size);
    player.name = 'Player';
    player.userData = { type: 'engine-object', game: createGameComponents({ tag: 'player', player: { enabled: true, speed: size * 3 }, collider: { mode: 'solid', size: [size * 0.6, size * 0.6], offset: [0, 0], height: size, offsetY: -size / 2 }, events: [{ when: 'start', action: 'message', value: 'Recogé la llave dorada, abrí la puerta con E y llegá al cristal. WASD para mover.' }] }) };
    objects.push(player);
    const door = createMapTile('wall', { x: origin + 6, z: 4, size, layer: 'Demo Walls', elevation: 0 }, '#b98956');
    door.name = 'Door';
    door.userData.game.events = [{ when: 'interact', otherTag: 'player', once: true, conditions: [{ variable: 'keys', operator: 'gte', value: 1 }], actions: [
      { type: 'addVariable', value: 'keys', amount: -1 }, { type: 'disable' }, { type: 'message', value: '¡Puerta abierta! Llegá al cristal del otro lado.' },
    ] }];
    objects.push(door);
    const key = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.25), new THREE.MeshStandardMaterial({ color: '#ffdc75', emissive: '#70500b' }));
    key.position.set((origin + 4.5) * size, size * 0.65, 4.5 * size);
    key.name = 'Golden key';
    key.userData = { type: 'engine-object', game: createGameComponents({ tag: 'key', collider: { mode: 'trigger', size: [size * 0.7, size * 0.7], offset: [0, 0], height: size * 0.5, offsetY: -size * 0.25 }, events: [{ when: 'triggerEnter', otherTag: 'player', once: true, actions: [
      { type: 'addVariable', value: 'keys', amount: 1 }, { type: 'hide' }, { type: 'disable' }, { type: 'message', value: 'Llaves: {keys}. Acercate a la puerta y presioná E.' },
    ] }] }) };
    objects.push(key);
    const goal = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.4), new THREE.MeshStandardMaterial({ color: '#69e4db', emissive: '#124a50' }));
    goal.position.set((origin + 9) * size, size * 0.7, 4.5 * size);
    goal.name = 'Goal crystal';
    goal.userData = { type: 'engine-object', game: createGameComponents({ tag: 'goal', collider: { mode: 'trigger', size: [size, size], offset: [0, 0], height: size * 0.8, offsetY: -size * 0.4 }, events: [{ when: 'triggerEnter', action: 'message', value: '¡Llegaste! E para interactuar.' }, { when: 'interact', action: 'message', value: '¡Primera misión completada!' }], script: 'return { update(dt) { api.object.rotation.y += dt; } };' }) };
    objects.push(goal);
    const add = () => { objects.forEach(object => this.scene.addObject(object)); this.onChange(); };
    const remove = () => { objects.forEach(object => this.scene.removeObject(object, { dispose: false })); this.onChange(); };
    add();
    this.history.push({ label: 'Playable example', undo: remove, redo: add });
    this.scene.selectObject(player);
    this.scene.frameObjects(objects);
    this.toast('Ejemplo creado. Presioná Jugar para probarlo.');
  }
}
