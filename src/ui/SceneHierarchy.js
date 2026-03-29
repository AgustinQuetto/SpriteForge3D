/**
 * SceneHierarchy — Tree view of all scene objects.
 */
export class SceneHierarchy {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.container = document.getElementById('scene-tree');
    this.onSelect = null;
  }

  refresh() {
    const objects = this.sceneManager.objects;
    const selected = this.sceneManager.selectedObject;

    if (objects.length === 0) {
      this.container.innerHTML = '<div class="scene-empty">No objects yet</div>';
      return;
    }

    this.container.innerHTML = '';

    for (const obj of objects) {
      const item = document.createElement('div');
      item.classList.add('scene-item');
      if (this.sceneManager.selectedObjects.includes(obj)) item.classList.add('selected');

      const icon = obj.userData.type === 'box' ? 'deployed_code' : 'rectangle';
      item.innerHTML = `
        <span class="material-symbols-rounded">${icon}</span>
        <span class="scene-item-name">${obj.name || 'Unnamed'}</span>
        <span class="material-symbols-rounded scene-item-visibility" data-action="visibility">
          ${obj.visible ? 'visibility' : 'visibility_off'}
        </span>
      `;

      // Select on click
      item.addEventListener('click', (e) => {
        if (e.target.dataset.action === 'visibility') {
          obj.visible = !obj.visible;
          this.refresh();
          return;
        }
        
        const additive = e.ctrlKey || e.shiftKey;
        this.sceneManager.selectObject(obj, additive);
        if (this.onSelect) this.onSelect(obj);
        this.refresh();
      });

      this.container.appendChild(item);
    }
  }
}
