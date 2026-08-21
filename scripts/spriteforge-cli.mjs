#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { PNG } from 'pngjs';
import {
  buildPaletteTexture,
  buildSpriteVoxelMesh,
  encodeGlb,
} from '../src/automation/SpriteVoxelPipeline.js';
import { buildAssemblyMesh } from '../src/automation/AssemblyPipeline.js';

const HELP = `SpriteForge3D automation CLI

Usage:
  spriteforge voxelize --input <sprite.png> [options]
  spriteforge assemble --recipe <assembly.json> [options]
  spriteforge validate --source <sprite.png> --render <render.png> [options]

Options:
  --output <model.glb>         Explicit GLB output. By default assets/... mirrors to models/...
  --manifest <metadata.json>  Explicit manifest output (default: <model>.spriteforge.json)
  --palette <palette.png>     Explicit runtime palette output (default: <model>_palette.png)
  --ppcm <number>             Source pixels per centimetre (default: 0.60)
  --depth-px <number>         Extrusion depth in source pixels (default: 3)
  --relief <flat|auto>        Flat extrusion or automatic volumetric relief (default: flat)
  --max-depth-px <integer>    Maximum automatic relief depth (default: 64)
  --alpha-threshold <1..255>  Pixel occupancy threshold (default: 1)
  --name <string>             glTF mesh and node name
  --unlit                     Preserve raw source colours without light response
  --dry-run                   Resolve and validate paths without writing files
  --force                     Replace existing generated outputs
  --json                      Emit only machine-readable JSON (default for successful runs)
  --max-bbox-error <pixels>   Validation tolerance per alpha-bound edge (default: 1)
  --max-color-mae <0..255>    Validation mean RGB error (default: 4)
  --max-alpha-mismatch <0..1> Validation occupancy mismatch ratio (default: 0.01)
  --help                      Show this help
`;

function parseArguments(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!command || command === '--help' || command === '-h') return { help: true };
  if (!['voxelize', 'assemble', 'validate'].includes(command)) throw new Error(`unsupported command: ${command}`);

  const result = { command };
  const flags = new Set(['unlit', 'dry-run', 'force', 'json']);
  while (args.length) {
    const raw = args.shift();
    if (!raw.startsWith('--')) throw new Error(`unexpected argument: ${raw}`);
    const key = raw.slice(2);
    if (flags.has(key)) {
      result[key] = true;
      continue;
    }
    if (!args.length) throw new Error(`missing value for --${key}`);
    result[key] = args.shift();
  }
  return result;
}

function alphaBounds(image, threshold) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] < threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error('validation image has no visible pixels');
  return { minX, minY, maxX, maxY };
}

async function validateRender(options) {
  if (!options.source || !options.render) throw new Error('validate requires --source and --render');
  const sourcePath = path.resolve(options.source);
  const renderPath = path.resolve(options.render);
  const source = PNG.sync.read(await fs.readFile(sourcePath));
  const render = PNG.sync.read(await fs.readFile(renderPath));
  if (source.width !== render.width || source.height !== render.height) {
    throw new Error(`resolution mismatch: source ${source.width}x${source.height}, render ${render.width}x${render.height}`);
  }

  const alphaThreshold = parseFiniteNumber(options['alpha-threshold'], 1, '--alpha-threshold');
  const sourceBounds = alphaBounds(source, alphaThreshold);
  const renderBounds = alphaBounds(render, alphaThreshold);
  const bboxErrors = {
    left: Math.abs(sourceBounds.minX - renderBounds.minX),
    top: Math.abs(sourceBounds.minY - renderBounds.minY),
    right: Math.abs(sourceBounds.maxX - renderBounds.maxX),
    bottom: Math.abs(sourceBounds.maxY - renderBounds.maxY),
  };

  let occupancyMismatches = 0;
  let sharedVisiblePixels = 0;
  let colourAbsoluteError = 0;
  for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
    const offset = pixel * 4;
    const sourceVisible = source.data[offset + 3] >= alphaThreshold;
    const renderVisible = render.data[offset + 3] >= alphaThreshold;
    if (sourceVisible !== renderVisible) occupancyMismatches += 1;
    if (!sourceVisible || !renderVisible) continue;
    sharedVisiblePixels += 1;
    colourAbsoluteError += Math.abs(source.data[offset] - render.data[offset]);
    colourAbsoluteError += Math.abs(source.data[offset + 1] - render.data[offset + 1]);
    colourAbsoluteError += Math.abs(source.data[offset + 2] - render.data[offset + 2]);
  }

  const maxBboxError = parseFiniteNumber(options['max-bbox-error'], 1, '--max-bbox-error');
  const maxColourMae = parseFiniteNumber(options['max-color-mae'], 4, '--max-color-mae');
  const maxAlphaMismatch = parseFiniteNumber(options['max-alpha-mismatch'], 0.01, '--max-alpha-mismatch');
  const colourMae = sharedVisiblePixels ? colourAbsoluteError / (sharedVisiblePixels * 3) : 255;
  const alphaMismatchRatio = occupancyMismatches / (source.width * source.height);
  const passed = Math.max(...Object.values(bboxErrors)) <= maxBboxError
    && colourMae <= maxColourMae
    && alphaMismatchRatio <= maxAlphaMismatch;
  const result = {
    ok: passed,
    command: 'validate',
    source: sourcePath,
    render: renderPath,
    resolution: [source.width, source.height],
    sourceBounds,
    renderBounds,
    bboxErrors,
    colourMae,
    alphaMismatchRatio,
    thresholds: { maxBboxError, maxColourMae, maxAlphaMismatch },
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!passed) process.exitCode = 2;
}

function defaultOutputPath(inputPath) {
  const parsed = path.parse(inputPath);
  const segments = path.resolve(inputPath).split(path.sep);
  const assetsIndex = segments.findIndex((segment) => segment.toLowerCase() === 'assets');
  if (assetsIndex < 0) {
    return path.join(parsed.dir, `${parsed.name}.glb`);
  }

  return path.join(
    ...segments.slice(0, assetsIndex),
    'models',
    ...segments.slice(assetsIndex + 1, -1),
    `${parsed.name}.glb`,
  );
}

function defaultPalettePath(outputPath) {
  return outputPath.replace(/\.glb$/i, '_palette.png');
}

function encodePalettePng(palette) {
  return PNG.sync.write({
    width: palette.width,
    height: palette.height,
    data: Buffer.from(palette.data),
  }, { colorType: 6, inputColorType: 6, bitDepth: 8 });
}

function parseFiniteNumber(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`);
  return parsed;
}

async function ensureWritable(outputs, force) {
  if (force) return;
  for (const output of outputs) {
    try {
      await fs.access(output);
      throw new Error(`refusing to overwrite existing output: ${output}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(HELP);
      return;
    }
    if (options.command === 'validate') {
      await validateRender(options);
      return;
    }
    if (options.command === 'assemble') {
      if (!options.recipe) throw new Error('assemble requires --recipe');
      const recipePath = path.resolve(options.recipe);
      const recipeDirectory = path.dirname(recipePath);
      const recipe = JSON.parse(await fs.readFile(recipePath, 'utf8'));
      recipe.parts = recipe.parts.map((part) => ({
        ...part,
        source: part.source ? path.resolve(recipeDirectory, part.source) : undefined,
      }));
      const outputPath = path.resolve(options.output || defaultOutputPath(recipePath));
      const manifestPath = path.resolve(
        options.manifest || outputPath.replace(/\.glb$/i, '.spriteforge.json'),
      );
      const palettePath = path.resolve(options.palette || defaultPalettePath(outputPath));
      await ensureWritable([outputPath, manifestPath, palettePath], Boolean(options.force));
      if (options['dry-run']) {
        process.stdout.write(`${JSON.stringify({
          ok: true, command: 'assemble', recipe: recipePath, output: outputPath,
          manifest: manifestPath, palette: palettePath, dryRun: true,
        })}\n`);
        return;
      }
      const mesh = await buildAssemblyMesh(recipe, async (source) => PNG.sync.read(await fs.readFile(source)));
      const palette = buildPaletteTexture(mesh);
      const glb = encodeGlb(mesh, { name: recipe.name, unlit: Boolean(options.unlit) });
      const manifest = {
        ...mesh.metadata,
        generator: 'SpriteForge3D CLI',
        generatedAt: new Date().toISOString(),
        recipe: recipePath,
        output: outputPath,
        palette: palettePath,
      };
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.mkdir(path.dirname(manifestPath), { recursive: true });
      await fs.writeFile(outputPath, glb);
      await fs.writeFile(palettePath, encodePalettePng(palette));
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      process.stdout.write(`${JSON.stringify({
        ok: true,
        command: 'assemble',
        recipe: recipePath,
        output: outputPath,
        manifest: manifestPath,
        palette: palettePath,
        paletteColours: palette.colours,
        bytes: glb.length,
        geometry: mesh.metadata.geometry,
        dimensionsCentimetres: mesh.metadata.dimensionsCentimetres,
      })}\n`);
      return;
    }
    if (!options.input) throw new Error('--input is required');

    const inputPath = path.resolve(options.input);
    const outputPath = path.resolve(options.output || defaultOutputPath(inputPath));
    const manifestPath = path.resolve(
      options.manifest || outputPath.replace(/\.glb$/i, '.spriteforge.json'),
    );
    const palettePath = path.resolve(options.palette || defaultPalettePath(outputPath));
    if (path.extname(inputPath).toLowerCase() !== '.png') throw new Error('input must be a PNG image');
    if (path.extname(outputPath).toLowerCase() !== '.glb') throw new Error('output must use the .glb extension');

    await fs.access(inputPath);
    await ensureWritable([outputPath, manifestPath, palettePath], Boolean(options.force));

    const baseResult = {
      ok: true,
      command: 'voxelize',
      input: inputPath,
      output: outputPath,
      manifest: manifestPath,
      palette: palettePath,
      dryRun: Boolean(options['dry-run']),
    };
    if (options['dry-run']) {
      process.stdout.write(`${JSON.stringify(baseResult)}\n`);
      return;
    }

    const decoded = PNG.sync.read(await fs.readFile(inputPath));
    const reliefMode = options.relief || 'flat';
    if (!['flat', 'auto'].includes(reliefMode)) throw new Error('--relief must be flat or auto');
    const mesh = buildSpriteVoxelMesh(decoded, {
      pixelsPerCentimetre: parseFiniteNumber(options.ppcm, 0.6, '--ppcm'),
      depthPixels: parseFiniteNumber(options['depth-px'], 3, '--depth-px'),
      reliefMode,
      maxDepthPixels: parseFiniteNumber(options['max-depth-px'], 64, '--max-depth-px'),
      alphaThreshold: parseFiniteNumber(options['alpha-threshold'], 1, '--alpha-threshold'),
    });
    const palette = buildPaletteTexture(mesh);
    const name = options.name || path.parse(inputPath).name;
    const glb = encodeGlb(mesh, { name, unlit: Boolean(options.unlit) });
    const manifest = {
      ...mesh.metadata,
      generator: 'SpriteForge3D CLI',
      generatedAt: new Date().toISOString(),
      source: inputPath,
      output: outputPath,
      palette: palettePath,
      material: options.unlit ? 'unlit-palette-texture' : 'pbr-palette-texture',
    };

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(outputPath, glb);
    await fs.writeFile(palettePath, encodePalettePng(palette));
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    process.stdout.write(`${JSON.stringify({
      ...baseResult,
      bytes: glb.length,
      geometry: mesh.metadata.geometry,
      paletteColours: palette.colours,
      dimensionsCentimetres: mesh.metadata.dimensionsCentimetres,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}

await main();
