import * as THREE from 'three';
import { authoredMatrix, authoredParent, setLocalMatrix } from '../core/AuthoringTransforms.js';
import { cloneGameObject, disposeGameObject, parseGameObject } from '../engine/GameAssets.js';
import { normalizeGameComponents } from '../engine/GameComponents.js';
import { yieldProjectLoad } from './ProjectLoader.js';
import { reconcileMapCells, validateMapCell } from '../engine/MapPlacement.js';

const transientKeys = new Set(['texture', 'textureImage', 'voxelBakedTexture', 'importedRoot']);
const arrayTypes = new Set(['Uint8Array', 'Uint8ClampedArray', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array']);

function metadata(value, seen = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return undefined;
  if (ArrayBuffer.isView(value)) return Array.from(value);
  if (seen.has(value)) return undefined;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return undefined;
  seen.add(value);
  const result = Array.isArray(value) ? value.map(item => metadata(item, seen)) : Object.fromEntries(Object.entries(value)
    .filter(([key]) => !key.startsWith('_') && !transientKeys.has(key))
    .map(([key, item]) => [key, metadata(item, seen)]).filter(([, item]) => item !== undefined));
  seen.delete(value);
  return result;
}

export function cloneEditorObject(source) {
  const copy = cloneGameObject(source);
  const visit = (original, target) => {
    target.userData = metadata(original.userData);
    for (const [key, value] of Object.entries(original.userData)) if (ArrayBuffer.isView(value)) target.userData[key] = new value.constructor(value);
    if (original.userData.texture) target.userData.texture = original.userData.texture;
    if (original.userData.textureImage) target.userData.textureImage = original.userData.textureImage;
    if (original.userData.voxelBakedTexture) target.userData.voxelBakedTexture = [target.material].flat().find(material => material?.map)?.map;
    original.children.forEach((child, index) => visit(child, target.children[index]));
  };
  visit(source, copy);
  copy.traverse(node => { if (node.userData.type === 'imported-3d') node.traverse(child => { if (child.isMesh || child.isLine || child.isPoints) child.userData.importedRoot = node; }); });
  return copy;
}

export function captureProjectScene(scene) {
  reconcileMapCells(scene.objects);
  const registered = new Set([...scene.objects, ...scene.groups]);
  if (registered.size !== scene.objects.length + scene.groups.length) throw new Error('Scene registry contains duplicate objects');
  const children = new Map();
  for (const [kind, list] of [['object', scene.objects], ['group', scene.groups]]) list.forEach((object, index) => {
    const parent = authoredParent(object); if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push({ kind, index });
  });
  const objects = scene.objects.map(object => {
    const copy = cloneGameObject(object);
    const visit = (source, target) => {
      target.userData = metadata(source.userData);
      const image = source.userData.textureImage || source.userData.texture?.image;
      const url = image?.currentSrc || image?.src;
      if (typeof url === 'string' && url.startsWith('data:image/')) target.userData.projectTextureSource = url;
      for (let index = source.children.length - 1; index >= 0; index--) {
        const child = source.children[index]; const childCopy = target.children[index];
        if (registered.has(child)) disposeGameObject(childCopy);
        else visit(child, childCopy);
      }
    };
    try {
      visit(object, copy);
      setLocalMatrix(copy, authoredMatrix(object));
      return { name: object.name, visual: copy.toJSON() };
    } finally { disposeGameObject(copy); }
  });
  const groups = scene.groups.map(group => ({
    name: group.name, visible: group.visible, matrix: authoredMatrix(group).toArray(),
    editor: metadata(group.userData),
    children: children.get(group) || [],
  }));
  // Registered children of registered visual roots need explicit relationships.
  for (const [index, object] of scene.objects.entries()) {
    objects[index].children = children.get(object) || [];
  }
  return { objects, groups };
}

function vector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) throw new Error(`Invalid ${label}`);
}

function validateMatrix(matrix, label) {
  vector(matrix, 16, label);
  if ([3, 7, 11].some(index => Math.abs(matrix[index]) > 1e-9) || Math.abs(matrix[15] - 1) > 1e-9) throw new Error(`Invalid affine matrix: ${label}`);
}

export function validateVisualSnapshot(visual, label = 'visual asset') {
  if (!visual?.object || typeof visual.object.type !== 'string') throw new Error(`Invalid ${label}`);
  for (const key of ['geometries', 'materials', 'textures', 'images']) if (visual[key] !== undefined && !Array.isArray(visual[key])) throw new Error(`Invalid ${label} ${key}`);
  const ids = key => new Set((visual[key] || []).map(item => item.uuid));
  const geometries = ids('geometries'); const materials = ids('materials'); const textures = ids('textures'); const images = ids('images');
  const visit = node => {
    if (!node || typeof node.type !== 'string') throw new Error(`Invalid ${label} node`);
    if (node.matrix) validateMatrix(node.matrix, `${label} transform`);
    if (node.geometry && !geometries.has(node.geometry)) throw new Error(`Missing geometry in ${label}`);
    for (const material of [node.material].flat().filter(Boolean)) if (!materials.has(material)) throw new Error(`Missing material in ${label}`);
    if (node.userData?.game) normalizeGameComponents(node.userData.game);
    if (node.userData?.mapCell) validateMapCell(node.userData.mapCell);
    if (node.userData?.projectTextureSource && !/^data:image\/(png|jpeg|jpg|webp|gif|avif|bmp);base64,/i.test(node.userData.projectTextureSource)) throw new Error(`Invalid base texture in ${label}`);
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error(`Invalid ${label} children`);
    (node.children || []).forEach(visit);
  };
  visit(visual.object);
  for (const material of visual.materials || []) for (const [key, value] of Object.entries(material)) {
    if ((key === 'map' || key.endsWith('Map') || ['matcap', 'gradientMap'].includes(key)) && typeof value === 'string' && !textures.has(value)) throw new Error(`Missing texture in ${label}`);
  }
  for (const texture of visual.textures || []) if (texture.image && !images.has(texture.image)) throw new Error(`Missing image in ${label}`);
  for (const image of visual.images || []) for (const url of [image.url].flat()) {
    if (typeof url === 'string') {
      if (!/^data:image\/(png|jpeg|jpg|webp|gif|avif|bmp);base64,/i.test(url)) throw new Error(`${label} contains an image that is not embedded`);
    } else if (url && typeof url === 'object') {
      if (!arrayTypes.has(url.type) || !Array.isArray(url.data) || !Number.isInteger(url.width) || !Number.isInteger(url.height) || url.width < 1 || url.height < 1) throw new Error(`Invalid image buffer in ${label}`);
    } else throw new Error(`Invalid image in ${label}`);
  }
}

export function projectTextureSources(project) {
  const urls = new Set();
  const visit = node => {
    if (node?.userData?.projectTextureSource) urls.add(node.userData.projectTextureSource);
    (node?.children || []).forEach(visit);
  };
  for (const object of project.objects) visit(object.visual?.object);
  return [...urls];
}

export function normalizeProjectDocument(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.assets) || !Array.isArray(input.objects)) throw new Error('Invalid project: assets and objects must be arrays');
  const project = structuredClone(input);
  const version = project.version ?? 1;
  if (!Number.isInteger(version) || version < 1 || version > 4) throw new Error(`Unsupported project version: ${version}`);
  project.version = version;
  project.groups ??= []; project.modelAssets ??= [];
  if (!Array.isArray(project.groups) || !Array.isArray(project.modelAssets)) throw new Error('Invalid project groups or model library');
  const names = new Set();
  for (const asset of project.assets) {
    if (typeof asset.name !== 'string' || names.has(asset.name) || typeof asset.dataUrl !== 'string' || !/^data:image\/(png|jpeg|jpg|webp|gif|avif|bmp);base64,/i.test(asset.dataUrl)) throw new Error('Invalid or duplicate sprite asset');
    names.add(asset.name);
  }
  for (const asset of project.modelAssets) if (typeof asset.name !== 'string' || typeof asset.format !== 'string' || typeof asset.sourceBase64 !== 'string') throw new Error('Invalid model asset');
  const supported = ['engine-object', 'imported-3d', 'voxel-json', 'voxel', 'plane', 'cube', 'cylinder', 'quad', 'box'];
  for (const [index, object] of project.objects.entries()) {
    const label = `object ${index + 1} (${object?.name || 'unnamed'})`;
    if (version === 4) validateVisualSnapshot(object.visual, label);
    else {
      if (!supported.includes(object.type)) throw new Error(`Unsupported ${label} type: ${object.type}`);
      for (const key of ['position', 'rotation', 'scale']) vector(object[key] || (key === 'scale' ? [1, 1, 1] : [0, 0, 0]), 3, `${label} ${key}`);
      if (object.type === 'engine-object') validateVisualSnapshot(object.engineScene, label);
      if (object.game) object.game = normalizeGameComponents(object.game);
    }
    object.children ??= [];
    if (!Array.isArray(object.children)) throw new Error(`Invalid ${label} hierarchy`);
  }
  for (const [index, group] of project.groups.entries()) {
    if (!group || typeof group.name !== 'string') throw new Error(`Invalid group ${index + 1}`);
    if (version === 4) validateMatrix(group.matrix, `group ${index + 1}`);
    else {
      for (const key of ['position', 'rotation', 'scale']) vector(group[key] || (key === 'scale' ? [1, 1, 1] : [0, 0, 0]), 3, `group ${index + 1} ${key}`);
      if (group.game) group.game = normalizeGameComponents(group.game);
      group.children = (group.children || []).map(child => ({ kind: 'object', index: child }));
    }
    group.children ??= [];
    if (!Array.isArray(group.children)) throw new Error(`Invalid group ${index + 1} children`);
  }
  const parents = new Map();
  const records = [...project.objects.map((data, index) => ({ data, key: `object:${index}` })), ...project.groups.map((data, index) => ({ data, key: `group:${index}` }))];
  for (const { data, key } of records) for (const child of data.children) {
    if (!['object', 'group'].includes(child.kind) || !Number.isInteger(child.index) || child.index < 0 || child.index >= (child.kind === 'object' ? project.objects.length : project.groups.length)) throw new Error('Invalid child reference in project hierarchy');
    const childKey = `${child.kind}:${child.index}`;
    if (parents.has(childKey)) throw new Error('An object cannot have multiple project parents');
    parents.set(childKey, key);
  }
  for (const { key } of records) {
    const path = new Set();
    for (let node = key; node; node = parents.get(node)) {
      if (path.has(node)) throw new Error('Project hierarchy contains a cycle');
      path.add(node);
    }
  }
  return project;
}

export async function prepareProjectScene(project, { legacyObject, parseVisual = parseGameObject, signal } = {}) {
  const root = new THREE.Group(); root.name = 'ExportGroup';
  const objects = []; const groups = [];
  const check = () => { if (signal?.aborted) throw new DOMException('Project load cancelled', 'AbortError'); };
  try {
    for (const data of project.objects) {
      if (objects.length % 32 === 0) await yieldProjectLoad(signal);
      check();
      let object;
      try { object = project.version === 4 ? await parseVisual(data.visual) : await legacyObject(data); }
      catch (error) { throw new Error(`Could not restore ${data.name || 'object'}: ${error.message || 'invalid visual or embedded image'}`, { cause: error }); }
      if (!object?.isObject3D) throw new Error(`Could not restore ${data.name || 'object'}`);
      root.add(object); objects.push(object); check();
    }
    for (const data of project.groups) {
      if (groups.length % 32 === 0) await yieldProjectLoad(signal);
      const group = new THREE.Group(); group.name = data.name || 'Group'; group.visible = data.visible !== false;
      group.userData = { ...(data.editor || {}), isSceneGroup: true };
      if (data.game) group.userData.game = structuredClone(data.game);
      if (project.version === 4) setLocalMatrix(group, new THREE.Matrix4().fromArray(data.matrix));
      else {
        group.position.fromArray(data.position || [0, 0, 0]); group.rotation.fromArray(data.rotation || [0, 0, 0]); group.scale.fromArray(data.scale || [1, 1, 1]);
      }
      root.add(group); groups.push(group);
    }
    const connect = (data, object) => data.children.forEach(child => object.add((child.kind === 'object' ? objects : groups)[child.index]));
    project.objects.forEach((data, index) => connect(data, objects[index]));
    project.groups.forEach((data, index) => connect(data, groups[index]));
    const ids = new Set();
    root.traverse(node => {
      const positions = node.geometry?.getAttribute('position')?.array;
      if (positions && positions.some(value => !Number.isFinite(value))) throw new Error(`Invalid geometry positions: ${node.name}`);
      if (node.userData.game) {
        node.userData.game = normalizeGameComponents(node.userData.game);
        if (ids.has(node.userData.game.id)) throw new Error(`Duplicate game object ID: ${node.name}`);
        ids.add(node.userData.game.id);
      }
      if (node.userData.mapCell) {
        try { validateMapCell(node.userData.mapCell); }
        catch (error) { throw new Error(`${error.message}: ${node.name}`); }
      }
    });
    root.updateMatrixWorld(true); reconcileMapCells(objects); check();
    return { root, objects, groups };
  } catch (error) { disposeGameObject(root); throw error; }
}
