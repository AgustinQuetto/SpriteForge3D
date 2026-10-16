import { buildEffectFields, fillEffectFields, readEffectFields } from './EffectFields.js';
import { normalizeLight, normalizeRenderSettings } from './EnvironmentSettings.js';
import { normalizeParticles } from './Particles.js';

export class ObjectEffectsEditor {
  constructor(host, game) {
    this.host = host; this.base = { render: normalizeRenderSettings(game.render), light: normalizeLight(game.light), particles: normalizeParticles(game.particles) };
    host.innerHTML = '<details class="engine-render-fields"><summary>Visibilidad y sombras</summary></details><details class="engine-light-fields"><summary>Luz del objeto</summary></details><details class="engine-particle-fields"><summary>Partículas</summary></details>';
    buildEffectFields(host.querySelector('.engine-render-fields'), [
      { path: 'render.visible', label: 'Mostrar al iniciar', type: 'checkbox' }, { path: 'render.castShadow', label: 'Proyecta sombras', type: 'checkbox' }, { path: 'render.receiveShadow', label: 'Recibe sombras', type: 'checkbox' },
    ], this.base);
    buildEffectFields(host.querySelector('.engine-light-fields'), [
      { path: 'light.enabled', label: 'Emitir luz', type: 'checkbox' },
      { path: 'light.type', label: 'Tipo de luz', options: [['point', 'Puntual'], ['spot', 'Foco'], ['directional', 'Direccional']] },
      { path: 'light.color', label: 'Color de luz', type: 'color' }, { path: 'light.intensity', label: 'Intensidad de luz', min: 0, max: 100000 },
      { path: 'light.distance', label: 'Alcance de luz', min: 1, max: 10000 }, { path: 'light.decay', label: 'Atenuación de luz', min: 0, max: 4 },
      { path: 'light.castShadow', label: 'La luz genera sombras', type: 'checkbox' },
      ...['X', 'Y', 'Z'].map((axis, index) => ({ path: `light.offset.${index}`, label: `Desplazamiento luz ${axis}` })),
      ...['X', 'Y', 'Z'].map((axis, index) => ({ path: `light.direction.${index}`, label: `Dirección luz ${axis}` })),
      { path: 'light.angle', label: 'Ángulo del foco (°)', min: 1, max: 89 }, { path: 'light.penumbra', label: 'Penumbra del foco', min: 0, max: 1 },
    ], this.base);
    const type = host.querySelector('[data-effect-field="light.type"]');
    type.onchange = () => { host.querySelector('[data-effect-field="light.intensity"]').value = type.value === 'directional' ? 2 : 4000; };
    const particles = host.querySelector('.engine-particle-fields');
    const presets = document.createElement('div'); presets.className = 'engine-fields';
    for (const [label, values] of [['Chispas', { color: '#ffb65d', additive: true, rate: 32, speed: 40, lifetime: 1.5, size: 4, spread: 1, gravity: -10 }], ['Humo', { color: '#bac2cd', additive: false, rate: 14, speed: 12, lifetime: 4, size: 12, spread: 0.5, gravity: 0, opacity: 0.35 }]]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.onclick = () => { const data = readEffectFields(host, this.base); data.particles = normalizeParticles({ ...data.particles, ...values, enabled: true }); fillEffectFields(host, data); };
      presets.append(button);
    }
    particles.append(presets);
    buildEffectFields(particles, [
      { path: 'particles.enabled', label: 'Activar partículas', type: 'checkbox' }, { path: 'particles.emitting', label: 'Emitir continuamente', type: 'checkbox' },
      { path: 'particles.count', label: 'Capacidad del emisor', min: 1, max: 2048, step: 1 }, { path: 'particles.rate', label: 'Partículas por segundo', min: 0, max: 2000 },
      { path: 'particles.lifetime', label: 'Vida (segundos)', min: 0.1, max: 30 }, { path: 'particles.speed', label: 'Velocidad de partículas', min: 0, max: 1000 },
      { path: 'particles.spread', label: 'Dispersión', min: 0, max: 2 }, { path: 'particles.gravity', label: 'Gravedad Y', min: -1000, max: 1000 },
      { path: 'particles.size', label: 'Tamaño de partícula', min: 0.1, max: 128 }, { path: 'particles.color', label: 'Color de partículas', type: 'color' },
      { path: 'particles.brightness', label: 'Brillo de partículas', min: 0, max: 10 },
      { path: 'particles.opacity', label: 'Opacidad de partículas', min: 0, max: 1 }, { path: 'particles.additive', label: 'Mezcla aditiva', type: 'checkbox' },
      { path: 'particles.area.0', label: 'Área del emisor X', min: 0, max: 10000 }, { path: 'particles.area.1', label: 'Área del emisor Z', min: 0, max: 10000 },
      { path: 'particles.seed', label: 'Semilla de partículas', min: 1, max: 2147483647, step: 1 },
    ], this.base);
  }
  read() {
    const data = readEffectFields(this.host, this.base);
    return { render: normalizeRenderSettings(data.render), light: normalizeLight(data.light), particles: normalizeParticles(data.particles) };
  }
}
