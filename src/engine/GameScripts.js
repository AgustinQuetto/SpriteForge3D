export const SCRIPT_TEMPLATES = [
  { id: 'hooks', name: 'Ciclo de vida', source: `return {
  start() { api.message('¡Listo!'); },
  update(dt) {
    // dt está en segundos. La simulación corre a 60 Hz.
  },
  stop() {},
};` },
  { id: 'move', name: 'Movimiento con IJKL', source: `return {
  update(dt) {
    const x = Number(api.input.down('l')) - Number(api.input.down('j'));
    const z = Number(api.input.down('k')) - Number(api.input.down('i'));
    const length = Math.hypot(x, z) || 1;
    api.move(x / length * 80 * dt, z / length * 80 * dt);
  },
};` },
  { id: 'interact', name: 'Interacción con E', source: `return {
  onInteract(other) {
    api.variables.visits = (api.variables.visits || 0) + 1;
    api.message('Visitas: ' + api.variables.visits);
  },
};` },
  { id: 'signal', name: 'Señales entre objetos', source: `return {
  onTriggerEnter(other) {
    if (other?.userData.game?.tag === 'player') api.emit('arrived');
  },
  onEvent(name, data) {
    if (name === 'arrived') api.message('Señal recibida');
  },
};` },
];

export function compileGameScript(source) {
  // Compile only. Validation must never execute author code.
  return new Function('api', `"use strict";\n${source}`);
}

export function createScriptHooks(source, api) {
  const hooks = compileGameScript(source)(api);
  if (hooks === undefined || hooks === null) return {};
  if (typeof hooks !== 'object' || Array.isArray(hooks) || typeof hooks.then === 'function') throw new Error('Devolvé un objeto de hooks, por ejemplo return { update(dt) {} };');
  for (const name of ['start', 'update', 'stop', 'onStart', 'onInteract', 'onEvent', 'onTriggerEnter', 'onTriggerStay', 'onTriggerExit', 'onAnimationEnd']) {
    if (hooks[name] !== undefined && typeof hooks[name] !== 'function') throw new Error(`El hook ${name} debe ser una función.`);
  }
  return hooks;
}

export function scriptErrorMessage(error) {
  const location = typeof error?.stack === 'string' && error.stack.match(/<anonymous>:(\d+):(\d+)/);
  // Function() adds two wrapper lines; strict mode adds one body line.
  const line = location ? Math.max(1, Number(location[1]) - 3) : null;
  return `${error?.message ?? String(error)}${line ? ` (línea ${line})` : ''}`;
}

export function indentScript(text, start, end, remove = false) {
  const lineStart = start ? text.lastIndexOf('\n', start - 1) + 1 : 0;
  const effectiveEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const newline = text.indexOf('\n', effectiveEnd); const lineEnd = newline < 0 ? text.length : newline;
  let firstDelta = 0; let delta = 0;
  const replacement = text.slice(lineStart, lineEnd).split('\n').map((line, index) => {
    const prefix = remove ? (line.match(/^( {1,2}|\t)/)?.[0].length || 0) : -2;
    if (!index) firstDelta = -prefix; delta -= prefix;
    return remove ? line.slice(prefix) : '  ' + line;
  }).join('\n');
  return { text: text.slice(0, lineStart) + replacement + text.slice(lineEnd),
    start: Math.max(lineStart, start + firstDelta), end: Math.max(lineStart, end + delta) };
}
