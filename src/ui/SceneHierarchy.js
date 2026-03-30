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
  }

  refresh() {
    const sm = this.sceneManager;
    const groups = sm.groups;
    // Objects not parented to any scene group
    const standalone = sm.objects.filter(obj => !obj.parent?.userData?.isSceneGroup);

    if (groups.length === 0 && standalone.length === 0) {
      this.container.innerHTML = '<div class="scene-empty">No objects yet</div>';
      return;
    }

    this.container.innerHTML = '';

    for (const group of groups) {
      this.container.appendChild(this._buildGroupItem(group));
    }

    for (const obj of standalone) {
      this.container.appendChild(this._buildObjectItem(obj, false));
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

    header.innerHTML = `
      <span class="material-symbols-rounded scene-expand-icon">${isExpanded ? 'expand_more' : 'chevron_right'}</span>
      <span class="material-symbols-rounded">${isExpanded ? 'folder_open' : 'folder'}</span>
      <span class="scene-item-name">${group.name}</span>
      <span class="material-symbols-rounded scene-item-visibility" data-action="visibility">
        ${group.visible ? 'visibility' : 'visibility_off'}
      </span>
    `;

    header.addEventListener('click', (e) => {
      // Visibility toggle
      if (e.target.dataset.action === 'visibility') {
        group.visible = !group.visible;
        this.refresh();
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

    wrapper.appendChild(header);

    // ── Children ──
    if (isExpanded) {
      const childrenEl = document.createElement('div');
      childrenEl.classList.add('scene-group-children');

      for (const child of group.children) {
        if (child.isMesh || child.isGroup) {
          childrenEl.appendChild(this._buildObjectItem(child, true));
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

    const iconMap = { box: 'deployed_code', quad: 'image', polygon: 'pentagon', cylinder: 'circle', plane: 'rectangle' };
    const icon = iconMap[obj.userData.type] || 'rectangle';

    item.innerHTML = `
      <span class="material-symbols-rounded">${icon}</span>
      <span class="scene-item-name">${obj.name || 'Unnamed'}</span>
      <span class="material-symbols-rounded scene-item-visibility" data-action="visibility">
        ${obj.visible ? 'visibility' : 'visibility_off'}
      </span>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.dataset.action === 'visibility') {
        obj.visible = !obj.visible;
        this.refresh();
        return;
      }
      const additive = e.shiftKey;
      sm.selectObject(obj, additive);
      if (this.onSelect) this.onSelect(obj);
      this.refresh();
    });

    return item;
  }
}
