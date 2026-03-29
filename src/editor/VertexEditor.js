import * as THREE from 'three';

export class VertexEditor {
  constructor(scene) {
    this.scene = scene; // The THREE.Scene
    this.activeMesh = null;
    this.controlPoints = [];
    
    this.group = new THREE.Group();
    this.group.name = 'VertexEditorControls';
    this.scene.add(this.group);
    
    this.pointGeo = new THREE.SphereGeometry(0.04, 16, 16);
    this.pointMat = new THREE.MeshBasicMaterial({ color: 0xff0055, depthTest: false });
    this.pointMat.renderOrder = 999; // ensure they render on top
  }
  
  enable(mesh) {
    this.disable();
    if (!mesh || !mesh.geometry) return;
    this.activeMesh = mesh;
    
    const posAttribute = mesh.geometry.attributes.position;
    const vertexMap = new Map();
    
    // Important: we must update matrix world to ensure accurate positions
    mesh.updateMatrixWorld(true);
    const worldMatrix = mesh.matrixWorld;
    
    for (let i = 0; i < posAttribute.count; i++) {
       const v = new THREE.Vector3().fromBufferAttribute(posAttribute, i);
       // Group by precise local coordinate string
       const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
       if (!vertexMap.has(key)) {
         vertexMap.set(key, { position: v.clone(), indices: [] });
       }
       vertexMap.get(key).indices.push(i);
    }
    
    vertexMap.forEach((data, key) => {
       const point = new THREE.Mesh(this.pointGeo, this.pointMat);
       
       // Position point in world space
       const worldPos = data.position.clone().applyMatrix4(worldMatrix);
       point.position.copy(worldPos);
       
       // Note: renderOrder only helps if depthTest is off/false. 
       // Above we set depthTest: false to see points through the mesh.

       point.userData = {
         isVertexControl: true,
         parentMesh: mesh,
         indices: data.indices
       };
       
       this.group.add(point);
       this.controlPoints.push(point);
    });
  }
  
  disable() {
    this.group.clear();
    this.controlPoints = [];
    this.activeMesh = null;
  }
  
  updateMeshGeometry(controlPoint) {
     if (!this.activeMesh) return;
     const mesh = this.activeMesh;
     
     // control points are in world space, convert back to mesh local space
     const localPos = controlPoint.position.clone();
     
     // we invert the mesh's world matrix to get world->local
     const invMat = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
     localPos.applyMatrix4(invMat);
     
     const posAttribute = mesh.geometry.attributes.position;
     
     controlPoint.userData.indices.forEach(idx => {
       posAttribute.setXYZ(idx, localPos.x, localPos.y, localPos.z);
     });
     
     posAttribute.needsUpdate = true;
     mesh.geometry.computeVertexNormals();
     
     // also update the bounding box/sphere
     mesh.geometry.computeBoundingBox();
     mesh.geometry.computeBoundingSphere();
  }
}
