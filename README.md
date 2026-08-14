# SpriteForge3D

Editor 3D orientado a flujo "2D -> 3D" para crear modelos low-poly desde assets PNG.

## Caracteristicas

- Carga de assets PNG y colocacion en escena.
- Importacion de voxels JSON dispersos (`voxel-binary-sparse-v1`).
- Creacion de primitivas (plane, cube, cylinder).
- Edicion de vertices, transformaciones, duplicado y borrado.
- Exportacion a GLTF, OBJ y Godot MeshLibrary.
- Export de UV Layout real con xatlas y aplicacion de texturas custom.
- Guardado/carga de proyecto `.s3d`.

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

## Licencia

Proyecto privado. Ajustar licencia segun publicacion.
