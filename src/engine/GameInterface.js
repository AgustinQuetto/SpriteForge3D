import { createScriptHooks, scriptErrorMessage } from './GameScripts.js';

export function normalizeGameInterface(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid game interface');
  const ui = { enabled: false, html: '', css: '', script: '', ...structuredClone(data) };
  if (typeof ui.enabled !== 'boolean') throw new Error('Invalid game interface enabled state');
  for (const key of ['html', 'css', 'script']) if (typeof ui[key] !== 'string' || ui[key].length > 100000) throw new Error(`Invalid interface ${key}: maximum 100000 characters`);
  return ui;
}

export const INTERFACE_EXAMPLE = {
  enabled: true,
  html: `<section class="scoreboard" aria-label="Panel del juego">
  <strong>Puntos: <span id="score">0</span></strong>
  <button id="add" type="button">Sumar punto</button>
  <button id="pause" type="button">Pausar partida</button>
  <output id="signal" aria-live="polite"></output>
</section>`,
  css: `.scoreboard { position: absolute; left: 16px; bottom: 16px; display: grid; gap: 10px; padding: 16px; border: 1px solid #6ca58b; border-radius: 10px; background: #152b32ee; color: white; }
button { padding: 9px 14px; border: 1px solid #8dc5b4; border-radius: 6px; background: #285c4b; color: white; cursor: pointer; }
button:focus-visible { outline: 3px solid #b6dbff; outline-offset: 2px; }`,
  script: `return {
  start() {
    api.variables.score ??= 0;
    api.ui.on('#add', 'click', () => {
      api.variables.score += 1;
      api.emit('scoreChanged', { score: api.variables.score });
    });
    api.ui.on('#pause', 'click', () => api.pause(!api.paused));
  },
  update(dt) {
    api.ui.text('#score', api.variables.score);
    api.ui.text('#pause', api.paused ? 'Continuar partida' : 'Pausar partida');
  },
  onEvent(name, data) {
    if (name === 'scoreChanged') api.ui.text('#signal', 'Señal: ' + data.score);
  },
};`,
};

export function isGameUIControl(event) {
  return (event.composedPath?.() || [event.target]).some(node => node?.matches?.('button, input, textarea, select, a, [contenteditable="true"]'));
}

export function createInterfaceView(host, source) {
  const frame = document.createElement('div'); frame.className = 'game-interface-host';
  frame.style.cssText = 'position:absolute;inset:0;z-index:8;pointer-events:none;contain:layout paint;overflow:hidden';
  const shadow = frame.attachShadow({ mode: 'open' }); const style = document.createElement('style');
  style.textContent = ':host{font:14px system-ui;color:white}.game-interface-surface{position:absolute;inset:0;pointer-events:none}.game-interface-surface>*{pointer-events:auto}' + source.css;
  const root = document.createElement('div'); root.className = 'game-interface-surface'; root.innerHTML = source.html;
  shadow.append(style, root); host.append(frame);
  return { root, dispose: () => frame.remove() };
}

export class GameInterface {
  constructor(source, { host, viewFactory = createInterfaceView, api, onError }) {
    this.source = normalizeGameInterface(source); this.view = viewFactory(host, this.source); this.onError = onError;
    this.hooks = {}; this.cleanups = new Set();
    const query = selector => {
      const element = this.view.root.querySelector(selector);
      if (!element) throw new Error(`UI element not found: ${selector}`); return element;
    };
    this.uiApi = {
      root: this.view.root, query,
      text: (selector, value) => { const element = query(selector); const text = String(value ?? ''); if (element.textContent !== text) element.textContent = text; },
      on: (selector, event, handler) => {
        if (typeof handler !== 'function') throw new Error('UI event handler must be a function');
        const element = query(selector);
        const fail = error => { if (!this.disposed) { this.report(`${event} ${selector}`, error); remove(); } };
        const listener = value => {
          try { const result = handler(value); if (typeof result?.then === 'function') Promise.resolve(result).catch(fail); }
          catch (error) { fail(error); }
        };
        const remove = () => { element.removeEventListener(event, listener); this.cleanups.delete(remove); };
        element.addEventListener(event, listener); this.cleanups.add(remove); return remove;
      },
    };
    this.api = api(this.uiApi);
  }

  report(hook, error) { this.onError(`UI / ${hook}: ${scriptErrorMessage(error)}`); }

  start() {
    try { this.hooks = createScriptHooks(this.source.script, this.api); }
    catch (error) { this.report('compile', error); }
    this.invoke('start');
  }

  invoke(hook, ...args) {
    if (typeof this.hooks[hook] !== 'function') return;
    const handler = this.hooks[hook];
    const fail = error => { if (!this.disposed && this.hooks[hook] === handler) { this.report(hook, error); delete this.hooks[hook]; } };
    try { const result = handler(...args); if (typeof result?.then === 'function') Promise.resolve(result).catch(fail); }
    catch (error) { fail(error); }
  }

  dispose() {
    this.invoke('stop'); for (const remove of this.cleanups) remove();
    this.disposed = true;
    this.hooks = {}; this.view.dispose();
  }
}
