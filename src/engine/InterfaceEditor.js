import { INTERFACE_EXAMPLE, normalizeGameInterface } from './GameInterface.js';
import { compileGameScript, scriptErrorMessage } from './GameScripts.js';

export class InterfaceEditor {
  constructor(host, getSettings, apply) {
    Object.assign(this, { host, getSettings, apply });
    host.innerHTML = `<summary>Interfaz del juego · HTML y JS</summary>
      <p>Creá tu HUD o menús con HTML, CSS y JavaScript. Se monta al Jugar y comparte variables, señales y controles con el motor.</p>
      <label class="engine-check"><input name="uiEnabled" type="checkbox"> Activar interfaz personalizada</label>
      <button type="button" data-ui="example">Usar interfaz de ejemplo</button>
      <details open><summary>HTML</summary><textarea name="uiHtml" rows="6" spellcheck="false" aria-label="HTML de la interfaz"></textarea></details>
      <details><summary>CSS</summary><textarea name="uiCss" rows="6" spellcheck="false" aria-label="CSS de la interfaz"></textarea></details>
      <details><summary>JavaScript de interfaz</summary><textarea name="uiScript" rows="10" spellcheck="false" aria-label="JavaScript de la interfaz"></textarea>
      <p><code>api.ui.query(selector)</code>, <code>text(selector, value)</code> y <code>on(selector, event, handler)</code> acceden al HTML. <code>api.variables</code>, <code>emit(name, data)</code>, <code>find(id)</code>, <code>findTag(tag)</code>, <code>setEnabled(bool, id)</code>, <code>pause(bool)</code>, <code>paused</code> y <code>message(text)</code> conectan con el juego.</p>
      <p>Devolvé start(), update(dt), onEvent(name, data) o stop(). update recibe dt=0 al pausar para mantener operativos los menús.</p></details>
      <p><code>api.world</code>: hour, cycling, setTime(hour), setCycleRunning(bool), setLight(id, patch), setEnvironment(patch), setPostProcessing(patch), emitParticles(id, count), setEmitting(id, bool).</p>
      <button type="button" class="engine-primary" data-ui="apply">Aplicar interfaz</button>
      <output class="engine-interface-status" aria-live="polite"></output>`;
    host.querySelector('[data-ui="example"]').onclick = () => { this.fill(INTERFACE_EXAMPLE); this.status('Ejemplo listo para editar. Aplicá la interfaz y probala con Jugar.'); };
    host.querySelector('[data-ui="apply"]').onclick = () => {
      try {
        const data = normalizeGameInterface({ enabled: host.querySelector('[name="uiEnabled"]').checked,
          html: host.querySelector('[name="uiHtml"]').value, css: host.querySelector('[name="uiCss"]').value, script: host.querySelector('[name="uiScript"]').value });
        compileGameScript(data.script); this.apply(data); this.status('Interfaz aplicada. Elegí Jugar para probar sus botones y señales.');
      } catch (error) { this.status(scriptErrorMessage(error), true); }
    };
    host.addEventListener('input', () => this.status('Cambios sin aplicar.')); this.sync();
  }

  status(message, error = false) { const output = this.host.querySelector('output'); output.textContent = message; output.dataset.error = String(error); }
  fill(data) {
    this.host.querySelector('[name="uiEnabled"]').checked = data.enabled;
    for (const [key, field] of [['html', 'uiHtml'], ['css', 'uiCss'], ['script', 'uiScript']]) this.host.querySelector(`[name="${field}"]`).value = data[key];
  }
  sync() { this.fill(normalizeGameInterface(this.getSettings().ui)); }
}
