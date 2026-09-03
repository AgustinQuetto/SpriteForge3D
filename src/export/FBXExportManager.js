import * as THREE from 'three';

const FIRST_OBJECT_ID = 100000;
const FBX_ROTATION_ORDER = 0;
const THREE_EULER_ORDER_FOR_FBX = 'ZYX';

function number(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-10) return '0';
  return String(Number(value.toFixed(6)));
}

function values(items) {
  return items.map(number).join(',');
}

function arrayValues(items, formatter = number, continuationIndent = '', width = 32) {
  const tokens = items.map(formatter);
  const lines = [];
  for (let offset = 0; offset < tokens.length; offset += width) {
    lines.push(tokens.slice(offset, offset + width).join(','));
  }
  return lines.join(`,\n${continuationIndent}`);
}

function quoted(value) {
  return `"${String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')}"`;
}

function safeName(value, fallback = 'Object') {
  const name = String(value || fallback)
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return name || fallback;
}

function stableGuid(value) {
  // Unity only needs a 32-character hexadecimal identifier. Keeping it
  // stable per filename means re-exporting a texture does not create a new
  // asset identity every time the model is updated.
  let hash = 2166136261;
  const input = String(value || 'texture.png');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const parts = [];
  for (let index = 0; index < 4; index += 1) {
    hash ^= index + 1;
    hash = Math.imul(hash, 16777619);
    parts.push((hash >>> 0).toString(16).padStart(8, '0'));
  }
  return parts.join('');
}

function nearestUnityTextureSize(width, height) {
  const largestDimension = Math.max(1, Number(width) || 1, Number(height) || 1);
  const size = 2 ** Math.ceil(Math.log2(largestDimension));
  return Math.min(16384, Math.max(32, size));
}

/**
 * Generate the Unity importer sidecar used by pixel-art textures.
 *
 * The FBX format can reference a PNG but cannot describe Unity-specific
 * sampler/import settings. The sidecar keeps the source pixels intact when
 * the exported folder is copied into Assets/.
 */
export function buildUnityTextureMeta({ filename = 'texture.png', width = 1, height = 1 } = {}) {
  const maxTextureSize = nearestUnityTextureSize(width, height);
  const guid = stableGuid(filename);
  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 13
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: 1
    linearTexture: 0
    fadeOut: 0
    borderMipMap: 0
    mipMapsPreserveCoverage: 0
    alphaTestReferenceValue: 0.5
    mipMapFadeDistanceStart: 1
    mipMapFadeDistanceEnd: 3
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
    flipGreenChannel: 0
  isReadable: 0
  streamingMipmaps: 0
  streamingMipmapsPriority: 0
  vTOnly: 0
  ignoreMipmapLimit: 1
  grayScaleToAlpha: 0
  generateCubemap: 6
  cubemapConvolution: 0
  seamlessCubemap: 0
  textureFormat: 1
  maxTextureSize: ${maxTextureSize}
  textureSettings:
    serializedVersion: 2
    filterMode: 0
    aniso: 1
    mipBias: 0
    wrapU: 0
    wrapV: 0
    wrapW: 0
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 0
  spriteMode: 0
  spriteExtrude: 1
  spriteMeshType: 1
  alignment: 0
  spritePivot: {x: 0.5, y: 0.5}
  spritePixelsToUnits: 100
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: 1
  spriteTessellationDetail: -1
  textureType: 0
  textureShape: 1
  singleChannelComponent: 0
  flipbookRows: 1
  flipbookColumns: 1
  maxTextureSizeSet: 1
  compressionQualitySet: 1
  textureFormatSet: 1
  ignorePngGamma: 0
  applyGammaDecoding: 0
  swizzle: 50462976
  cookieLightType: 0
  platformSettings:
  - serializedVersion: 4
    buildTarget: DefaultTexturePlatform
    maxTextureSize: ${maxTextureSize}
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 0
    compressionQuality: 0
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
  - serializedVersion: 4
    buildTarget: Standalone
    maxTextureSize: ${maxTextureSize}
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 0
    compressionQuality: 0
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
  - serializedVersion: 4
    buildTarget: WebGL
    maxTextureSize: ${maxTextureSize}
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 0
    compressionQuality: 0
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
  spriteSheet:
    serializedVersion: 2
    sprites: []
    outline: []
    customData: 
    physicsShape: []
    bones: []
    spriteID: 
    internalID: 0
    vertices: []
    indices: 
    edges: []
    weights: []
    secondaryTextures: []
    spriteCustomMetadata:
      entries: []
    nameFileIdTable: {}
  mipmapLimitGroupName: 
  pSDRemoveMatte: 0
  userData: 
  assetBundleName: 
  assetBundleVariant: 
`;
}

function materialList(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function materialIndexForOffset(geometry, offset, materialCount) {
  const group = geometry.groups.find(item => (
    offset >= item.start && offset < item.start + item.count
  ));
  const index = group?.materialIndex || 0;
  return Math.min(index, Math.max(0, materialCount - 1));
}

function buildMeshGeometry(mesh, materialCount) {
  const geometry = mesh.geometry;
  const position = geometry?.getAttribute('position');
  if (!position) return null;

  let normal = geometry.getAttribute('normal');
  if (!normal) {
    geometry.computeVertexNormals();
    normal = geometry.getAttribute('normal');
  }

  const uv = geometry.getAttribute('uv');
  const index = geometry.index;
  const drawStart = Math.max(0, geometry.drawRange.start || 0);
  const available = index ? index.count : position.count;
  const drawCount = Number.isFinite(geometry.drawRange.count)
    ? Math.min(Math.max(0, available - drawStart), geometry.drawRange.count)
    : Math.max(0, available - drawStart);

  const vertices = [];
  const normals = [];
  const uvs = [];
  const polygonVertexIndices = [];
  const materialIndices = [];

  for (let offset = 0; offset + 2 < drawCount; offset += 3) {
    const sourceOffsets = [drawStart + offset, drawStart + offset + 1, drawStart + offset + 2];
    const sourceIndices = sourceOffsets.map(sourceOffset => (
      index ? index.getX(sourceOffset) : sourceOffset
    ));
    if (sourceIndices.some(sourceIndex => sourceIndex < 0 || sourceIndex >= position.count)) continue;

    const base = vertices.length / 3;
    const facePositions = sourceIndices.map(sourceIndex => [
      position.getX(sourceIndex),
      position.getY(sourceIndex),
      position.getZ(sourceIndex),
    ]);

    let faceNormal = null;
    if (!normal) {
      const a = new THREE.Vector3().fromArray(facePositions[0]);
      const b = new THREE.Vector3().fromArray(facePositions[1]);
      const c = new THREE.Vector3().fromArray(facePositions[2]);
      faceNormal = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a))
        .normalize();
    }

    sourceIndices.forEach((sourceIndex, corner) => {
      vertices.push(...facePositions[corner]);
      if (normal) {
        normals.push(normal.getX(sourceIndex), normal.getY(sourceIndex), normal.getZ(sourceIndex));
      } else {
        normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
      }
      if (uv) uvs.push(uv.getX(sourceIndex), uv.getY(sourceIndex));
    });

    // FBX closes a polygon by storing the last vertex as -(index + 1).
    polygonVertexIndices.push(base, base + 1, -(base + 2) - 1);
    materialIndices.push(materialIndexForOffset(geometry, drawStart + offset, materialCount));
  }

  if (vertices.length === 0) return null;
  return { vertices, normals, uvs, polygonVertexIndices, materialIndices };
}

function imageSource(texture) {
  const image = texture?.image;
  if (!image) return null;

  const width = Number(image.naturalWidth || image.videoWidth || image.width) || 1;
  const height = Number(image.naturalHeight || image.videoHeight || image.height) || 1;

  let source = image.currentSrc || image.src || '';
  if (!source && typeof image.toDataURL === 'function') source = image.toDataURL();
  if (typeof source !== 'string' || !source) return null;

  if (source.startsWith('data:')) {
    const match = source.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/);
    if (match) {
      const mime = match[1] || 'image/png';
      const extension = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      const base64 = source.includes(';base64,') ? match[2] : null;
      return {
        filename: `texture.${extension}`,
        base64,
        dataUrl: source,
        mimeType: mime,
        externalPath: null,
        width,
        height,
      };
    }
  }

  const filename = source.split(/[\\/]/).pop() || 'texture.png';
  return { filename, base64: null, dataUrl: null, mimeType: null, externalPath: source, width, height };
}

function createTextureRecord(material, materialName, nextId, textureRecords, textureByKey) {
  const map = material?.map;
  if (!map) return null;

  const source = imageSource(map);
  if (!source) return null;
  const repeat = map.repeat || { x: 1, y: 1 };
  const offset = map.offset || { x: 0, y: 0 };
  const key = `${source.base64 || source.externalPath || source.filename}|${repeat.x}|${repeat.y}|${offset.x}|${offset.y}`;
  if (textureByKey.has(key)) return textureByKey.get(key);

  const id = nextId();
  const record = {
    id,
    videoId: nextId(),
    name: safeName(materialName, 'Texture'),
    filename: source.externalPath ? source.filename : null,
    base64: source.base64,
    dataUrl: source.dataUrl,
    mimeType: source.mimeType,
    externalPath: source.externalPath,
    width: source.width,
    height: source.height,
    repeat: [repeat.x, repeat.y],
    offset: [offset.x, offset.y],
  };
  textureRecords.push(record);
  textureByKey.set(key, record);
  return record;
}

function createMaterialRecord(material, name, nextId, textureRecords, textureByKey, materialRecords, materialByObject) {
  if (material && materialByObject.has(material)) return materialByObject.get(material);

  const record = {
    id: nextId(),
    name: safeName(name, 'Material'),
    material,
    texture: null,
  };
  record.texture = createTextureRecord(material, record.name, nextId, textureRecords, textureByKey);
  materialRecords.push(record);
  if (material) materialByObject.set(material, record);
  return record;
}

function materialBlock(record) {
  const color = record.material?.color || new THREE.Color(0xcccccc);
  const opacity = Number.isFinite(record.material?.opacity) ? record.material.opacity : 1;
  const transparency = Math.max(0, Math.min(1, 1 - opacity));
  const shininess = Number.isFinite(record.material?.shininess) ? record.material.shininess : 16;
  return [
    `    Material: ${record.id}, ${quoted(`Material::${record.name}`)}, "" {`,
    '        Version: 102',
    '        ShadingModel: "phong"',
    '        MultiLayer: 0',
    '        Properties70:  {',
    `            P: "DiffuseColor", "Color", "", "A",${values([color.r, color.g, color.b])}`,
    '            P: "DiffuseFactor", "Number", "", "A",1',
    '            P: "SpecularColor", "Color", "", "A",0.15,0.15,0.15',
    `            P: "Shininess", "Number", "", "A",${number(shininess)}`,
    `            P: "Opacity", "Number", "", "A",${number(opacity)}`,
    `            P: "TransparencyFactor", "Number", "", "A",${number(transparency)}`,
    '        }',
    '    }',
  ].join('\n');
}

function geometryBlock(record) {
  const data = record.data;
  const allSameMaterial = data.materialIndices.every(index => index === data.materialIndices[0]);
  const materialValues = allSameMaterial ? [data.materialIndices[0]] : data.materialIndices;
  const lines = [
    `    Geometry: ${record.id}, ${quoted(`Geometry::${record.name}`)}, "Mesh" {`,
    '        GeometryVersion: 124',
    `        Vertices: *${data.vertices.length} {`,
    `            a: ${arrayValues(data.vertices)}`,
    '        }',
    `        PolygonVertexIndex: *${data.polygonVertexIndices.length} {`,
    `            a: ${arrayValues(data.polygonVertexIndices, value => String(value))}`,
    '        }',
    '        LayerElementNormal: 0 {',
    '            Version: 101',
    '            Name: ""',
    '            MappingInformationType: "ByPolygonVertex"',
    '            ReferenceInformationType: "Direct"',
    `            Normals: *${data.normals.length} {`,
    `                a: ${arrayValues(data.normals)}`,
    '            }',
    '        }',
  ];

  if (data.uvs.length) {
    lines.push(
      '        LayerElementUV: 0 {',
      '            Version: 101',
      '            Name: "UVChannel_1"',
      '            MappingInformationType: "ByPolygonVertex"',
      '            ReferenceInformationType: "Direct"',
      `            UV: *${data.uvs.length} {`,
      `                a: ${arrayValues(data.uvs)}`,
      '            }',
      '        }',
    );
  }

  lines.push(
    '        LayerElementMaterial: 0 {',
    '            Version: 101',
    '            Name: ""',
    `            MappingInformationType: "${allSameMaterial ? 'AllSame' : 'ByPolygon'}"`,
    '            ReferenceInformationType: "Direct"',
    `            Materials: *${materialValues.length} {`,
    `                a: ${arrayValues(materialValues, value => String(value))}`,
    '            }',
    '        }',
    '        Layer: 0 {',
    '            Version: 100',
    '            LayerElement:  {',
    '                Type: "LayerElementNormal"',
    '                TypedIndex: 0',
    '            }',
  );
  if (data.uvs.length) {
    lines.push(
      '            LayerElement:  {',
      '                Type: "LayerElementUV"',
      '                TypedIndex: 0',
      '            }',
    );
  }
  lines.push(
    '            LayerElement:  {',
    '                Type: "LayerElementMaterial"',
    '                TypedIndex: 0',
    '            }',
    '        }',
    '    }',
  );
  return lines.join('\n');
}

function videoBlock(record) {
  const lines = [
    `    Video: ${record.videoId}, ${quoted(`Video::${record.filename}`)}, "Clip" {`,
    '        Type: "Clip"',
    '        Properties70:  {',
    `            P: "Path", "KString", "XRefUrl", "",${quoted(record.externalPath || record.filename)}`,
    '        }',
    '        UseMipMap: 0',
    `        Filename: ${quoted(record.externalPath || record.filename)}`,
    `        RelativeFilename: ${quoted(record.filename)}`,
  ];
  lines.push('    }');
  return lines.join('\n');
}

function textureBlock(record) {
  return [
    `    Texture: ${record.id}, ${quoted(`Texture::${record.name}`)}, "" {`,
    '        Type: "TextureVideoClip"',
    '        Version: 202',
    `        TextureName: ${quoted(`Texture::${record.name}`)}`,
    '        Properties70:  {',
    '            P: "CurrentTextureBlendMode", "enum", "", "",0',
    '            P: "UVSet", "KString", "", "", "UVChannel_1"',
    '            P: "UseMaterial", "bool", "", "",1',
    '        }',
    `        Media: ${quoted(`Video::${record.filename}`)}`,
    `        FileName: ${quoted(record.externalPath || record.filename)}`,
    `        RelativeFileName: ${quoted(record.filename)}`,
    `        ModelUVTranslation: ${values(record.offset)}`,
    `        ModelUVScaling: ${values(record.repeat)}`,
    '        UVSet: "UVChannel_1"',
    '        Texture_Alpha_Source: "None"',
    '        Cropping: 0,0,0,0',
    '    }',
  ].join('\n');
}

function modelBlock(record) {
  const node = record.node;
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();

  position.copy(node.position);
  scale.copy(node.scale);

  // FBX stores extrinsic Euler rotations. RotationOrder 0 (FBX XYZ) is the
  // same composition as Three.js intrinsic ZYX, so derive those angles from
  // the quaternion instead of serializing Object3D.rotation (normally XYZ).
  // Mixing Three's XYZ angles with FBX order 0 changes rotations that involve
  // more than one axis and is especially noticeable on cylinders.
  euler.setFromQuaternion(node.quaternion, THREE_EULER_ORDER_FOR_FBX);

  const rotation = [
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z),
  ];
  const type = node.isMesh ? 'Mesh' : 'Null';
  return [
    `    Model: ${record.id}, ${quoted(`Model::${record.name}`)}, "${type}" {`,
    '        Version: 232',
    '        Properties70:  {',
    '            P: "DefaultAttributeIndex", "int", "Integer", "",0',
    `            P: "Lcl Translation", "Lcl Translation", "", "A",${values([position.x, position.y, position.z])}`,
    `            P: "Lcl Rotation", "Lcl Rotation", "", "A",${values(rotation)}`,
    `            P: "Lcl Scaling", "Lcl Scaling", "", "A",${values([scale.x, scale.y, scale.z])}`,
    `            P: "RotationOrder", "enum", "", "A",${FBX_ROTATION_ORDER}`,
    // Three.js composes a child below a scaled parent as parent * local
    // (RSrs in FBX terminology). Declaring this explicitly prevents FBX
    // importers from moving the parent's scale after the child's rotation.
    '            P: "InheritType", "enum", "", "A",1',
    '        }',
    '        Shading: T',
    '        Culling: "CullingOff"',
    '    }',
  ].join('\n');
}

function definitionBlock(type, count, template = '') {
  if (count === 0) return '';
  const lines = [
    `    ObjectType: "${type}" {`,
    `        Count: ${count}`,
  ];
  if (template) {
    lines.push(
      `        PropertyTemplate: "${template.name}" {`,
      '            Properties70:  {',
      ...template.properties.map(property => `                ${property}`),
      '            }',
      '        }',
    );
  }
  lines.push('    }');
  return lines.join('\n') + '\n';
}

const MODEL_TEMPLATE = {
  name: 'FbxNode',
  properties: [
    'P: "QuaternionInterpolate", "enum", "", "",0',
    'P: "RotationOffset", "Vector3D", "Vector", "",0,0,0',
    'P: "RotationPivot", "Vector3D", "Vector", "",0,0,0',
    'P: "ScalingOffset", "Vector3D", "Vector", "",0,0,0',
    'P: "ScalingPivot", "Vector3D", "Vector", "",0,0,0',
    'P: "TranslationActive", "bool", "", "",0',
    'P: "RotationOrder", "enum", "", "",0',
    'P: "InheritType", "enum", "", "",1',
    'P: "GeometricTranslation", "Vector3D", "Vector", "",0,0,0',
    'P: "GeometricRotation", "Vector3D", "Vector", "",0,0,0',
    'P: "GeometricScaling", "Vector3D", "Vector", "",1,1,1',
    'P: "Show", "bool", "", "",1',
    'P: "DefaultAttributeIndex", "int", "Integer", "",-1',
    'P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0',
    'P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0',
    'P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1',
    'P: "Visibility", "Visibility", "", "A",1',
  ],
};

const GEOMETRY_TEMPLATE = {
  name: 'FbxMesh',
  properties: [
    'P: "Color", "ColorRGB", "Color", "",0.8,0.8,0.8',
    'P: "BBoxMin", "Vector3D", "Vector", "",0,0,0',
    'P: "BBoxMax", "Vector3D", "Vector", "",0,0,0',
    'P: "Primary Visibility", "bool", "", "",1',
    'P: "Casts Shadows", "bool", "", "",1',
    'P: "Receive Shadows", "bool", "", "",1',
  ],
};

const MATERIAL_TEMPLATE = {
  name: 'FbxSurfacePhong',
  properties: [
    'P: "ShadingModel", "KString", "", "", "Phong"',
    'P: "MultiLayer", "bool", "", "",0',
    'P: "EmissiveColor", "Color", "", "A",0,0,0',
    'P: "EmissiveFactor", "Number", "", "A",1',
    'P: "AmbientColor", "Color", "", "A",0.2,0.2,0.2',
    'P: "AmbientFactor", "Number", "", "A",1',
    'P: "DiffuseColor", "Color", "", "A",0.8,0.8,0.8',
    'P: "DiffuseFactor", "Number", "", "A",1',
    'P: "TransparentColor", "Color", "", "A",0,0,0',
    'P: "TransparencyFactor", "Number", "", "A",0',
    'P: "SpecularColor", "Color", "", "A",0.2,0.2,0.2',
    'P: "SpecularFactor", "Number", "", "A",1',
    'P: "ShininessExponent", "Number", "", "A",20',
    'P: "ReflectionColor", "Color", "", "A",0,0,0',
    'P: "ReflectionFactor", "Number", "", "A",1',
  ],
};

const TEXTURE_TEMPLATE = {
  name: 'FbxFileTexture',
  properties: [
    'P: "TextureTypeUse", "enum", "", "",0',
    'P: "Texture alpha", "Number", "", "A",1',
    'P: "CurrentMappingType", "enum", "", "",0',
    'P: "WrapModeU", "enum", "", "",0',
    'P: "WrapModeV", "enum", "", "",0',
    'P: "UVSwap", "bool", "", "",0',
    'P: "PremultiplyAlpha", "bool", "", "",1',
    'P: "Translation", "Vector", "", "A",0,0,0',
    'P: "Rotation", "Vector", "", "A",0,0,0',
    'P: "Scaling", "Vector", "", "A",1,1,1',
    'P: "UVSet", "KString", "", "", "default"',
    'P: "UseMaterial", "bool", "", "",0',
    'P: "UseMipMap", "bool", "", "",0',
  ],
};

/**
 * Build a Unity-compatible ASCII FBX 7.3 document from a Three.js object
 * hierarchy. The browser cannot rely on a native/binary FBX SDK, so the
 * document includes the standard metadata sections expected by Unity's FBX
 * importer.
 */
function buildFBXDocument(exportRoot, { texturePrefix = 'texture' } = {}) {
  exportRoot.updateMatrixWorld(true);

  let nextIdValue = FIRST_OBJECT_ID;
  const nextId = () => nextIdValue++;
  const modelRecords = [];
  const geometryRecords = [];
  const materialRecords = [];
  const textureRecords = [];
  const textureByKey = new Map();
  const materialByObject = new WeakMap();
  const modelByNode = new Map();
  const usedNames = new Map();

  const uniqueName = value => {
    const base = safeName(value);
    const count = (usedNames.get(base) || 0) + 1;
    usedNames.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  };

  exportRoot.traverse(node => {
    if (node === exportRoot || (!node.isGroup && !node.isMesh)) return;

    const data = node.isMesh ? buildMeshGeometry(node, materialList(node).length) : null;
    if (node.isMesh && !data) return;

    const model = {
      id: nextId(),
      node,
      name: uniqueName(node.name || (node.isMesh ? 'Mesh' : 'Group')),
      geometry: null,
      materials: [],
    };
    modelRecords.push(model);
    modelByNode.set(node, model);

    if (!node.isMesh) return;

    model.geometry = {
      id: nextId(),
      name: `${model.name}_Geometry`,
      data,
    };
    geometryRecords.push(model.geometry);

    materialList(node).forEach((material, index) => {
      model.materials.push(createMaterialRecord(
        material,
        `${model.name}_Material_${index + 1}`,
        nextId,
        textureRecords,
        textureByKey,
        materialRecords,
        materialByObject,
      ));
    });
  });

  if (geometryRecords.length === 0) throw new Error('No meshes found to export as FBX');

  const safeTexturePrefix = safeName(texturePrefix, 'texture');
  textureRecords.forEach((texture, index) => {
    if (!texture.filename) {
      const extension = texture.dataUrl?.match(/^data:image\/([^;,]+)/i)?.[1]
        ?.replace('jpeg', 'jpg') || 'png';
      texture.filename = `${safeTexturePrefix}_texture_${index + 1}.${extension}`;
    }
  });

  const connections = [];
  const parentModelRecord = record => {
    let parent = record.node.parent;
    while (parent && parent !== exportRoot && !modelByNode.has(parent)) parent = parent.parent;
    return parent && modelByNode.get(parent);
  };

  modelRecords.forEach(record => {
    if (record.geometry) connections.push(`    C: "OO", ${record.geometry.id}, ${record.id}`);
    record.materials.forEach(material => {
      connections.push(`    C: "OO", ${material.id}, ${record.id}`);
    });

    const parentRecord = parentModelRecord(record);
    connections.push(`    C: "OO", ${record.id}, ${parentRecord ? parentRecord.id : 0}`);
  });

  textureRecords.forEach(texture => {
    connections.push(`    C: "OO", ${texture.videoId}, ${texture.id}`);
  });
  materialRecords.forEach(material => {
    if (material.texture) {
      connections.push(`    C: "OP", ${material.texture.id}, ${material.id}, "DiffuseColor"`);
    }
  });

  const totalObjects = modelRecords.length
    + geometryRecords.length
    + materialRecords.length
    + textureRecords.length * 2;
  const objectBlocks = [
    ...geometryRecords.map(geometryBlock),
    ...modelRecords.map(modelBlock),
    ...materialRecords.map(materialBlock),
    ...textureRecords.map(videoBlock),
    ...textureRecords.map(textureBlock),
  ].join('\n');

  const fbxText = `; FBX 7.3.0 project file
; Created by SpriteForge3D
FBXHeaderExtension:  {
    FBXHeaderVersion: 1003
    FBXVersion: 7300
    Creator: "FBX SDK"
}
Documents:  {
    Count: 1
    Document: 1, "", "Scene" {
    }
}
References:  {
}
Definitions:  {
    Version: 100
    Count: ${totalObjects}
${definitionBlock('Geometry', geometryRecords.length, GEOMETRY_TEMPLATE)}${definitionBlock('Model', modelRecords.length, MODEL_TEMPLATE)}${definitionBlock('Material', materialRecords.length, MATERIAL_TEMPLATE)}${definitionBlock('Video', textureRecords.length)}${definitionBlock('Texture', textureRecords.length, TEXTURE_TEMPLATE)}}
Objects:  {
${objectBlocks}
}
Connections:  {
${connections.join('\n')}
}
Takes:  {
    Current: ""
}
`;
  return {
    ascii: fbxText.replace(/^( {4})+/gm, match => '\t'.repeat(match.length / 4)),
    textures: textureRecords,
  };
}

export function buildAsciiFBX(exportRoot, options = {}) {
  return buildFBXDocument(exportRoot, options).ascii;
}

async function textureBlob(record) {
  if (record.dataUrl && typeof fetch === 'function') {
    try {
      const response = await fetch(record.dataUrl);
      if (response.ok) return response.blob();
    } catch {
      // Fall back to decoding base64 below when fetch cannot handle the data URL.
    }
  }

  if (!record.base64 || typeof atob !== 'function') return null;
  const binary = atob(record.base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: record.mimeType || 'image/png' });
}

function textureMetaBlob(record) {
  return new Blob([
    buildUnityTextureMeta({
      filename: record.filename,
      width: record.width,
      height: record.height,
    }),
  ], { type: 'text/plain' });
}

export class FBXExportManager {
  static async export(exportGroup, defaultFilename = 'sprite3d-model') {
    if (!exportGroup) throw new Error('No objects to export');

    const clone = exportGroup.clone(true);
    clone.updateMatrixWorld(true);
    const filename = `${defaultFilename}.fbx`;
    const { ascii, textures } = buildFBXDocument(clone, { texturePrefix: defaultFilename });
    const blob = new Blob([ascii], { type: 'application/octet-stream' });
    const textureAssets = [];
    for (const texture of textures) {
      const assetBlob = await textureBlob(texture);
      if (assetBlob) {
        textureAssets.push({
          blob: assetBlob,
          filename: texture.filename,
          metaBlob: textureMetaBlob(texture),
          metaFilename: `${texture.filename}.meta`,
        });
      }
    }

    if (textureAssets.length && typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
      let directoryHandle;
      try {
        directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch (error) {
        if (error?.name === 'AbortError') return null;
        throw error;
      }

      await FBXExportManager._writeFile(directoryHandle, filename, blob);
      for (const asset of textureAssets) {
        await FBXExportManager._writeFile(directoryHandle, asset.filename, asset.blob);
        await FBXExportManager._writeFile(directoryHandle, asset.metaFilename, asset.metaBlob);
      }
      return { blob, textureCount: textureAssets.length };
    }

    let fileHandle = null;
    if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'Autodesk FBX ASCII Model',
            accept: { 'application/octet-stream': ['.fbx'] },
          }],
        });
      } catch (error) {
        if (error?.name === 'AbortError') return null;
        throw error;
      }
    }

    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      FBXExportManager._download(blob, filename);
    }

    textureAssets.forEach((asset, index) => {
      FBXExportManager._download(asset.blob, asset.filename, (index + 1) * 250);
      FBXExportManager._download(asset.metaBlob, asset.metaFilename, (index + 1) * 250 + 125);
    });

    return { blob, textureCount: textureAssets.length };
  }

  static async _writeFile(directoryHandle, filename, blob) {
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  static _download(blob, filename, delay = 0) {
    const download = () => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    if (delay > 0) setTimeout(download, delay);
    else download();
  }
}
