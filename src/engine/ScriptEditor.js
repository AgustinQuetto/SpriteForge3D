import { SCRIPT_TEMPLATES, compileGameScript, indentScript, scriptErrorMessage } from './GameScripts.js';

export class ScriptEditor {
  constructor(host, source, objectName) {
    Object.assign(this, { host, objectName }); this.previous = null;
    host.innerHTML = `<summary>JavaScript</summary>
      <p>Devolvé un objeto con hooks. El código se ejecuta al Jugar; validarlo solo comprueba la sintaxis.</p>
      <label>Plantilla de script<select name="scriptTemplate"></select></label>
      <div class="engine-fields"><button type="button" data-script="template">Usar plantilla</button><button type="button" data-script="restore" disabled>Restaurar texto anterior</button></div>
      <p class="engine-script-hint">Usar plantilla reemplaza el texto del editor. Podés restaurarlo antes de aplicar.</p>
      <textarea name="script" rows="10" wrap="off" spellcheck="false" aria-label="Script JavaScript" placeholder="return { update(dt) { api.move(0, 10 * dt); } };"></textarea>
      <div class="engine-fields"><button type="button" data-script="indent" title="Indentar líneas (Ctrl+])">Indentar</button><button type="button" data-script="unindent" title="Quitar sangría (Ctrl+[)">Quitar sangría</button></div>
      <button type="button" data-script="validate">Validar sintaxis</button>
      <output class="engine-script-status" aria-live="polite"></output>
      <details class="engine-script-api"><summary>API disponible</summary>
        <p><code>api.object</code>: objeto en la copia de juego. <code>api.move(x, z)</code>: movimiento con colisiones. <code>api.input.down(key)</code> / <code>pressed(key)</code>: teclas.</p>
        <p><code>api.variables</code>: estado de la partida. <code>api.emit(name, data)</code> / <code>onEvent(name, data)</code>: señales. <code>api.find(id)</code> / <code>findTag(tag)</code>: objetos.</p>
        <p><code>api.message(text)</code>, <code>setEnabled(bool, id)</code>, <code>playAnimation(name)</code>, <code>stopAnimation()</code>, <code>resumeMovementAnimation()</code>.</p>
        <p><code>api.world.hour</code>, <code>setTime(hour)</code>, <code>setCycleRunning(bool)</code>, <code>setLight(id, patch)</code>, <code>setEnvironment(patch)</code>, <code>setPostProcessing(patch)</code> controlan el mundo. <code>api.emitParticles(count)</code> y <code>setEmitting(bool)</code> controlan este emisor.</p>
        <p>Hooks: start, update(dt), onStart, onInteract(other), onTriggerEnter/Stay/Exit(other), onEvent(name, data), onAnimationEnd(name), stop.</p>
      </details>`;
    this.textarea = host.querySelector('textarea'); this.textarea.value = source;
    const select = host.querySelector('[name="scriptTemplate"]');
    select.replaceChildren(...SCRIPT_TEMPLATES.map(template => new Option(template.name, template.id)));
    this.textarea.addEventListener('input', () => this.status('Cambios sin aplicar. Usá Aplicar comportamiento para guardarlos.'));
    host.querySelector('[data-script="template"]').onclick = () => {
      this.previous = this.textarea.value; this.textarea.value = SCRIPT_TEMPLATES.find(template => template.id === select.value).source;
      host.querySelector('[data-script="restore"]').disabled = false; this.changed();
    };
    host.querySelector('[data-script="restore"]').onclick = () => {
      this.textarea.value = this.previous; this.previous = null; host.querySelector('[data-script="restore"]').disabled = true; this.changed();
    };
    host.querySelector('[data-script="validate"]').onclick = () => this.validate();
    host.querySelector('[data-script="indent"]').onclick = () => this.indent(false);
    host.querySelector('[data-script="unindent"]').onclick = () => this.indent(true);
    this.textarea.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && ['[', ']'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); this.indent(event.key === '[');
      }
    });
  }

  status(message, error = false) {
    const output = this.host.querySelector('.engine-script-status'); output.textContent = message; output.dataset.error = String(error);
  }

  changed() { this.textarea.dispatchEvent(new Event('input', { bubbles: true })); this.textarea.focus(); }

  indent(remove) {
    const next = indentScript(this.textarea.value, this.textarea.selectionStart, this.textarea.selectionEnd, remove);
    this.textarea.value = next.text; this.textarea.setSelectionRange(next.start, next.end); this.changed();
  }

  validate() {
    try { compileGameScript(this.textarea.value); this.status('Sintaxis válida. Aplicá el comportamiento y probá la lógica con Jugar.'); return true; }
    catch (error) { this.host.open = true; this.status(`${this.objectName} / script: ${scriptErrorMessage(error)}`, true); return false; }
  }

  read() {
    if (!this.validate()) throw new Error('Corregí la sintaxis del script antes de aplicar.');
    return this.textarea.value;
  }
}
