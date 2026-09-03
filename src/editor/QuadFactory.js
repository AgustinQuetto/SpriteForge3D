import * as THREE from 'three';
import {
  ALPHA_THRESHOLD,
  buildDepthMapFromHeightSource,
  ensureVoxelPaintData,
  getImageDataFromMesh,
  getImageDataFromSource,
  getVoxelGridOrigin,
  restoreVoxelState,
  splitVoxelStateBySelection,
} from './PixelUtils.js';

/**
 * Creates the texture that represents the current voxel paint layer. The
 * voxel geometry is generated from sampled pixels, so exporting only vertex
 * colors would make the result dependent on how the target engine imports
 * vertex colors. A real canvas texture is embedded by GLTFExporter instead.
 */
function createVoxelBakedTexture(imageData, activeMap, colorMap) {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const baked = context.createImageData(imageData.width, imageData.height);
  for (let pixelIndex = 0; pixelIndex < imageData.width * imageData.height; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const isActive = activeMap ? !!activeMap[pixelIndex] : imageData.data[offset + 3] >= ALPHA_THRESHOLD;

    if (!isActive) {
      baked.data[offset] = 0;
      baked.data[offset + 1] = 0;
      baked.data[offset + 2] = 0;
      baked.data[offset + 3] = 0;
      continue;
    }

    baked.data[offset] = colorMap ? colorMap[offset] : imageData.data[offset];
    baked.data[offset + 1] = colorMap ? colorMap[offset + 1] : imageData.data[offset + 1];
    baked.data[offset + 2] = colorMap ? colorMap[offset + 2] : imageData.data[offset + 2];
    baked.data[offset + 3] = colorMap ? colorMap[offset + 3] : imageData.data[offset + 3];
  }

  context.putImageData(baked, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

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
    if (original.userData.voxelDepthMap) clone.userData.voxelDepthMap = new Uint16Array(original.userData.voxelDepthMap);
    if (original.userData.voxelSelection) clone.userData.voxelSelection = new Uint8Array(original.userData.voxelSelection);
    if (original.userData.voxelActiveMap) clone.userData.voxelActiveMap = new Uint8Array(original.userData.voxelActiveMap);
    if (original.userData.voxelColorMap) clone.userData.voxelColorMap = new Uint8Array(original.userData.voxelColorMap);
    if (original.userData.voxelPivotOffset) clone.userData.voxelPivotOffset = [...original.userData.voxelPivotOffset];
    if (original.userData.voxelBakedTexture) {
      clone.userData.voxelBakedTexture = Array.isArray(clone.material)
        ? clone.material.find(material => material?.map)?.map || null
        : clone.material?.map || null;
    }

    // Offset position to next grid cell (32 units)
    clone.position.x += 32.0;
    clone.position.z += 32.0;

    return clone;
  }

  /**
   * Cut the selected voxel columns out of a mesh and return them as an
   * independently editable mesh. The caller owns adding the piece to a scene.
   * @param {THREE.Mesh} original
   * @param {string} pieceName
   * @returns {{ piece: THREE.Mesh, movedCount: number, remainingCount: number, localPivotDelta: THREE.Vector3 } | null}
   */
  static splitVoxelSelection(original, pieceName = `${original?.name || 'Voxel'} - Pieza`) {
    if (!original?.userData?.voxelized) return null;
    const paintData = ensureVoxelPaintData(original);
    const selection = original.userData.voxelSelection;
    if (!paintData || !selection) return null;

    const split = splitVoxelStateBySelection({
      active: paintData.active,
      selection,
      depthMap: original.userData.voxelDepthMap,
      colors: paintData.colors,
      width: paintData.width,
      height: paintData.height,
    });
    if (!split) return null;

    const piece = QuadFactory.duplicate(original);
    piece.name = pieceName;
    piece.position.copy(original.position);
    piece.quaternion.copy(original.quaternion);
    piece.scale.copy(original.scale);

    const pixelSize = original.userData.voxelPixelSize || 1;
    const currentPivot = original.userData.voxelPivotOffset || [0, 0];
    const selectedPivot = [
      -paintData.width * pixelSize / 2
        + (split.bounds.minCol + split.bounds.maxCol + 1) * pixelSize / 2,
      (paintData.height - 1 - split.bounds.maxRow) * pixelSize,
    ];
    const localPivotDelta = new THREE.Vector3(
      selectedPivot[0] - Number(currentPivot[0] || 0),
      selectedPivot[1] - Number(currentPivot[1] || 0),
      0,
    );

    piece.userData.voxelPivotOffset = selectedPivot;
    piece.userData.voxelDerivedPiece = true;
    restoreVoxelState(original, split.remaining);
    restoreVoxelState(piece, split.piece);
    QuadFactory.rebuildVoxelGeometry(original);
    QuadFactory.rebuildVoxelGeometry(piece);

    return {
      piece,
      movedCount: split.movedCount,
      remainingCount: split.remainingCount,
      localPivotDelta,
    };
  }

  /**
   * Voxelize a sprite mesh: each non-transparent pixel becomes a coloured cube.
   * Optional per-pixel depth from mesh.userData.voxelDepthMap (relief).
   * @param {THREE.Mesh} mesh
   * @param {number} pixelSize
   * @returns {THREE.Mesh}
   */
  static voxelizeSprite(mesh, pixelSize = 1, { preserveScale = false, repeatInfo = null } = {}) {
    const uvRepeat = repeatInfo || mesh.userData.uvRepeat || [1, 1];
    const uvOffset = mesh.userData.uvOffset || [0, 0];
    const repeatX = Math.max(0.0001, Math.abs(Number(uvRepeat[0]) || 1));
    const repeatY = Math.max(0.0001, Math.abs(Number(uvRepeat[1]) || 1));
    const usesRepeatedTexture = repeatX !== 1 || repeatY !== 1 || uvOffset[0] !== 0 || uvOffset[1] !== 0;
    mesh.userData.voxelUsesUVRepeat = usesRepeatedTexture;
    mesh.userData.voxelRepeat = [repeatX, repeatY];

    const imageData = getImageDataFromMesh(mesh, { respectUV: usesRepeatedTexture });
    if (!imageData) {
      console.warn('voxelizeSprite: mesh has no texture image');
      return mesh;
    }

    if (usesRepeatedTexture && !preserveScale) {
      mesh.userData.voxelSourceScale = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
      mesh.userData.voxelPreviousTextureRepeatOnScale = !!mesh.userData.textureRepeatOnScale;
      mesh.userData.voxelPreviousTextureRepeatBaseScale = mesh.userData.textureRepeatBaseScale
        ? [...mesh.userData.textureRepeatBaseScale]
        : null;
      mesh.userData.voxelPreviousTextureRepeatBaseUV = mesh.userData.textureRepeatBaseUV
        ? [...mesh.userData.textureRepeatBaseUV]
        : null;
      mesh.scale.x /= repeatX;
      mesh.scale.y /= repeatY;
      mesh.userData.voxelScaleCompensation = [repeatX, repeatY, 1];
      // The voxel geometry now contains the repeated pattern itself.
      mesh.userData.textureRepeatOnScale = false;
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
    // Copy the source once. Future brush edits use these arrays instead of
    // mutating the user's texture, so the original reference image remains
    // available for re-applying heightmaps and saving the project.
    ensureVoxelPaintData(mesh, imageData);

    return QuadFactory.rebuildVoxelGeometry(mesh);
  }

  /**
   * Rebuild merged voxel geometry from texture + depth map.
   * @param {THREE.Mesh} mesh — must be voxelized or about to be
   * @returns {THREE.Mesh}
   */
  static rebuildVoxelGeometry(mesh) {
    const imageData = getImageDataFromMesh(mesh, { respectUV: !!mesh.userData.voxelUsesUVRepeat });
    if (!imageData) return mesh;

    const { data, width: imgW, height: imgH } = imageData;
    const pixelSize = mesh.userData.voxelPixelSize || 1;
    const depthMap = mesh.userData.voxelDepthMap || new Uint16Array(imgW * imgH);
    const paintData = ensureVoxelPaintData(mesh, imageData);
    const activeMap = paintData?.active;
    const colorMap = paintData?.colors;

    const voxels = [];
    for (let row = 0; row < imgH; row++) {
      for (let col = 0; col < imgW; col++) {
        const pi = row * imgW + col;
        const i = pi * 4;
        const a = data[i + 3];
        if (activeMap ? !activeMap[pi] : a < ALPHA_THRESHOLD) continue;
        voxels.push({
          col,
          row,
          r: colorMap ? colorMap[i] : data[i],
          g: colorMap ? colorMap[i + 1] : data[i + 1],
          b: colorMap ? colorMap[i + 2] : data[i + 2],
          depth: depthMap[pi] || 0,
        });
      }
    }

    if (voxels.length === 0) {
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
      else mesh.material?.dispose();
      mesh.userData.voxelBakedTexture?.dispose();
      mesh.userData.voxelBakedTexture = null;

      const emptyGeometry = new THREE.BufferGeometry();
      emptyGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      emptyGeometry.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
      emptyGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
      emptyGeometry.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
      emptyGeometry.setIndex([]);
      mesh.geometry = emptyGeometry;
      mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
      mesh.userData.voxelized = true;
      mesh.userData.voxelCount = 0;
      mesh.userData.voxelPixelSize = pixelSize;
      mesh.userData.voxelImageWidth = imgW;
      mesh.userData.voxelImageHeight = imgH;
      return mesh;
    }

    const srgbToLinear = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };

    const { x: originX, y: originY } = getVoxelGridOrigin(mesh, imgW, imgH);
    const half = pixelSize / 2;
    const baseZ = -half;
    const columns = new Map(voxels.map(voxel => [voxel.row * imgW + voxel.col, voxel]));

    const heightAt = (row, col) => {
      const voxel = columns.get(row * imgW + col);
      return voxel ? (voxel.depth + 0.5) * pixelSize : baseZ;
    };

    // Count only visible faces so the final buffers are allocated once.
    let faceCount = 0;
    for (const voxel of voxels) {
      const topZ = heightAt(voxel.row, voxel.col);
      faceCount += 2; // front and back
      if (topZ > heightAt(voxel.row, voxel.col - 1)) faceCount += 1;
      if (topZ > heightAt(voxel.row, voxel.col + 1)) faceCount += 1;
      if (topZ > heightAt(voxel.row - 1, voxel.col)) faceCount += 1;
      if (topZ > heightAt(voxel.row + 1, voxel.col)) faceCount += 1;
    }

    const positions = new Float32Array(faceCount * 4 * 3);
    const normals = new Float32Array(faceCount * 4 * 3);
    const uvs = new Float32Array(faceCount * 4 * 2);
    const colors = new Float32Array(faceCount * 4 * 3);
    const indices = new Uint32Array(faceCount * 6);

    let vertexOffset = 0;
    let indexOffset = 0;
    const addQuad = (corners, normal, color, uvCorners) => {
      for (let cornerIndex = 0; cornerIndex < 4; cornerIndex += 1) {
        const positionOffset = (vertexOffset + cornerIndex) * 3;
        const uvOffset = (vertexOffset + cornerIndex) * 2;
        positions[positionOffset] = corners[cornerIndex][0];
        positions[positionOffset + 1] = corners[cornerIndex][1];
        positions[positionOffset + 2] = corners[cornerIndex][2];
        normals[positionOffset] = normal[0];
        normals[positionOffset + 1] = normal[1];
        normals[positionOffset + 2] = normal[2];
        colors[positionOffset] = color[0];
        colors[positionOffset + 1] = color[1];
        colors[positionOffset + 2] = color[2];
        uvs[uvOffset] = uvCorners[cornerIndex][0];
        uvs[uvOffset + 1] = uvCorners[cornerIndex][1];
      }

      indices[indexOffset] = vertexOffset;
      indices[indexOffset + 1] = vertexOffset + 1;
      indices[indexOffset + 2] = vertexOffset + 2;
      indices[indexOffset + 3] = vertexOffset;
      indices[indexOffset + 4] = vertexOffset + 2;
      indices[indexOffset + 5] = vertexOffset + 3;
      vertexOffset += 4;
      indexOffset += 6;
    };

    for (const voxel of voxels) {
      const x0 = originX + voxel.col * pixelSize - half;
      const x1 = x0 + pixelSize;
      const y0 = originY + (imgH - 1 - voxel.row) * pixelSize - half;
      const y1 = y0 + pixelSize;
      const topZ = heightAt(voxel.row, voxel.col);
      const u0 = voxel.col / imgW;
      const u1 = (voxel.col + 1) / imgW;
      const v0 = 1 - (voxel.row + 1) / imgH;
      const v1 = 1 - voxel.row / imgH;
      const color = [srgbToLinear(voxel.r), srgbToLinear(voxel.g), srgbToLinear(voxel.b)];

      // The bottom is omitted intentionally: it is coplanar for every voxel and
      // is never visible in the editor or in a normal static-mesh import.
      addQuad(
        [[x0, y0, baseZ], [x0, y1, baseZ], [x1, y1, baseZ], [x1, y0, baseZ]],
        [0, 0, -1], color,
        [[u0, v0], [u0, v1], [u1, v1], [u1, v0]],
      );
      addQuad(
        [[x0, y0, topZ], [x1, y0, topZ], [x1, y1, topZ], [x0, y1, topZ]],
        [0, 0, 1], color,
        [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
      );

      const leftHeight = heightAt(voxel.row, voxel.col - 1);
      if (topZ > leftHeight) {
        addQuad(
          [[x0, y0, leftHeight], [x0, y0, topZ], [x0, y1, topZ], [x0, y1, leftHeight]],
          [-1, 0, 0], color,
          [[u0, v0], [u0, v1], [u1, v1], [u1, v0]],
        );
      }

      const rightHeight = heightAt(voxel.row, voxel.col + 1);
      if (topZ > rightHeight) {
        addQuad(
          [[x1, y0, rightHeight], [x1, y1, rightHeight], [x1, y1, topZ], [x1, y0, topZ]],
          [1, 0, 0], color,
          [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
        );
      }

      const bottomHeight = heightAt(voxel.row + 1, voxel.col);
      if (topZ > bottomHeight) {
        addQuad(
          [[x0, y0, bottomHeight], [x1, y0, bottomHeight], [x1, y0, topZ], [x0, y0, topZ]],
          [0, -1, 0], color,
          [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
        );
      }

      const topHeight = heightAt(voxel.row - 1, voxel.col);
      if (topZ > topHeight) {
        addQuad(
          [[x0, y1, topHeight], [x0, y1, topZ], [x1, y1, topZ], [x1, y1, topHeight]],
          [0, 1, 0], color,
          [[u0, v0], [u0, v1], [u1, v1], [u1, v0]],
        );
      }
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

    mesh.userData.voxelBakedTexture?.dispose();
    const bakedTexture = createVoxelBakedTexture(imageData, activeMap, colorMap);
    mesh.userData.voxelBakedTexture = bakedTexture;

    mesh.geometry = mergedGeom;
    mesh.material = new THREE.MeshStandardMaterial({
      map: bakedTexture,
      color: 0xffffff,
      transparent: !!bakedTexture,
      alphaTest: bakedTexture ? 0.1 : 0,
      side: THREE.DoubleSide,
      vertexColors: !bakedTexture,
      roughness: 0.85,
      metalness: 0
    });

    mesh.userData.voxelized = true;
    mesh.userData.voxelCount = voxels.length;
    mesh.userData.voxelPixelSize = pixelSize;
    mesh.userData.voxelImageWidth = imgW;
    mesh.userData.voxelImageHeight = imgH;
    mesh.userData.voxelMeshing = 'visible-surfaces';
    mesh.userData.voxelFaceCount = faceCount;
    mesh.userData.voxelTriangleCount = faceCount * 2;
    mesh.userData.type = 'voxel';

    return mesh;
  }

  /**
   * Paint or erase one pixel in the editable voxel layer.
   * @param {THREE.Mesh} mesh voxelized sprite
   * @param {number} col image-space column
   * @param {number} row image-space row
   * @param {boolean} active whether the pixel should have a voxel
   * @param {{r:number,g:number,b:number,a?:number}|null} color
   */
  static setVoxelPixel(mesh, col, row, active, color = null) {
    const paintData = ensureVoxelPaintData(mesh);
    if (!paintData) return false;
    if (col < 0 || col >= paintData.width || row < 0 || row >= paintData.height) return false;

    const pi = row * paintData.width + col;
    const ci = pi * 4;
    const wasActive = !!paintData.active[pi];
    const nextActive = !!active;
    paintData.active[pi] = nextActive ? 1 : 0;

    if (color && nextActive) {
      paintData.colors[ci] = Math.max(0, Math.min(255, Math.round(color.r)));
      paintData.colors[ci + 1] = Math.max(0, Math.min(255, Math.round(color.g)));
      paintData.colors[ci + 2] = Math.max(0, Math.min(255, Math.round(color.b)));
      paintData.colors[ci + 3] = Math.max(0, Math.min(255, Math.round(color.a ?? 255)));
    }

    return wasActive !== nextActive || !!color;
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

    const spriteData = getImageDataFromMesh(mesh, { respectUV: !!mesh.userData.voxelUsesUVRepeat });
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

    const spriteData = getImageDataFromMesh(mesh, { respectUV: !!mesh.userData.voxelUsesUVRepeat });
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
    const userData = mesh.userData;
    const texture = userData.texture;
    const scaleCompensation = userData.voxelScaleCompensation
      || (userData.voxelUsesUVRepeat ? userData.voxelRepeat : null);
    const previousRepeatState = {
      enabled: userData.voxelPreviousTextureRepeatOnScale,
      baseScale: userData.voxelPreviousTextureRepeatBaseScale,
      baseUV: userData.voxelPreviousTextureRepeatBaseUV,
    };
    const uvRepeat = userData.uvRepeat || [1, 1];
    const uvOffset = userData.uvOffset || [0, 0];
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
    userData.voxelBakedTexture?.dispose();
    userData.voxelBakedTexture = null;

    mesh.geometry = geom;

    if (texture) {
      const matTex = texture.clone();
      matTex.colorSpace = THREE.SRGBColorSpace;
      matTex.magFilter  = THREE.NearestFilter;
      matTex.minFilter  = THREE.NearestMipMapLinearFilter;
      matTex.wrapS = THREE.RepeatWrapping;
      matTex.wrapT = THREE.RepeatWrapping;
      matTex.repeat.set(uvRepeat[0], uvRepeat[1]);
      matTex.offset.set(uvOffset[0], uvOffset[1]);
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

    if (scaleCompensation) {
      mesh.scale.x *= Number(scaleCompensation[0]) || 1;
      mesh.scale.y *= Number(scaleCompensation[1]) || 1;
    }
    if (previousRepeatState.enabled !== undefined && previousRepeatState.enabled !== null) {
      userData.textureRepeatOnScale = !!previousRepeatState.enabled;
      userData.textureRepeatBaseScale = previousRepeatState.baseScale
        ? [...previousRepeatState.baseScale]
        : [mesh.scale.x, mesh.scale.y];
      userData.textureRepeatBaseUV = previousRepeatState.baseUV
        ? [...previousRepeatState.baseUV]
        : [...uvRepeat];
    }

    userData.voxelized = false;
    userData.type = 'quad';
    userData.extrusionDepth = 0;
    userData.voxelDepthMap = null;
    userData.voxelSelection = null;
    userData.voxelActiveMap = null;
    userData.voxelColorMap = null;
    userData.voxelHeightmapSource = null;
    userData.voxelHeightmapName = null;
    userData.voxelHeightmapImage = null;
    delete userData.voxelUsesUVRepeat;
    delete userData.voxelRepeat;
    delete userData.voxelSourceScale;
    delete userData.voxelScaleCompensation;
    delete userData.voxelPreviousTextureRepeatOnScale;
    delete userData.voxelPreviousTextureRepeatBaseScale;
    delete userData.voxelPreviousTextureRepeatBaseUV;
    delete userData.voxelPivotOffset;
    delete userData.voxelDerivedPiece;

    return mesh;
  }
}
