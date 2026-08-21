# SpriteForge3D

Editor y pipeline orientado a flujo "2D -> pixel-volume 3D" desde assets PNG. Puede conservar un frente pixel-perfect, crear relieve volumetrico y ensamblar objetos completos a partir de piezas sin imponer una estetica low-poly generica.

## Caracteristicas

- Carga de assets PNG y colocacion en escena.
- Importacion de voxels JSON dispersos (`voxel-binary-sparse-v1`).
- Creacion de primitivas (plane, cube, cylinder).
- Edicion de vertices, transformaciones, duplicado y borrado.
- Exportacion a GLTF, OBJ y Godot MeshLibrary.
- Export de UV Layout real con xatlas y aplicacion de texturas custom.
- Guardado/carga de proyecto `.s3d`.
- CLI automatizable con salida JSON para voxelizado, auto-relief, ensamblaje y validacion visual.
- Atlas de paleta sRGB y UV0 robustos para la cadena FBX/Unreal.

## Stack

- `three`
- `vite`
- `xatlas-three`
- `xatlasjs`

## Requisitos

- Node.js 18+ (recomendado)
- npm

## Instalacion

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Automatizacion para agentes y CI

```bash
npm run spriteforge -- voxelize --input C:/proyecto/assets/layer3/arbol.png --relief auto --max-depth-px 64
npm run spriteforge -- assemble --recipe C:/proyecto/assets/recipes/aserradero.json
npm run spriteforge -- validate --source arbol.png --render arbol_validation.png --max-bbox-error 1
```

La CLI refleja automaticamente `assets/...` en `models/...`, evita sobrescrituras salvo `--force` y emite una sola linea JSON. Cada conversion genera GLB, manifiesto `.spriteforge.json` y un atlas `_palette.png`. `assemble` acepta partes con `source` PNG o generadores `pixel-box`/`pixel-disc`, con posicion, rotacion y escala declaradas en centimetros.

Los modelos conservan `COLOR_0` para autoria y usan UV0 sobre un atlas de paleta como contrato runtime. Esto evita que diferencias entre importadores GLB/FBX eliminen la paleta del asset.

## Importar voxels JSON

Usa **Project > Import Voxels** o arrastra un `.json` al viewport. El formato declara
las dimensiones, el orden de los ejes y las coordenadas ocupadas:

```json
{
  "format": "voxel-binary-sparse-v1",
  "name": "farol_3d",
  "dimensions": { "y": 384, "x": 96, "z": 96 },
  "order": ["y", "x", "z"],
  "filledVoxels": [[0, 48, 48], [1, 48, 48]]
}
```

El importador respeta `order`, centra el modelo en X/Z y apoya Y=0 sobre la grilla.

## Estructura principal

- `src/main.js`: wiring principal de UI, escena y acciones.
- `src/export/UVExporter.js`: export UV (template y real unwrap).
- `src/editor/`: herramientas de edicion.
- `src/ui/`: paneles y componentes de interfaz.
- `src/automation/`: generacion pixel-volume y ensamblaje data-driven.
- `scripts/spriteforge-cli.mjs`: interfaz terminal/machine-readable.
- `test/`: pruebas de escala, geometria, relieve, paleta y recetas.

## Licencia

Proyecto privado. Ajustar licencia segun publicacion.
