import * as THREE from 'three';
import { ALPHA_THRESHOLD, buildDepthMapFromHeightSource, getImageDataFromMesh, getImageDataFromSource } from './PixelUtils.js';

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
   * Voxelize a sprite mesh: each non-transparent pixel becomes a coloured cube.
   * Optional per-pixel depth from mesh.userData.voxelDepthMap (relief).
   * @param {THREE.Mesh} mesh
   * @param {number} pixelSize
   * @returns {THREE.Mesh}
   */
  static voxelizeSprite(mesh, pixelSize = 1) {
    const imageData = getImageDataFromMesh(mesh);
    if (!imageData) {
      console.warn('voxelizeSprite: mesh has no texture image');
      return mesh;
    }

    const { width, height } = imageData;
    if (width * height > 4096) {
      console.warn(`voxelizeSprite: large sprite (${width}×${height}), this may be slow`);
    }

    const size = width * height;
    if (!mesh.userData.voxelDepthMap || mesh.userData.voxelDepthMap.length !== size) {
      mesh.userData.voxelDepthMap = new Uint16Array(size);
    }
    mesh.userData.voxelSelection = new Uint8Array(size);
    mesh.userData.voxelImageWidth = width;
    mesh.userData.voxelImageHeight = height;
    mesh.userData.voxelPixelSize = pixelSize;

    return QuadFactory.rebuildVoxelGeometry(mesh);
  }

  /**
   * Rebuild merged voxel geometry from texture + depth map.
   * @param {THREE.Mesh} mesh — must be voxelized or about to be
   * @returns {THREE.Mesh}
   */
  static rebuildVoxelGeometry(mesh) {
    const imageData = getImageDataFromMesh(mesh);
    if (!imageData) return mesh;

    const { data, width: imgW, height: imgH } = imageData;
    const pixelSize = mesh.userData.voxelPixelSize || 1;
    const depthMap = mesh.userData.voxelDepthMap || new Uint16Array(imgW * imgH);

    const voxels = [];
    for (let row = 0; row < imgH; row++) {
      for (let col = 0; col < imgW; col++) {
        const pi = row * imgW + col;
        const i = pi * 4;
        const a = data[i + 3];
        if (a < ALPHA_THRESHOLD) continue;
        voxels.push({
          col,
          row,
          r: data[i],
          g: data[i + 1],
          b: data[i + 2],
          depth: depthMap[pi] || 0,
        });
      }
    }

    if (voxels.length === 0) {
      console.warn('rebuildVoxelGeometry: no opaque pixels found');
      return mesh;
    }

    const srgbToLinear = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };

    const originX = -imgW * pixelSize / 2 + pixelSize / 2;
    const originY = pixelSize / 2;

    let totalVerts = 0;
    let totalIndices = 0;
    const boxParts = [];

    for (const voxel of voxels) {
      const depthLayers = 1 + voxel.depth;
      const boxDepth = pixelSize * depthLayers;
      const box = new THREE.BoxGeometry(pixelSize, pixelSize, boxDepth);
      const posAttr = box.getAttribute('position');
      const normAttr = box.getAttribute('normal');
      const uvAttr = box.getAttribute('uv');
      const indexAttr = box.getIndex();

      const voxelX = originX + voxel.col * pixelSize;
      const voxelY = originY + (imgH - 1 - voxel.row) * pixelSize;
      const voxelZ = (voxel.depth * pixelSize) / 2;

      boxParts.push({
        positions: posAttr.array.slice(),
        normals: normAttr.array.slice(),
        uvs: uvAttr.array.slice(),
        indices: indexAttr.array.slice(),
        vertCount: posAttr.count,
        voxelX, voxelY, voxelZ,
        colourR: srgbToLinear(voxel.r),
        colourG: srgbToLinear(voxel.g),
        colourB: srgbToLinear(voxel.b),
      });

      totalVerts += posAttr.count;
      totalIndices += indexAttr.count;
      box.dispose();
    }

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const colors = new Float32Array(totalVerts * 3);
    const indices = new Uint32Array(totalIndices);

    let vertOffset = 0;
    let idxOffset = 0;

    for (const part of boxParts) {
      const {
        positions: boxPos, normals: boxNorm, uvs: boxUv, indices: boxIdx,
        vertCount, voxelX, voxelY, voxelZ, colourR, colourG, colourB,
      } = part;
      const vertBase = vertOffset;

      for (let v = 0; v < vertCount; v++) {
        const src = v * 3;
        const dst = (vertBase + v) * 3;
        positions[dst]     = boxPos[src] + voxelX;
        positions[dst + 1] = boxPos[src + 1] + voxelY;
        positions[dst + 2] = boxPos[src + 2] + voxelZ;

        normals[dst]     = boxNorm[src];
        normals[dst + 1] = boxNorm[src + 1];
        normals[dst + 2] = boxNorm[src + 2];

        colors[dst]     = colourR;
        colors[dst + 1] = colourG;
        colors[dst + 2] = colourB;

        const uvSrc = v * 2;
        const uvDst = (vertBase + v) * 2;
        uvs[uvDst]     = boxUv[uvSrc];
        uvs[uvDst + 1] = boxUv[uvSrc + 1];
      }

      for (let idx = 0; idx < boxIdx.length; idx++) {
        indices[idxOffset + idx] = boxIdx[idx] + vertBase;
      }

      vertOffset += vertCount;
      idxOffset += boxIdx.length;
    }

    const mergedGeom = new THREE.BufferGeometry();
    mergedGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    mergedGeom.setAttribute('normal',   new THREE.BufferAttribute(normals,   3));
    mergedGeom.setAttribute('uv',       new THREE.BufferAttribute(uvs,       2));
    mergedGeom.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
    mergedGeom.setIndex(new THREE.BufferAttribute(indices, 1));
    mergedGeom.computeBoundingSphere();

    mesh.geometry?.dispose();
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
    mesh.userData.voxelImageWidth = imgW;
    mesh.userData.voxelImageHeight = imgH;
    mesh.userData.type = 'voxel';

    return mesh;
  }

  /**
   * Apply depth delta to selected pixels and rebuild geometry.
   * @param {THREE.Mesh} mesh
   * @param {number} delta — positive = extract, negative = subtract
   * @param {number} maxDepth
   * @returns {boolean} whether any pixel changed
   */
  static applyVoxelDepthDelta(mesh, delta, maxDepth = 64) {
    const selection = mesh.userData.voxelSelection;
    const depthMap = mesh.userData.voxelDepthMap;
    if (!selection || !depthMap) return false;

    let changed = false;
    for (let i = 0; i < selection.length; i++) {
      if (!selection[i]) continue;
      const prev = depthMap[i];
      const next = Math.max(0, Math.min(maxDepth, prev + delta));
      if (next !== prev) {
        depthMap[i] = next;
        changed = true;
      }
    }

    if (changed) QuadFactory.rebuildVoxelGeometry(mesh);
    return changed;
  }

  /**
   * Apply grayscale heightmap to voxel depth (per-pixel volume).
   * @param {THREE.Mesh} mesh — voxelized sprite
   * @param {HTMLImageElement} heightImage
   * @param {{ maxDepth?: number, invert?: boolean, sourceName?: string }} opts
   * @returns {THREE.Mesh}
   */
  static applyHeightmap(mesh, heightImage, opts = {}) {
    if (!mesh.userData.voxelized) {
      console.warn('applyHeightmap: mesh is not voxelized');
      return mesh;
    }

    const spriteData = getImageDataFromMesh(mesh);
    const heightData = getImageDataFromSource(heightImage);
    if (!spriteData || !heightData) return mesh;

    const maxDepth = opts.maxDepth ?? mesh.userData.voxelHeightMax ?? 8;
    const invert = opts.invert ?? !!mesh.userData.voxelHeightInvert;

    mesh.userData.voxelDepthMap = buildDepthMapFromHeightSource(
      spriteData.data, spriteData.width, spriteData.height,
      heightData.data, heightData.width, heightData.height,
      { maxDepth, invert }
    );
    mesh.userData.voxelHeightMax = maxDepth;
    mesh.userData.voxelHeightInvert = invert;
    mesh.userData.voxelHeightmapSource = 'file';
    mesh.userData.voxelHeightmapName = opts.sourceName || 'heightmap.png';
    mesh.userData.voxelHeightmapImage = heightImage;

    return QuadFactory.rebuildVoxelGeometry(mesh);
  }

  /**
   * Derive depth from the sprite texture luminance (same image, grayscale volume).
   * @param {THREE.Mesh} mesh
   * @param {{ maxDepth?: number, invert?: boolean }} opts
   * @returns {THREE.Mesh}
   */
  static applyHeightmapFromLuminance(mesh, opts = {}) {
    if (!mesh.userData.voxelized) {
      console.warn('applyHeightmapFromLuminance: mesh is not voxelized');
      return mesh;
    }

    const spriteData = getImageDataFromMesh(mesh);
    if (!spriteData) return mesh;

    const maxDepth = opts.maxDepth ?? mesh.userData.voxelHeightMax ?? 8;
    const invert = opts.invert ?? !!mesh.userData.voxelHeightInvert;

    mesh.userData.voxelDepthMap = buildDepthMapFromHeightSource(
      spriteData.data, spriteData.width, spriteData.height,
      spriteData.data, spriteData.width, spriteData.height,
      { maxDepth, invert }
    );
    mesh.userData.voxelHeightMax = maxDepth;
    mesh.userData.voxelHeightInvert = invert;
    mesh.userData.voxelHeightmapSource = 'luminance';
    mesh.userData.voxelHeightmapName = mesh.userData.textureName || 'sprite luminance';
    mesh.userData.voxelHeightmapImage = null;

    return QuadFactory.rebuildVoxelGeometry(mesh);
  }

  /**
   * Re-apply stored heightmap with updated max depth / invert settings.
   */
  static reapplyHeightmap(mesh) {
    if (mesh.userData.voxelHeightmapSource === 'luminance') {
      return QuadFactory.applyHeightmapFromLuminance(mesh, {
        maxDepth: mesh.userData.voxelHeightMax,
        invert: mesh.userData.voxelHeightInvert,
      });
    }
    if (mesh.userData.voxelHeightmapImage) {
      return QuadFactory.applyHeightmap(mesh, mesh.userData.voxelHeightmapImage, {
        maxDepth: mesh.userData.voxelHeightMax,
        invert: mesh.userData.voxelHeightInvert,
        sourceName: mesh.userData.voxelHeightmapName,
      });
    }
    return mesh;
  }

  /** Reset all voxel depth layers to flat. */
  static clearVoxelDepth(mesh) {
    if (!mesh.userData.voxelDepthMap) return mesh;
    mesh.userData.voxelDepthMap.fill(0);
    mesh.userData.voxelHeightmapSource = null;
    mesh.userData.voxelHeightmapName = null;
    mesh.userData.voxelHeightmapImage = null;
    if (mesh.userData.voxelized) QuadFactory.rebuildVoxelGeometry(mesh);
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
    mesh.userData.voxelDepthMap = null;
    mesh.userData.voxelSelection = null;
    mesh.userData.voxelHeightmapSource = null;
    mesh.userData.voxelHeightmapName = null;
    mesh.userData.voxelHeightmapImage = null;

    return mesh;
  }
}
