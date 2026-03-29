import * as THREE from 'three';

/**
 * QuadFactory — Creates textured planes and boxes from sprite textures.
 * Auto-pivots at the bottom center and preserves sprite aspect ratio.
 */
export class QuadFactory {

  /**
   * Create a textured quad (PlaneGeometry) from a texture.
   * Origin is at the bottom-center of the quad.
   * @param {THREE.Texture} texture
   * @param {string} name
   * @param {number} scale - overall scale multiplier
   * @param {number} segments - subdivisions for vertex editing
   * @returns {THREE.Mesh}
   */
  static createQuad(texture, name = 'Quad', scale = 1, segments = 1) {
    const img = texture.image;
    const height = img.height * scale;
    const width = img.width * scale;

    // PlaneGeometry centered at origin — shift up so origin is at base
    const geometry = new THREE.PlaneGeometry(width, height, segments, segments);
    geometry.translate(0, height / 2, 0);

    const matTex = texture.clone();
    matTex.colorSpace = THREE.SRGBColorSpace;
    matTex.magFilter = THREE.NearestFilter;
    matTex.minFilter = THREE.NearestMipMapLinearFilter;
    matTex.wrapS = THREE.RepeatWrapping;
    matTex.wrapT = THREE.RepeatWrapping;
    matTex.needsUpdate = true;

    const material = new THREE.MeshStandardMaterial({
      map: matTex,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.userData.type = 'quad';
    mesh.userData.textureName = name;
    mesh.userData.originalWidth = width;
    mesh.userData.originalHeight = height;
    mesh.userData.extrusionDepth = 0;
    
    // UV Tiling properties (default)
    mesh.userData.uvRepeat = [1, 1];
    mesh.userData.uvOffset = [0, 0];

    // Store base texture ref for later face assignment / atlas
    mesh.userData.texture = texture;
    mesh.userData.textureImage = img;

    return mesh;
  }

  /**
   * Extrude a quad into a box with depth.
   * Front and back faces get the sprite texture; sides get edge material.
   * @param {THREE.Mesh} quadMesh - the original quad mesh
   * @param {number} depth - extrusion depth
   * @returns {THREE.Mesh} - new mesh replacing the old one
   */
  static extrudeQuad(quadMesh, depth) {
    const userData = quadMesh.userData;
    const width = userData.originalWidth;
    const height = userData.originalHeight;
    const texture = userData.texture;

    const segments = quadMesh.geometry.parameters.widthSegments || 1;

    if (depth <= 0.001) {
      // Revert to flat plane
      const geom = new THREE.PlaneGeometry(width, height, segments, segments);
      geom.translate(0, height / 2, 0);

      quadMesh.geometry.dispose();
      quadMesh.geometry = geom;

      // Revert to single material
      if (Array.isArray(quadMesh.material)) {
        quadMesh.material.forEach(m => m.dispose());
      }

      quadMesh.material = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.1,
        side: THREE.DoubleSide,
        roughness: 1,
        metalness: 0
      });

      userData.extrusionDepth = 0;
      userData.type = 'quad';
      return quadMesh;
    }

    // Create box geometry with origin at bottom center
    const geom = new THREE.BoxGeometry(width, height, depth, segments, segments, segments);
    geom.translate(0, height / 2, 0);

    // Dispose old geometry
    quadMesh.geometry.dispose();
    quadMesh.geometry = geom;

    // Material array: [+x, -x, +y, -y, +z, -z]
    // Sides = edge color, top/bottom = edge, front/back = texture
    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3d4a,
      roughness: 1,
      metalness: 0
    });

    // If there's an existing mapped texture, clone it so it respects tiling
    let currentMap = texture;
    if (quadMesh.material && !Array.isArray(quadMesh.material) && quadMesh.material.map) {
        currentMap = quadMesh.material.map;
    }
    
    const matTex = currentMap.clone();
    matTex.wrapS = THREE.RepeatWrapping;
    matTex.wrapT = THREE.RepeatWrapping;
    matTex.needsUpdate = true;

    const textureMaterial = new THREE.MeshStandardMaterial({
      map: matTex,
      transparent: true,
      alphaTest: 0.1,
      roughness: 1,
      metalness: 0
    });

    // Dispose old material
    if (Array.isArray(quadMesh.material)) {
      quadMesh.material.forEach(m => m.dispose());
    } else if (quadMesh.material) {
      quadMesh.material.dispose();
    }

    quadMesh.material = [
      edgeMaterial,     // +X right
      edgeMaterial,     // -X left
      edgeMaterial,     // +Y top
      edgeMaterial,     // -Y bottom
      textureMaterial,  // +Z front
      textureMaterial.clone() // -Z back
    ];

    userData.extrusionDepth = depth;
    userData.type = 'box';
    return quadMesh;
  }

  /**
   * Assign a texture to a specific face of an extruded box.
   * @param {THREE.Mesh} mesh
   * @param {number} faceIndex - 0-5 matching BoxGeometry material indices
   * @param {THREE.Texture} texture
   */
  static assignFaceTexture(mesh, faceIndex, texture) {
    if (!Array.isArray(mesh.material) || faceIndex < 0 || faceIndex > 5) return;

    const matTex = texture.clone();
    matTex.colorSpace = THREE.SRGBColorSpace;
    matTex.magFilter = THREE.NearestFilter;
    matTex.minFilter = THREE.NearestMipMapLinearFilter;
    matTex.wrapS = THREE.RepeatWrapping;
    matTex.wrapT = THREE.RepeatWrapping;
    matTex.needsUpdate = true;

    const mat = new THREE.MeshStandardMaterial({
      map: matTex,
      transparent: true,
      alphaTest: 0.1,
      roughness: 1,
      metalness: 0
    });

    // Dispose old material for this face
    if (mesh.material[faceIndex]) {
      mesh.material[faceIndex].dispose();
    }

    mesh.material[faceIndex] = mat;
  }

  /**
   * Create a basic Plane primitive (no texture).
   * @param {number} width
   * @param {number} height
   * @param {number} segments
   * @returns {THREE.Mesh}
   */
  static createPlane(width = 1, height = 1, segments = 1) {
    const geometry = new THREE.PlaneGeometry(width, height, segments, segments);
    geometry.translate(0, height / 2, 0);

    const material = new THREE.MeshStandardMaterial({
      color: 0x8890a4,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Plane';
    mesh.userData.type = 'quad';
    mesh.userData.textureName = '';
    mesh.userData.originalWidth = width;
    mesh.userData.originalHeight = height;
    mesh.userData.extrusionDepth = 0;
    mesh.userData.texture = null;
    return mesh;
  }

  /**
   * Create a basic Cube (Box) primitive.
   * @param {number} width
   * @param {number} height
   * @param {number} depth
   * @param {number} segments
   * @returns {THREE.Mesh}
   */
  static createCube(width = 1, height = 1, depth = 1, segments = 1) {
    const geometry = new THREE.BoxGeometry(width, height, depth, segments, segments, segments);
    geometry.translate(0, height / 2, 0);

    const material = new THREE.MeshStandardMaterial({
      color: 0x8890a4,
      roughness: 1,
      metalness: 0
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Cube';
    mesh.userData.type = 'box';
    mesh.userData.textureName = '';
    mesh.userData.originalWidth = width;
    mesh.userData.originalHeight = height;
    mesh.userData.extrusionDepth = depth;
    mesh.userData.texture = null;
    return mesh;
  }

  /**
   * Create a Cylinder primitive.
   * @param {number} radius
   * @param {number} height
   * @param {number} segments
   * @returns {THREE.Mesh}
   */
  static createCylinder(radius = 0.5, height = 1, segments = 16) {
    const geometry = new THREE.CylinderGeometry(radius, radius, height, segments);
    geometry.translate(0, height / 2, 0);

    const material = new THREE.MeshStandardMaterial({
      color: 0x8890a4,
      roughness: 1,
      metalness: 0
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Cylinder';
    mesh.userData.type = 'cylinder';
    mesh.userData.textureName = '';
    mesh.userData.originalWidth = radius * 2;
    mesh.userData.originalHeight = height;
    mesh.userData.extrusionDepth = 0;
    mesh.userData.texture = null;
    return mesh;
  }

  /**
   * Apply a texture to ALL faces of a mesh.
   * @param {THREE.Mesh} mesh
   * @param {THREE.Texture} texture
   */
  static applyTexture(mesh, texture) {
    const matTex = texture.clone();
    matTex.colorSpace = THREE.SRGBColorSpace;
    matTex.magFilter = THREE.NearestFilter;
    matTex.minFilter = THREE.NearestMipMapLinearFilter;
    matTex.wrapS = THREE.RepeatWrapping;
    matTex.wrapT = THREE.RepeatWrapping;
    matTex.needsUpdate = true;

    const mat = new THREE.MeshStandardMaterial({
      map: matTex,
      roughness: 1,
      metalness: 0,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide
    });

    // Dispose old material(s)
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(m => m.dispose());
    } else if (mesh.material) {
      mesh.material.dispose();
    }

    mesh.material = mat;
    mesh.userData.texture = texture;
    mesh.userData.textureName = texture.name || 'texture';
  }

  /**
   * Duplicate a mesh with its textures.
   * @param {THREE.Mesh} original
   * @returns {THREE.Mesh}
   */
  static duplicate(original) {
    const clone = original.clone();
    clone.name = original.name + ' Copy';

    // Clone geometry
    clone.geometry = original.geometry.clone();

    // Clone materials and their textures
    if (Array.isArray(original.material)) {
      clone.material = original.material.map(m => {
        const mat = m.clone();
        if (mat.map) {
          mat.map = mat.map.clone();
          mat.map.needsUpdate = true;
        }
        return mat;
      });
    } else {
      clone.material = original.material.clone();
      if (clone.material.map) {
        clone.material.map = clone.material.map.clone();
        clone.material.map.needsUpdate = true;
      }
    }

    // Copy userData
    clone.userData = { ...original.userData };

    // Offset position to next grid cell (32 units)
    clone.position.x += 32.0;
    clone.position.z += 32.0;

    return clone;
  }
}
