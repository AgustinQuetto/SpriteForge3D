import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';

/**
 * OBJExportManager — Exports the scene as .obj + .mtl.
 */
export class OBJExportManager {
  /**
   * Export the given group as an OBJ file.
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
          suggestedName: `${defaultFilename}.obj`,
          types: [{
            description: 'Wavefront OBJ',
            accept: { 'text/plain': ['.obj'] }
          }]
        });
      } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
        return; // User cancelled
      }
    }

    // Clone and apply transform
    const cloneGroup = exportGroup.clone(true);
    cloneGroup.updateMatrixWorld(true);

    const exporter = new OBJExporter();
    const result = exporter.parse(cloneGroup);
    const blob = new Blob([result], { type: 'text/plain' });

    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      OBJExportManager._fallbackDownload(blob, `${defaultFilename}.obj`);
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
