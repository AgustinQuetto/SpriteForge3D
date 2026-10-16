# Example assets

- `voxels.json`: sparse voxel import example for the modeling workflow.
- `game-demo.s3d`: complete v4 game project with an animated sprite player, key/door mission, reusable sprite resource, shadow lighting, particles, bloom, and an HTML control panel. Open through **Proyecto → Abrir proyecto**, then choose **Jugar**. Use WASD and E; the HTML buttons demonstrate time of day, light/post toggles, bursts, and pause. Changing the runtime controls does not alter the saved project.
- `player-sheet.png`: transparent 64 × 32 pixel character sheet, arranged as four columns and two rows of 16 × 16 frames. Import it as one sprite; enable animation and frame-size fitting. Start with `idle` (frame `0`) and `walk` (frames `1,2,3`) at 8 FPS, looping. Enable movement-based animation for a player, or use a visual start event to play `walk` on a stationary object. The remaining frames provide color variants for experimenting with additional clips.

See `docs/GAME_AUTHORING.md` for map placement, behavior, project save/open, and export.
