# SpriteForge3D v2: accessible 2.5D game engine

## Product goal

Turn the existing sprite/model editor into an integrated engine where a creator can import pixel art, create animated reusable assets, paint an isometric map, configure game objects, author visual events or JavaScript behavior, light the world with shadows and a day/night cycle, add particles and post-processing, test instantly, and export a playable browser game. Top-down movement uses the XZ ground plane; Y remains elevation. Preserve existing modeling and export workflows and open older `.s3d` projects.

## Acceptance criteria

1. **Maps:** paint, erase, fill rectangular areas, select assets, organize layers, and save/reopen map layout. Editing supports undo/redo and visible brush feedback.
2. **Assets:** import sprites/models, capture reusable templates, place independent instances, define sprite-sheet animation clips, preview and trigger animations. Templates and clips survive project reload.
3. **Game objects:** inspect named entities and configure enabled state, tags, player controls, colliders, animations, and behavior. Stable object IDs support references independent of display names.
4. **Gameplay:** fixed-step top-down movement, solid collisions, trigger enter/stay/exit events, interaction, orthographic/isometric camera settings, and camera follow. Play/pause/stop never modifies authored scene data.
5. **Authoring:** approachable visual event/action controls plus JavaScript lifecycle hooks, input, variables, event dispatch, movement, and animation APIs. Report errors with object/hook context; prevent event recursion from freezing the editor.
6. **Projects:** versioned engine data, existing project compatibility, autosave, and reload of map, assets, components, scripts, and settings.
7. **Delivery:** export a standalone browser game using the same runtime as editor preview, with embedded assets, startup/error handling, and clear controls.
8. **Usability and verification:** a built-in playable example, documented authoring workflow/API, keyboard-accessible panels, regression tests for map/history/persistence/runtime, and browser verification of author → play → stop → reload → export.
9. **Lighting and atmosphere:** configurable lights, cast/receive shadows, and an adjustable day/night cycle with preview, pause, restart, and project persistence. Verify the same lighting and shadow behavior in exported games, including batched map meshes and sprites.
10. **Effects:** configurable particle emitters and post-processing controls with bounded resource use, predictable pause/stop behavior, project persistence, and matching preview/export output. Supply accessible authoring controls and direct browser evidence for both features.
11. **In-game UI:** author interfaces using HTML, CSS, and JavaScript, with an engine bridge for variables, events, object control, and pause state. Use the same DOM-based UI in editor Play and exported games; isolate its styling from the editor, preserve keyboard interaction, and dispose it on Stop/restart. UI source and configuration must survive project round trips.

## Implementation sequence

- Establish component schema and isolated runtime; integrate a map palette, painting, templates, inspector, events, and playable example.
- Extend animation authoring, asset management, collision/interaction tooling, script diagnostics, camera controls, and visual events through complete game workflows.
- Add standalone game packaging and verify the exported game, project migration, and editor round trips.
- Refine layer tooling, performance, accessibility, discoverability, and regression coverage against all acceptance criteria.
- Add shared environment rendering for lights/shadows/day-night, particle simulation, and post-processing; integrate authoring, persistence, and standalone delivery and verify them together.

This document defines the full target. An initial playable foundation does not establish completion. Track evidence and remaining gaps in `docs/ENGINE_V2_PROGRESS.md`.
