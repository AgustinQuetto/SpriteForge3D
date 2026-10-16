import * as THREE from 'three';
import { finite, color } from './EnvironmentSettings.js';

export function normalizeParticles(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid particle emitter');
  const result = { enabled: false, emitting: true, count: 128, rate: 24, lifetime: 2, speed: 30, spread: 0.5, gravity: 0,
    size: 5, color: '#ffb65d', brightness: 2, opacity: 0.9, additive: true, area: [4, 4], seed: 1, ...structuredClone(data) };
  for (const key of ['enabled', 'emitting', 'additive']) if (typeof result[key] !== 'boolean') throw new Error(`Invalid particle ${key}`);
  if (!Number.isInteger(result.count) || result.count < 1 || result.count > 2048) throw new Error('Particle capacity must be 1–2048');
  finite(result.rate, 0, 2000, 'particle rate'); finite(result.lifetime, 0.1, 30, 'particle lifetime'); finite(result.speed, 0, 1000, 'particle speed');
  finite(result.spread, 0, 2, 'particle spread'); finite(result.gravity, -1000, 1000, 'particle gravity'); finite(result.size, 0.1, 128, 'particle size');
  color(result.color, 'particle'); finite(result.brightness, 0, 10, 'particle brightness'); finite(result.opacity, 0, 1, 'particle opacity');
  if (!Array.isArray(result.area) || result.area.length !== 2 || !result.area.every(value => Number.isFinite(value) && value >= 0 && value <= 10000)) throw new Error('Invalid particle emission area');
  if (!Number.isInteger(result.seed) || result.seed < 1 || result.seed > 2147483647) throw new Error('Invalid particle seed');
  return result;
}

function particleTexture() {
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const alpha = Math.max(0, 1 - Math.hypot((x - 7.5) / 7.5, (y - 7.5) / 7.5)); const offset = (y * 16 + x) * 4;
    data.set([255, 255, 255, Math.round(alpha * alpha * 255)], offset);
  }
  const texture = new THREE.DataTexture(data, 16, 16); texture.needsUpdate = true; return texture;
}

export class ParticleEmitter {
  constructor(object, input = {}, capacity) {
    const data = normalizeParticles(input);
    this.object = object; this.settings = data; this.capacity = Math.max(0, Math.floor(Math.min(capacity ?? data.count, data.count)));
    this.randomState = data.seed; this.elapsed = 0; this.pending = 0; this.alive = 0; this.burst = 0;
    this.positions = new Float32Array(this.capacity * 3); this.colors = new Float32Array(this.capacity * 4); this.velocities = new Float32Array(this.capacity * 3); this.ages = new Float32Array(this.capacity); this.ages.fill(-1);
    this.geometry = new THREE.BufferGeometry(); this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.PointsMaterial({ size: data.size, color: data.color, map: particleTexture(), transparent: true, opacity: data.opacity,
      depthWrite: false, vertexColors: true, blending: data.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.material.color.multiplyScalar(this.settings.brightness);
    this.points = new THREE.Points(this.geometry, this.material); this.points.name = 'RuntimeParticles'; this.points.frustumCulled = false;
  }

  random() { this.randomState = Math.imul(this.randomState, 1664525) + 1013904223 | 0; return (this.randomState >>> 0) / 4294967296; }
  emit(count) { this.burst = Math.min(this.capacity, this.burst + Math.max(0, Math.floor(finite(count, 0, 100000, 'particle burst')))); }

  update(dt, active = true) {
    this.points.visible = active;
    if (!active) return;
    const data = this.settings; this.elapsed += dt; this.pending += data.emitting ? data.rate * dt : 0;
    let spawn = Math.min(this.capacity, Math.floor(this.pending) + this.burst); this.pending %= 1; this.burst = 0;
    this.object.updateWorldMatrix(true, false); let count = 0;
    for (let index = 0; index < this.capacity; index++) {
      const offset = index * 3;
      if (this.ages[index] >= 0) {
        this.ages[index] += dt;
        if (this.ages[index] >= data.lifetime) this.ages[index] = -1;
        else { this.velocities[offset + 1] += data.gravity * dt; for (let axis = 0; axis < 3; axis++) this.positions[offset + axis] += this.velocities[offset + axis] * dt; }
      }
      if (this.ages[index] < 0 && spawn > 0) {
        spawn--; this.ages[index] = 0;
        const position = new THREE.Vector3((this.random() - 0.5) * data.area[0], 0, (this.random() - 0.5) * data.area[1]).applyMatrix4(this.object.matrixWorld);
        const velocity = new THREE.Vector3((this.random() - 0.5) * data.spread, 1, (this.random() - 0.5) * data.spread).transformDirection(this.object.matrixWorld).multiplyScalar(data.speed * (0.6 + this.random() * 0.8));
        position.toArray(this.positions, offset); velocity.toArray(this.velocities, offset);
      }
      if (this.ages[index] >= 0) {
        const fade = 1 - this.ages[index] / data.lifetime; count++;
        const colorOffset = index * 4; this.colors[colorOffset] = this.colors[colorOffset + 1] = this.colors[colorOffset + 2] = 1; this.colors[colorOffset + 3] = fade;
      } else this.colors[index * 4 + 3] = 0;
    }
    this.alive = count; this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.color.needsUpdate = true;
  }

  dispose() { this.points.removeFromParent(); this.geometry.dispose(); this.material.map.dispose(); this.material.dispose(); }
}

export class ParticleManager {
  constructor(scene, entities, isActive, onError = () => {}) {
    this.emitters = new Map(); this.isActive = isActive; let remaining = 20000; let warned = false;
    for (const entity of entities) {
      if (!entity.components.particles.enabled) continue;
      if (!remaining || this.emitters.size >= 64) { if (!warned) { onError('Particle budget: up to 64 emitters and 20000 particles are rendered.'); warned = true; } continue; }
      const emitter = new ParticleEmitter(entity.object, entity.components.particles, remaining); remaining -= emitter.capacity;
      this.emitters.set(entity.id, { entity, emitter }); scene.add(emitter.points);
    }
  }
  update(dt) { for (const { entity, emitter } of this.emitters.values()) emitter.update(dt, this.isActive(entity)); }
  emit(id, count) { const entry = this.emitters.get(id); if (!entry) throw new Error(`Particle emitter not found: ${id}`); entry.emitter.emit(count); }
  setEmitting(id, enabled) { if (typeof enabled !== 'boolean') throw new Error('Emitter state must be boolean'); const entry = this.emitters.get(id); if (!entry) throw new Error(`Particle emitter not found: ${id}`); entry.emitter.settings.emitting = enabled; }
  dispose() { for (const { emitter } of this.emitters.values()) emitter.dispose(); this.emitters.clear(); }
}
