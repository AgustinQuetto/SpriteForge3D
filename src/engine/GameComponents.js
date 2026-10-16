import { MathUtils } from 'three';
import { normalizeSpriteAnimation } from './SpriteAnimation.js';
import { normalizeEventRules } from './GameEvents.js';
import { normalizeCollider } from './Colliders.js';
import { normalizeGameInterface } from './GameInterface.js';
import { normalizeEnvironment, normalizeLight, normalizeRenderSettings, normalizePostProcessing } from './EnvironmentSettings.js';
import { normalizeParticles } from './Particles.js';

// Engine data is plain JSON so projects and templates use the same contract.
export function createGameComponents(overrides = {}) {
  return {
    id: MathUtils.generateUUID(),
    enabled: true,
    tag: '',
    player: { enabled: false, speed: 96 },
    collider: { mode: 'none', size: [24, 24], offset: [0, 0] },
    animation: { enabled: false, columns: 1, rows: 1, fps: 8, frames: [0], loop: true },
    events: [],
    script: '',
    render: normalizeRenderSettings(), light: normalizeLight(), particles: normalizeParticles(),
    ...structuredClone(overrides),
  };
}

export function normalizeGameComponents(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid game object components');
  const defaults = createGameComponents();
  const result = { ...defaults, ...structuredClone(data) };
  if (typeof result.id !== 'string' || !result.id || result.id.length > 128 || typeof result.enabled !== 'boolean' || typeof result.tag !== 'string' || result.tag.length > 100) throw new Error('Invalid game object identity, state or tag');
  for (const key of ['player', 'collider', 'animation']) {
    result[key] = { ...defaults[key], ...result[key] };
  }
  const number = (value, min, max, label) => {
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}`);
  };
  number(result.player.speed, 0, 10000, 'movement speed');
  if (typeof result.player.enabled !== 'boolean') throw new Error('Invalid player enabled state');
  result.collider = normalizeCollider(result.collider);
  result.animation = normalizeSpriteAnimation(result.animation);
  result.events = normalizeEventRules(result.events, result.animation);
  result.render = normalizeRenderSettings(result.render); result.light = normalizeLight(result.light); result.particles = normalizeParticles(result.particles);
  if (typeof result.script !== 'string' || result.script.length > 100000) throw new Error('Invalid script');
  return result;
}

export function createEngineSettings() {
  return { version: 2, cellSize: 32, layer: 'Ground', layers: [{ name: 'Ground', visible: true, locked: false }], elevation: 0, camera: 'isometric', cameraSize: 220, followPlayer: true, batchMap: true, ui: normalizeGameInterface(), environment: normalizeEnvironment(), postProcessing: normalizePostProcessing(), templates: [] };
}
