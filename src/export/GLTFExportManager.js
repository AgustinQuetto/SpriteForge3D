import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/**
 * GLTFExportManager — Exports the scene as .glb with embedded textures.
 * Handles data-URL textures by converting them to proper images for the exporter.
 */
export class GLTFExportManager {
  /**
   * Export the given group as a GLB file and trigger download.
   * @param {THREE.Group} exportGroup
   * @param {string} defaultFilename
   */
  static async export(exportGroup, defaultFilename = 'sprite3d-model') {
    if (exportGroup.children.length === 0) {
      throw new Error('No objects to export');
    }

    let fileHandle = null;
    if (window.showSaveFilePicker) {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: `${defaultFilename}.glb`,
          types: [{
            description: 'GLTF Binary Model',
            accept: { 'model/gltf-binary': ['.glb'] }
          }]
        });
      } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
        return; // User cancelled the save dialog
      }
    }

    // Clone the group so we don't mutate the live scene
    const cloneGroup = exportGroup.clone(true);

    // Ensure all textures have proper images set
    cloneGroup.traverse((child) => {
      if (child.isMesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of materials) {
          if (mat && mat.map) {
            mat.map.needsUpdate = true;
          }
        }
      }
    });

    const exporter = new GLTFExporter();
    let blob = null;

    try {
      const result = await exporter.parseAsync(cloneGroup, { binary: true, onlyVisible: true });
      blob = new Blob([result], { type: 'model/gltf-binary' });
    } catch (err) {
      // Fallback: try callback-based parse
      blob = await new Promise((resolve, reject) => {
        exporter.parse(
          cloneGroup,
          (res) => resolve(new Blob([res], { type: 'model/gltf-binary' })),
          reject,
          { binary: true, onlyVisible: true }
        );
      });
    }

    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      GLTFExportManager._fallbackDownload(blob, `${defaultFilename}.glb`);
    }

    return blob;
  }

  static _fallbackDownload(blob, filename) {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 1000);
    };
    reader.readAsDataURL(blob);
  }
}
