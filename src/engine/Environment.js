import * as THREE from 'three';
import { normalizeEnvironment, normalizeLight, normalizeRenderSettings, finite } from './EnvironmentSettings.js';

export function daylightAt(settings, hour) {
  const phase = (hour - 6) / 24 * Math.PI * 2;
  const strength = Math.max(0, Math.sin(phase)); const daylight = THREE.MathUtils.smoothstep(strength, 0, 0.35);
  const elevation = THREE.MathUtils.degToRad(Math.sin(phase) * settings.sunElevation);
  const azimuth = THREE.MathUtils.degToRad(settings.sunAzimuth + (hour - 12) * 7.5);
  return { strength, daylight, direction: new THREE.Vector3(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth)) };
}

function active(object) {
  for (let node = object; node; node = node.userData._origParent || node.parent) if (node.userData.game?.enabled === false) return false;
  return true;
}

export class Environment {
  constructor(scene, roots, data = {}, { editor = false, onError = () => {} } = {}) {
    Object.assign(this, { scene, roots, editor, onError }); this.originalBackground = scene.background;
    this.group = new THREE.Group(); this.group.name = 'GameEnvironment'; scene.add(this.group);
    this.ambient = new THREE.HemisphereLight(); this.sun = new THREE.DirectionalLight();
    this.legacyAmbient = new THREE.AmbientLight(0xffffff, 1.2); this.group.add(this.ambient, this.sun, this.sun.target, this.legacyAmbient);
    this.lights = new Map(); this.depths = new Map(); this.flags = new Map(); this.reported = new Set();
    this.revision = 0; this.configure(data);
  }

  configure(data) { this.settings = normalizeEnvironment(data); this.hour = this.settings.dayNight.hour; this.cycling = this.settings.dayNight.enabled; this.revision++; }
  setTime(hour) { this.hour = finite(hour, 0, 24, 'hour') % 24; }
  setCycleRunning(enabled) { if (typeof enabled !== 'boolean') throw new Error('Cycle state must be boolean'); this.cycling = enabled; }
  advance(dt) { if (this.settings.enabled && this.cycling) this.hour = (this.hour + dt * 24 / this.settings.dayNight.duration) % 24; }

  warn(key, message) { if (!this.reported.has(key)) { this.reported.add(key); this.onError(message); } }

  releaseLight(record) {
    this.group.remove(record.light, record.light.target); record.light.dispose();
  }

  syncLights(roots) {
    const seen = new Set(); const scanned = new Set(); let count = 0; let shadows = this.sun.castShadow ? 1 : 0;
    for (const root of roots) root.traverse(object => {
      if (!object.userData.game?.light?.enabled || !active(object) || scanned.has(object)) return;
      if (this.editor) { for (let node = object; node; node = node.parent) if (!node.visible || !node.layers.mask) return; }
      scanned.add(object);
      if (count++ >= 32) { this.warn('light-budget', 'Lighting budget: only the first 32 active object lights are rendered.'); return; }
      let data;
      try { data = normalizeLight(object.userData.game.light); }
      catch (error) { this.warn(object.uuid, `${object.name} / light: ${error.message}`); return; }
      seen.add(object);
      let record = this.lights.get(object);
      if (!record || record.type !== data.type) {
        if (record) this.releaseLight(record);
        const light = data.type === 'point' ? new THREE.PointLight() : data.type === 'spot' ? new THREE.SpotLight() : new THREE.DirectionalLight();
        light.name = `Light: ${object.name}`; this.group.add(light); if (light.target) this.group.add(light.target);
        record = { light, type: data.type }; this.lights.set(object, record);
      }
      const light = record.light; object.updateWorldMatrix(true, false);
      light.position.fromArray(data.offset).applyMatrix4(object.matrixWorld); light.color.set(data.color); light.intensity = data.intensity;
      if (light.isPointLight || light.isSpotLight) { light.distance = data.distance; light.decay = data.decay; }
      if (light.isSpotLight) { light.angle = THREE.MathUtils.degToRad(data.angle); light.penumbra = data.penumbra; }
      if (light.target) light.target.position.copy(light.position).add(new THREE.Vector3().fromArray(data.direction).transformDirection(object.matrixWorld).multiplyScalar(100));
      light.castShadow = this.settings.enabled && this.settings.shadows && data.castShadow && shadows < 4;
      if (light.castShadow) shadows++;
      else if (data.castShadow && this.settings.shadows && shadows >= 4) this.warn('shadow-budget', 'Shadow budget: sun plus object shadow lights are limited to four.');
      const size = Math.min(light.isPointLight ? 512 : 1024, this.settings.shadowSize);
      if (light.shadow.mapSize.x !== size) { light.shadow.dispose(); light.shadow.map = null; light.shadow.mapPass = null; light.shadow.mapSize.set(size, size); }
      light.shadow.bias = -0.0005; light.shadow.normalBias = 0.15;
      light.shadow.camera.near = 0.1; light.shadow.camera.far = Math.max(100, data.distance);
      if (light.isDirectionalLight) { Object.assign(light.shadow.camera, { left: -data.distance, right: data.distance, top: data.distance, bottom: -data.distance }); }
      light.shadow.camera.updateProjectionMatrix();
    });
    for (const [object, record] of this.lights) if (!seen.has(object) || !object.userData.game.light.enabled || !active(object)) { this.releaseLight(record); this.lights.delete(object); }
  }

  syncShadows(roots) {
    if (!this.settings.enabled) {
      for (const [object, flags] of this.flags) Object.assign(object, flags); this.flags.clear();
      for (const [object, record] of this.depths) this.releaseDepth(object, record);
      return;
    }
    const seen = new Set();
    for (const root of roots) root.traverse(object => {
      if (!object.isMesh) return; seen.add(object);
      if (!this.flags.has(object)) this.flags.set(object, { castShadow: object.castShadow, receiveShadow: object.receiveShadow });
      let owner = object;
      while (owner && !owner.userData.game?.render) owner = owner.userData._origParent || owner.parent;
      const flags = owner?.userData.game?.render || normalizeRenderSettings();
      object.castShadow = flags.castShadow; object.receiveShadow = flags.receiveShadow;
      const material = object.material;
      if (!Array.isArray(material) && material?.map && material.transparent && material.alphaTest < 0.1 && !object.customDepthMaterial) {
        const params = { map: material.map, alphaMap: material.alphaMap, alphaTest: 0.1, side: material.side };
        const depth = new THREE.MeshDepthMaterial({ ...params, depthPacking: THREE.RGBADepthPacking }); const distance = new THREE.MeshDistanceMaterial(params);
        this.depths.set(object, { depth, distance, source: material }); object.customDepthMaterial = depth; object.customDistanceMaterial = distance;
      }
      const record = this.depths.get(object);
      if (record) {
        if (record.source !== material || record.depth.map !== material.map) this.releaseDepth(object, record);
        else { record.depth.map = record.distance.map = material.map; record.depth.alphaMap = record.distance.alphaMap = material.alphaMap; }
      }
    });
    for (const [object, record] of this.depths) if (!seen.has(object)) this.releaseDepth(object, record);
    for (const [object, flags] of this.flags) if (!seen.has(object)) { Object.assign(object, flags); this.flags.delete(object); }
  }

  releaseDepth(object, record) {
    if (object.customDepthMaterial === record.depth) object.customDepthMaterial = undefined;
    if (object.customDistanceMaterial === record.distance) object.customDistanceMaterial = undefined;
    record.depth.dispose(); record.distance.dispose(); this.depths.delete(object);
  }

  prepare(focus = new THREE.Vector3(), cameraSize = 220) {
    const settings = this.settings; const roots = [this.roots()].flat().filter(Boolean);
    if (!settings.enabled) {
      this.ambient.color.set(0xffffff); this.ambient.groundColor.set(0x48545e); this.ambient.intensity = this.editor ? 0 : 2;
      this.legacyAmbient.visible = this.editor;
      this.sun.color.set(0xffffff); this.sun.intensity = this.editor ? 0.4 : 2; this.sun.position.set(this.editor ? 5 : 200, this.editor ? 10 : 400, this.editor ? 5 : 160); this.sun.target.position.set(0, 0, 0); this.sun.castShadow = false;
      this.scene.background = this.originalBackground;
    } else {
      this.legacyAmbient.visible = false;
      const daylight = daylightAt(settings, this.hour);
      this.ambient.color.set('#24375e').lerp(new THREE.Color(settings.ambientColor), daylight.daylight);
      this.ambient.groundColor.set(settings.groundColor); this.ambient.intensity = settings.ambientIntensity * (0.15 + daylight.daylight * 0.85);
      this.sun.color.set('#ff9a64').lerp(new THREE.Color(settings.sunColor), daylight.strength); this.sun.intensity = settings.sunIntensity * Math.sqrt(daylight.strength);
      const range = Math.min(8192, Math.max(settings.shadowRange, cameraSize * 1.5));
      this.sun.position.copy(focus).addScaledVector(daylight.direction, range * 2); this.sun.target.position.copy(focus);
      this.sun.castShadow = settings.shadows && daylight.strength > 0.01;
      Object.assign(this.sun.shadow.camera, { left: -range, right: range, top: range, bottom: -range, near: 1, far: range * 5 }); this.sun.shadow.camera.updateProjectionMatrix();
      if (this.sun.shadow.mapSize.x !== settings.shadowSize) { this.sun.shadow.dispose(); this.sun.shadow.map = null; this.sun.shadow.mapPass = null; this.sun.shadow.mapSize.set(settings.shadowSize, settings.shadowSize); }
      this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.15;
      this.scene.background = new THREE.Color(settings.nightBackground).lerp(new THREE.Color(settings.background), daylight.daylight);
    }
    this.syncLights(roots); this.syncShadows(roots);
  }

  render(renderer, draw) {
    if (!renderer.shadowMap) return draw();
    const previous = { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type };
    try { renderer.shadowMap.enabled = this.settings.enabled && this.settings.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap; return draw(); }
    finally { Object.assign(renderer.shadowMap, previous); }
  }

  dispose() {
    for (const record of this.lights.values()) this.releaseLight(record); this.lights.clear();
    for (const [object, record] of this.depths) this.releaseDepth(object, record);
    for (const [object, flags] of this.flags) Object.assign(object, flags); this.flags.clear();
    this.sun.dispose(); this.group.removeFromParent(); this.scene.background = this.originalBackground;
  }
}
