import * as THREE from 'three';

export async function loadProjectAssets(records, signal) {
  const results = await Promise.allSettled(records.map(record => new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); image.onload = image.onerror = null; };
    const fail = error => { cleanup(); reject(error); };
    const abort = () => fail(new DOMException('Project load cancelled', 'AbortError'));
    const timeout = setTimeout(() => fail(new Error(`Sprite timed out: ${record.name}`)), 20000);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    image.onerror = () => fail(new Error(`Could not decode sprite: ${record.name}`));
    image.onload = () => {
      cleanup();
      const texture = new THREE.Texture(image); texture.needsUpdate = true;
      texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestMipMapLinearFilter;
      resolve({ ...record, texture, image });
    };
    image.src = record.dataUrl;
  })));
  const error = results.find(result => result.status === 'rejected');
  const assets = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (error) { assets.forEach(asset => asset.texture.dispose()); throw error.reason; }
  return assets;
}

export function restoreEditorReferences(root, assets, baseAssets = []) {
  const byName = new Map(assets.map(asset => [asset.name, asset]));
  const bySource = new Map([...assets, ...baseAssets].map(asset => [asset.dataUrl, asset]));
  root.traverse(node => {
    for (const [key, Type] of [['voxelActiveMap', Uint8Array], ['voxelColorMap', Uint8Array], ['voxelSelection', Uint8Array], ['voxelDepthMap', Uint16Array]]) {
      if (Array.isArray(node.userData[key])) node.userData[key] = new Type(node.userData[key]);
    }
    const asset = bySource.get(node.userData.projectTextureSource) || byName.get(node.userData.textureName);
    const materialTexture = [node.material].flat().find(material => material?.map)?.map;
    if (asset || materialTexture) {
      node.userData.texture = asset?.texture || materialTexture;
      node.userData.textureImage = asset?.image || materialTexture.image;
      if (node.userData.voxelized && materialTexture) node.userData.voxelBakedTexture = materialTexture;
    }
    if (node.userData.type === 'imported-3d') node.traverse(child => {
      if (child.isMesh || child.isLine || child.isPoints) child.userData.importedRoot = node;
    });
  });
}
