import { fitColliderToVisual, normalizeCollider } from './Colliders.js';

export const collisionGroups = [['1', 'Mundo'], ['2', 'Jugador'], ['4', 'Personajes'], ['8', 'Recogibles'], ['16', 'Proyectiles'], ['32', 'Grupo 6'], ['64', 'Grupo 7'], ['128', 'Grupo 8']];

export class ColliderEditor {
  constructor(host, object, collider, readAnimation) {
    Object.assign(this, { host, object });
    host.innerHTML = `<summary>Colisión</summary><label>Tipo<select name="collider" aria-label="Tipo de colisión"><option value="none">Sin colisión</option><option value="solid">Sólido</option><option value="trigger">Zona de evento</option></select></label>
      <div class="engine-fields"><label>Ancho X<input name="width" type="number" step="any" min="0.01"></label><label>Fondo Z<input name="depth" type="number" step="any" min="0.01"></label></div>
      <div class="engine-fields"><label>Centro X<input name="offsetX" type="number" step="any"></label><label>Centro Z<input name="offsetZ" type="number" step="any"></label></div>
      <div class="engine-fields"><label>Altura<input name="colliderHeight" type="number" step="any" min="0.01"></label><label>Base Y<input name="colliderOffsetY" type="number" step="any"></label></div>
      <label class="engine-check"><input name="respectHeight" type="checkbox"> Separar colisiones por altura</label>
      <button type="button" class="engine-fit-collider">Ajustar al visual</button><p>Verde: selección. Azul: sólido. Dorado: zona de evento. Los bordes muestran la caja usada por la simulación.</p>
      <details><summary>Filtrar colisiones</summary><label>Grupo de este objeto<select name="collisionGroup" aria-label="Grupo de colisión"></select></label><p>Colisionar con:</p><div class="engine-collision-mask"></div></details>
      <output class="engine-collider-error" aria-live="polite"></output>`;
    host.querySelector('[name="collisionGroup"]').replaceChildren(...collisionGroups.map(([value, name]) => new Option(name, value)));
    for (const [value, name] of collisionGroups) {
      const label = document.createElement('label'); label.className = 'engine-check';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'collisionMask'; checkbox.value = value;
      label.append(checkbox, document.createTextNode(name)); host.querySelector('.engine-collision-mask').append(label);
    }
    this.write(normalizeCollider(collider));
    host.querySelector('.engine-fit-collider').onclick = () => {
      try {
        const previous = this.read();
        const fit = fitColliderToVisual(object, readAnimation());
        this.write({ ...previous, ...fit, mode: previous.mode === 'none' ? 'solid' : previous.mode });
        host.querySelector('.engine-collider-error').textContent = 'Ajuste listo. Aplicá el comportamiento para guardarlo.';
      } catch (error) { host.querySelector('.engine-collider-error').textContent = error.message; }
    };
  }

  write(collider) {
    for (const [name, value] of Object.entries({ collider: collider.mode, width: collider.size[0], depth: collider.size[1], offsetX: collider.offset[0], offsetZ: collider.offset[1], colliderHeight: collider.height, colliderOffsetY: collider.offsetY, collisionGroup: collider.group })) this.host.querySelector(`[name="${name}"]`).value = value;
    this.host.querySelector('[name="respectHeight"]').checked = collider.respectHeight;
    for (const input of this.host.querySelectorAll('[name="collisionMask"]')) input.checked = !!(collider.mask & Number(input.value));
  }

  read() {
    const value = name => this.host.querySelector(`[name="${name}"]`).value;
    return normalizeCollider({ mode: value('collider'), size: [Number(value('width')), Number(value('depth'))], offset: [Number(value('offsetX')), Number(value('offsetZ'))],
      height: Number(value('colliderHeight')), offsetY: Number(value('colliderOffsetY')), respectHeight: this.host.querySelector('[name="respectHeight"]').checked,
      group: Number(value('collisionGroup')), mask: [...this.host.querySelectorAll('[name="collisionMask"]:checked')].reduce((mask, input) => mask | Number(input.value), 0),
    });
  }

  setMode(mode) { this.host.querySelector('[name="collider"]').value = mode; }
}
