import { authoredParent } from './AuthoringTransforms.js';

export function selectionRoots(selection) {
  const selected = new Set(selection);
  return [...selected].filter(object => {
    for (let parent = authoredParent(object); parent; parent = authoredParent(parent)) if (selected.has(parent)) return false;
    return true;
  });
}

// Keep registries in sync with the visible scene. A detached group's children
// must not reappear as standalone objects in the next project snapshot.
export function captureSceneRemoval(scene, roots) {
  const descendants = new Set(); roots.forEach(root => root.traverse(node => descendants.add(node)));
  return { descendants, objects: [...scene.objects], groups: [...scene.groups],
    roots: roots.map(object => ({ object, parent: object.parent, index: object.parent?.children.indexOf(object) })) };
}

export function removeSceneTrees(scene, state) {
  state.roots.forEach(({ object }) => object.removeFromParent());
  scene.objects = scene.objects.filter(object => !state.descendants.has(object));
  scene.groups = scene.groups.filter(group => !state.descendants.has(group));
  scene._updateObjectCount();
}

export function restoreSceneTrees(scene, state) {
  state.roots.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).forEach(({ object, parent, index }) => {
    const destination = parent || scene.exportGroup; destination.add(object);
    destination.children.splice(destination.children.indexOf(object), 1);
    destination.children.splice(Math.min(index ?? destination.children.length, destination.children.length), 0, object);
  });
  scene.objects = [...state.objects]; scene.groups = [...state.groups]; scene._updateObjectCount();
}
