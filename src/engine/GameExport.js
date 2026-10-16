import runtimeSource from 'virtual:spriteforge-player';
import { serializeGameObject } from './GameAssets.js';

export function buildGameHTML(root, settings) {
  const data = JSON.stringify({ version: 1, scene: serializeGameObject(root), settings }).replace(/</g, '\\u003c');
  const script = runtimeSource.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SpriteForge Game</title><style>
*{box-sizing:border-box}body{margin:0;background:#121c25;color:#e5f3ec;font:14px system-ui}canvas{display:block;width:100vw;height:100vh;outline:none}
header{position:fixed;top:16px;left:16px;right:16px;pointer-events:none;display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.hud{max-width:560px;background:#101c28e8;border:1px solid #42675e;padding:16px;border-radius:8px}h1{font-size:16px;margin:0 0 8px}p{margin:8px 0;line-height:1.5;font-size:12px}
button{pointer-events:auto;border:1px solid #6aa484;background:#29563f;border-radius:5px;color:white;padding:9px 15px;cursor:pointer}button:disabled{opacity:.4}button:focus-visible{outline:2px solid white;outline-offset:2px}
output{display:block;margin-top:12px}#error{color:#ffb2a4;white-space:pre-wrap;max-height:180px;overflow:auto}
</style></head><body><canvas id="game" tabindex="0" aria-label="Juego"></canvas>
<header><div class="hud"><h1 id="status">Cargando…</h1><p>WASD / flechas: mover · E / espacio: interactuar · Esc: pausa</p><output id="message" aria-live="polite"></output><output id="error" aria-live="polite"></output></div>
<div><button id="play">Jugar</button> <button id="pause" disabled>Pausar</button></div></header>
<script type="application/json" id="game-data">${data}</script><script>${script}</script></body></html>`;
}

export function downloadGame(root, settings) {
  const blob = new Blob([buildGameHTML(root, settings)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'spriteforge-game.html';
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
