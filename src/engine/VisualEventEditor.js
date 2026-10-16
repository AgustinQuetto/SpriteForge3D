import { MathUtils } from 'three';
import { normalizeEventRules, TARGET_ACTIONS } from './GameEvents.js';

const eventLabels = [['start', 'Al iniciar'], ['interact', 'Al interactuar'], ['triggerEnter', 'Al entrar'], ['triggerStay', 'Mientras está dentro'], ['triggerExit', 'Al salir'], ['signal', 'Al recibir señal'], ['animationEnd', 'Al terminar animación']];
const actionLabels = [['message', 'Mostrar mensaje'], ['addVariable', 'Sumar a variable'], ['setVariable', 'Asignar variable'], ['hide', 'Ocultar objeto'], ['show', 'Mostrar objeto'], ['enable', 'Activar objeto'], ['disable', 'Desactivar objeto'], ['emit', 'Emitir señal'], ['playAnimation', 'Reproducir clip'], ['stopAnimation', 'Detener animación'], ['movementAnimation', 'Animación por movimiento']];
const operatorLabels = [['eq', '='], ['neq', '≠'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤']];
actionLabels.push(['lightOn', 'Encender luz'], ['lightOff', 'Apagar luz'], ['particlesOn', 'Iniciar emisión'], ['particlesOff', 'Detener emisión'], ['burstParticles', 'Ráfaga de partículas'], ['setTime', 'Cambiar hora'], ['cycleOn', 'Iniciar ciclo día/noche'], ['cycleOff', 'Detener ciclo día/noche']);
const options = labels => labels.map(([value, text]) => new Option(text, value));

export class VisualEventEditor {
  constructor(host, rules, targets, onPreset) {
    Object.assign(this, { host, targets });
    host.innerHTML = `<summary>Eventos visuales</summary><p>Las condiciones se comprueban antes de ejecutar las acciones en orden. Las variables numéricas empiezan en 0.</p>
      <div class="engine-event-rules"></div><button type="button" class="engine-add-rule">+ Evento</button>
      <div class="engine-event-presets"><button type="button" data-preset="pickup">Ejemplo: coleccionable</button><button type="button" data-preset="door">Ejemplo: puerta con llave</button></div>`;
    normalizeEventRules(rules).forEach(rule => this.addRule(rule));
    host.querySelector('.engine-add-rule').onclick = () => this.addRule();
    for (const button of host.querySelectorAll('[data-preset]')) button.onclick = () => {
      const pickup = button.dataset.preset === 'pickup';
      this.addRule({
        when: pickup ? 'triggerEnter' : 'interact', otherTag: 'player', once: true,
        conditions: pickup ? [] : [{ variable: 'keys', operator: 'gte', value: 1 }],
        actions: pickup ? [
          { type: 'addVariable', value: 'keys', amount: 1 }, { type: 'hide' },
          { type: 'disable' }, { type: 'message', value: 'Llaves: {keys}' },
        ] : [
          { type: 'addVariable', value: 'keys', amount: -1 }, { type: 'disable' },
          { type: 'message', value: 'Puerta abierta. Llaves restantes: {keys}' },
        ],
      });
      onPreset(pickup ? 'trigger' : 'solid');
    };
  }

  addRule(data = { when: 'interact', actions: [{ type: 'message', value: '¡Hola!' }] }) {
    const rule = normalizeEventRules([data])[0];
    const row = document.createElement('fieldset');
    row.className = 'engine-event';
    row.dataset.ruleId = rule.id;
    row.innerHTML = `<legend>Regla de evento</legend><label>Cuando<select name="when" aria-label="Cuándo ocurre el evento"></select></label>
      <label class="engine-signal">Señal / clip<input name="signal" maxlength="100"></label>
      <label>Solo si el otro tiene etiqueta<input name="otherTag" maxlength="100" placeholder="Cualquiera"></label>
      <div class="engine-fields"><label class="engine-check"><input type="checkbox" name="once"> Una vez por partida</label><label>Espera entre usos (s)<input type="number" name="cooldown" min="0" max="86400" step="0.1"></label></div>
      <div class="engine-conditions"></div><button type="button" class="engine-add-condition">+ Condición</button>
      <div class="engine-actions"></div><button type="button" class="engine-add-action">+ Acción</button>
      <button type="button" class="engine-remove-rule">Eliminar evento</button>`;
    row.querySelector('[name="when"]').replaceChildren(...options(eventLabels));
    for (const key of ['when', 'signal', 'otherTag', 'cooldown']) row.querySelector(`[name="${key}"]`).value = rule[key];
    row.querySelector('[name="once"]').checked = rule.once;
    const update = () => {
      const when = row.querySelector('[name="when"]').value;
      row.querySelector('.engine-signal').hidden = !['signal', 'animationEnd'].includes(when);
    };
    row.querySelector('[name="when"]').onchange = update;
    rule.conditions.forEach(condition => this.addCondition(row, condition));
    rule.actions.forEach(action => this.addAction(row, action));
    row.querySelector('.engine-add-condition').onclick = () => this.addCondition(row);
    row.querySelector('.engine-add-action').onclick = () => this.addAction(row);
    row.querySelector('.engine-remove-rule').onclick = () => row.remove();
    update(); this.host.querySelector('.engine-event-rules').append(row);
  }

  addCondition(rule, condition = { variable: 'keys', operator: 'gte', value: 1 }) {
    const row = document.createElement('div'); row.className = 'engine-condition';
    row.innerHTML = '<label>Variable<input name="conditionVariable" maxlength="100"></label><div class="engine-fields"><label>Comparación<select name="conditionOperator" aria-label="Comparación"></select></label><label>Valor<input name="conditionValue" type="number" step="any"></label></div><button type="button">Eliminar condición</button>';
    row.querySelector('[name="conditionVariable"]').value = condition.variable;
    row.querySelector('[name="conditionOperator"]').replaceChildren(...options(operatorLabels));
    row.querySelector('[name="conditionOperator"]').value = condition.operator;
    row.querySelector('[name="conditionValue"]').value = condition.value;
    row.querySelector('button').onclick = () => row.remove();
    rule.querySelector('.engine-conditions').append(row);
  }

  addAction(rule, data = { type: 'message', value: '¡Hola!', amount: 1, target: 'self' }) {
    const action = { value: '', amount: 1, target: 'self', ...data };
    const row = document.createElement('fieldset'); row.className = 'engine-action';
    row.innerHTML = `<legend>Acción</legend><label>Hacer<select name="actionType" aria-label="Tipo de acción"></select></label>
      <label class="engine-action-value"><span>Texto / variable / señal / clip</span><input name="actionValue" maxlength="4000"></label>
      <label class="engine-action-amount"><span>Valor numérico</span><input name="actionAmount" type="number" step="any"></label>
      <div class="engine-action-target"><label>Buscar destino<input name="actionTargetSearch" placeholder="Nombre o ID"></label><label>Objeto destino<select name="actionTarget" aria-label="Objeto destino"></select></label></div>
      <div class="engine-fields"><button type="button" data-order="up" aria-label="Subir acción">↑</button><button type="button" data-order="down" aria-label="Bajar acción">↓</button><button type="button" class="engine-remove-action">Eliminar acción</button></div>`;
    row.querySelector('[name="actionType"]').replaceChildren(...options(actionLabels));
    row.querySelector('[name="actionType"]').value = action.type;
    row.querySelector('[name="actionValue"]').value = action.value;
    row.querySelector('[name="actionAmount"]').value = action.amount;
    const select = row.querySelector('[name="actionTarget"]');
    const updateTargets = (selected = select.value) => {
      const search = row.querySelector('[name="actionTargetSearch"]').value.toLowerCase();
      const targets = this.targets.filter(target => target.id === selected || `${target.name} ${target.id}`.toLowerCase().includes(search));
      select.replaceChildren(...options([['self', 'Este objeto'], ['other', 'El otro / emisor'], ...targets.map(target => [target.id, target.name])]));
      if (![...select.options].some(option => option.value === selected)) select.add(new Option(`Objeto faltante: ${selected}`, selected));
      select.value = selected;
    };
    updateTargets(action.target);
    row.querySelector('[name="actionTargetSearch"]').addEventListener('input', () => updateTargets());
    const update = () => {
      const type = row.querySelector('[name="actionType"]').value;
      row.querySelector('.engine-action-amount').hidden = !['addVariable', 'setVariable', 'burstParticles', 'setTime'].includes(type);
      row.querySelector('.engine-action-amount span').textContent = type === 'setTime' ? 'Hora (0–24)' : type === 'burstParticles' ? 'Cantidad de partículas' : 'Valor numérico';
      row.querySelector('.engine-action-target').hidden = !TARGET_ACTIONS.includes(type);
      row.querySelector('.engine-action-value').hidden = !['message', 'addVariable', 'setVariable', 'emit', 'playAnimation'].includes(type);
      row.querySelector('.engine-action-value span').textContent = ['addVariable', 'setVariable'].includes(type) ? 'Nombre de variable' : type === 'message' ? 'Mensaje (ej. Llaves: {keys})' : type === 'playAnimation' ? 'Nombre del clip' : 'Nombre de señal';
    };
    row.querySelector('[name="actionType"]').onchange = update;
    row.querySelector('.engine-remove-action').onclick = () => row.remove();
    row.querySelector('[data-order="up"]').onclick = () => { if (row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling); };
    row.querySelector('[data-order="down"]').onclick = () => { if (row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row); };
    update(); rule.querySelector('.engine-actions').append(row);
  }

  read() {
    return [...this.host.querySelectorAll('.engine-event')].map(row => ({
      id: row.dataset.ruleId || MathUtils.generateUUID(), when: row.querySelector('[name="when"]').value,
      signal: row.querySelector('[name="signal"]').value, otherTag: row.querySelector('[name="otherTag"]').value,
      once: row.querySelector('[name="once"]').checked, cooldown: Number(row.querySelector('[name="cooldown"]').value),
      conditions: [...row.querySelectorAll('.engine-condition')].map(condition => ({
        variable: condition.querySelector('[name="conditionVariable"]').value.trim(), operator: condition.querySelector('[name="conditionOperator"]').value,
        value: Number(condition.querySelector('[name="conditionValue"]').value),
      })),
      actions: [...row.querySelectorAll('.engine-action')].map(action => ({
        type: action.querySelector('[name="actionType"]').value, value: action.querySelector('[name="actionValue"]').value,
        amount: Number(action.querySelector('[name="actionAmount"]').value), target: action.querySelector('[name="actionTarget"]').value,
      })),
    }));
  }
}
