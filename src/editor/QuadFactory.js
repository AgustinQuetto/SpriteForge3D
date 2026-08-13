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
  static extrudeQuad(quadMesh, depth, textureSides = true) {
    const userData = quadMesh.userData;
    const width = userData.originalWidth || 32;
    const height = userData.originalHeight || 32;
    const texture = userData.texture;

    const segments = quadMesh.geometry?.parameters?.widthSegments || 1;

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

    // Get current texture map if available
    let currentMap = texture;
    if (quadMesh.material) {
      if (!Array.isArray(quadMesh.material) && quadMesh.material.map) {
        currentMap = quadMesh.material.map;
      } else if (Array.isArray(quadMesh.material) && quadMesh.material[4] && quadMesh.material[4].map) {
        currentMap = quadMesh.material[4].map;
      }
    }

    const createFaceMat = (repeatX = 1, repeatY = 1) => {
      if (!currentMap) {
        return new THREE.MeshStandardMaterial({ color: 0x3a3d4a, roughness: 1, metalness: 0 });
      }
      const matTex = currentMap.clone();
      matTex.colorSpace = THREE.SRGBColorSpace;
      matTex.magFilter = THREE.NearestFilter;
      matTex.minFilter = THREE.NearestMipMapLinearFilter;
      matTex.wrapS = THREE.RepeatWrapping;
      matTex.wrapT = THREE.RepeatWrapping;
      matTex.repeat.set(repeatX, repeatY);
      matTex.needsUpdate = true;

      return new THREE.MeshStandardMaterial({
        map: matTex,
        transparent: true,
        alphaTest: 0.1,
        roughness: 1,
        metalness: 0
      });
    };

    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3d4a,
      roughness: 1,
      metalness: 0
    });

    // Dispose old material
    if (Array.isArray(quadMesh.material)) {
      quadMesh.material.forEach(m => m.dispose());
    } else if (quadMesh.material) {
      quadMesh.material.dispose();
    }

    if (textureSides) {
      // Calculate tile repetition based on dimensions so the sprite pattern repeats seamlessly
      const repSideX = depth / width;
      const repSideY = depth / height;

      quadMesh.material = [
        createFaceMat(repSideX, 1),      // +X right (depth x height)
        createFaceMat(repSideX, 1),      // -X left  (depth x height)
        createFaceMat(1, repSideY),      // +Y top   (width x depth)
        createFaceMat(1, repSideY),      // -Y bottom(width x depth)
        createFaceMat(1, 1),             // +Z front (width x height)
        createFaceMat(1, 1)              // -Z back  (width x height)
      ];
    } else {
      quadMesh.material = [
        edgeMaterial,        // +X right
        edgeMaterial,        // -X left
        edgeMaterial,        // +Y top
        edgeMaterial,        // -Y bottom
        createFaceMat(1, 1), // +Z front
        createFaceMat(1, 1)  // -Z back
      ];
    }

    userData.extrusionDepth = depth;
    userData.textureSides = textureSides;
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
    mesh.userData.texture = texture;
    mesh.userData.textureName = texture.name || 'texture';

    if (mesh.userData.type === 'box' && mesh.userData.extrusionDepth > 0) {
      this.extrudeQuad(mesh, mesh.userData.extrusionDepth, mesh.userData.textureSides !== false);
      return;
    }

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
  /**
   * Voxelize a sprite mesh: each non-transparent pixel becomes a 1×1×1 coloured cube.
   * The resulting merged mesh replaces the original flat quad.
   * @param {THREE.Mesh} mesh - must have mesh.userData.texture with a valid image
   * @param {number} pixelSize - world-unit size of each voxel cube (default 1)
   * @returns {THREE.Mesh} the same mesh, mutated in-place
   */
  static voxelizeSprite(mesh, pixelSize = 1) {
    const texture = mesh.userData.texture;
    if (!texture || !texture.image) {
      console.warn('voxelizeSprite: mesh has no texture image');
      return mesh;
    }

    const img = texture.image;
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

    if (!imgW || !imgH) {
      console.warn('voxelizeSprite: image has no dimensions');
      return mesh;
    }

    // Warn if sprite is large — voxelizing can be expensive
    if (imgW * imgH > 4096) {
      console.warn(`voxelizeSprite: large sprite (${imgW}×${imgH}), this may be slow`);
    }

    // Read pixels via an OffscreenCanvas
    const canvas = new OffscreenCanvas(imgW, imgH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, imgW, imgH);
    const { data } = ctx.getImageData(0, 0, imgW, imgH);

    // Collect voxel positions and colours (only opaque/semi-transparent pixels)
    const ALPHA_THRESHOLD = 30; // 0-255; pixels below are skipped
    const voxels = [];
    for (let row = 0; row < imgH; row++) {
      for (let col = 0; col < imgW; col++) {
        const i = (row * imgW + col) * 4;
        const a = data[i + 3];
        if (a < ALPHA_THRESHOLD) continue;
        voxels.push({
          col,
          row,
          r: data[i],
          g: data[i + 1],
          b: data[i + 2],
          a
        });
      }
    }

    if (voxels.length === 0) {
      console.warn('voxelizeSprite: no opaque pixels found');
      return mesh;
    }

    // Build merged geometry manually using a BoxGeometry template
    const boxTemplate = new THREE.BoxGeometry(pixelSize, pixelSize, pixelSize);
    const posAttr = boxTemplate.getAttribute('position');
    const normAttr = boxTemplate.getAttribute('normal');
    const uvAttr = boxTemplate.getAttribute('uv');
    const indexAttr = boxTemplate.getIndex();
    const vertsPerBox = posAttr.count;
    const indicesPerBox = indexAttr.count;

    const totalVerts = voxels.length * vertsPerBox;
    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const colors = new Float32Array(totalVerts * 3);
    const indices = new Uint32Array(voxels.length * indicesPerBox);

    // Sprite origin matches createQuad: bottom-left is (0, 0), Y grows upward
    // col 0 = left edge, row 0 = top of sprite (image row 0 = top)
    const originX = -imgW * pixelSize / 2 + pixelSize / 2;   // centre horizontally
    const originY = pixelSize / 2;                              // bottom pivot

    for (let vi = 0; vi < voxels.length; vi++) {
      const { col, row, r, g, b } = voxels[vi];

      // Flip row: image row=0 is top, but our Y grows up, so row=0 → highest Y
      const voxelX = originX + col * pixelSize;
      const voxelY = originY + (imgH - 1 - row) * pixelSize;
      const voxelZ = 0;

      // Convert sRGB (getImageData values) → linear colour space.
      // getImageData returns perceptual (sRGB) values; Three.js vertex colours
      // are in linear space, so a direct /255 makes them appear too bright/washed.
      const srgbToLinear = (c) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };

      const colourR = srgbToLinear(r);
      const colourG = srgbToLinear(g);
      const colourB = srgbToLinear(b);

      const vertBase = vi * vertsPerBox;

      for (let v = 0; v < vertsPerBox; v++) {
        const dst = (vertBase + v) * 3;
        positions[dst]     = posAttr.getX(v) + voxelX;
        positions[dst + 1] = posAttr.getY(v) + voxelY;
        positions[dst + 2] = posAttr.getZ(v) + voxelZ;

        normals[dst]     = normAttr.getX(v);
        normals[dst + 1] = normAttr.getY(v);
        normals[dst + 2] = normAttr.getZ(v);

        colors[dst]     = colourR;
        colors[dst + 1] = colourG;
        colors[dst + 2] = colourB;

        const uvDst = (vertBase + v) * 2;
        uvs[uvDst]     = uvAttr.getX(v);
        uvs[uvDst + 1] = uvAttr.getY(v);
      }

      const idxBase = vi * indicesPerBox;
      for (let idx = 0; idx < indicesPerBox; idx++) {
        indices[idxBase + idx] = indexAttr.getX(idx) + vertBase;
      }
    }

    boxTemplate.dispose();

    const mergedGeom = new THREE.BufferGeometry();
    mergedGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    mergedGeom.setAttribute('normal',   new THREE.BufferAttribute(normals,   3));
    mergedGeom.setAttribute('uv',       new THREE.BufferAttribute(uvs,       2));
    mergedGeom.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
    mergedGeom.setIndex(new THREE.BufferAttribute(indices, 1));
    mergedGeom.computeBoundingSphere();

    // Dispose old geometry + material
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(m => m.dispose());
    } else if (mesh.material) {
      mesh.material.dispose();
    }

    mesh.geometry = mergedGeom;
    mesh.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0
    });

    mesh.userData.voxelized = true;
    mesh.userData.voxelPixelSize = pixelSize;
    mesh.userData.type = 'voxel';

    return mesh;
  }

  /**
   * Revert a voxelized mesh back to its original flat quad representation.
   * @param {THREE.Mesh} mesh
   * @returns {THREE.Mesh}
   */
  static devoxelizeSprite(mesh) {
    const texture = mesh.userData.texture;
    const width   = mesh.userData.originalWidth  || 32;
    const height  = mesh.userData.originalHeight || 32;

    const geom = new THREE.PlaneGeometry(width, height, 1, 1);
    geom.translate(0, height / 2, 0);

    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(m => m.dispose());
    } else if (mesh.material) {
      mesh.material.dispose();
    }

    mesh.geometry = geom;

    if (texture) {
      const matTex = texture.clone();
      matTex.colorSpace = THREE.SRGBColorSpace;
      matTex.magFilter  = THREE.NearestFilter;
      matTex.minFilter  = THREE.NearestMipMapLinearFilter;
      matTex.wrapS = THREE.RepeatWrapping;
      matTex.wrapT = THREE.RepeatWrapping;
      matTex.needsUpdate = true;

      mesh.material = new THREE.MeshStandardMaterial({
        map: matTex,
        transparent: true,
        alphaTest: 0.1,
        side: THREE.DoubleSide,
        roughness: 1,
        metalness: 0
      });
    } else {
      mesh.material = new THREE.MeshStandardMaterial({
        color: 0x8890a4,
        side: THREE.DoubleSide,
        roughness: 1,
        metalness: 0
      });
    }

    mesh.userData.voxelized = false;
    mesh.userData.type = 'quad';
    mesh.userData.extrusionDepth = 0;

    return mesh;
  }
}
