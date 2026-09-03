import { GLTFExportManager } from './GLTFExportManager.js';

/**
 * UnrealExportManager — Exports a self-contained GLB for Unreal's Interchange
 * pipeline. GLB keeps the scene, UVs and embedded textures in one file, which
 * is preferable for static voxel meshes. SpriteForge uses centimetres as its
 * modeling unit while glTF uses metres, so the export clone is scaled by 0.01.
 */
export class UnrealExportManager {
  static async exportStaticMesh(exportGroup, defaultFilename = 'spriteforge-unreal') {
    return GLTFExportManager.export(exportGroup, defaultFilename, { unitScale: 0.01 });
  }
}
