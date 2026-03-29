# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000 (Vite, hot reload)
npm run build    # Production build → dist/
npm run preview  # Serve production build locally
```

No test or lint commands are configured.

## Architecture

**SpriteForge3D** is a browser-based 2D→3D editor: users import PNG sprites, arrange them in 3D space, extrude them into geometry, and export to GLTF/OBJ/Godot MeshLibrary formats. Built with vanilla JavaScript + Three.js, bundled by Vite. No framework, no TypeScript.

### Module Responsibilities

- **`src/main.js`** — Central orchestrator (~983 lines). All UI event wiring, keyboard shortcuts, and callback plumbing between modules. Start here to understand any feature end-to-end.
- **`src/core/SceneManager.js`** — Three.js scene, WebGL renderer, camera (perspective + orthographic), OrbitControls, TransformControls, raycasting selection, snap-to-grid. Exposes `exportGroup` (the scene graph that gets exported).
- **`src/editor/QuadFactory.js`** — Mesh creation: `createQuad()` (textured sprite plane), primitives (plane/cube/cylinder), `extrudeQuad()` (flat quad → box), `applyTexture()`. Sprites anchor at bottom-center for 2.5D perspective.
- **`src/editor/VertexEditor.js`** — Vertex deformation mode: spawns draggable sphere handles per vertex, updates geometry in real time.
- **`src/editor/HistoryManager.js`** — Undo/redo stack.
- **`src/export/UVExporter.js`** — UV unwrapping via xatlas WASM (`generateRealLayout()`), UV template PNG export, UV application to meshes before texturing.
- **`src/export/GLTFExportManager.js`**, **`OBJExportManager.js`**, **`GodotExportManager.js`** — Format-specific export of `SceneManager.exportGroup`.
- **`src/ui/AssetPanel.js`** — Drag-drop PNG loading, thumbnail grid, sprite sheet slicing.
- **`src/ui/PropertiesPanel.js`** — Transform inputs (position/rotation/scale), extrusion slider, texture apply.
- **`src/ui/SceneHierarchy.js`** — Scene tree view, click-to-select.

### Data Flow

```
User input (canvas click / UI)
  → main.js handlers
  → SceneManager + QuadFactory
  → Three.js scene (exportGroup)
  → HistoryManager (undo snapshot)
  → UI panels update
  → Export managers (on demand)
```

### Project Persistence

Save/load uses `.s3d` format (JSON with base64-embedded textures). Uses the File System Access API with a Blob/download fallback.

### xatlas Integration

UV unwrapping uses a WASM library at `public/libs/xatlas.js` + `xatlas.wasm`. Required for the "Generate UV Layout" feature. Must be present in `public/libs/` for UV export to work.

### Key Conventions

- All `.js` files are ES modules (`"type": "module"` in package.json).
- Call `dispose()` on geometries and materials before replacing them to avoid GPU memory leaks.
- `SceneManager.exportGroup` is the authoritative scene graph — all user-created meshes must be added to it.
- `main.js` is intentionally large (it's the glue layer); new features should be implemented in dedicated modules and wired through `main.js`.
