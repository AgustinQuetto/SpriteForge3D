import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

const libredwgWasmUrl = new URL(
  '../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm',
  import.meta.url,
);

export const MODEL_EXTENSIONS = ['obj', 'gltf', 'glb', 'stl', 'ply', 'fbx', 'dae', 'dwg', 'dxf'];
export const MODEL_ACCEPT = MODEL_EXTENSIONS.map(extension => `.${extension}`).join(',');

function extensionOf(name = '') {
  return name.split('.').pop()?.toLowerCase() || '';
}

function decodeText(buffer) {
  return new TextDecoder().decode(buffer);
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function createDefaultMaterial({ vertexColors = false } = {}) {
  return new THREE.MeshStandardMaterial({
    color: 0xb7c4d6,
    roughness: 0.72,
    metalness: 0.08,
    vertexColors,
  });
}

function makeRoot(object, name, format) {
  const root = object?.isObject3D ? object : new THREE.Group();
  if (!object?.isObject3D) root.add(object);
  root.name = name || root.name || `Imported ${format.toUpperCase()}`;
  root.userData.type = 'imported-3d';
  root.userData.imported3DFormat = format;
  root.traverse(node => {
    if (!node.isMesh && !node.isLine && !node.isPoints) return;
    node.userData.importedRoot = root;
    node.castShadow = false;
    node.receiveShadow = false;
  });
  return root;
}

function parseGltf(buffer, name) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', result => resolve(makeRoot(result.scene, name, extensionOf(name))), reject);
  });
}

function parseDwg(buffer, name, format) {
  return import('@mlightcad/libredwg-web').then(async ({ Dwg_File_Type, LibreDwg }) => {
    const wasmDirectory = new URL('.', libredwgWasmUrl).href;
    const libredwg = await LibreDwg.create(wasmDirectory);
    const data = libredwg.dwg_read_data(buffer, format === 'dxf' ? Dwg_File_Type.DXF : Dwg_File_Type.DWG);
    if (!data) throw new Error('El archivo DWG no pudo ser leído.');

    try {
      const database = libredwg.convert(data);
      const svg = libredwg.dwg_to_svg(database);
      if (!svg) throw new Error('El archivo DWG no contiene geometría visible.');

      const parsed = new SVGLoader().parse(svg);
      const group = new THREE.Group();
      parsed.paths.forEach(path => {
        const color = new THREE.Color(path.color || '#d8e2f0');
        const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
        path.subPaths?.forEach(subPath => {
          const points = subPath.getPoints();
          if (points.length < 2) return;
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          group.add(new THREE.Line(geometry, material));
        });
      });
      if (group.children.length === 0) throw new Error('El archivo DWG no contiene líneas importables.');

      // DWG/SVG is a 2D CAD drawing. Lay it flat on SpriteForge's XZ ground plane.
      group.rotation.x = -Math.PI / 2;
      return makeRoot(group, name, format);
    } finally {
      libredwg.dwg_free(data);
    }
  });
}

export async function importModelBuffer(buffer, { name = 'model', format = extensionOf(name) } = {}) {
  const normalizedFormat = format.toLowerCase();
  let root;

  switch (normalizedFormat) {
    case 'obj': {
      const loader = new OBJLoader();
      root = loader.parse(decodeText(buffer));
      break;
    }
    case 'stl': {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      root = new THREE.Mesh(geometry, createDefaultMaterial());
      break;
    }
    case 'ply': {
      const geometry = new PLYLoader().parse(buffer);
      if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
      root = new THREE.Mesh(geometry, createDefaultMaterial({ vertexColors: !!geometry.hasAttribute('color') }));
      break;
    }
    case 'fbx':
      root = new FBXLoader().parse(buffer, '');
      break;
    case 'dae': {
      const result = new ColladaLoader().parse(decodeText(buffer), '');
      root = result.scene;
      break;
    }
    case 'gltf':
    case 'glb':
      return parseGltf(buffer, name);
    case 'dwg':
    case 'dxf':
      return parseDwg(buffer, name, normalizedFormat);
    default:
      throw new Error(`Formato 3D no compatible: .${normalizedFormat || 'desconocido'}`);
  }

  return makeRoot(root, name, normalizedFormat);
}

export async function importModelFile(file) {
  const format = extensionOf(file.name);
  if (!MODEL_EXTENSIONS.includes(format)) {
    throw new Error(`Formato no compatible: .${format || 'desconocido'}`);
  }
  const buffer = await file.arrayBuffer();
  const root = await importModelBuffer(buffer, { name: file.name, format });
  return {
    root,
    name: file.name,
    format,
    sourceBase64: arrayBufferToBase64(buffer),
  };
}

export async function importModelSource(sourceBase64, { name = 'model', format } = {}) {
  if (!sourceBase64) throw new Error('El proyecto no contiene los datos del modelo importado.');
  const resolvedFormat = (format || extensionOf(name)).toLowerCase();
  const root = await importModelBuffer(base64ToArrayBuffer(sourceBase64), {
    name,
    format: resolvedFormat,
  });
  return { root, name, format: resolvedFormat };
}
