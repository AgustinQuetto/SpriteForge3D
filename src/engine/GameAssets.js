import * as THREE from 'three';
import { setLocalMatrix } from '../core/AuthoringTransforms.js';

export function reidentifyGameObjects(roots) {
  const ids = new Map();
  const objects = new Set();
  for (const root of [roots].flat()) root.traverse(object => { if (object.userData.game) objects.add(object); });
  for (const object of objects) {
    object.userData.game = structuredClone(object.userData.game);
    const previous = object.userData.game.id;
    const next = THREE.MathUtils.generateUUID();
    if (previous) ids.set(previous, next);
    object.userData.game.id = next;
  }
  for (const object of objects) for (const rule of object.userData.game.events || []) {
    for (const action of rule.actions || []) if (ids.has(action.target)) action.target = ids.get(action.target);
  }
  return roots;
}

// Skip editor-only userData (DOM images, cached textures, voxel arrays). Visual
// buffers and material maps are authoritative in a runtime/template snapshot.
function cloneNode(source, nodes, targets) {
  source.updateWorldMatrix(true, false);
  const copy = new source.constructor();
  nodes.set(source, copy);
  copy.name = source.name;
  setLocalMatrix(copy, source.matrix.clone());
  copy.visible = source.visible;
  copy.castShadow = source.castShadow; copy.receiveShadow = source.receiveShadow; copy.renderOrder = source.renderOrder; copy.frustumCulled = source.frustumCulled;
  if (source.isLight) {
    copy.color.copy(source.color); copy.intensity = source.intensity;
    for (const key of ['distance', 'decay', 'angle', 'penumbra', 'width', 'height']) if (key in source) copy[key] = source[key];
    if (source.groundColor) copy.groundColor.copy(source.groundColor);
    if (source.shadow) copy.shadow = source.shadow.clone();
    if (source.target) targets.push([source, copy]);
  }
  copy.userData = {
    type: 'engine-object',
    game: source.userData.game ? structuredClone(source.userData.game) : undefined,
    mapCell: source.userData.mapCell ? structuredClone(source.userData.mapCell) : undefined,
  };
  // Parametric geometry.toJSON() writes constructor parameters, discarding
  // vertex edits and translated sprite pivots. Store actual buffers instead.
  if (source.geometry) copy.geometry = new THREE.BufferGeometry().copy(source.geometry);
  const cloneMaterial = material => {
    const cloned = material.clone();
    for (const key of Object.keys(cloned)) {
      if (cloned[key]?.isTexture) {
        cloned[key] = cloned[key].clone();
        cloned[key].needsUpdate = true;
      }
    }
    return cloned;
  };
  if (source.material) copy.material = Array.isArray(source.material)
    ? source.material.map(cloneMaterial) : cloneMaterial(source.material);
  for (const child of source.children) copy.add(cloneNode(child, nodes, targets));
  return copy;
}

export function cloneGameObject(source) {
  const nodes = new Map(); const targets = []; const copy = cloneNode(source, nodes, targets);
  for (const [original, cloned] of targets) {
    if (nodes.has(original.target)) cloned.target = nodes.get(original.target);
    else {
      source.updateWorldMatrix(true, false);
      cloned.target.position.copy(original.target.getWorldPosition(new THREE.Vector3())).applyMatrix4(source.matrixWorld.clone().invert());
      cloned.target.updateMatrix();
      cloned.target.name = 'Light target'; copy.add(cloned.target);
    }
  }
  return copy;
}

export function disposeGameObject(root) {
  const textures = new Set();
  root.traverse(node => {
    if (node.isLight) node.dispose?.();
    node.geometry?.dispose();
    for (const material of [node.material].flat().filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      material.dispose();
    }
  });
  textures.forEach(texture => texture.dispose());
  root.removeFromParent();
}

export function serializeGameObject(source) {
  const copy = cloneGameObject(source);
  const json = copy.toJSON();
  disposeGameObject(copy);
  return json;
}

export async function parseGameObject(json) {
  const object = await new THREE.ObjectLoader().parseAsync(json);
  object.traverse(node => setLocalMatrix(node, node.matrix.clone()));
  return object;
}
