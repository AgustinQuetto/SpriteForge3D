export function finite(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}: ${min}–${max}`);
  return value;
}

export function color(value, label) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid ${label} color`);
  return value;
}

function flag(value, label) { if (typeof value !== 'boolean') throw new Error(`Invalid ${label}`); }
function record(data, label) { if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid ${label}`); }

export function normalizeEnvironment(data = {}) {
  record(data, 'environment');
  const result = { enabled: false, background: '#637f9d', nightBackground: '#050814', ambientColor: '#c2dcff', groundColor: '#424653',
    ambientIntensity: 1, sunColor: '#fff1d6', sunIntensity: 2, sunAzimuth: 45, sunElevation: 50,
    shadows: true, shadowSize: 1024, shadowRange: 512, dayNight: { enabled: false, hour: 12, duration: 120 }, ...structuredClone(data) };
  record(result.dayNight, 'day/night cycle'); result.dayNight = { enabled: false, hour: 12, duration: 120, ...result.dayNight };
  for (const key of ['enabled', 'shadows']) flag(result[key], key);
  flag(result.dayNight.enabled, 'day/night enabled');
  for (const key of ['background', 'nightBackground', 'ambientColor', 'groundColor', 'sunColor']) color(result[key], key);
  finite(result.ambientIntensity, 0, 10, 'ambient intensity'); finite(result.sunIntensity, 0, 20, 'sun intensity');
  finite(result.sunAzimuth, -360, 360, 'sun azimuth'); finite(result.sunElevation, 5, 85, 'sun elevation');
  if (![256, 512, 1024, 2048].includes(result.shadowSize)) throw new Error('Invalid shadow map size');
  finite(result.shadowRange, 32, 8192, 'shadow range'); finite(result.dayNight.hour, 0, 24, 'hour');
  finite(result.dayNight.duration, 2, 86400, 'day length'); result.dayNight.hour %= 24;
  return result;
}

export function normalizeRenderSettings(data = {}) {
  record(data, 'render settings'); const result = { visible: true, castShadow: true, receiveShadow: true, ...structuredClone(data) };
  for (const key of ['visible', 'castShadow', 'receiveShadow']) flag(result[key], `render ${key}`);
  return result;
}

export function normalizeLight(data = {}) {
  record(data, 'light');
  const result = { enabled: false, type: 'point', color: '#ffca85', intensity: 4000, distance: 256, decay: 2,
    angle: 40, penumbra: 0.4, castShadow: false, offset: [0, 24, 0], direction: [0, -1, 0], ...structuredClone(data) };
  flag(result.enabled, 'light enabled'); flag(result.castShadow, 'light shadows');
  if (!['point', 'spot', 'directional'].includes(result.type)) throw new Error('Invalid light type');
  color(result.color, 'light'); finite(result.intensity, 0, 100000, 'light intensity'); finite(result.distance, 1, 10000, 'light range');
  finite(result.decay, 0, 4, 'light decay'); finite(result.angle, 1, 89, 'spot angle'); finite(result.penumbra, 0, 1, 'spot penumbra');
  for (const key of ['offset', 'direction']) if (!Array.isArray(result[key]) || result[key].length !== 3 || !result[key].every(value => Number.isFinite(value) && Math.abs(value) <= 10000)) throw new Error(`Invalid light ${key}`);
  if (Math.hypot(...result.direction) < 1e-6) throw new Error('Light direction must not be zero');
  return result;
}

export function normalizePostProcessing(data = {}) {
  record(data, 'post-processing');
  const result = { enabled: false, exposure: 1, bloom: 0.7, bloomThreshold: 0.8, bloomRadius: 0.3, vignette: 0.25, resolution: 0.75, ...structuredClone(data) };
  flag(result.enabled, 'post-processing enabled'); finite(result.exposure, 0.1, 5, 'exposure');
  finite(result.bloom, 0, 4, 'bloom'); finite(result.bloomThreshold, 0, 5, 'bloom threshold'); finite(result.bloomRadius, 0, 1, 'bloom radius');
  finite(result.vignette, 0, 1, 'vignette'); finite(result.resolution, 0.25, 1, 'post-processing resolution'); return result;
}
