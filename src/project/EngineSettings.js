import { createEngineSettings } from '../engine/GameComponents.js';
import { normalizeMapLayers } from '../engine/MapLayers.js';
import { validateVisualSnapshot } from './ProjectDocument.js';
import { normalizeGameInterface } from '../engine/GameInterface.js';
import { normalizeEnvironment, normalizePostProcessing } from '../engine/EnvironmentSettings.js';

export function normalizeEngineSettings(data = {}, objects = []) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid engine settings');
  if (data.version !== undefined && (!Number.isInteger(data.version) || data.version < 1 || data.version > 2)) throw new Error('Unsupported engine settings version');
  const settings = { ...createEngineSettings(), ...structuredClone(data), version: 2 };
  for (const [key, min, max] of [['cellSize', 1, 1024], ['elevation', -10000, 10000], ['cameraSize', 32, 2048]]) {
    if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) throw new Error(`Invalid engine setting: ${key}`);
  }
  if (!['isometric', 'top-down'].includes(settings.camera) || typeof settings.followPlayer !== 'boolean') throw new Error('Invalid game camera settings');
  if (typeof settings.batchMap !== 'boolean') throw new Error('Invalid map rendering setting');
  settings.ui = normalizeGameInterface(settings.ui);
  settings.environment = normalizeEnvironment(settings.environment); settings.postProcessing = normalizePostProcessing(settings.postProcessing);
  if (typeof settings.layer !== 'string' || !settings.layer.trim() || settings.layer.length > 60 || !Array.isArray(settings.layers)) throw new Error('Invalid map layers');
  normalizeMapLayers(settings, objects);
  if (!Array.isArray(settings.templates)) throw new Error('Invalid resource library');
  const ids = new Set();
  for (const record of settings.templates) {
    if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id) || typeof record.name !== 'string' || !record.name.trim()) throw new Error('Invalid or duplicate resource');
    ids.add(record.id);
    if (record.thumbnail && (typeof record.thumbnail !== 'string' || !record.thumbnail.startsWith('data:image/png;base64,'))) throw new Error(`Invalid resource thumbnail: ${record.name}`);
    validateVisualSnapshot(record.scene, `resource ${record.name}`);
  }
  return settings;
}
