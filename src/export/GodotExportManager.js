import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export class GodotExportManager {
  /**
   * Generates a specially formatted GLTF scene optimized for Godot's "Import As MeshLibrary" feature.
   * It deduplicates identical items, places them in a row, and automatically adds the 
   * "-col" suffix to names so Godot generates static collision bodies for the GridMap tiles.
   * 
   * @param {THREE.Group} exportGroup - The scene group containing the models.
   * @param {string} fileName - Name of the output file.
   */
  static async exportLibrary(exportGroup, fileName = 'mesh_library') {
    // 1. Deduplicate items. We define "uniqueness" by geometry structure and material properties.
    const uniqueItems = new Map();

    exportGroup.traverse((child) => {
      if (child.isMesh) {
        // Build a unique signature for this mesh to avoid duplicates in the library
        const u = child.userData;
        const type = u.type || 'unknown';
        const tex = u.textureName || 'none';
        const depth = u.extrusionDepth || 0;
        const width = u.originalWidth || 1;
        const height = u.originalHeight || 1;
        const uvR = u.uvRepeat ? u.uvRepeat.join(',') : '1,1';
        const uvO = u.uvOffset ? u.uvOffset.join(',') : '0,0';
        
        // Also account for vertex deformation if the geometry was modified
        // A simple hash of the first and last position vertices as a dirty check
        let geoHash = 'no-deform';
        if (child.geometry && child.geometry.attributes.position) {
            const pos = child.geometry.attributes.position;
            if (pos.count > 0) {
                geoHash = `${pos.getX(0).toFixed(2)}_${pos.getY(0).toFixed(2)}_${pos.getZ(pos.count-1).toFixed(2)}`;
            }
        }

        const signature = `${type}_${tex}_${width}_${height}_${depth}_${uvR}_${uvO}_${geoHash}`;

        if (!uniqueItems.has(signature)) {
            // Keep the earliest one found, or just the first one
            // Clean up name by removing " Copy" strings
            let cleanName = child.name.replace(/ Copy/g, '').trim();
            if (cleanName === '') cleanName = type;
            
            uniqueItems.set(signature, {
                mesh: child,
                name: cleanName
            });
        }
      }
    });

    if (uniqueItems.size === 0) {
      throw new Error('No meshes found to export for the library.');
    }

    // 2. Build a new isolated Scene for the GLTF
    const libraryScene = new THREE.Scene();
    
    let xOffset = 0;
    
    // 3. Compute Item IDs
    // We map every unique item to an integer ID based on the order they were added to the GLTF.
    // Godot's "Import as MeshLibrary" usually assigns IDs alphabetically based on node names.
    // To ensure our GDScript places the right blocks, we'll sort the names alphabetically to match 
    // Godot's predictable ID assignment behavior natively.
    const sortedSignatures = Array.from(uniqueItems.keys()).sort((a, b) => {
        const nameA = uniqueItems.get(a).name;
        const nameB = uniqueItems.get(b).name;
        return nameA.localeCompare(nameB);
    });

    let currentId = 0;
    const itemIds = {}; // signature -> id
    const sortedUniqueItems = new Map();

    sortedSignatures.forEach(sig => {
        itemIds[sig] = currentId++;
        sortedUniqueItems.set(sig, uniqueItems.get(sig));
    });

    // We want the tiles to have their origin exactly at 0,0,0 locally
    sortedUniqueItems.forEach((data, signature) => {
      const original = data.mesh;
      const clone = original.clone();
      
      // Clear position, rotation, scale to ensure it sits perfectly at grid origin (0,0,0)
      clone.position.set(xOffset, 0, 0);
      clone.rotation.set(0, 0, 0);
      clone.scale.set(1, 1, 1);
      
      // Append Godot collision suffix (-col generates a StaticBody3D with a mesh-accurate CollisionShape)
      // This is crucial for making the GridMap functional out of the box.
      clone.name = `${data.name}-col`;
      
      libraryScene.add(clone);
      
      xOffset += 2; // space them out for visual clarity in viewers
    });

    // 4. Generate GDScript for automatic layout placement
    let gdScript = `@tool\nextends EditorScript\n\n`;
    gdScript += `# Sprite3D Auto-Layout Script\n`;
    gdScript += `# Usage: Open a 3D scene in Godot, select this script in the Script editor, and click File -> Run.\n`;
    gdScript += `func _run():\n`;
    gdScript += `\tvar root = get_scene()\n`;
    gdScript += `\tif not root:\n\t\tprint("Error: Please open a 3D Scene first.")\n\t\treturn\n\n`;
    gdScript += `\tvar gridmap = root.get_node_or_null("GridMap")\n`;
    gdScript += `\tif not gridmap:\n`;
    gdScript += `\t\tgridmap = GridMap.new()\n`;
    gdScript += `\t\tgridmap.name = "GridMap"\n`;
    gdScript += `\t\tgridmap.cell_size = Vector3(32, 32, 32)\n`;
    gdScript += `\t\troot.add_child(gridmap)\n`;
    gdScript += `\t\tgridmap.owner = root\n\n`;
    gdScript += `\tgridmap.clear()\n\n`;

    exportGroup.traverse((child) => {
      if (child.isMesh) {
          const u = child.userData;
          const type = u.type || 'unknown';
          const tex = u.textureName || 'none';
          const depth = u.extrusionDepth || 0;
          const width = u.originalWidth || 1;
          const height = u.originalHeight || 1;
          const uvR = u.uvRepeat ? u.uvRepeat.join(',') : '1,1';
          const uvO = u.uvOffset ? u.uvOffset.join(',') : '0,0';
          
          let geoHash = 'no-deform';
          if (child.geometry && child.geometry.attributes.position) {
              const pos = child.geometry.attributes.position;
              if (pos.count > 0) {
                  geoHash = `${pos.getX(0).toFixed(2)}_${pos.getY(0).toFixed(2)}_${pos.getZ(pos.count-1).toFixed(2)}`;
              }
          }
          const sig = `${type}_${tex}_${width}_${height}_${depth}_${uvR}_${uvO}_${geoHash}`;
          
          const id = itemIds[sig];
          if (id !== undefined) {
              const x = Math.round(child.position.x / 32);
              const y = Math.round(child.position.y / 32);
              // In Godot, Z points towards viewer. Same as Three.js, but GridMap Z can be identical or inverted based on user layout.
              const z = Math.round(child.position.z / 32);
              
              // Handle very basic Y rotation for the tile mapping
              let rotIndex = 0; // default orientation
              const rotY = Math.round(THREE.MathUtils.radToDeg(child.rotation.y));
              if (rotY === 90 || rotY === -270) rotIndex = 16;
              else if (rotY === 180 || rotY === -180) rotIndex = 10;
              else if (rotY === 270 || rotY === -90) rotIndex = 22;

              gdScript += `\tgridmap.set_cell_item(Vector3i(${x}, ${y}, ${z}), ${id}, ${rotIndex})\n`;
          }
      }
    });

    gdScript += `\n\tprint("GridMap level injected successfully!")\n`;

    // 5. Trigger Downloads sequentially
    const exporter = new GLTFExporter();
    
    return new Promise((resolve, reject) => {
      exporter.parse(
        libraryScene,
        async (gltf) => {
          try {
            const glbBlob = new Blob([gltf], { type: 'model/gltf-binary' });
            const gdBlob = new Blob([gdScript], { type: 'text/plain' });
            
            // Helper to download via DOM if File System Access is unavailable or to do multiple files
            const downloadBlob = (blob, name) => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.style.display = 'none';
              a.href = url;
              a.download = name;
              document.body.appendChild(a);
              a.click();
              setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }, 100);
            };

            // Download both files automatically
            downloadBlob(glbBlob, `${fileName}.glb`);
            
            // Small delay to allow the browser to process multiple downloads gracefully
            setTimeout(() => {
               downloadBlob(gdBlob, `build_gridmap.gd`);
            }, 500);
            
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        (error) => {
          reject(error);
        },
        { binary: true }
      );
    });
  }
}
