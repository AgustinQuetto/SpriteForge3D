import { buildEffectFields, fillEffectFields, readEffectFields } from './EffectFields.js';
import { normalizeEnvironment, normalizePostProcessing } from './EnvironmentSettings.js';

export class WorldEditor {
  constructor(host, getSettings, { apply, addLight, addEmitter, preview }) {
    Object.assign(this, { host, getSettings });
    host.innerHTML = `<summary>Mundo, luces y efectos</summary><div class="engine-world-fields"></div>
      <details class="engine-post-fields"><summary>Postprocesamiento</summary></details>
      <div class="engine-fields"><button type="button" data-world="day">Día</button><button type="button" data-world="sunset">Atardecer</button><button type="button" data-world="night">Noche</button></div>
      <button type="button" data-world="preview">Previsualizar ciclo</button><output class="engine-world-clock"></output>
      <button type="button" class="engine-primary" data-world="apply">Aplicar mundo y efectos</button>
      <div class="engine-fields"><button type="button" data-world="light">Agregar luz puntual</button><button type="button" data-world="particles">Agregar emisor</button></div>
      <p>Las luces se configuran en su objeto. Las partículas se ven al Jugar. Sombras: hasta 4 luces; partículas: hasta 64 emisores / 20000 partículas. Los efectos visuales no alteran la interfaz HTML.</p>
      <output class="engine-world-error" aria-live="polite"></output>`;
    const values = { environment: normalizeEnvironment(), postProcessing: normalizePostProcessing() };
    buildEffectFields(host.querySelector('.engine-world-fields'), [
      { path: 'environment.enabled', label: 'Activar ambiente de juego', type: 'checkbox' },
      { path: 'environment.background', label: 'Fondo de día', type: 'color' }, { path: 'environment.nightBackground', label: 'Fondo de noche', type: 'color' },
      { path: 'environment.ambientColor', label: 'Color ambiente', type: 'color' }, { path: 'environment.groundColor', label: 'Rebote del suelo', type: 'color' },
      { path: 'environment.ambientIntensity', label: 'Intensidad ambiente', min: 0, max: 10 },
      { path: 'environment.sunColor', label: 'Color del sol', type: 'color' }, { path: 'environment.sunIntensity', label: 'Intensidad del sol', min: 0, max: 20 },
      { path: 'environment.sunAzimuth', label: 'Dirección del sol (°)', min: -360, max: 360 }, { path: 'environment.sunElevation', label: 'Altura del sol (°)', min: 5, max: 85 },
      { path: 'environment.shadows', label: 'Sombras', type: 'checkbox' },
      { path: 'environment.shadowSize', label: 'Resolución de sombras', numeric: true, options: [256, 512, 1024, 2048].map(value => [value, String(value)]) },
      { path: 'environment.shadowRange', label: 'Alcance de sombras', min: 32, max: 8192 },
      { path: 'environment.dayNight.enabled', label: 'Ciclo día / noche', type: 'checkbox' },
      { path: 'environment.dayNight.hour', label: 'Hora inicial', min: 0, max: 24 }, { path: 'environment.dayNight.duration', label: 'Duración del día (segundos)', min: 2, max: 86400 },
    ], values);
    buildEffectFields(host.querySelector('.engine-post-fields'), [
      { path: 'postProcessing.enabled', label: 'Activar postprocesamiento', type: 'checkbox' },
      { path: 'postProcessing.exposure', label: 'Exposición', min: 0.1, max: 5 }, { path: 'postProcessing.bloom', label: 'Bloom', min: 0, max: 4 },
      { path: 'postProcessing.bloomThreshold', label: 'Umbral de bloom', min: 0, max: 5 }, { path: 'postProcessing.bloomRadius', label: 'Radio de bloom', min: 0, max: 1 },
      { path: 'postProcessing.vignette', label: 'Viñeta', min: 0, max: 1 }, { path: 'postProcessing.resolution', label: 'Escala de efectos', min: 0.25, max: 1 },
    ], values);
    for (const name of ['day', 'sunset', 'night']) host.querySelector(`[data-world="${name}"]`).onclick = () => {
      const data = readEffectFields(host, this.current()); data.environment.enabled = true; data.environment.dayNight.enabled = true; data.environment.dayNight.hour = { day: 12, sunset: 17, night: 0 }[name];
      fillEffectFields(host, data); this.error('Preset listo. Aplicá el mundo para guardarlo.');
    };
    host.querySelector('[data-world="apply"]').onclick = () => {
      try { const data = readEffectFields(host, this.current()); apply({ environment: normalizeEnvironment(data.environment), postProcessing: normalizePostProcessing(data.postProcessing) }); this.error('Mundo aplicado.'); }
      catch (error) { this.error(error.message); }
    };
    host.querySelector('[data-world="light"]').onclick = addLight; host.querySelector('[data-world="particles"]').onclick = addEmitter;
    host.querySelector('[data-world="preview"]').onclick = () => preview(); this.sync();
  }
  current() { const settings = this.getSettings(); return { environment: settings.environment, postProcessing: settings.postProcessing }; }
  sync() { fillEffectFields(this.host, this.current()); }
  error(message) { this.host.querySelector('.engine-world-error').textContent = message; }
  updateClock(environment, particles, previewing = true) {
    this.host.querySelector('[data-world="preview"]').setAttribute('aria-pressed', String(previewing && !particles));
    this.host.querySelector('.engine-world-clock').textContent = `Hora ${environment.hour.toFixed(2)} · ${previewing ? `Ciclo ${environment.cycling ? 'activo' : 'detenido'}` : 'Vista fija'}${particles ? ` · ${[...particles.emitters.values()].reduce((sum, item) => sum + item.emitter.alive, 0)} partículas` : ''}`;
  }
}
