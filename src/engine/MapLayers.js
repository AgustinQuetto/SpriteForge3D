export function normalizeMapLayers(settings, objects = []) {
  const layers = [];
  const names = new Set();
  for (const layer of settings.layers || []) {
    if (typeof layer.name !== 'string' || !layer.name.trim() || names.has(layer.name)) throw new Error('Invalid map layer');
    names.add(layer.name);
    layers.push({ name: layer.name, visible: layer.visible !== false, locked: layer.locked === true });
  }
  const add = name => {
    if (typeof name === 'string' && name && !names.has(name)) {
      names.add(name); layers.push({ name, visible: true, locked: false });
    }
  };
  add(settings.layer || 'Ground');
  for (const object of objects) object.traverse(node => add(node.userData.mapCell?.layer));
  settings.layers = layers;
  settings.layer ||= layers[0].name;
  return layers;
}

export class MapLayers {
  constructor(scene, history, getSettings, onChange) {
    Object.assign(this, { scene, history, getSettings, onChange });
    this.originalMasks = new WeakMap();
  }

  get layers() { return this.getSettings().layers || normalizeMapLayers(this.getSettings(), this.scene.objects); }
  get active() { return this.layers.find(layer => layer.name === this.getSettings().layer); }

  canPaint(name) {
    const layer = this.layers.find(item => item.name === name);
    return !!layer && layer.visible && !layer.locked;
  }

  isEditable(object) {
    const layers = new Map(this.layers.map(layer => [layer.name, layer]));
    const blocked = node => {
      const layer = layers.get(node.userData.mapCell?.layer);
      return layer && (!layer.visible || layer.locked);
    };
    for (let node = object; node; node = node.parent) if (blocked(node)) return false;
    let allowed = true;
    object.traverse(node => { if (blocked(node)) allowed = false; });
    return allowed;
  }

  syncVisibility() {
    const layers = new Map(this.layers.map(layer => [layer.name, layer]));
    const apply = (node, hidden = false) => {
      hidden ||= layers.get(node.userData.mapCell?.layer)?.visible === false;
      if (!this.originalMasks.has(node)) this.originalMasks.set(node, node.layers.mask);
      node.layers.mask = hidden ? 0 : this.originalMasks.get(node);
      node.children.forEach(child => apply(child, hidden));
    };
    this.scene.exportGroup.children.forEach(node => apply(node));
  }

  snapshot() {
    normalizeMapLayers(this.getSettings(), this.scene.objects);
    return {
      layers: structuredClone(this.layers), layer: this.getSettings().layer,
      cells: this.scene.objects.flatMap(object => {
        const cells = [];
        object.traverse(node => { if (node.userData.mapCell) cells.push({ node, cell: { ...node.userData.mapCell } }); });
        return cells;
      }),
    };
  }

  apply(state) {
    Object.assign(this.getSettings(), { layers: structuredClone(state.layers), layer: state.layer });
    for (const { node, cell } of state.cells) node.userData.mapCell = { ...cell };
    for (const object of [...this.scene.selectedObjects]) if (!this.isEditable(object)) this.scene.deselectObject(object);
    this.syncVisibility();
    this.onChange();
  }

  change(label, mutate) {
    const before = this.snapshot();
    mutate();
    const after = this.snapshot();
    this.apply(after);
    this.history.push({ label, undo: () => this.apply(before), redo: () => this.apply(after) });
  }

  select(name) {
    if (!this.layers.some(layer => layer.name === name)) throw new Error('Map layer not found');
    if (this.getSettings().layer === name) return;
    this.change('Select map layer', () => { this.getSettings().layer = name; });
  }

  add(name) {
    name = name.trim();
    if (!name || name.length > 60 || this.layers.some(layer => layer.name === name)) throw new Error('Usá un nombre único de 1 a 60 caracteres.');
    this.change('Create map layer', () => {
      this.getSettings().layers.push({ name, visible: true, locked: false });
      this.getSettings().layer = name;
    });
  }

  rename(name) {
    name = name.trim();
    const current = this.active.name;
    if (name === current) return;
    if (!name || name.length > 60 || this.layers.some(layer => layer.name === name)) throw new Error('Usá un nombre único de 1 a 60 caracteres.');
    this.change('Rename map layer', () => {
      this.active.name = name;
      this.getSettings().layer = name;
      for (const object of this.scene.objects) object.traverse(node => {
        if (node.userData.mapCell?.layer === current) node.userData.mapCell.layer = name;
      });
    });
  }

  setFlag(key, value) {
    if (!['visible', 'locked'].includes(key)) throw new Error('Unknown layer flag');
    this.change(key === 'visible' ? 'Map layer visibility' : 'Map layer lock', () => { this.active[key] = !!value; });
  }
}

export class MapLayerPanel {
  constructor(host, model, beforeChange, onError) {
    Object.assign(this, { host, model });
    host.innerHTML = `<label>Capa activa<select id="engine-layer"></select></label>
      <div class="engine-fields"><label class="engine-check"><input type="checkbox" name="layerVisible"> Visible en editor</label><label class="engine-check"><input type="checkbox" name="layerLocked"> Bloqueada</label></div>
      <label>Nombre de capa<input name="layerName" maxlength="60" placeholder="Decoración"></label>
      <div class="engine-fields"><button type="button" class="engine-layer-add">+ Crear capa</button><button type="button" class="engine-layer-rename">Renombrar</button></div>
      <output class="engine-layer-status" aria-live="polite"></output>`;
    const run = action => {
      beforeChange();
      try { action(); this.sync(); }
      catch (error) { onError(error.message); this.sync(); }
    };
    host.querySelector('#engine-layer').onchange = event => run(() => model.select(event.target.value));
    host.querySelector('[name="layerVisible"]').onchange = event => run(() => model.setFlag('visible', event.target.checked));
    host.querySelector('[name="layerLocked"]').onchange = event => run(() => model.setFlag('locked', event.target.checked));
    host.querySelector('.engine-layer-add').onclick = () => run(() => model.add(host.querySelector('[name="layerName"]').value));
    host.querySelector('.engine-layer-rename').onclick = () => run(() => model.rename(host.querySelector('[name="layerName"]').value));
    this.sync();
  }

  sync() {
    normalizeMapLayers(this.model.getSettings(), this.model.scene.objects);
    const layers = this.model.layers;
    const active = this.model.active;
    const select = this.host.querySelector('#engine-layer');
    select.replaceChildren(...layers.map(layer => new Option(`${layer.locked ? '🔒 ' : ''}${layer.visible ? '' : '◌ '}${layer.name}`, layer.name)));
    select.value = active.name;
    this.host.querySelector('[name="layerVisible"]').checked = active.visible;
    this.host.querySelector('[name="layerLocked"]').checked = active.locked;
    const count = this.model.scene.objects.filter(object => object.userData.mapCell?.layer === active.name).length;
    this.host.querySelector('.engine-layer-status').textContent = `${count} celdas · ${active.locked ? 'Desbloqueá la capa para editar.' : !active.visible ? 'Mostrá la capa para editar.' : 'Lista para pintar.'}`;
    this.model.syncVisibility();
  }
}
