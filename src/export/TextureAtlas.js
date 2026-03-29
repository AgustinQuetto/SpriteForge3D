import * as THREE from 'three';

/**
 * TextureAtlas — Packs multiple sprite textures into a single atlas.
 * Uses a simple shelf-based bin-packing algorithm.
 */
export class TextureAtlas {
  constructor() {
    this.entries = [];  // { image, x, y, w, h }
  }

  /**
   * Collect unique textures from scene objects.
   * @param {THREE.Object3D[]} objects
   */
  collectFromObjects(objects) {
    const seen = new Set();
    this.entries = [];

    for (const obj of objects) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of materials) {
        if (mat && mat.map && mat.map.image && !seen.has(mat.map.image.src || mat.map.uuid)) {
          const key = mat.map.image.src || mat.map.uuid;
          seen.add(key);
          this.entries.push({
            texture: mat.map,
            image: mat.map.image,
            w: mat.map.image.width || mat.map.image.naturalWidth,
            h: mat.map.image.height || mat.map.image.naturalHeight,
            x: 0,
            y: 0
          });
        }
      }
    }
  }

  /**
   * Pack entries into an atlas and generate a canvas texture.
   * @param {number} padding - pixels between entries
   * @returns {{ canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, uvMap: Map }}
   */
  pack(padding = 2) {
    if (this.entries.length === 0) return null;

    // Sort by height descending for shelf packing
    this.entries.sort((a, b) => b.h - a.h);

    // Estimate atlas size (next power-of-two)
    const totalArea = this.entries.reduce((s, e) => s + (e.w + padding) * (e.h + padding), 0);
    let size = nextPowerOfTwo(Math.ceil(Math.sqrt(totalArea)) * 1.3);
    size = Math.max(size, 256);

    // Try packing; increase size if needed
    let packed = false;
    while (!packed && size <= 8192) {
      packed = this._shelfPack(size, padding);
      if (!packed) size *= 2;
    }

    // Render atlas canvas
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // UV lookup: texture UUID → { u0, v0, u1, v1 }
    const uvMap = new Map();

    for (const entry of this.entries) {
      ctx.drawImage(entry.image, entry.x, entry.y, entry.w, entry.h);
      uvMap.set(entry.texture.uuid, {
        u0: entry.x / size,
        v0: 1 - (entry.y + entry.h) / size,
        u1: (entry.x + entry.w) / size,
        v1: 1 - entry.y / size
      });
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipMapLinearFilter;
    texture.flipY = false; // We handle flip manually in UV coords
    texture.needsUpdate = true;

    return { canvas, texture, uvMap };
  }

  /**
   * Shelf pack algorithm.
   * @param {number} atlasSize
   * @param {number} padding
   * @returns {boolean} true if all entries fit
   */
  _shelfPack(atlasSize, padding) {
    let shelfY = padding;
    let shelfH = 0;
    let cursorX = padding;

    for (const entry of this.entries) {
      if (cursorX + entry.w + padding > atlasSize) {
        // New shelf
        shelfY += shelfH + padding;
        shelfH = 0;
        cursorX = padding;
      }

      if (shelfY + entry.h + padding > atlasSize) {
        return false; // Doesn't fit
      }

      entry.x = cursorX;
      entry.y = shelfY;
      cursorX += entry.w + padding;
      shelfH = Math.max(shelfH, entry.h);
    }

    return true;
  }

  /**
   * Remap object UVs to reference the atlas.
   * @param {THREE.Object3D[]} objects
   * @param {Map} uvMap
   * @param {THREE.CanvasTexture} atlasTexture
   */
  static remapUVs(objects, uvMap, atlasTexture) {
    for (const obj of objects) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];

      for (let i = 0; i < materials.length; i++) {
        const mat = materials[i];
        if (!mat || !mat.map) continue;

        const region = uvMap.get(mat.map.uuid);
        if (!region) continue;

        // Remap UVs for this material group
        const uv = obj.geometry.getAttribute('uv');
        if (uv) {
          // For boxes with multiple materials, we'd need per-group UV remap
          // For simplicity, remap the whole UV attribute
          for (let j = 0; j < uv.count; j++) {
            const u = uv.getX(j);
            const v = uv.getY(j);
            uv.setXY(j,
              region.u0 + u * (region.u1 - region.u0),
              region.v0 + v * (region.v1 - region.v0)
            );
          }
          uv.needsUpdate = true;
        }

        // Point material to atlas texture
        mat.map = atlasTexture;
        mat.needsUpdate = true;
      }
    }
  }
}

function nextPowerOfTwo(v) {
  v--;
  v |= v >> 1;
  v |= v >> 2;
  v |= v >> 4;
  v |= v >> 8;
  v |= v >> 16;
  v++;
  return v;
}
