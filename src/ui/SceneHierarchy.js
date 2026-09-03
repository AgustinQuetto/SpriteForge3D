/**
 * SceneHierarchy — Tree view with group (folder) support.
 * Groups render as collapsible folders; their children are indented.
 * Standalone meshes render as flat items below groups.
 */
export class SceneHierarchy {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.container = document.getElementById('scene-tree');
    this.onSelect = null;
    this.onDelete = null;
    this.onSelectVoxels = null;
    this.onDeleteVoxels = null;
    this.onDropCreateGroup = null;
    this.onDropToGroup = null;
    this.onDropToRoot = null;
    this.draggedItems = [];

    this.container.addEventListener('dragover', (event) => {
      if (!this.draggedItems.length || event.target.closest('.scene-item')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      this.container.classList.add('drop-to-root');
    });
    this.container.addEventListener('dragleave', (event) => {
      if (!this.container.contains(event.relatedTarget)) {
        this.container.classList.remove('drop-to-root');
      }
    });
    this.container.addEventListener('drop', (event) => {
      if (!this.draggedItems.length || event.target.closest('.scene-item')) return;
      event.preventDefault();
      this.container.classList.remove('drop-to-root');
      if (this.onDropToRoot) this.onDropToRoot([...this.draggedItems]);
    });
  }

  refresh() {
    const sm = this.sceneManager;
    const groups = sm.groups;
    // Objects not parented to any scene group
    const standalone = sm.objects.filter(obj => !obj.parent?.userData?.isSceneGroup);

    if (groups.length === 0 && standalone.length === 0) {
      this.container.innerHTML = '<div class="scene-empty">Todavía no hay objetos</div>';
      return;
    }

    this.container.innerHTML = '';

    for (const group of groups) {
      this.container.appendChild(this._buildGroupItem(group));
    }

    for (const obj of standalone) {
      this.container.appendChild(this._buildObjectItem(obj, false));
      const voxelSelection = this._buildVoxelSelectionItem(obj, false);
      if (voxelSelection) this.container.appendChild(voxelSelection);
    }
  }

  _buildGroupItem(group) {
    const sm = this.sceneManager;
    const isSelected = sm.selectedObjects.includes(group);
    const isExpanded = group.userData._expanded !== false;

    const wrapper = document.createElement('div');
    wrapper.classList.add('scene-group');

    // ── Header row ──
    const header = document.createElement('div');
    header.classList.add('scene-item', 'scene-group-header');
    if (isSelected) header.classList.add('selected');
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', String(isExpanded));
    header.setAttribute('aria-label', `Grupo ${group.name}`);

    header.innerHTML = `
      <span class="material-symbols-rounded scene-expand-icon">${isExpanded ? 'expand_more' : 'chevron_right'}</span>
      <span class="material-symbols-rounded">${isExpanded ? 'folder_open' : 'folder'}</span>
      <span class="scene-item-name">${group.name}</span>
      <span class="material-symbols-rounded scene-item-visibility" data-action="visibility">
        ${group.visible ? 'visibility' : 'visibility_off'}
      </span>
      <span class="material-symbols-rounded scene-item-delete" data-action="delete" title="Borrar grupo">delete</span>
    `;

    header.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      // Visibility toggle
      if (action === 'visibility') {
        group.visible = !group.visible;
        this.refresh();
        return;
      }
      if (action === 'delete') {
        if (!sm.selectedObjects.includes(group)) sm.selectObject(group, false);
        if (this.onDelete) this.onDelete(group);
        return;
      }
      // Expand/collapse via the chevron
      if (e.target.classList.contains('scene-expand-icon')) {
        group.userData._expanded = !isExpanded;
        this.refresh();
        return;
      }
      // Select group
      const additive = e.shiftKey;
      sm.selectObject(group, additive);
      if (this.onSelect) this.onSelect(group);
      this.refresh();
    });

    this._configureGroupDropTarget(header, group);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        header.click();
      }
    });

    wrapper.appendChild(header);

    // ── Children ──
    if (isExpanded) {
      const childrenEl = document.createElement('div');
      childrenEl.classList.add('scene-group-children');

      for (const child of group.children) {
        if (child.isMesh || child.isGroup) {
          childrenEl.appendChild(this._buildObjectItem(child, true));
          const voxelSelection = this._buildVoxelSelectionItem(child, true);
          if (voxelSelection) childrenEl.appendChild(voxelSelection);
        }
      }

      wrapper.appendChild(childrenEl);
    }

    return wrapper;
  }

  _buildObjectItem(obj, indented) {
    const sm = this.sceneManager;
    const isSelected = sm.selectedObjects.includes(obj);

    const item = document.createElement('div');
    item.classList.add('scene-item');
    if (indented) item.classList.add('scene-child-item');
    if (isSelected) item.classList.add('selected');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-selected', String(isSelected));
    item.setAttribute('aria-label', `Seleccionar ${obj.name || 'objeto sin nombre'}`);

    const iconMap = {
      box: 'deployed_code',
      'voxel-json': 'deployed_code',
      voxel: 'view_in_ar',
      quad: 'image',
      polygon: 'pentagon',
      cylinder: 'circle',
      plane: 'rectangle',
    };
    const icon = iconMap[obj.userData.type] || 'rectangle';

    item.innerHTML = `
      <span class="material-symbols-rounded">${icon}</span>
      <span class="scene-item-name">${obj.name || 'Unnamed'}</span>
      ${obj.userData.voxelized ? `<span class="scene-item-count" title="${obj.userData.voxelCount || 0} vóxeles">${obj.userData.voxelCount || 0}</span>` : ''}
      <span class="material-symbols-rounded scene-item-visibility" data-action="visibility">
        ${obj.visible ? 'visibility' : 'visibility_off'}
      </span>
      <span class="material-symbols-rounded scene-item-delete" data-action="delete" title="Borrar pieza">delete</span>
    `;

    item.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'visibility') {
        obj.visible = !obj.visible;
        this.refresh();
        return;
      }
      if (action === 'delete') {
        if (!sm.selectedObjects.includes(obj)) sm.selectObject(obj, false);
        if (this.onDelete) this.onDelete(obj);
        return;
      }
      const additive = e.shiftKey;
      sm.selectObject(obj, additive);
      if (this.onSelect) this.onSelect(obj);
      this.refresh();
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      }
    });

    this._configureObjectDrag(item, obj);

    return item;
  }

  _buildVoxelSelectionItem(obj, indented) {
    if (!obj.userData.voxelized || !obj.userData.voxelSelection) return null;
    const selectedCount = obj.userData.voxelSelection.reduce((total, selected, index) => (
      total + (selected && obj.userData.voxelActiveMap?.[index] ? 1 : 0)
    ), 0);
    if (selectedCount === 0) return null;

    const item = document.createElement('div');
    item.classList.add('scene-item', 'scene-voxel-selection');
    if (indented) item.classList.add('scene-child-item');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `${selectedCount} vóxeles seleccionados de ${obj.name}`);
    item.innerHTML = `
      <span class="material-symbols-rounded">select_all</span>
      <span class="scene-item-name">Vóxeles seleccionados</span>
      <span class="scene-item-count">${selectedCount}</span>
      <span class="material-symbols-rounded scene-item-delete" data-action="delete-voxels" title="Borrar vóxeles seleccionados">delete_sweep</span>
    `;

    item.addEventListener('click', (event) => {
      sm.selectObject(obj, false);
      if (event.target.closest('[data-action="delete-voxels"]')) {
        if (this.onDeleteVoxels) this.onDeleteVoxels(obj);
      } else if (this.onSelectVoxels) {
        this.onSelectVoxels(obj);
      }
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        item.click();
      }
    });
    return item;
  }

  _configureObjectDrag(item, obj) {
    if (obj.userData.isSceneGroup) return;
    item.draggable = true;
    item.addEventListener('dragstart', (event) => {
      const selected = this.sceneManager.selectedObjects.filter(selectedObj => !selectedObj.userData?.isSceneGroup);
      this.draggedItems = selected.includes(obj) ? selected : [obj];
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', obj.uuid);
      requestAnimationFrame(() => item.classList.add('dragging'));
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      this.container.classList.remove('drop-to-root');
      this.container.querySelectorAll('.drop-target').forEach(target => target.classList.remove('drop-target'));
      this.draggedItems = [];
    });
    item.addEventListener('dragover', (event) => {
      if (!this.draggedItems.length || this.draggedItems.includes(obj)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      item.classList.add('drop-target');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
    item.addEventListener('drop', (event) => {
      if (!this.draggedItems.length || this.draggedItems.includes(obj)) return;
      event.preventDefault();
      event.stopPropagation();
      item.classList.remove('drop-target');
      const parentGroup = obj.parent?.userData?.isSceneGroup ? obj.parent : null;
      if (parentGroup && this.onDropToGroup) this.onDropToGroup([...this.draggedItems], parentGroup);
      else if (this.onDropCreateGroup) this.onDropCreateGroup([...this.draggedItems], obj);
    });
  }

  _configureGroupDropTarget(item, group) {
    item.addEventListener('dragover', (event) => {
      if (!this.draggedItems.length) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      item.classList.add('drop-target');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
    item.addEventListener('drop', (event) => {
      if (!this.draggedItems.length) return;
      event.preventDefault();
      event.stopPropagation();
      item.classList.remove('drop-target');
      if (this.onDropToGroup) this.onDropToGroup([...this.draggedItems], group);
    });
  }
}
