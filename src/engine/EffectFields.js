export function buildEffectFields(host, fields, data) {
  for (const field of fields) {
    const label = document.createElement('label'); label.textContent = field.label;
    const input = document.createElement(field.options ? 'select' : 'input'); input.dataset.effectField = field.path;
    if (field.options) {
      for (const [value, text] of field.options) input.add(new Option(text, value));
      if (field.numeric) input.dataset.numeric = 'true';
    } else {
      input.type = field.type || 'number';
      if (input.type === 'checkbox') label.className = 'engine-check';
      if (field.min !== undefined) input.min = field.min; if (field.max !== undefined) input.max = field.max;
      if (input.type === 'number') input.step = field.step || 'any';
    }
    if (input.type === 'checkbox') label.prepend(input); else label.append(input);
    host.append(label);
  }
  fillEffectFields(host, data);
}

export function fillEffectFields(host, data) {
  for (const input of host.querySelectorAll('[data-effect-field]')) {
    const value = input.dataset.effectField.split('.').reduce((current, key) => current?.[key], data);
    if (input.type === 'checkbox') input.checked = !!value; else input.value = value ?? '';
  }
}

export function readEffectFields(host, defaults) {
  const data = structuredClone(defaults);
  for (const input of host.querySelectorAll('[data-effect-field]')) {
    const keys = input.dataset.effectField.split('.'); const key = keys.pop(); const parent = keys.reduce((current, part) => current[part], data);
    parent[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' || input.dataset.numeric ? Number(input.value) : input.value;
  }
  return data;
}
