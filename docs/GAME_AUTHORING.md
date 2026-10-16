# Creating a 2.5D game

## First playable scene

Run `npm run dev`, open the editor, and choose **Ejemplo jugable**. The example is added beside existing content and can be undone. Select **Jugar** to control the blue player with WASD or arrows. Collect the golden key, approach the brown door and press E or Space, then reach the cyan goal crystal and interact again. **Pausar** freezes simulation; **Detener** or Escape returns to the authored scene.

An empty project offers **Crear ejemplo jugable** and **Pintar desde cero**. Importing sprites, voxel JSON, and the modeling cube are under **Importar o modelar un recurso**. The workflow indicator follows Map → Objects → Play/export. Use **Encuadrar** or F to frame the current selection, or the entire map when nothing is selected; loading a project frames its contents automatically. Ctrl/Cmd+F remains browser search.

For an integrated effects example, open `examples/game-demo.s3d` through **Proyecto**. It includes the animated sprite player, reusable resource, key/door mission, shadow lighting, particles, post-processing, and an HTML world-control panel.

## Maps and assets

Choose **Suelo**, **Pared sólida**, **Sprite seleccionado**, or a saved resource in **Mapa y biblioteca**. Set cell size, elevation, active layer, and color. **Pintar mapa** paints one cell per pointer position; dragging connects cells. **Rectángulo** fills a dragged region (up to 4096 cells); **Borrar** removes cells on the current layer/elevation/grid. Each stroke supports undo/redo. Escape returns to object selection.

Use **Nombre de capa → Crear capa** to add a layer. Select a layer and use **Renombrar** to update its existing cells. Visibility and lock controls protect selection, edits, and painting; changes support undo/redo and project persistence. **Visible en editor** is an authoring aid: a hidden layer still appears in the playable game. Older free-text layer names are discovered when projects load. Narrow windows have **Biblioteca** and **Inspector** buttons; Play uses the full viewport.

Placed objects retain a local support point. Moving, rotating, or scaling an object/group updates its current X/Z cell and elevation; the inspector shows this address without changing its display name. Paint/erase uses the cell containing that support point, with the original grid size and layer. Set **Altura Y** to the displayed elevation when editing a raised piece. A scaled piece still owns one placement cell even when its visual footprint spans several cells. Overlapping placements at the same address are replaced/erased together, and undo restores all of them. Older projects adopt the current pivot and saved elevation when support points are first initialized.

Import sprites/models using the existing library. Select one object or group and choose **Guardar selección como recurso**. Each painted instance has independent geometry, materials, textures, and behavior IDs. Captured resources are snapshots; editing the source does not update existing instances.

Open **Administrar recursos** to browse thumbnails and search by name. Select a card to use it as the map brush. **Renombrar recurso** requires a unique name. **Actualizar desde selección** replaces the selected resource with a snapshot of the currently selected scene object/group, preserving the resource ID and name; only future placements change. **Quitar recurso** removes it from the palette without deleting placed instances. Capture, rename, update, and removal support undo/redo. Thumbnails and resource changes are saved in the project.

Visual actions that reference other objects inside a captured group are remapped to the corresponding objects in each instance. References to objects outside the group stay external. The same remapping applies when duplicating a related selection. IDs embedded in JavaScript source are literal code and are not rewritten; use tags or script logic for reusable behavior.

### Large maps

**Rendimiento → Agrupar dibujo de celdas** is enabled by default and saved with the project. It groups compatible opaque, untextured map meshes into spatial instance batches in both the editor and exported game. Tiles keep independent transforms, colors, behavior, picking, history, and saved data. Animated/textured meshes, custom render callbacks, and mirrored or sheared transforms use ordinary drawing; edits to a batched material or geometry also fall back until batches rebuild.

The performance panel shows actual drawing calls and average frame time. Compare with batching disabled using the same camera; timings depend on scene content and hardware. Collision uses a spatial broad phase with exact mask/height/overlap checks. Dense overlapping triggers can still generate many contacts.

Run `npm run benchmark:engine -- --size 64` for a repeatable CPU benchmark, or add `--project large-map.s3d` to generate a playable 4,350-object stress project. CPU timings exclude GPU drawing; use the browser panel for the complete frame. Generated projects are test artifacts, not required repository assets.

## Game objects and events

Select an object and use **Objeto de juego**. Enable player controls, set speed, and configure behavior. Apply changes with **Aplicar comportamiento**; unapplied inspector edits are previews. The read-only object ID supports references that survive renaming.

### Colliders

Choose no collider, solid, or trigger. X/Z dimensions and offsets are local to the object and respect parent transforms. **Altura** extends upward from **Base Y** relative to the object's origin. **Ajustar al visual** fits the local geometry, accounting for sprite-frame resizing; flat sprites receive a small ground footprint. Apply the fitted values to save them.

The selected collider previews in green. The **Colisiones** toolbar button shows all colliders in edit or play mode: blue solids and gold triggers. Overlays are editor helpers and are excluded from project visuals and game export.

By default, collision uses XZ regardless of elevation, preserving older projects. Enable **Separar colisiones por altura** to require vertical volume overlap whenever either collider uses that option. There is no gravity or platform support. Under **Filtrar colisiones**, choose a group and the groups it should collide with; both objects' masks must agree. For example, assign a player to **Jugador** and a collectible to **Recogibles**, with matching mask checkboxes. These groups are independent of event tags and map layers.

Players that spawn inside solids are separated in the runtime copy. An unresolved overlap reports the object name and stops its attempted movement; adjust the authored spawn/collider. Movement slides along axis-aligned world bounds, including the bounding boxes of rotated colliders.

### Visual events

Add a rule for start, interaction, trigger enter/stay/exit, a named signal, or animation completion. Filter by the other object's tag, add numeric variable conditions, and optionally require **Una vez por partida** or a cooldown. All conditions must pass; unset numeric variables read as zero. Cooldowns use simulation time and freeze while paused.

Each rule runs its actions in order. Add, remove, or move actions with the arrow buttons. Actions can display a message, assign/add a numeric variable, emit a signal, hide/show, enable/disable, or control animation. Messages support substitutions such as `Llaves: {keys}`. Object actions target this object, the other object/signal sender, or an object selected by name/ID; use **Buscar destino** to narrow the picker. A missing target reports the rule/action context once and later actions continue.

Effects also have visual actions: **Encender/Apagar luz**, **Iniciar/Detener emisión**, **Ráfaga de partículas**, **Cambiar hora**, and **Iniciar/Detener ciclo día/noche**. Light/emitter actions support the same object targets. Enable the target's particle component before Play; emission actions control that existing pool. Stopping emission lets existing particles finish their lifetimes. Hour actions accept 0–24 and burst actions accept a nonnegative integer.

**Ejemplo: coleccionable** adds a player-tagged, one-shot trigger that adds a key, hides/disables itself, and displays the counter. **Ejemplo: puerta con llave** adds an interaction rule requiring `keys ≥ 1`, consumes a key, and disables the door. These presets configure collider mode; fit dimensions and apply the behavior afterward. The built-in demo uses this workflow.

Signal rules match a signal name. Animation-completion rules can optionally filter a clip name. Interaction targets the nearest active object with an interaction handler. Hidden objects retain behavior and colliders; disabled objects and their descendants stop simulating and rendering. Showing a disabled object changes its pending visibility but does not enable it. Enabling an initially inactive object initializes its script/start events once; later reactivation resumes its state. Stop resets variables, cooldowns, one-shot history, visibility, and runtime transforms.

## Sprite animation clips

Open **Animaciones de sprite** and set the sheet's columns/rows. Each named clip has its own FPS, comma-separated frame indices (starting at zero), and loop setting. Frames run left-to-right, top-to-bottom. Names use letters, numbers, underscores, and hyphens. Choose a default clip and use **Vista previa** to preview any clip, including unapplied edits, without changing scene textures. **Aplicar comportamiento** saves all clips.

For a full sheet imported as one sprite, **Ajustar geometría al tamaño de un cuadro** divides its runtime geometry width/height by columns/rows. The authored geometry remains intact. Leave this off for already-sized geometry or 3D assets.

Enable **Elegir idle / walk al mover** for automatic playback based on actual movement. Names such as `walk-north` and `idle-north` choose a direction; the engine falls back to `walk`/`idle`, then the default clip. A blocked player uses idle. Manual clip playback overrides movement animation until explicitly resumed. Visual events can **Reproducir clip**, **Detener animación**, or resume **Animación por movimiento**. **Al terminar animación** fires once for a non-looping clip.

Try `examples/player-sheet.png`: 4 columns, 2 rows, `idle` = frame `0`, `walk` = frames `1,2,3`, 8 FPS. Capture the configured object as a resource to reuse the clips in independently painted instances.

## JavaScript API

The object's **JavaScript** section offers lifecycle, IJKL movement, interaction, and signal templates. **Usar plantilla** replaces the editor text; **Restaurar texto anterior** restores it before applying. Indent/unindent buttons and Ctrl/Cmd+] / Ctrl/Cmd+[ work on selected lines; Tab retains normal focus navigation. **Validar sintaxis** compiles without running code. Applying rejects invalid syntax. Runtime failures identify the object/hook and source line when the browser provides one, including non-Error throws.

Scripts are factory bodies that return lifecycle hooks:

```js
return {
  start() { api.message('Ready'); },
  update(dt) {
    if (api.input.down('q')) api.move(-30 * dt, 0);
  },
  onTriggerEnter(other) {
    if (other?.userData.game?.tag === 'player') api.emit('goal', { score: 1 });
  },
  onEvent(name, data) {
    if (name === 'goal') api.variables.score = data.score;
  },
  stop() {},
};
```

Other hooks: `onTriggerStay(other)`, `onTriggerExit(other)`, `onInteract(other)`, `onAnimationEnd(clipName)`, and `onStart()`. `start()` initializes scripts before visual start events; `onStart()` receives that event. `update(dt)` runs at 60 Hz. Movement uses world X/Z distances and solid collision checks. `api.object` is the runtime Three.js object; direct transform edits bypass collision checks. `api.input.pressed(key)` lasts one simulation tick. `api.find(id)` returns an object by its **ID de objeto** (persisted after applying behavior); `api.findTag(tag)` returns matching objects.

`api.playAnimation('attack', true)` plays/restarts a named clip. Pass `false` to avoid restarting an already playing clip. `api.stopAnimation()` freezes playback, and `api.resumeMovementAnimation()` restores automatic idle/walk switching. The old `api.playAnimation(restart)` signature still works.

`api.setEnabled(false)` disables the current object. Pass a stable ID as the second argument to change another object. Enabling an initially inactive parent also initializes its active descendants. Start signals can reach objects later in the scene's order. Script `stop()` hooks still run for initialized objects disabled during gameplay.

Script errors appear with object/hook context; a failing hook is disabled for that play session. Signals are queued with a bounded event budget. Scripts run as local JavaScript when Play starts and have browser privileges; this is not a sandbox. Stop discards engine-managed runtime state; arbitrary external script effects cannot be rolled back.

## Lighting, atmosphere, and effects

Open **Mundo y efectos** in the toolbar. Enable the game environment, set sky/ambient/sun colors and intensities, then choose **Aplicar mundo y efectos**. Day, sunset, and night presets fill the form; apply to save them. Original projects keep their previous lighting until the environment is enabled. World changes support undo/redo and project persistence.

**Hora inicial** uses a 24-hour clock. With **Ciclo día / noche** enabled, **Duración del día** specifies real seconds for a full day. Otherwise the chosen hour stays fixed. **Previsualizar ciclo** advances the editor's temporary clock without changing the saved initial hour. Play starts from the saved hour; pause freezes the clock, and restart resets it. Sun position, intensity, sky color, and ambient light follow the cycle.

Enable **Sombras** and choose resolution/range. Range covers the area around the game camera; larger areas reduce shadow detail. The object inspector's **Visibilidad y sombras** controls initial game visibility and cast/receive flags. Sprite textures use alpha-cutout shadows. Transparent pixels do not cast a solid rectangle. Batched map meshes retain the same shadow policy.

**Agregar luz puntual** creates a selectable marker near the selection or view center. In **Luz del objeto**, choose point, spot, or directional light and adjust color, intensity, range, local offset/direction, and optional shadows. Point/spot intensities use distance attenuation and usually need values in the thousands at this project's scale; directional values are typically 1–3. Spot angle and penumbra control its cone. Helpers follow object transforms. The marker is visible while editing but hidden at game start; an invisible mesh can still emit light. Disabling the object or a parent suppresses its light.

**Agregar emisor** creates an editable particle marker. Open **Partículas**, choose Chispas or Humo, then adjust capacity, rate, lifetime, local emission area/direction, speed, gravity, size, color, brightness, opacity, and blending. Apply the behavior and use Play to preview. Particles travel in world space after spawning; disabling a parent hides/freezes its emitter. Pause freezes particles; Stop releases their pools. Orthographic particle size is measured in screen pixels at effect resolution; perspective views also attenuate size with distance.

**Postprocesamiento** controls exposure, bloom intensity/threshold/radius, vignette, and effect resolution. Bright particles and emissive/strongly lit surfaces can produce bloom. Effects apply to the 3D viewport, leaving HTML text and controls crisp. Disabling post-processing releases its render targets; Play and export use the same pipeline.

Budgets bound rendering work: 32 active object lights, four shadow lights including the sun, 64 particle emitters, 20,000 total particles, and 2,048 particles per emitter. Sun maps support up to 2048²; object point shadows are capped at 512 per cube face and other object shadows at 1024². Excess lights/emitters report a diagnostic and are skipped in scene order. Intermediate post-processing buffers are capped at two million pixels; lower effect resolution improves speed.

### World API

Both object scripts and HTML UI scripts share `api.world`:

```js
api.world.setTime(18);
api.world.setCycleRunning(false); // Freeze at the selected hour.
api.world.setEnvironment({ enabled: true, ambientIntensity: 0.5 });
api.world.setPostProcessing({ enabled: true, bloom: 1.2 });
const lamp = api.findTag('lamp')[0];
api.world.setLight(lamp.userData.game.id, { enabled: true, color: '#ff9944' });
const emitter = api.findTag('fx')[0];
api.world.emitParticles(emitter.userData.game.id, 24);
api.world.setEmitting(emitter.userData.game.id, false);
```

Read `api.world.hour` and `cycling` for a HUD. Patches validate the same ranges as the inspector and only affect the runtime copy. Unspecified clock/cycle values survive environment patches. Object scripts can use `api.emitParticles(24)` and `api.setEmitting(false)` for their own emitter. HTML controls can still change world settings while paused; automatic clock and particle advancement remain frozen.

## HTML game interfaces

Choose **Interfaz HTML** in the toolbar to open the global **Interfaz del juego** editor. Enable it, write HTML, CSS and JavaScript, then choose **Aplicar interfaz**. **Usar interfaz de ejemplo** fills a scoreboard with working score/signal and pause buttons; apply it and press **Jugar**. Source is saved with the project and embedded in the exported HTML. Put JavaScript in its dedicated field; `<script>` tags assigned through the HTML template are not executed automatically.

UI scripts use the same factory/hook style. `api.ui.root` is the interface container; `query(selector)` returns a real DOM element, `text(selector, value)` updates text, and `on(selector, event, handler)` registers a managed DOM listener. For example:

```js
return {
  start() {
    api.ui.on('#reset', 'click', () => {
      api.variables.score = 0;
      api.emit('scoreReset');
    });
  },
  update(dt) { api.ui.text('#score', api.variables.score ?? 0); },
  onEvent(name, data) {},
  stop() {},
};
```

The bridge includes `api.variables`, `emit`, `message`, `find(id)`, `findTag(tag)`, `setEnabled(bool, id)`, `pause(bool)` and the read-only `paused` property. These are the same runtime variables, objects, and signal queue used by visual events and object scripts. Object scripts can also access the mounted interface through `api.ui` and pause via `api.pause`. UI starts before object start hooks; startup signals still reach those hooks.

UI `update(dt)` runs once per rendered frame and receives `0` while paused, keeping menus interactive without advancing physics. Signals remain usable while paused and share the recursion limits. Stop/restart removes the interface and managed listeners; UI failures report hook/event context. Styling is scoped in a shadow root and clipped to the game viewport. This isolates presentation, not JavaScript privileges.

Tab reaches HTML controls from the canvas; Space and Enter activate buttons. Native input fields retain their keyboard behavior. Click the game canvas to return to WASD controls. Escape stops editor Play and pauses/resumes an exported game. Use embedded data URLs for UI images when an independent offline HTML file is required; arbitrary external URLs in custom HTML/CSS are not automatically packaged.

## Projects and delivery

Save `.s3d` projects through **Proyecto**; **Descargar copia .s3d** downloads directly without a native save dialog. Autosave includes map cells, captured resources, component settings, and scripts. Drafts use IndexedDB so large maps can exceed localStorage's quota; small projects retain a localStorage fallback. Existing drafts migrate automatically. **Borrador guardado en este navegador** confirms a completed write. Storage failures are shown in the palette; download a copy if storage is unavailable. Drafts remain specific to this browser/profile and are not cloud backups.

Project version 4 saves actual geometry buffers, material textures, editable voxel metadata, nested groups, and exact local matrices. Saving while multiple objects are selected preserves their authored parents and transforms. Deleting a group removes its descendants from the project and supports undo. Render batches are temporary helpers and never enter saved scenes or exported visual data; the game recreates its own batches.

Opening a project validates the document and prepares assets and objects before replacing the current scene. **Cancelar carga** or Escape cancels preparation; failed/cancelled loads preserve the current scene, resource library, and undo history. Errors identify the rejected object/resource. If the autosaved draft cannot be recovered, it is kept until an intentional edit or successful project replacement.

Project versions 1–3 migrate on load; future versions and malformed references are rejected. Engine settings version 2 includes layers. Older projects load with default game settings and migrated single animation clips. Original single-action event rules are converted when edited or played; old collider settings retain XZ-only behavior. Saving writes version 4, so keep an older copy when compatibility with an older editor matters.

**Exportar juego** downloads `spriteforge-game.html`, containing the player runtime, scene, and embedded material textures. Open the file in a WebGL browser and click **Jugar**. Restart rebuilds the runtime; Escape pauses. The generated game has no editor or CDN dependency. Static meshes and sprite-sheet animations are supported; skeletal/model animation and multi-map transitions remain planned work.
