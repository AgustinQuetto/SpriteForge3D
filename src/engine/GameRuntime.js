import * as THREE from 'three';
import { cloneGameObject, disposeGameObject } from './GameAssets.js';
import { normalizeGameComponents } from './GameComponents.js';
import { SpriteAnimator } from './SpriteAnimation.js';
import { collidersMatch, overlapsXZ, overlapCorrection } from './Colliders.js';
import { conditionsMatch, formatGameMessage, TARGET_ACTIONS } from './GameEvents.js';
import { MapBatchRenderer } from './MapBatchRenderer.js';
import { ColliderIndex } from './ColliderIndex.js';
import { createScriptHooks, scriptErrorMessage } from './GameScripts.js';
import { GameInterface, normalizeGameInterface } from './GameInterface.js';
import { Environment } from './Environment.js';
import { normalizeLight, normalizePostProcessing } from './EnvironmentSettings.js';
import { ParticleManager } from './Particles.js';
import { PostProcessing } from './PostProcessing.js';

const STEP = 1 / 60;
const MAX_EVENTS = 256;

export class GameRuntime {
  constructor(source, settings, { onMessage = () => {}, onError = () => {}, onStateChange = () => {}, uiHost, uiViewFactory } = {}) {
    this.settings = { ...settings };
    this.onMessage = onMessage;
    this.onError = onError;
    Object.assign(this, { onStateChange, uiHost, uiViewFactory });
    this.interfaceSettings = normalizeGameInterface(settings.ui);
    this.root = cloneGameObject(source);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#121c25');
    this.scene.add(this.root);
    this.camera = new THREE.OrthographicCamera(-300, 300, 220, -220, 0.1, 10000);
    this.keys = new Set();
    this.pressed = new Set();
    this.variables = Object.create(null);
    this.entities = [];
    this.queue = [];
    this.contacts = new Map();
    this.accumulator = 0;
    this.time = 0;
    this.paused = false;
    this.started = false;
    this.ruleState = new Map();
    this.reportedErrors = new Set();
    this.root.updateMatrixWorld(true);
    try {
      this.root.traverse(object => {
        if (!object.userData.game) return;
        const components = normalizeGameComponents(object.userData.game);
        const entity = { id: components.id, object, components, hooks: {}, facing: 'south', visibleBeforeDisable: object.visible && components.render.visible, animator: new SpriteAnimator(object, components.animation) };
        object.userData.game = components;
        object.visible &&= components.enabled && components.render.visible;
        this.entities.push(entity);
      });
      const ids = new Set();
      for (const entity of this.entities) {
        if (ids.has(entity.id)) throw new Error(`Duplicate game object ID: ${entity.object.name}`);
        ids.add(entity.id);
      }
    } catch (error) {
      disposeGameObject(this.root);
      throw error;
    }
    this.colliderIndex = new ColliderIndex(settings.cellSize);
    const bounds = new THREE.Box3().setFromObject(this.root);
    this.cameraTarget = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    this.updateCamera(1);
    this.mapRenderer = new MapBatchRenderer(this.scene, () => this.root);
    this.environment = new Environment(this.scene, () => this.root, settings.environment, { onError });
    this.postSettings = normalizePostProcessing(settings.postProcessing);
    this.particles = new ParticleManager(this.scene, this.entities, entity => this.isActive(entity), onError);
    this.world = this.worldApi();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.booting = true;
    if (this.interfaceSettings.enabled && (this.uiHost || this.uiViewFactory)) {
      try {
        this.interface = new GameInterface(this.interfaceSettings, { host: this.uiHost, viewFactory: this.uiViewFactory,
          api: ui => this.interfaceApi(ui), onError: this.onError });
        this.interface.start();
      } catch (error) { this.onError(`UI / mount: ${scriptErrorMessage(error)}`); }
    }
    this.initializeActiveEntities();
    this.booting = false;
    this.drainEvents();
  }

  initializeActiveEntities() {
    if (!this.started || this.initializing) return;
    this.initializing = true;
    let pending;
    while ((pending = this.entities.filter(entity => this.isActive(entity) && !entity.lifecycleStarted)).length) {
      for (const entity of pending) {
        if (!this.isActive(entity)) continue;
        if (!entity.initialized) {
          entity.initialized = true;
          if (entity.components.player.enabled) this.resolveOverlaps(entity);
          if (entity.components.script.trim()) {
            try {
              // Local user-authored JavaScript runs only after explicit Play.
              entity.hooks = createScriptHooks(entity.components.script, this.api(entity));
            } catch (error) { this.report(entity, 'compile', error); }
          }
        }
        if (!this.isActive(entity)) continue;
        entity.lifecycleStarted = true;
        this.invoke(entity, 'start');
        this.enqueue(entity, 'start');
      }
    }
    this.initializing = false;
  }

  report(entity, hook, error) {
    this.onError(`${entity.object.name} / ${hook}: ${scriptErrorMessage(error)}`);
  }

  invoke(entity, hook, ...args) {
    if ((hook !== 'stop' && !this.isActive(entity)) || typeof entity.hooks[hook] !== 'function') return;
    try { entity.hooks[hook](...args); }
    catch (error) {
      this.report(entity, hook, error);
      delete entity.hooks[hook]; // A broken per-frame hook must not flood diagnostics.
    }
  }

  api(entity) {
    return {
      object: entity.object,
      variables: this.variables,
      world: this.world,
      emitParticles: (count = 16) => this.particles.emit(entity.id, count),
      setEmitting: enabled => this.particles.setEmitting(entity.id, enabled),
      ui: this.interface?.uiApi || null,
      pause: enabled => this.setPaused(enabled),
      input: { down: key => this.keys.has(key.toLowerCase()), pressed: key => this.pressed.has(key.toLowerCase()) },
      move: (x, z) => this.move(entity, x, z),
      emit: (name, data) => this.emit(name, data, entity),
      message: value => this.onMessage(String(value)),
      find: id => this.entities.find(item => item.id === id)?.object || null,
      findTag: tag => this.entities.filter(item => item.components.tag === tag).map(item => item.object),
      setEnabled: (enabled, id = entity.id) => {
        const target = this.entities.find(item => item.id === id);
        if (!target) throw new Error(`Game object not found: ${id}`);
        this.setEnabled(target, enabled);
      },
      playAnimation: (name = entity.animator.clipName, restart = true) => {
        if (typeof name === 'boolean') { restart = name; name = entity.animator.clipName; }
        entity.animator.play(name, restart);
      },
      stopAnimation: () => entity.animator.stop(),
      resumeMovementAnimation: () => { entity.animator.manual = false; entity.animator.playing = true; },
    };
  }

  keyDown(key) {
    key = key.toLowerCase();
    if (!this.keys.has(key)) this.pressed.add(key);
    this.keys.add(key);
  }

  interfaceApi(ui) {
    const runtime = this;
    return {
      ui, variables: this.variables, world: this.world,
      get paused() { return runtime.paused; },
      pause: (enabled = true) => this.setPaused(enabled),
      emit: (name, data) => this.emit(name, data), message: text => this.onMessage(String(text)),
      find: id => this.entities.find(entity => entity.id === id)?.object || null,
      findTag: tag => this.entities.filter(entity => entity.components.tag === tag).map(entity => entity.object),
      setEnabled: (enabled, id) => {
        const entity = this.entities.find(item => item.id === id);
        if (!entity) throw new Error(`Game object not found: ${id}`); this.setEnabled(entity, enabled);
      },
    };
  }

  setPaused(enabled = true) {
    this.paused = !!enabled; this.clearInput(); this.onStateChange({ paused: this.paused });
  }

  worldApi() {
    const runtime = this;
    return {
      get hour() { return runtime.environment.hour; },
      get cycling() { return runtime.environment.cycling; },
      setTime: hour => this.environment.setTime(hour), setCycleRunning: enabled => this.environment.setCycleRunning(enabled),
      setEnvironment: patch => {
        const environment = this.environment;
        environment.configure({ ...environment.settings, ...patch, dayNight: { ...environment.settings.dayNight, hour: environment.hour, enabled: environment.cycling, ...patch.dayNight } });
      },
      setPostProcessing: patch => { this.postSettings = normalizePostProcessing({ ...this.postSettings, ...patch }); },
      setLight: (id, patch) => {
        const entity = this.entities.find(item => item.id === id); if (!entity) throw new Error(`Game object not found: ${id}`);
        entity.components.light = normalizeLight({ ...entity.components.light, ...patch });
      },
      emitParticles: (id, count = 16) => this.particles.emit(id, count), setEmitting: (id, enabled) => this.particles.setEmitting(id, enabled),
    };
  }

  keyUp(key) { this.keys.delete(key.toLowerCase()); }
  clearInput() { this.keys.clear(); this.pressed.clear(); }

  bounds(entity) {
    return this.colliderIndex.bounds(entity);
  }

  isActive(entity) {
    for (let object = entity.object; object; object = object.parent) if (object.userData.game?.enabled === false) return false;
    return entity.components.enabled;
  }

  setEnabled(entity, enabled) {
    enabled = !!enabled;
    if (entity.components.enabled === enabled) return;
    if (!enabled) entity.visibleBeforeDisable = entity.object.visible;
    entity.components.enabled = enabled;
    entity.object.visible = enabled ? entity.visibleBeforeDisable : false;
    if (enabled) this.initializeActiveEntities();
  }

  translateWorld(entity, x, z) {
    const world = entity.object.getWorldPosition(new THREE.Vector3());
    world.x += x; world.z += z;
    if (entity.object.parent) entity.object.parent.worldToLocal(world);
    entity.object.position.copy(world);
    entity.object.updateMatrixWorld(true);
  }

  resolveOverlaps(entity) {
    if (entity.components.collider.mode !== 'solid') return true;
    this.colliderIndex.sync(this.entities, item => this.isActive(item));
    for (let pass = 0; pass < 8; pass++) {
      const bounds = this.bounds(entity);
      const candidates = [];
      for (const { entity: other } of this.colliderIndex.query(bounds)) {
        if (other === entity || !this.isActive(other) || other.components.collider.mode !== 'solid') continue;
        const obstacle = this.bounds(other);
        if (!collidersMatch(entity.components.collider, other.components.collider, bounds, obstacle)) continue;
        const correction = overlapCorrection(bounds, obstacle);
        if (correction) candidates.push(correction);
      }
      if (!candidates.length) return true;
      const correction = candidates.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
      this.translateWorld(entity, correction.x, correction.z);
    }
    const bounds = this.bounds(entity);
    if (!this.colliderIndex.query(bounds).some(({ entity: other }) => {
      if (other === entity || !this.isActive(other) || other.components.collider.mode !== 'solid') return false;
      const obstacle = this.bounds(other);
      return collidersMatch(entity.components.collider, other.components.collider, bounds, obstacle) && overlapsXZ(bounds, obstacle);
    })) return true;
    const label = `${entity.id}:overlap`;
    if (!this.reportedErrors.has(label)) {
      this.reportedErrors.add(label);
      this.report(entity, 'collision', new Error('Cannot resolve overlapping solids. Adjust the spawn or collider.'));
    }
    return false;
  }

  move(entity, x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Movement must use finite numbers');
    if (!this.isActive(entity) || !this.resolveOverlaps(entity)) return;
    const collides = entity.components.collider.mode === 'solid';
    for (const [axis, distance] of [['x', x], ['z', z]]) {
      if (!distance) continue;
      let allowed = distance;
      const box = this.bounds(entity);
      const swept = { ...box };
      const alongAxis = axis.toUpperCase(); swept[`min${alongAxis}`] += Math.min(0, distance); swept[`max${alongAxis}`] += Math.max(0, distance);
      if (collides) for (const { entity: other } of this.colliderIndex.query(swept)) {
        if (other === entity || !this.isActive(other) || other.components.collider.mode !== 'solid') continue;
        const obstacle = this.bounds(other);
        if (!collidersMatch(entity.components.collider, other.components.collider, box, obstacle)) continue;
        const cross = axis === 'x' ? 'Z' : 'X';
        const along = axis.toUpperCase();
        if (box[`min${cross}`] >= obstacle[`max${cross}`] - 0.00001 || box[`max${cross}`] <= obstacle[`min${cross}`] + 0.00001) continue;
        if (distance > 0 && box[`max${along}`] <= obstacle[`min${along}`] + 0.00001) {
          allowed = Math.min(allowed, Math.max(0, obstacle[`min${along}`] - box[`max${along}`]));
        } else if (distance < 0 && box[`min${along}`] >= obstacle[`max${along}`] - 0.00001) {
          allowed = Math.max(allowed, Math.min(0, obstacle[`max${along}`] - box[`min${along}`]));
        }
      }
      this.translateWorld(entity, axis === 'x' ? allowed : 0, axis === 'z' ? allowed : 0);
    }
  }

  enqueue(entity, when, other = null, name = '', data = null) {
    const pendingScriptSignal = when === 'signal' && (this.initializing || this.booting) && !entity.initialized && entity.components.script.trim();
    if (!this.isActive(entity) || (!this.hasEventHandler(entity, when) && !pendingScriptSignal)) return;
    if (this.queue.length < 4096) this.queue.push({ entity, when, other, name, data });
    else if (!this.reportedErrors.has('queue-limit')) {
      this.reportedErrors.add('queue-limit'); this.onError('Event queue limit reached; excess events were dropped.');
    }
  }

  hasEventHandler(entity, when) {
    const hook = when === 'signal' ? 'onEvent' : `on${when[0].toUpperCase()}${when.slice(1)}`;
    return typeof entity.hooks[hook] === 'function' || entity.components.events.some(rule => rule.when === when);
  }

  emit(name, data, sender = null) {
    for (const entity of this.entities) this.enqueue(entity, 'signal', sender, String(name), data);
    if (typeof this.interface?.hooks.onEvent === 'function') {
      if (this.queue.length < 4096) this.queue.push({ ui: true, name: String(name), data });
      else if (!this.reportedErrors.has('queue-limit')) { this.reportedErrors.add('queue-limit'); this.onError('Event queue limit reached; excess events were dropped.'); }
    }
  }

  drainEvents() {
    let processed = 0;
    let actionCount = 0;
    while (this.queue.length && processed++ < MAX_EVENTS) {
      const { entity, when, other, name, data, ui } = this.queue.shift();
      if (ui) { this.interface?.invoke('onEvent', name, data); continue; }
      if (!this.isActive(entity)) continue;
      this.invoke(entity, when === 'signal' ? 'onEvent' : `on${when[0].toUpperCase()}${when.slice(1)}`, ['signal', 'animationEnd'].includes(when) ? name : other?.object || null, data);
      for (const rule of entity.components.events) {
        if (!this.isActive(entity)) break;
        if (rule.when !== when || (when === 'signal' && rule.signal !== name) || (when === 'animationEnd' && rule.signal && rule.signal !== name)) continue;
        if (!conditionsMatch(rule, this.variables, other)) continue;
        const key = `${entity.id}:${rule.id}`;
        const previous = this.ruleState.get(key);
        if (previous && (rule.once || this.time - previous.time + 1e-8 < rule.cooldown)) continue;
        this.ruleState.set(key, { time: this.time });
        for (const [index, action] of rule.actions.entries()) {
          if (++actionCount > 1024) { this.queue.length = 0; this.onError('Action limit reached; remaining actions were dropped.'); return; }
          try { this.executeAction(entity, action, other); }
          catch (error) {
            const label = `${key}:${index}`;
            if (!this.reportedErrors.has(label)) {
              this.reportedErrors.add(label); this.report(entity, `${when} action ${index + 1}`, error);
            }
          }
        }
      }
    }
    if (this.queue.length) {
      this.queue.length = 0;
      this.onError('Event limit reached; recursive signals were dropped.');
    }
  }

  executeAction(entity, action, other) {
    let target = entity;
    if (TARGET_ACTIONS.includes(action.type)) {
      target = action.target === 'self' ? entity : action.target === 'other' ? other : this.entities.find(item => item.id === action.target);
      if (!target) throw new Error(`Game object target not found: ${action.target}`);
    }
    switch (action.type) {
      case 'message': this.onMessage(formatGameMessage(action.value, this.variables)); break;
      case 'hide':
        target.object.visible = false;
        if (!target.components.enabled) target.visibleBeforeDisable = false;
        break;
      case 'show':
        target.object.visible = target.components.enabled;
        if (!target.components.enabled) target.visibleBeforeDisable = true;
        break;
      case 'enable': this.setEnabled(target, true); break;
      case 'disable': this.setEnabled(target, false); break;
      case 'setVariable': this.variables[action.value] = action.amount; break;
      case 'addVariable': this.variables[action.value] = (Number(this.variables[action.value]) || 0) + action.amount; break;
      case 'emit': this.emit(action.value, null, entity); break;
      case 'playAnimation': target.animator.play(action.value); break;
      case 'stopAnimation': target.animator.stop(); break;
      case 'movementAnimation': target.animator.manual = false; target.animator.playing = true; break;
      case 'lightOn': case 'lightOff': this.world.setLight(target.id, { enabled: action.type === 'lightOn' }); break;
      case 'particlesOn': case 'particlesOff': this.particles.setEmitting(target.id, action.type === 'particlesOn'); break;
      case 'burstParticles': this.particles.emit(target.id, action.amount); break;
      case 'setTime': this.environment.setTime(action.amount); break;
      case 'cycleOn': case 'cycleOff': this.environment.setCycleRunning(action.type === 'cycleOn'); break;
    }
  }

  updateContacts() {
    const next = new Map();
    this.colliderIndex.sync(this.entities, entity => this.isActive(entity));
    const pairs = []; const seen = new Set();
    for (const entry of this.colliderIndex.entries.values()) {
      if (entry.entity.components.collider.mode !== 'trigger') continue;
      for (const candidate of this.colliderIndex.query(entry.bounds)) {
        if (candidate === entry) continue;
        const [a, b] = entry.order < candidate.order ? [entry, candidate] : [candidate, entry]; const key = `${a.order}:${b.order}`;
        if (!seen.has(key)) { seen.add(key); pairs.push([a, b]); }
      }
    }
    pairs.sort(([a, b], [c, d]) => a.order - c.order || b.order - d.order);
    for (const [first, second] of pairs) {
      const a = first.entity; const b = second.entity; const aBounds = first.bounds; const bBounds = second.bounds;
      if (!collidersMatch(a.components.collider, b.components.collider, aBounds, bBounds) || !overlapsXZ(aBounds, bBounds)) continue;
      const key = `${a.id}:${b.id}`;
      next.set(key, [a, b]);
      const when = this.contacts.has(key) ? 'triggerStay' : 'triggerEnter';
      this.enqueue(a, when, b); this.enqueue(b, when, a);
    }
    for (const [key, [a, b]] of this.contacts) if (!next.has(key)) {
      this.enqueue(a, 'triggerExit', b); this.enqueue(b, 'triggerExit', a);
    }
    this.contacts = next;
  }

  step(dt) {
    this.time += dt;
    for (const entity of this.entities) {
      if (!this.isActive(entity)) continue;
      if (!entity.components.player.enabled && typeof entity.hooks.update !== 'function' && !entity.animator.animation.enabled) continue;
      const before = entity.object.getWorldPosition(new THREE.Vector3());
      if (entity.components.player.enabled) {
        let x = Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft'));
        let z = Number(this.keys.has('s') || this.keys.has('arrowdown')) - Number(this.keys.has('w') || this.keys.has('arrowup'));
        const length = Math.hypot(x, z) || 1;
        this.move(entity, x / length * entity.components.player.speed * dt, z / length * entity.components.player.speed * dt);
      }
      this.invoke(entity, 'update', dt);
      const movement = entity.object.getWorldPosition(new THREE.Vector3()).sub(before);
      const moving = Math.hypot(movement.x, movement.z) > 1e-6;
      if (moving) entity.facing = Math.abs(movement.x) > Math.abs(movement.z) ? (movement.x > 0 ? 'east' : 'west') : (movement.z > 0 ? 'south' : 'north');
      if (entity.animator.update(dt, moving, entity.facing)) this.enqueue(entity, 'animationEnd', null, entity.animator.clipName);
    }
    this.updateContacts();
    if (this.pressed.has('e') || this.pressed.has(' ')) {
      const player = this.entities.find(entity => this.isActive(entity) && entity.components.player.enabled);
      if (player) {
        const position = player.object.getWorldPosition(new THREE.Vector3());
        const nearby = this.entities.filter(entity => entity !== player && this.isActive(entity) && this.hasEventHandler(entity, 'interact'))
          .map(entity => ({ entity, distance: entity.object.getWorldPosition(new THREE.Vector3()).distanceTo(position) }))
          .filter(item => item.distance <= this.settings.cellSize * 1.75).sort((a, b) => a.distance - b.distance);
        if (nearby.length) this.enqueue(nearby[0].entity, 'interact', player);
      }
    }
    this.drainEvents();
    this.environment.advance(dt); this.particles.update(dt);
    this.pressed.clear();
  }

  update(dt) {
    if (!this.started) return;
    if (!this.paused) {
      this.accumulator += Math.min(Math.max(dt, 0), 0.1);
      while (!this.paused && this.accumulator + 1e-9 >= STEP) {
        this.step(STEP);
        this.accumulator -= STEP;
      }
    }
    if (this.paused) this.accumulator = 0;
    this.interface?.invoke('update', this.paused ? 0 : Math.min(Math.max(dt, 0), 0.1));
    if (this.paused && this.queue.length) this.drainEvents();
  }

  updateCamera(aspect) {
    const size = this.settings.cameraSize;
    this.camera.left = -size * aspect; this.camera.right = size * aspect;
    this.camera.top = size; this.camera.bottom = -size;
    const player = this.entities.find(entity => this.isActive(entity) && entity.components.player.enabled);
    if (this.settings.followPlayer && player) player.object.getWorldPosition(this.cameraTarget);
    const offset = this.settings.camera === 'top-down' ? new THREE.Vector3(0, 700, 0.01) : new THREE.Vector3(500, 600, 500);
    this.camera.position.copy(this.cameraTarget).add(offset);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    for (const entity of this.entities) this.invoke(entity, 'stop');
    this.interface?.dispose(); this.interface = null;
    this.clearInput();
    this.pipeline?.dispose(); this.pipeline = null; this.particles.dispose(); this.environment.dispose();
    this.mapRenderer.dispose();
    disposeGameObject(this.root);
    this.entities = [];
    this.queue = [];
    this.contacts.clear();
    this.colliderIndex.clear();
  }

  render(renderer) {
    this.environment.prepare(this.cameraTarget, this.settings.cameraSize);
    if (this.worldRevision !== this.environment.revision) { this.worldRevision = this.environment.revision; this.mapRenderer.invalidate(); }
    if (!this.postSettings.enabled && this.pipeline) { this.pipeline.dispose(); this.pipeline = null; }
    if (this.postSettings.enabled && renderer.isWebGLRenderer && (!this.pipeline || this.pipeline.renderer !== renderer)) {
      this.pipeline?.dispose(); this.pipeline = new PostProcessing(renderer);
    }
    const adapter = this.pipeline ? { render: (scene, camera) => this.pipeline.render(scene, camera, this.postSettings) } : renderer;
    this.environment.render(renderer, () => this.mapRenderer.render(adapter, this.camera, this.settings.batchMap !== false));
  }
}
