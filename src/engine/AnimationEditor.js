import { getAnimationFrame, normalizeSpriteAnimation } from './SpriteAnimation.js';

// Canvas previews read image pixels; authored Three.js textures stay untouched.
export class AnimationEditor {
  constructor(host, object, animation) {
    this.host = host;
    this.object = object;
    this.playing = false;
    this.time = 0;
    const config = normalizeSpriteAnimation(animation);
    host.innerHTML = `<summary>Animaciones de sprite</summary>
      <label class="engine-check"><input name="animated" type="checkbox"> Animar textura</label>
      <div class="engine-fields"><label>Columnas<input name="columns" type="number" min="1" max="1024"></label><label>Filas<input name="rows" type="number" min="1" max="1024"></label></div>
      <label class="engine-check"><input name="resizeToFrame" type="checkbox"> Ajustar geometría al tamaño de un cuadro</label>
      <p>Para sprites sin recortar: divide ancho/alto en el juego. Conserva la geometría del editor.</p>
      <div class="engine-clips"></div><button type="button" class="engine-add-clip">+ Clip</button>
      <label>Clip inicial<select name="defaultClip"></select></label>
      <label class="engine-check"><input name="movement" type="checkbox"> Elegir idle / walk al mover</label>
      <p>Usá idle, walk o nombres como walk-north, walk-south, walk-east y walk-west para las direcciones.</p>
      <div class="engine-animation-preview"><canvas width="224" height="160" aria-label="Vista previa del sprite"></canvas>
        <label>Clip de vista previa<select name="previewClip"></select></label>
        <button type="button" class="engine-preview-toggle">▶ Vista previa</button>
        <output class="engine-preview-status" aria-live="polite">Vista previa sin modificar el objeto</output>
      </div>`;
    for (const key of ['columns', 'rows']) host.querySelector(`[name="${key}"]`).value = config[key];
    for (const [name, key] of [['animated', 'enabled'], ['resizeToFrame', 'resizeToFrame'], ['movement', 'movement']]) host.querySelector(`[name="${name}"]`).checked = config[key];
    config.clips.forEach(clip => this.addClip(clip));
    this.syncChoices();
    host.querySelector('[name="defaultClip"]').value = config.defaultClip;
    host.querySelector('[name="previewClip"]').value = config.defaultClip;
    host.querySelector('.engine-add-clip').onclick = () => {
      const names = [...host.querySelectorAll('[name="clipName"]')].map(input => input.value);
      let index = 1;
      while (names.includes(`clip${index}`)) index++;
      this.addClip({ name: `clip${index}`, fps: 8, frames: [0], loop: true });
      this.syncChoices();
    };
    host.querySelector('.engine-preview-toggle').onclick = () => {
      this.playing = !this.playing;
      this.time = 0;
      this.updateButton();
      this.preview();
    };
    host.addEventListener('change', () => {
      this.time = 0;
      this.preview();
    });
    this.preview();
  }

  addClip(clip) {
    const row = document.createElement('fieldset');
    row.className = 'engine-clip';
    row.innerHTML = `<legend>Clip</legend><label>Nombre del clip<input name="clipName" maxlength="60" placeholder="walk-south"></label>
      <label>Cuadros (desde 0)<input name="clipFrames" placeholder="0,1,2,3"></label>
      <label>FPS<input name="clipFps" type="number" min="0.01" max="240"></label>
      <label class="engine-check"><input name="clipLoop" type="checkbox"> Repetir</label>
      <button type="button" class="engine-remove-clip">Eliminar clip</button>`;
    row.querySelector('[name="clipName"]').value = clip.name;
    row.querySelector('[name="clipFrames"]').value = clip.frames.join(',');
    row.querySelector('[name="clipFps"]').value = clip.fps;
    row.querySelector('[name="clipLoop"]').checked = clip.loop;
    row.querySelector('[name="clipName"]').addEventListener('input', () => this.syncChoices());
    row.querySelector('.engine-remove-clip').onclick = () => {
      if (this.host.querySelectorAll('.engine-clip').length === 1) return this.setStatus('Se requiere al menos un clip.');
      row.remove(); this.syncChoices(); this.time = 0; this.preview();
    };
    this.host.querySelector('.engine-clips').append(row);
  }

  syncChoices() {
    for (const name of ['defaultClip', 'previewClip']) {
      const select = this.host.querySelector(`[name="${name}"]`);
      const previous = select.value;
      select.replaceChildren(...[...this.host.querySelectorAll('[name="clipName"]')].map(input => new Option(input.value, input.value)));
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
    }
  }

  read() {
    const value = name => this.host.querySelector(`[name="${name}"]`).value;
    const checked = name => this.host.querySelector(`[name="${name}"]`).checked;
    return normalizeSpriteAnimation({
      enabled: checked('animated'), columns: Number(value('columns')), rows: Number(value('rows')),
      resizeToFrame: checked('resizeToFrame'), movement: checked('movement'), defaultClip: value('defaultClip'),
      clips: [...this.host.querySelectorAll('.engine-clip')].map(row => {
        const frames = row.querySelector('[name="clipFrames"]').value;
        if (!frames.trim() || frames.split(',').some(frame => !frame.trim())) throw new Error('Ingresá cuadros separados por comas.');
        return {
          name: row.querySelector('[name="clipName"]').value.trim(),
          frames: frames.split(',').map(frame => Number(frame.trim())),
          fps: Number(row.querySelector('[name="clipFps"]').value),
          loop: row.querySelector('[name="clipLoop"]').checked,
        };
      }),
    });
  }

  setStatus(message) { this.host.querySelector('.engine-preview-status').textContent = message; }
  updateButton() { this.host.querySelector('.engine-preview-toggle').textContent = this.playing ? '■ Detener vista previa' : '▶ Vista previa'; }

  preview() {
    try {
      const config = this.read();
      const name = this.host.querySelector('[name="previewClip"]').value;
      const clip = config.clips.find(item => item.name === name);
      if (!clip) return;
      let image;
      this.object.traverse(node => {
        if (image) return;
        image = [node.material].flat().find(material => material?.map?.image)?.map.image;
      });
      const canvas = this.host.querySelector('canvas');
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!image || !(image.width > 0 && image.height > 0)) {
        this.playing = false; this.updateButton();
        return this.setStatus('Aplicá una textura de sprite para ver la animación.');
      }
      const frame = getAnimationFrame(clip, this.time);
      const width = image.width / config.columns; const height = image.height / config.rows;
      const scale = Math.min((canvas.width - 16) / width, (canvas.height - 16) / height);
      context.imageSmoothingEnabled = false;
      context.drawImage(image, (frame % config.columns) * width, Math.floor(frame / config.columns) * height, width, height,
        (canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2, width * scale, height * scale);
      this.setStatus(`${name} · cuadro ${frame}`);
      if (!clip.loop && this.time >= clip.frames.length / clip.fps) { this.playing = false; this.updateButton(); }
    } catch (error) {
      this.playing = false; this.updateButton(); this.setStatus(error.message);
    }
  }

  update(dt) {
    if (!this.playing) return;
    this.time += dt;
    this.preview();
  }

  dispose() { this.playing = false; }
}
