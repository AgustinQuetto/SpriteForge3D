import { MathUtils } from 'three';
import { cloneGameObject, disposeGameObject, parseGameObject, serializeGameObject } from './GameAssets.js';
import { normalizeGameComponents } from './GameComponents.js';
import { yieldProjectLoad } from '../project/ProjectLoader.js';

export function disposeResources(state) {
  for (const root of state.owned || []) disposeGameObject(root);
}

export async function prepareResources(records, { signal, parse = parseGameObject } = {}) {
  const state = { records: structuredClone(records), cache: new Map(), owned: new Set() };
  try {
    for (const record of state.records) {
      if (state.cache.size % 32 === 0) await yieldProjectLoad(signal);
      if (signal?.aborted) throw new DOMException('Project load cancelled', 'AbortError');
      let root;
      try { root = await parse(record.scene); }
      catch (error) { throw new Error(`Could not restore resource ${record.name}: ${error.message || 'invalid visual or embedded image'}`, { cause: error }); }
      state.owned.add(root);
      const ids = new Set();
      root.traverse(node => {
        delete node.userData.mapCell;
        if (node.userData.game) {
          node.userData.game = normalizeGameComponents(node.userData.game);
          if (ids.has(node.userData.game.id)) throw new Error(`Duplicate object ID in resource ${record.name}`);
          ids.add(node.userData.game.id);
        }
      });
      state.cache.set(record.id, root);
      record.scene = serializeGameObject(root);
    }
    if (signal?.aborted) throw new DOMException('Project load cancelled', 'AbortError');
    return state;
  } catch (error) { disposeResources(state); throw error; }
}

export class ResourceLibrary {
  constructor({ getSettings, history, onChange, thumbnail = () => '' }) {
    Object.assign(this, { getSettings, history, onChange, thumbnail });
    this.cache = new Map(); this.owned = new Set();
  }

  get records() { return this.getSettings().templates; }
  state() { return { records: this.records, cache: this.cache, owned: this.owned }; }
  adopt(state) {
    this.getSettings().templates = state.records;
    this.cache = state.cache; this.owned = state.owned;
  }

  uniqueName(name) {
    const base = name.trim().slice(0, 100) || 'Recurso';
    let result = base; let index = 2;
    while (this.records.some(record => record.name === result)) result = `${base} ${index++}`;
    return result;
  }

  makeRecord(source, name, id = MathUtils.generateUUID()) {
    const root = cloneGameObject(source);
    try {
      root.position.set(0, 0, 0); root.traverse(node => { delete node.userData.mapCell; });
      const scene = serializeGameObject(root);
      let thumbnail = '';
      try { thumbnail = this.thumbnail(root) || ''; } catch { /* A thumbnail failure must not discard a valid asset. */ }
      this.owned.add(root);
      return { record: { id, name, scene, thumbnail }, root };
    } catch (error) { disposeGameObject(root); throw error; }
  }

  change(label, mutate) {
    const before = { records: this.records.slice(), cache: new Map(this.cache) };
    mutate();
    const after = { records: this.records.slice(), cache: new Map(this.cache) };
    const apply = state => {
      this.getSettings().templates = state.records.slice(); this.cache = new Map(state.cache); this.onChange();
    };
    this.onChange(); this.history.push({ label, undo: () => apply(before), redo: () => apply(after) });
  }

  capture(source) {
    const { record, root } = this.makeRecord(source, this.uniqueName(source.name || 'Recurso'));
    this.change('Capture resource', () => { this.getSettings().templates = [...this.records, record]; this.cache.set(record.id, root); });
    return record;
  }

  rename(id, name) {
    name = name.trim();
    if (!name || name.length > 100 || this.records.some(record => record.id !== id && record.name === name)) throw new Error('Usá un nombre único de 1 a 100 caracteres.');
    this.require(id);
    this.change('Rename resource', () => { this.getSettings().templates = this.records.map(record => record.id === id ? { ...record, name } : record); });
  }

  update(id, source) {
    const previous = this.require(id);
    const { record, root } = this.makeRecord(source, previous.name, id);
    this.change('Update resource', () => {
      this.getSettings().templates = this.records.map(item => item.id === id ? record : item); this.cache.set(id, root);
    });
  }

  remove(id) {
    this.require(id);
    this.change('Remove resource', () => { this.getSettings().templates = this.records.filter(record => record.id !== id); this.cache.delete(id); });
  }

  require(id) {
    const record = this.records.find(item => item.id === id);
    if (!record) throw new Error('Seleccioná un recurso guardado.');
    return record;
  }
}

export class ResourceLibraryPanel {
  constructor(host, library, { selected, select, selection, onError }) {
    Object.assign(this, { host, library, selected, select });
    host.innerHTML = `<label>Buscar recurso<input name="resourceSearch" placeholder="Nombre del recurso"></label>
      <div class="engine-resource-grid" aria-label="Recursos guardados"></div>
      <label>Nombre del recurso<input name="resourceName" maxlength="100"></label>
      <div class="engine-fields"><button type="button" data-action="rename">Renombrar recurso</button><button type="button" data-action="remove">Quitar recurso</button></div>
      <button type="button" data-action="update">Actualizar desde selección</button>
      <p>Actualizar cambia las próximas instancias. Las piezas colocadas conservan su estado. Quitar se puede deshacer.</p>
      <output class="engine-resource-status" aria-live="polite"></output>`;
    host.querySelector('[name="resourceSearch"]').addEventListener('input', () => this.refreshCards());
    for (const button of host.querySelectorAll('[data-action]')) button.onclick = () => {
      try {
        const id = selected();
        if (button.dataset.action === 'rename') library.rename(id, host.querySelector('[name="resourceName"]').value);
        if (button.dataset.action === 'remove') library.remove(id);
        if (button.dataset.action === 'update') {
          const objects = selection();
          if (objects.length !== 1) throw new Error('Seleccioná un objeto o grupo para actualizar el recurso.');
          library.update(id, objects[0]);
        }
        this.refresh();
      } catch (error) { onError(error.message); }
    };
    this.refresh();
  }

  refreshCards() {
    const search = this.host.querySelector('[name="resourceSearch"]').value.toLowerCase();
    const grid = this.host.querySelector('.engine-resource-grid'); grid.replaceChildren();
    const records = this.library.records.filter(record => record.name.toLowerCase().includes(search));
    for (const record of records) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'engine-resource-card';
      button.setAttribute('aria-label', `Usar recurso ${record.name}`); button.setAttribute('aria-pressed', String(record.id === this.selected()));
      if (record.thumbnail) { const image = document.createElement('img'); image.src = record.thumbnail; image.alt = ''; button.append(image); }
      else { const icon = document.createElement('span'); icon.className = 'material-symbols-rounded'; icon.textContent = 'view_in_ar'; button.append(icon); }
      const name = document.createElement('span'); name.textContent = record.name; button.append(name);
      button.onclick = () => { this.select(record.id); this.refresh(); };
      grid.append(button);
    }
    this.host.querySelector('.engine-resource-status').textContent = records.length ? `${records.length} recursos visibles` : 'No hay recursos que coincidan.';
  }

  refresh() {
    const record = this.library.records.find(item => item.id === this.selected());
    this.host.querySelector('[name="resourceName"]').value = record?.name || '';
    for (const button of this.host.querySelectorAll('[data-action]')) button.disabled = !record;
    this.refreshCards();
  }
}
