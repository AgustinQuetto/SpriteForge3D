# SpriteForge3D

Editor 3D en el navegador y pipeline automatizable para convertir sprites 2D en modelos con volumen. Está orientado a pixel art: conserva el frente pixel-perfect, permite editar relieve y vóxeles, organizar piezas y exportar modelos listos para motores de juego.

## Características

- Importación de sprites PNG mediante selector, drag & drop o pegado desde el portapapeles.
- Importación de modelos OBJ, GLTF/GLB, STL, PLY, FBX, DAE, DWG y DXF.
- Importación de vóxeles JSON dispersos con formato `voxel-binary-sparse-v1`.
- Creación de planos, cubos, cilindros, líneas, rectángulos y geometría mediante Push/Pull.
- Transformaciones, snap a la grilla o a otros assets, edición de vértices, duplicado y borrado.
- Conversión de sprites a vóxeles, pincel para agregar o borrar píxeles y edición de relieve por selección o arrastre directo.
- Selección de vóxeles por píxel, área o varita; extracción, sustracción, separación en piezas y borrado independiente.
- Heightmaps desde la luminancia del sprite o desde una imagen en escala de grises.
- Árbol de escena con selección múltiple, visibilidad, borrado directo y agrupación mediante drag & drop.
- Paleta radial de herramientas que se abre en la posición del cursor.
- Exportación de la escena completa, la selección o un grupo a GLTF/GLB, OBJ, FBX, Unreal Engine y Godot MeshLibrary.
- Generación de UV Layout real con xatlas y aplicación de texturas personalizadas.
- Proyectos `.s3d` con guardado, apertura, nuevo proyecto y recuperación automática del último borrador.
- CLI con salida JSON para voxelizado, auto-relief, ensamblaje y validación visual.

## Stack

- [Three.js](https://threejs.org/)
- [Vite](https://vite.dev/)
- [xatlas-three](https://www.npmjs.com/package/xatlas-three)
- [xatlasjs](https://www.npmjs.com/package/xatlasjs)
- [libredwg-web](https://www.npmjs.com/package/@mlightcad/libredwg-web) para DWG/DXF

## Requisitos

- Node.js 18 o superior.
- npm.
- Un navegador moderno con WebGL. La File System Access API es opcional; cuando no está disponible se utiliza descarga tradicional.

## Instalación y desarrollo

```bash
npm install
npm run dev
```

Vite inicia el editor en `http://localhost:3000`.

```bash
npm test
npm run build
npm run preview
```

## Flujo básico del editor

1. Importá un PNG, un JSON voxel o un modelo 3D. Un único sprite se coloca automáticamente en el centro de la escena.
2. Ajustá posición, rotación, escala, grosor y textura desde el panel de propiedades.
3. Para trabajar por píxel, convertí el sprite en vóxeles y usá **Pincel** o **Relieve**.
4. Organizá las piezas desde el árbol de objetos y elegí el alcance de exportación mediante la selección.
5. Exportá al formato de destino o guardá el trabajo como proyecto `.s3d`.

### Proyectos

El menú **Proyecto** contiene:

- **Nuevo proyecto:** limpia escena, referencias, assets, selección, herramientas activas, historial y borrador automático.
- **Guardar proyecto:** genera un archivo `.s3d` con objetos, grupos, recursos y texturas embebidas.
- **Abrir proyecto:** restaura un archivo `.s3d`.
- **Importar vóxeles:** carga un archivo JSON voxel.
- **Importar modelo 3D / CAD:** carga uno o varios modelos compatibles.

Los cambios se guardan además como borrador local. Al volver a abrir el editor, SpriteForge3D recupera automáticamente el último proyecto con contenido.

### Agrupación con drag & drop

El panel **Objetos** funciona también como organizador:

- Arrastrá una pieza sobre otra pieza sin agrupar para crear un grupo.
- Arrastrá una o varias piezas seleccionadas sobre una carpeta para moverlas al grupo.
- Arrastrá una pieza al fondo del árbol para sacarla del grupo.
- Usá el icono de papelera para borrar una pieza o un grupo directamente.

Todas estas operaciones participan del historial de deshacer y rehacer.

### Selección y edición voxel

En modo **Relieve** podés seleccionar vóxeles con varita, píxel o área. Cuando existe una selección, el árbol muestra una subfila **Vóxeles seleccionados** con su contador y una acción de borrado.

- **Extraer / Sustraer:** modifica la profundidad de la selección.
- **Separar selección como pieza:** mueve los vóxeles a un objeto independiente.
- **Supr / Backspace:** en modo Relieve borra únicamente los vóxeles seleccionados.
- La papelera de la fila principal siempre elimina la pieza completa.

### Paleta rápida

La paleta radial reúne Mover, Rotar, Escalar, Pincel, Relieve, Cortar, Rectángulo y Línea.

- Presioná `Q` para abrirla en la posición actual del cursor.
- Hacé clic derecho sobre un área vacía del viewport.
- Usá `Shift + clic derecho` para abrirla incluso cuando el cursor está sobre un objeto.
- También puede abrirse desde el botón circular de la esquina inferior derecha.

### Atajos principales

| Acción | Atajo |
| --- | --- |
| Abrir paleta radial | `Q` |
| Rotar / Escalar | `E` / `R` |
| Línea / Rectángulo | `L` / `B` |
| Push/Pull / Cortar | `P` / `C` |
| Relieve / Pincel voxel | `M` / `V` |
| Ajustar a la grilla | `G` |
| Agrupar / Desagrupar | `Ctrl/Cmd + G` / `Ctrl/Cmd + Shift + G` |
| Duplicar | `Ctrl/Cmd + D` |
| Deshacer / Rehacer | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` |
| Borrar selección | `Supr` o `Backspace` |
| Mover cámara | `W`, `A`, `S`, `D` |
| Salir de la herramienta activa | `Esc` |

## Exportación

- **GLTF/GLB:** formato general con geometría, UV y texturas.
- **OBJ:** compatibilidad con herramientas DCC.
- **FBX:** conserva jerarquía, transformaciones, normales, UV y materiales. Exporta las texturas PNG auxiliares y sidecars `.meta` configurados para pixel art en Unity: Point, sin mipmaps, sin compresión y en sRGB.
- **Unreal Engine:** genera un GLB autocontenido y convierte las unidades de centímetros del editor a metros de glTF.
- **Godot MeshLibrary:** genera los recursos necesarios para trabajar con GridMap.

El alcance se determina automáticamente: si hay una selección se exportan esos objetos o el grupo seleccionado; de lo contrario se exporta la escena completa.

## Automatización para agentes y CI

```bash
npm run spriteforge -- voxelize --input C:/proyecto/assets/layer3/arbol.png --relief auto --max-depth-px 64
npm run spriteforge -- assemble --recipe C:/proyecto/assets/recipes/aserradero.json
npm run spriteforge -- validate --source arbol.png --render arbol_validation.png --max-bbox-error 1
```

La CLI refleja automáticamente `assets/...` en `models/...`, evita sobrescrituras salvo que se use `--force` y emite una única línea JSON. Cada conversión genera un GLB, un manifiesto `.spriteforge.json` y un atlas `_palette.png`.

`assemble` acepta partes con una imagen `source` o con los generadores `pixel-box` y `pixel-disc`. La posición, rotación y escala se expresan en centímetros. Los modelos conservan `COLOR_0` para autoría y usan UV0 sobre un atlas de paleta como contrato de runtime.

## Formato de vóxeles JSON

Usá **Proyecto > Importar vóxeles** o arrastrá un `.json` al viewport:

```json
{
  "format": "voxel-binary-sparse-v1",
  "name": "farol_3d",
  "dimensions": { "y": 384, "x": 96, "z": 96 },
  "order": ["y", "x", "z"],
  "filledVoxels": [[0, 48, 48], [1, 48, 48]]
}
```

El importador valida las dimensiones y coordenadas, respeta `order`, centra el modelo en X/Z y apoya su base sobre Y=0.

## Estructura principal

- `src/main.js`: coordinación de la interfaz, escena, historial, persistencia y acciones.
- `src/core/SceneManager.js`: escena Three.js, cámaras, selección, transformaciones, snap y grupos.
- `src/editor/`: herramientas de dibujo, corte, edición de vértices, pincel y relieve voxel.
- `src/import/`: importadores voxel y de modelos 3D/CAD.
- `src/export/`: exportadores GLTF, OBJ, FBX, Unreal, Godot y UV.
- `src/ui/`: biblioteca de assets, árbol de escena y panel de propiedades.
- `src/automation/`: generación pixel-volume y ensamblaje data-driven.
- `scripts/spriteforge-cli.mjs`: interfaz de terminal machine-readable.
- `test/`: pruebas de geometría, exportación, escala, relieve, selección voxel, paleta y recetas.

## Licencia

Proyecto privado. Definir una licencia antes de su publicación.
