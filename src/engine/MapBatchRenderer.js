import * as THREE from 'three';

function geometryKey(geometry) {
  let hash = 2166136261;
  const add = value => { hash = Math.imul(hash ^ value, 16777619); };
  const attributes = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b));
  const layout = [];
  for (const [name, attribute] of [...attributes, ['index', geometry.index]]) {
    if (!attribute) continue;
    if (attribute.isInterleavedBufferAttribute || attribute.isInstancedBufferAttribute) return null;
    const bytes = new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
    for (const byte of bytes) add(byte);
    layout.push(`${name}:${attribute.array.constructor.name}:${attribute.itemSize}:${attribute.normalized}:${attribute.count}`);
  }
  return `${layout.join('|')}:${geometry.drawRange.start}:${geometry.drawRange.count}:${hash >>> 0}`;
}

function sameGeometry(a, b) {
  for (const key of [...Object.keys(a.attributes), 'index']) {
    const first = key === 'index' ? a.index : a.attributes[key];
    const second = key === 'index' ? b.index : b.attributes[key];
    if (!first !== !second) return false;
    if (first && (first.array.length !== second.array.length || first.array.some((value, index) => value !== second.array[index]))) return false;
  }
  return true;
}

function materialState(material) {
  const keys = Object.keys(material).filter(key => !['uuid', 'id', 'name', 'color', 'userData'].includes(key));
  return { keys, values: keys.map(key => material[key]?.isColor ? material[key].clone() : material[key]), compile: material.onBeforeCompile };
}

function materialUnchanged(record) {
  if (record.object.material !== record.material) return false;
  const { keys, values, compile } = record.materialState; const material = record.material;
  if (material.onBeforeCompile !== compile) return false;
  for (let index = 0; index < keys.length; index++) {
    const previous = values[index]; const current = material[keys[index]];
    if (previous?.isColor ? !current?.isColor || !previous.equals(current) : previous !== current) return false;
  }
  return true;
}

function geometryState(geometry) {
  return { geometry, start: geometry.drawRange.start, count: geometry.drawRange.count,
    attributes: [...Object.entries(geometry.attributes), ['index', geometry.index]].filter(([, attribute]) => attribute)
      .map(([key, attribute]) => ({ key, attribute, version: attribute.version, array: attribute.array })) };
}

function geometryUnchanged(record) {
  const geometry = record.object.geometry; const state = record.geometryState;
  if (geometry !== state.geometry || geometry.drawRange.start !== state.start || geometry.drawRange.count !== state.count) return false;
  if (Object.keys(geometry.attributes).length !== state.attributes.length - (geometry.index ? 1 : 0)) return false;
  for (const { key, attribute, version, array } of state.attributes) {
    if ((key === 'index' ? geometry.index : geometry.attributes[key]) !== attribute || attribute.version !== version || attribute.array !== array) return false;
  }
  return true;
}

function canInstance(object) {
  const material = object.material; const geometry = object.geometry;
  if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh || object.children.length || !object.userData.mapCell || !geometry?.attributes.position) return false;
  if (!material || Array.isArray(material) || (!material.isMeshStandardMaterial && !material.isMeshBasicMaterial)) return false;
  if (material.transparent || material.opacity !== 1 || material.wireframe || material.clippingPlanes || material.vertexColors || Object.values(material).some(value => value?.isTexture)) return false;
  if (material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false;
  if (Object.keys(geometry.morphAttributes).length || object.renderOrder || object.userData.game?.animation?.enabled) return false;
  return true;
}

// Three.js instanced normals support independent TRS, but not shear or mirrored
// transforms. Keep those meshes in the regular renderer.
function supportedMatrix(matrix) {
  if (matrix.determinant() <= 1e-12) return false;
  const e = matrix.elements;
  const x = e[0] ** 2 + e[1] ** 2 + e[2] ** 2; const y = e[4] ** 2 + e[5] ** 2 + e[6] ** 2; const z = e[8] ** 2 + e[9] ** 2 + e[10] ** 2;
  return Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]) < 1e-6 * Math.sqrt(x * y)
    && Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]) < 1e-6 * Math.sqrt(x * z)
    && Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]) < 1e-6 * Math.sqrt(y * z);
}

export class MapBatchRenderer {
  constructor(scene, roots, { minimum = 8 } = {}) {
    Object.assign(this, { scene, roots, minimum });
    this.group = new THREE.Group(); this.group.name = 'MapRenderBatches'; this.group.layers.enableAll();
    scene.add(this.group); this.batches = []; this.dirty = true;
    this.stats = { cells: 0, batches: 0 };
  }

  invalidate() { this.dirty = true; }

  clear() {
    for (const batch of this.batches) { batch.mesh.removeFromParent(); batch.mesh.geometry.dispose(); batch.mesh.material.dispose(); batch.mesh.dispose(); }
    this.batches = []; this.stats = { cells: 0, batches: 0 };
  }

  rebuild(roots) {
    this.clear(); this.dirty = false;
    const buckets = new Map(); const keys = new WeakMap();
    for (const root of roots) root.traverse(object => {
      if (!canInstance(object)) return;
      const geometry = object.geometry; const material = object.material;
      if (!keys.has(geometry)) keys.set(geometry, geometryKey(geometry));
      const geometrySignature = keys.get(geometry); if (!geometrySignature) return;
      const json = material.toJSON();
      for (const key of ['uuid', 'name', 'metadata', 'color', 'userData']) delete json[key];
      const e = object.matrixWorld.elements; const chunkSize = Math.max(1, object.userData.mapCell.size) * 16;
      const key = `${geometrySignature}:${JSON.stringify(json)}:${object.castShadow}:${object.receiveShadow}:${Math.floor(e[12] / chunkSize)},${Math.floor(e[14] / chunkSize)}`;
      const bucket = buckets.get(key) || [];
      // Verify actual arrays as well: a hash collision must never merge visuals.
      if (bucket.length && !sameGeometry(bucket[0].geometry, geometry)) return;
      bucket.push(object); buckets.set(key, bucket);
    });
    for (const objects of buckets.values()) {
      if (objects.length < this.minimum) continue;
      const geometry = new THREE.BufferGeometry().copy(objects[0].geometry); geometry.computeBoundingSphere();
      const material = objects[0].material.clone(); material.color.set(0xffffff);
      const mesh = new THREE.InstancedMesh(geometry, material, objects.length);
      mesh.name = 'MapRenderBatch'; mesh.layers.enableAll(); mesh.castShadow = objects[0].castShadow; mesh.receiveShadow = objects[0].receiveShadow;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const records = objects.map(object => ({ object, castShadow: object.castShadow, receiveShadow: object.receiveShadow, material: object.material, materialState: materialState(object.material), geometryState: geometryState(object.geometry) }));
      this.group.add(mesh); this.batches.push({ mesh, records });
    }
  }

  prepare(camera, roots) {
    this.scene.updateMatrixWorld();
    if (this.dirty) this.rebuild(roots);
    const rootSet = new Set(roots); const hidden = []; let cells = 0; let batches = 0;
    for (const batch of this.batches) {
      const { mesh } = batch; let count = 0; let matricesChanged = false; let colorsChanged = false;
      for (const record of batch.records) {
        const object = record.object;
        if (!materialUnchanged(record) || !geometryUnchanged(record) || object.castShadow !== record.castShadow || object.receiveShadow !== record.receiveShadow || object.children.length || object.userData.game?.animation?.enabled
          || object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || Object.keys(object.geometry.morphAttributes).length) continue;
        let visible = object.layers.test(camera.layers); let connected = false;
        for (let node = object; node; node = node.parent) { visible &&= node.visible; connected ||= rootSet.has(node); }
        if (!visible || !connected || !supportedMatrix(object.matrixWorld)) continue;
        const matrix = object.matrixWorld.elements; const array = mesh.instanceMatrix.array; const offset = count * 16;
        if (matrix.some((value, index) => array[offset + index] !== Math.fround(value))) { mesh.setMatrixAt(count, object.matrixWorld); matricesChanged = true; }
        const color = object.material.color; const colors = mesh.instanceColor?.array; const colorOffset = count * 3;
        if (!colors || colors[colorOffset] !== Math.fround(color.r) || colors[colorOffset + 1] !== Math.fround(color.g) || colors[colorOffset + 2] !== Math.fround(color.b)) {
          mesh.setColorAt(count, color); colorsChanged = true;
        }
        hidden.push(object); count++;
      }
      if (count !== mesh.count) matricesChanged = true;
      mesh.count = count; mesh.visible = count > 0;
      if (matricesChanged) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
      if (colorsChanged) mesh.instanceColor.needsUpdate = true;
      cells += count; if (count) batches++;
    }
    this.stats = { cells, batches }; return hidden;
  }

  render(renderer, camera, enabled = true) {
    if (!enabled) { this.group.visible = false; this.stats = { cells: 0, batches: 0 }; renderer.render(this.scene, camera); return; }
    this.group.visible = true;
    const roots = [this.roots()].flat().filter(Boolean); const hidden = this.prepare(camera, roots);
    const autoUpdate = this.scene.matrixWorldAutoUpdate;
    try {
      hidden.forEach(object => { object.visible = false; });
      this.scene.matrixWorldAutoUpdate = false; // prepare() already updated world matrices.
      renderer.render(this.scene, camera);
    } finally { this.scene.matrixWorldAutoUpdate = autoUpdate; hidden.forEach(object => { object.visible = true; }); }
  }

  dispose() { this.clear(); this.group.removeFromParent(); }
}
