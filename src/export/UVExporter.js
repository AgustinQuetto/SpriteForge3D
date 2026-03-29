import * as THREE from 'three';
import { UVUnwrapper } from 'xatlas-three';
import { UVsDebug } from 'three/addons/utils/UVsDebug.js';
import xatlasWorkerUrl from 'xatlasjs/dist/xatlas.js?url';
import xatlasWasmUrl from 'xatlasjs/dist/xatlas.wasm?url';
 
/**
 * UVExporter — Generates 2D texture templates for 3D meshes.
 * Focused on extruded quads and primitives.
 */
export class UVExporter {
  static _unwrapper = null;
  static _libLoaded = false;

  static async generateRealLayout(mesh, resolution = 1024, options = {}) {
    const { applyToMesh = true } = options;
    if (!mesh?.geometry) {
      throw new Error('No mesh geometry selected');
    }

    const safeResolution = this._sanitizeResolution(resolution);
    await this._ensureXAtlasLoaded();

    const workGeometry = await this._unwrapGeometryForRealUV(mesh);

    if (applyToMesh) {
      this._applyGeometryToMesh(mesh, workGeometry);
    }

    const debugCanvas = UVsDebug(workGeometry, safeResolution);
    if (!debugCanvas) {
      throw new Error('Failed to generate UV debug canvas');
    }

    const canvas = document.createElement('canvas');
    canvas.width = safeResolution;
    canvas.height = safeResolution;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#121420';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(debugCanvas, 0, 0, safeResolution, safeResolution);

    this._downloadCanvas(mesh, canvas, '_uv_layout_real.png');
  }

  static async applyRealUVToMesh(mesh) {
    if (!mesh?.geometry) {
      throw new Error('No mesh geometry selected');
    }
    await this._ensureXAtlasLoaded();
    const workGeometry = await this._unwrapGeometryForRealUV(mesh);
    this._applyGeometryToMesh(mesh, workGeometry);
  }

  /**
   * Generates a UV layout PNG for the given mesh.
   * @param {THREE.Mesh} mesh 
   * @param {number} resolution - Base resolution (e.g., 256, 512, 1024)
   */
  static generateTemplate(mesh, resolution = 512) {
    const geometry = mesh.geometry;
    const uvAttr = geometry?.getAttribute?.('uv');
    if (!uvAttr || uvAttr.count === 0) {
      throw new Error('Selected mesh has no UVs to export');
    }

    const transformedUvs = this._collectTransformedUVs(mesh, geometry, uvAttr);
    const bounds = this._computeBounds(transformedUvs);

    // Guard against degenerate UV islands.
    if (!Number.isFinite(bounds.minU) || !Number.isFinite(bounds.minV)) {
      throw new Error('Could not compute UV bounds');
    }

    const safeResolution = this._sanitizeResolution(resolution);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = safeResolution;
    canvas.height = safeResolution;

    const padding = Math.max(16, Math.round(safeResolution * 0.035));
    const drawable = safeResolution - padding * 2;
    const rangeU = Math.max(1e-6, bounds.maxU - bounds.minU);
    const rangeV = Math.max(1e-6, bounds.maxV - bounds.minV);
    const maxRange = Math.max(rangeU, rangeV);
    const scale = drawable / maxRange;
    const drawWidth = rangeU * scale;
    const drawHeight = rangeV * scale;
    const offsetX = padding + (drawable - drawWidth) * 0.5;
    const offsetY = padding + (drawable - drawHeight) * 0.5;

    // Solid background for broad image viewer compatibility.
    ctx.fillStyle = '#1a1d28';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
 
    this._drawGrid(ctx, safeResolution, padding, drawWidth, drawHeight, offsetX, offsetY);
    this._drawTriangles(ctx, transformedUvs, bounds, scale, offsetX, offsetY);
    this._drawBounds(ctx, offsetX, offsetY, drawWidth, drawHeight, safeResolution);
    this._drawLegend(ctx, mesh, safeResolution, bounds);
 
    this._downloadCanvas(mesh, canvas, '_uv_layout.png');
  }
 
  static _sanitizeResolution(resolution) {
    const value = Math.round(Number(resolution) || 1024);
    return THREE.MathUtils.clamp(value, 256, 8192);
  }

  static _getTextureForMaterial(mesh, materialIndex = 0) {
    if (Array.isArray(mesh.material)) {
      const mat = mesh.material[materialIndex] ?? mesh.material[0];
      return mat?.map || null;
    }
    return mesh.material?.map || null;
  }

  static _transformUV(uv, texture) {
    if (!texture) return uv;
    // Use raw UV matrix (repeat/offset/rotation/center) without wrapping
    // so exported coordinates remain numerically accurate.
    texture.updateMatrix();
    uv.applyMatrix3(texture.matrix);
    return uv;
  }

  static _collectTransformedUVs(mesh, geometry, uvAttr) {
    const triangles = [];
    const index = geometry.getIndex();
    const src = index ? index.array : null;
    const groups = geometry.groups && geometry.groups.length > 0
      ? geometry.groups
      : [{ start: 0, count: index ? src.length : uvAttr.count, materialIndex: 0 }];

    const getUV = (vertexIndex, texture) => {
      const uv = new THREE.Vector2(uvAttr.getX(vertexIndex), uvAttr.getY(vertexIndex));
      return this._transformUV(uv, texture);
    };

    for (const group of groups) {
      const materialIndex = group.materialIndex || 0;
      const texture = this._getTextureForMaterial(mesh, materialIndex);
      const start = group.start;
      const end = group.start + group.count;

      for (let i = start; i + 2 < end; i += 3) {
        const aIndex = index ? src[i] : i;
        const bIndex = index ? src[i + 1] : i + 1;
        const cIndex = index ? src[i + 2] : i + 2;

        triangles.push({
          materialIndex,
          uvs: [getUV(aIndex, texture), getUV(bIndex, texture), getUV(cIndex, texture)]
        });
      }
    }

    return triangles;
  }

  static _computeBounds(triangles) {
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;

    for (const tri of triangles) {
      for (const uv of tri.uvs) {
        if (!Number.isFinite(uv.x) || !Number.isFinite(uv.y)) continue;
        if (uv.x < minU) minU = uv.x;
        if (uv.y < minV) minV = uv.y;
        if (uv.x > maxU) maxU = uv.x;
        if (uv.y > maxV) maxV = uv.y;
      }
    }
    return { minU, minV, maxU, maxV };
  }

  static _uvToCanvas(uv, bounds, scale, offsetX, offsetY) {
    const x = offsetX + (uv.x - bounds.minU) * scale;
    const y = offsetY + (bounds.maxV - uv.y) * scale;
    return { x, y };
  }

  static _drawGrid(ctx, resolution, padding, drawWidth, drawHeight, offsetX, offsetY) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = Math.max(1, resolution / 1024);
    ctx.setLineDash([4, 6]);

    const divisions = 10;
    for (let i = 0; i <= divisions; i++) {
      const t = i / divisions;
      const x = offsetX + drawWidth * t;
      const y = offsetY + drawHeight * t;
      ctx.beginPath();
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + drawHeight);
      ctx.moveTo(offsetX, y);
      ctx.lineTo(offsetX + drawWidth, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  static _drawTriangles(ctx, triangles, bounds, scale, offsetX, offsetY) {
    ctx.save();
    ctx.strokeStyle = '#80b2ff';
    ctx.fillStyle = 'rgba(128,178,255,0.12)';
    ctx.lineWidth = Math.max(1.2, scale * 0.004);
    ctx.lineJoin = 'round';

    for (const tri of triangles) {
      const hue = (tri.materialIndex * 57) % 360;
      ctx.strokeStyle = `hsl(${hue} 90% 72%)`;
      ctx.fillStyle = `hsl(${hue} 90% 62% / 0.12)`;

      const a = this._uvToCanvas(tri.uvs[0], bounds, scale, offsetX, offsetY);
      const b = this._uvToCanvas(tri.uvs[1], bounds, scale, offsetX, offsetY);
      const c = this._uvToCanvas(tri.uvs[2], bounds, scale, offsetX, offsetY);

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  static _drawBounds(ctx, x, y, w, h, resolution) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, resolution / 512);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  static _drawLegend(ctx, mesh, resolution, bounds) {
    const type = mesh.userData.type || 'mesh';
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `600 ${Math.max(12, Math.round(resolution * 0.018))}px Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${mesh.name || 'object'} (${type})`, 12, 10);

    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = `${Math.max(10, Math.round(resolution * 0.013))}px Inter, sans-serif`;
    ctx.fillText(
      `U:[${bounds.minU.toFixed(4)}, ${bounds.maxU.toFixed(4)}]  V:[${bounds.minV.toFixed(4)}, ${bounds.maxV.toFixed(4)}]`,
      12,
      12 + Math.max(14, Math.round(resolution * 0.024))
    );
    ctx.restore();
  }

  static _downloadCanvas(mesh, canvas, suffix) {
    const safeName = (mesh.name || 'object').replace(/[^a-z0-9_\-]/gi, '_');
    const filename = `${safeName}${suffix}`;
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }, 'image/png');
  }

  static _ensureIndexedGeometry(geometry) {
    if (geometry.getIndex()) return geometry;

    const indexed = geometry.clone();
    const vertexCount = indexed.getAttribute('position')?.count || 0;
    const indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) indices[i] = i;
    indexed.setIndex(new THREE.BufferAttribute(indices, 1));
    return indexed;
  }

  static _applyGeometryToMesh(mesh, geometry) {
    const previousGeometry = mesh.geometry;
    mesh.geometry = geometry.clone();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeVertexNormals();
    mesh.userData.realUVApplied = true;
    previousGeometry.dispose();
  }

  static async _unwrapGeometryForRealUV(mesh) {
    // Work on a clone so we do not mutate selected mesh while computing.
    let workGeometry = mesh.geometry.clone();
    workGeometry = this._ensureIndexedGeometry(workGeometry);

    // xatlas writes new UVs to "uv" and keeps existing UVs in "uv2".
    await this._unwrapper.unwrapGeometry(workGeometry, 'uv', 'uv2');
    return workGeometry;
  }

  static async _ensureXAtlasLoaded() {
    if (this._libLoaded && this._unwrapper) return;
    if (!this._unwrapper) {
      this._unwrapper = new UVUnwrapper({ BufferAttribute: THREE.BufferAttribute }, {
        resolution: 2048,
        padding: 2,
        bilinear: true,
        rotateCharts: true,
        rotateChartsToAxis: true
      }, {
        fixWinding: true,
        useInputMeshUvs: false
      });
    }

    const wasmAbsoluteUrl = new URL(xatlasWasmUrl, window.location.href).href;
    const workerAbsoluteUrl = new URL(xatlasWorkerUrl, window.location.href).href;

    await this._unwrapper.loadLibrary(
      () => {},
      wasmAbsoluteUrl,
      workerAbsoluteUrl
    );
    this._libLoaded = true;
  }
 
  /**
   * Applies an atlas texture to a box mesh, mapping the 3x2 layout.
   * @param {THREE.Mesh} mesh 
   * @param {THREE.Texture} texture 
   */
  static applyAtlas(mesh, texture) {
    const applyDirectTexture = () => {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => {
          if (!mat) return;
          const tex = texture.clone();
          tex.needsUpdate = true;
          mat.map = tex;
          mat.needsUpdate = true;
        });
      } else if (mesh.material) {
        mesh.material.map = texture;
        mesh.material.needsUpdate = true;
      }
    };

    if (mesh.userData.realUVApplied) {
      applyDirectTexture();
      return;
    }

    if (mesh.userData.type !== 'box') {
      applyDirectTexture();
      return;
    }
 
    // Box has 6 faces: [+x, -x, +y, -y, +z, -z]
    // Indices: 0:Right, 1:Left, 2:Top, 3:Bottom, 4:Front, 5:Back
    const faces = [
      { name: 'Right',  idx: 0, col: 2, row: 1 },
      { name: 'Left',   idx: 1, col: 1, row: 1 },
      { name: 'Top',    idx: 2, col: 2, row: 0 },
      { name: 'Bottom', idx: 3, col: 0, row: 1 },
      { name: 'Front',  idx: 4, col: 0, row: 0 },
      { name: 'Back',   idx: 5, col: 1, row: 0 }
    ];
 
    if (!Array.isArray(mesh.material)) {
      mesh.material = Array(6).fill(null).map(() => mesh.material.clone());
    }
 
    faces.forEach(f => {
      const tex = texture.clone();
      tex.repeat.set(1/3, 1/2);
      tex.offset.set(f.col/3, (1 - f.row/2) - 1/2); // Y is flipped in offset
      tex.needsUpdate = true;
      
      mesh.material[f.idx].map = tex;
      mesh.material[f.idx].needsUpdate = true;
    });
  }
}
