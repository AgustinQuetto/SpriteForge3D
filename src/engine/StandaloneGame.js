import * as THREE from 'three';
import { parseGameObject, disposeGameObject } from './GameAssets.js';
import { GameRuntime } from './GameRuntime.js';
import { isGameUIControl } from './GameInterface.js';

// Bundled as an inline IIFE for the exported HTML. No CDN or server is needed.
async function boot() {
  const data = JSON.parse(document.getElementById('game-data').textContent);
  const source = await parseGameObject(data.scene);
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  let runtime = null;
  let previous = performance.now();
  const status = document.getElementById('status');
  const message = document.getElementById('message');
  const error = document.getElementById('error');
  const pause = document.getElementById('pause');
  const play = document.getElementById('play');
  function updateStatus() {
    status.textContent = !runtime ? 'Listo para jugar' : runtime.paused ? 'En pausa' : 'Jugando';
    pause.textContent = runtime?.paused ? 'Continuar' : 'Pausar';
    pause.disabled = !runtime;
  }
  play.onclick = () => {
    runtime?.dispose();
    error.textContent = ''; message.textContent = '';
    runtime = new GameRuntime(source, data.settings, {
      uiHost: document.body, onStateChange: updateStatus,
      onMessage: value => { message.textContent = value; },
      onError: value => { error.textContent = value; },
    });
    runtime.start();
    previous = performance.now();
    play.textContent = 'Reiniciar';
    updateStatus(); canvas.focus();
  };
  pause.onclick = () => {
    if (!runtime) return;
    runtime.setPaused(!runtime.paused);
    updateStatus(); canvas.focus();
  };
  window.addEventListener('keydown', event => {
    if (!runtime) return;
    if (event.key === 'Tab') { runtime.clearInput(); return; }
    if (event.key === 'Escape') { pause.click(); event.preventDefault(); return; }
    if (isGameUIControl(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    runtime.keyDown(event.key); event.preventDefault();
  });
  window.addEventListener('keyup', event => runtime?.keyUp(event.key));
  window.addEventListener('blur', () => runtime?.clearInput());
  canvas.onclick = () => canvas.focus();
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    runtime?.updateCamera(innerWidth / innerHeight);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', () => { runtime?.dispose(); disposeGameObject(source); renderer.dispose(); });
  renderer.setClearColor('#121c25'); renderer.clear();
  resize(); updateStatus();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = (now - previous) / 1000;
    previous = now;
    if (!runtime) return;
    runtime.update(dt);
    runtime.updateCamera(innerWidth / innerHeight);
    runtime.render(renderer);
  }
  requestAnimationFrame(frame);
}

const showError = value => { document.getElementById('error').textContent = value; };
window.addEventListener('error', event => showError(event.message));
window.addEventListener('unhandledrejection', event => showError(event.reason?.message || String(event.reason)));
boot().catch(error => showError(`No se pudo cargar el juego: ${error.message}`));
