import { RepeatWrapping } from 'three';

export function normalizeSpriteAnimation(data = {}) {
  const animation = {
    enabled: false, columns: 1, rows: 1, resizeToFrame: false,
    defaultClip: 'default', movement: false, clips: [], ...structuredClone(data),
  };
  for (const key of ['enabled', 'resizeToFrame', 'movement']) if (typeof animation[key] !== 'boolean') throw new Error(`Invalid animation ${key}`);
  if (!Array.isArray(animation.clips)) throw new Error('Animation clips must be an array');
  for (const key of ['columns', 'rows']) {
    if (!Number.isInteger(animation[key]) || animation[key] < 1 || animation[key] > 1024) throw new Error('Animation grid must use integers between 1 and 1024');
  }
  // Migrate the original single-clip component without changing its playback.
  if (!animation.clips.length) {
    animation.clips = [{ name: 'default', frames: data.frames || [0], fps: data.fps ?? 8, loop: data.loop !== false }];
    animation.defaultClip = 'default';
  }
  const names = new Set();
  for (const clip of animation.clips) {
    if (typeof clip.name !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(clip.name) || names.has(clip.name)) throw new Error('Clip names must be unique and use letters, numbers, underscores or hyphens');
    names.add(clip.name);
    if (!Number.isFinite(clip.fps) || clip.fps < 0.01 || clip.fps > 240) throw new Error('Invalid animation fps');
    if (!Array.isArray(clip.frames) || !clip.frames.length || clip.frames.length > 10000 || clip.frames.some(frame => !Number.isInteger(frame) || frame < 0 || frame >= animation.columns * animation.rows)) throw new Error('Animation frames must be inside the sprite sheet');
    if (typeof clip.loop !== 'boolean') throw new Error('Clip loop must be a boolean');
  }
  if (!names.has(animation.defaultClip)) throw new Error('Select an existing default clip');
  return animation;
}

export function getAnimationFrame(clip, time) {
  const index = Math.floor(Math.max(0, time) * clip.fps + 1e-8);
  return clip.frames[clip.loop ? index % clip.frames.length : Math.min(index, clip.frames.length - 1)];
}

export function movementClip(animation, moving, direction) {
  const prefix = moving ? 'walk' : 'idle';
  const names = new Set(animation.clips.map(clip => clip.name));
  return [ `${prefix}-${direction}`, prefix, animation.defaultClip ].find(name => names.has(name));
}

export function applySpriteFrame(root, animation, frame) {
  function visit(node) {
    for (const material of [node.material].flat().filter(Boolean)) if (material.map) {
      const texture = material.map;
      if (texture.wrapS !== RepeatWrapping || texture.wrapT !== RepeatWrapping) {
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.needsUpdate = true;
      }
      texture.repeat.set(1 / animation.columns, 1 / animation.rows);
      texture.offset.set((frame % animation.columns) / animation.columns, 1 - (Math.floor(frame / animation.columns) + 1) / animation.rows);
    }
    for (const child of node.children) {
      // Nested animated objects own their texture playback.
      if (!child.userData.game?.animation?.enabled) visit(child);
    }
  }
  visit(root);
}

export class SpriteAnimator {
  constructor(object, animation) {
    this.object = object;
    this.animation = normalizeSpriteAnimation(animation);
    this.clipName = this.animation.defaultClip;
    this.time = 0;
    this.playing = true;
    this.manual = false;
    this.completed = false;
    if (this.animation.enabled && this.animation.resizeToFrame) {
      const fit = node => {
        if (node.geometry && [node.material].flat().some(material => material?.map)) {
          node.geometry.scale(1 / this.animation.columns, 1 / this.animation.rows, 1);
          node.geometry.computeBoundingBox(); node.geometry.computeBoundingSphere();
        }
        for (const child of node.children) if (!child.userData.game?.animation?.enabled) fit(child);
      };
      fit(object);
    }
    this.draw();
  }

  get clip() { return this.animation.clips.find(clip => clip.name === this.clipName); }

  play(name = this.clipName, restart = true, manual = true) {
    if (!this.animation.clips.some(clip => clip.name === name)) throw new Error(`Animation clip not found: ${name}`);
    if (name !== this.clipName || restart) { this.time = 0; this.completed = false; }
    this.clipName = name; this.playing = true; this.manual = manual;
    this.draw();
  }

  stop() { this.playing = false; this.manual = true; }

  update(dt, moving = false, direction = 'south') {
    if (!this.animation.enabled) return false;
    if (this.animation.movement && !this.manual) this.play(movementClip(this.animation, moving, direction), false, false);
    if (!this.playing) return false;
    this.time += dt;
    this.draw();
    if (!this.clip.loop && !this.completed && this.time + 1e-8 >= this.clip.frames.length / this.clip.fps) {
      this.completed = true; this.playing = false;
      return true;
    }
    return false;
  }

  draw() {
    if (this.animation.enabled) applySpriteFrame(this.object, this.animation, getAnimationFrame(this.clip, this.time));
  }
}
