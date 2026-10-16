import { build, defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Build the player once per Vite session and embed it in downloaded games.
// configFile:false prevents recursively loading this editor configuration.
function standalonePlayer() {
  let bundle;
  return {
    name: 'spriteforge-standalone-player',
    resolveId(id) { if (id === 'virtual:spriteforge-player') return '\0spriteforge-player'; },
    async load(id) {
      if (id !== '\0spriteforge-player') return;
      bundle ||= build({
        configFile: false, publicDir: false, logLevel: 'silent',
        build: {
          write: false,
          lib: { entry: fileURLToPath(new URL('./src/engine/StandaloneGame.js', import.meta.url)), name: 'SpriteForgeGame', formats: ['iife'] },
          minify: true,
        },
      });
      const result = await bundle;
      const code = [result].flat().flatMap(item => item.output).find(item => item.type === 'chunk' && item.isEntry).code;
      return `export default ${JSON.stringify(code)};`;
    },
    handleHotUpdate(context) {
      if (!context.file.replaceAll('\\', '/').includes('/src/engine/')) return;
      bundle = null;
      const module = context.server.moduleGraph.getModuleById('\0spriteforge-player');
      if (module) context.server.moduleGraph.invalidateModule(module);
      context.server.ws.send({ type: 'full-reload' });
    },
  };
}

export default defineConfig({
  plugins: [standalonePlayer()],
  publicDir: 'assets',
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
});
