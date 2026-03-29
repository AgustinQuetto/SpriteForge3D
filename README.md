# SpriteForge3D

Editor 3D orientado a flujo "2D -> 3D" para crear modelos low-poly desde assets PNG.

## Caracteristicas

- Carga de assets PNG y colocacion en escena.
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

## Estructura principal

- `src/main.js`: wiring principal de UI, escena y acciones.
- `src/export/UVExporter.js`: export UV (template y real unwrap).
- `src/editor/`: herramientas de edicion.
- `src/ui/`: paneles y componentes de interfaz.

## Licencia

Proyecto privado. Ajustar licencia segun publicacion.
