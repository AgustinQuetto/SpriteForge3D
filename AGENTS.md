# Repository Guidelines

## Project Structure & Module Organization

SpriteForge3D is a browser-based sprite-to-3D editor built with vanilla JavaScript, Three.js, and Vite.

- `src/main.js` wires UI events, persistence, history, and editor actions.
- `src/core/` manages the scene, cameras, selection, transforms, and groups.
- `src/engine/` contains map tools, resources, gameplay, and standalone export; `src/project/` validates and stages project loading.
- `src/editor/` contains drawing, geometry, voxel, and undo/redo tools.
- `src/import/` and `src/export/` handle model formats, textures, and UV layouts.
- `src/ui/` contains panels; `src/styles/index.css` defines shared styles.
- `src/automation/` implements voxel generation and assembly; `scripts/spriteforge-cli.mjs` exposes the CLI.
- `test/` holds automated tests; `examples/` contains sample voxel JSON. `public/libs/` holds xatlas runtime assets. Check static paths against `vite.config.js`, which currently sets `publicDir: 'assets'`.

## Build, Test, and Development Commands

Use Node.js 18+ and npm. Run commands from the repository root:

- `npm ci`: install dependencies from `package-lock.json`.
- `npm run dev`: start Vite at `http://localhost:3000` with hot reload.
- `npm run build`: generate the production bundle in `dist/`.
- `npm run preview`: serve the production build locally.
- `npm test`: run all `test/*.test.mjs` tests.
- `npm run benchmark:engine -- --size 64`: measure map creation, batching, and simulation.
- `npm run spriteforge -- voxelize --input sprite.png --relief auto`: generate voxel assets.

## Coding Style & Naming Conventions

Use ES modules with explicit `.js` import extensions, two-space indentation, single quotes, and semicolons. Match surrounding code. Use PascalCase for classes and class modules (`SceneManager.js`), camelCase for functions and variables, and kebab-case for test files. No formatter or linter is configured.

Implement features in dedicated modules and connect them through `main.js`. Add user meshes to `SceneManager.exportGroup`. Dispose of replaced Three.js geometries and materials.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Name files `<feature>.test.mjs` and describe observable behavior in test titles. Run an individual suite with `node --test test/export-scope.test.mjs`. Cover geometry, transforms, selection, export, and pipeline regressions where relevant. No coverage threshold is configured. For editor changes, manually check the affected workflow, undo/redo, and browser console; run `npm test` and `npm run build` before submitting.

## Commit & Pull Request Guidelines

Recent commits use `feat:`, `docs:`, and optional scopes such as `feat(pipeline):`. Follow that pattern with a concise, imperative summary. Keep changes focused. PRs should explain the problem, resulting behavior, and validation performed; link related issues and include screenshots or recordings for visible editor changes. Update `README.md` when workflows or CLI options change.
