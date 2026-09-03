import * as THREE from 'three';

function cloneWithWorldTransform(object) {
  object.updateWorldMatrix(true, false);

  const clone = object.clone(true);
  clone.matrix.copy(object.matrixWorld);
  clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
  clone.matrixAutoUpdate = true;
  clone.updateMatrixWorld(true);
  return clone;
}

function hasExportableContent(root) {
  let found = false;
  root.traverse(node => {
    if (node.isMesh || node.isLine || node.isPoints) found = true;
  });
  return found;
}

/**
 * Build an isolated export root from the current scene selection.
 *
 * Exporters clone their input, so cloning here lets us export a mesh, a
 * group, or several selected items without moving anything in the editor.
 * World transforms are baked into the temporary clones so objects selected
 * from inside a group keep their visible position in the exported file.
 */
export function createExportScope(sceneManager) {
  const selected = (sceneManager.selectedObjects || []).filter(Boolean);

  if (selected.length === 0) {
    return {
      group: sceneManager.exportGroup,
      isSelection: false,
      label: 'Escena completa',
      hasContent: hasExportableContent(sceneManager.exportGroup),
    };
  }

  const group = new THREE.Group();
  const firstName = selected.length === 1 ? selected[0].name : '';
  group.name = firstName || 'SelectedObjects';
  selected.forEach(object => group.add(cloneWithWorldTransform(object)));

  return {
    group,
    isSelection: true,
    label: selected.length === 1
      ? `Selecci\u00f3n: ${firstName || 'objeto'}`
      : `Selecci\u00f3n: ${selected.length} objetos`,
    hasContent: hasExportableContent(group),
  };
}
