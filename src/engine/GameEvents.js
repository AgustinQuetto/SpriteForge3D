import { MathUtils } from 'three';

export const EVENT_TYPES = ['start', 'interact', 'triggerEnter', 'triggerStay', 'triggerExit', 'signal', 'animationEnd'];
export const ACTION_TYPES = ['message', 'hide', 'show', 'enable', 'disable', 'setVariable', 'addVariable', 'emit', 'playAnimation', 'stopAnimation', 'movementAnimation', 'lightOn', 'lightOff', 'particlesOn', 'particlesOff', 'burstParticles', 'setTime', 'cycleOn', 'cycleOff'];
export const CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];
export const TARGET_ACTIONS = ['hide', 'show', 'enable', 'disable', 'playAnimation', 'stopAnimation', 'movementAnimation', 'lightOn', 'lightOff', 'particlesOn', 'particlesOff', 'burstParticles'];

export function normalizeEventRules(rules = [], animation) {
  if (!Array.isArray(rules) || rules.length > 128) throw new Error('Use at most 128 event rules per object');
  const ids = new Set();
  return rules.map(rule => {
    const result = {
      id: rule.id || MathUtils.generateUUID(), when: rule.when,
      signal: rule.signal || '', otherTag: rule.otherTag || '',
      once: rule.once === true, cooldown: rule.cooldown ?? 0,
      conditions: structuredClone(rule.conditions || []),
      // Migrate the original one-action format.
      actions: structuredClone(rule.actions || [{ type: rule.action === 'increment' ? 'addVariable' : rule.action, value: rule.value, amount: 1, target: 'self' }]),
    };
    if (typeof result.id !== 'string' || result.id.length > 128 || ids.has(result.id)) throw new Error('Event rule IDs must be unique');
    ids.add(result.id);
    if (!EVENT_TYPES.includes(result.when)) throw new Error('Unknown event type');
    for (const key of ['signal', 'otherTag']) if (typeof result[key] !== 'string' || result[key].length > 100) throw new Error(`Invalid event ${key}`);
    if (!Number.isFinite(result.cooldown) || result.cooldown < 0 || result.cooldown > 86400) throw new Error('Invalid event cooldown');
    if (!Array.isArray(result.conditions) || result.conditions.length > 8) throw new Error('Use at most 8 conditions per event');
    for (const condition of result.conditions) {
      if (typeof condition.variable !== 'string' || !condition.variable.trim() || condition.variable.length > 100 || !CONDITION_OPERATORS.includes(condition.operator) || !Number.isFinite(condition.value)) throw new Error('Invalid variable condition');
    }
    if (!Array.isArray(result.actions) || !result.actions.length || result.actions.length > 32) throw new Error('Use 1 to 32 actions per event');
    result.actions = result.actions.map(action => {
      const normalized = { type: action.type, value: action.value ?? '', amount: action.amount ?? 1, target: action.target || 'self' };
      if (!ACTION_TYPES.includes(normalized.type)) throw new Error('Unknown event action');
      if (typeof normalized.value !== 'string' || normalized.value.length > 4000) throw new Error('Invalid action value');
      if (typeof normalized.target !== 'string' || normalized.target.length > 128) throw new Error('Invalid action target');
      if (!Number.isFinite(normalized.amount) || Math.abs(normalized.amount) > 1e9) throw new Error('Invalid action amount');
      if (normalized.type === 'setTime' && (normalized.amount < 0 || normalized.amount > 24)) throw new Error('Hour must be 0–24');
      if (normalized.type === 'burstParticles' && (!Number.isInteger(normalized.amount) || normalized.amount < 0 || normalized.amount > 100000)) throw new Error('Particle burst must be 0–100000');
      if (['setVariable', 'addVariable'].includes(normalized.type) && (!normalized.value.trim() || normalized.value.length > 100)) throw new Error('Specify a variable name');
      if (normalized.type === 'playAnimation' && normalized.target === 'self' && animation && !animation.clips.some(clip => clip.name === normalized.value)) throw new Error(`Animation clip not found: ${normalized.value}`);
      return normalized;
    });
    return result;
  });
}

export function conditionsMatch(rule, variables, other) {
  if (rule.otherTag && other?.components.tag !== rule.otherTag) return false;
  return rule.conditions.every(condition => {
    const actual = Number(variables[condition.variable] ?? 0);
    if (!Number.isFinite(actual)) return false;
    switch (condition.operator) {
      case 'eq': return actual === condition.value;
      case 'neq': return actual !== condition.value;
      case 'gt': return actual > condition.value;
      case 'gte': return actual >= condition.value;
      case 'lt': return actual < condition.value;
      case 'lte': return actual <= condition.value;
      default: return false;
    }
  });
}

export function formatGameMessage(message, variables) {
  return message.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_, name) => String(variables[name] ?? 0));
}
