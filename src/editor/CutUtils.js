import * as THREE from 'three';

// ──────────────────────────────────────────── Vertex Snap ──

/**
 * Scans all mesh vertices in XZ space and returns the closest one to worldPos,
 * projected onto Y=0, or null if none is within threshold.
 */
export function findNearestVertex(worldPos, objects, threshold) {
  let best = null;
  let bestDist = threshold;

  const v = new THREE.Vector3();

  for (const mesh of objects) {
    const buf = mesh.geometry?.attributes?.position;
    if (!buf) continue;
    const arr = buf.array;

    for (let i = 0; i < arr.length; i += 3) {
      v.set(arr[i], arr[i + 1], arr[i + 2]);
      mesh.localToWorld(v);

      const dx = v.x - worldPos.x;
      const dz = v.z - worldPos.z;
      const d = Math.sqrt(dx * dx + dz * dz);

      if (d < bestDist) {
        bestDist = d;
        best = new THREE.Vector3(v.x, 0, v.z);
      }
    }
  }

  return best;
}

// ──────────────────────────────────────────── Line Math ──

/**
 * Infinite-line vs finite-segment intersection on XZ plane.
 * Line: parameterised through (ax,az)→(bx,bz), extended to infinity.
 * Segment: (cx,cz)→(dx,dz).
 * Returns { point: Vector3, u } where u ∈ (0,1) is position along the segment,
 * or null if parallel / not intersecting the segment interior.
 */
export function lineIntersectSegment(ax, az, bx, bz, cx, cz, dx, dz) {
  const lx = bx - ax, lz = bz - az; // line direction
  const sx = dx - cx, sz = dz - cz; // segment direction

  const denom = lx * sz - lz * sx;
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const t = ((cx - ax) * sz - (cz - az) * sx) / denom; // position along line (unused)
  const u = ((cx - ax) * lz - (cz - az) * lx) / denom; // position along segment

  if (u <= 1e-6 || u >= 1 - 1e-6) return null; // misses segment interior

  const px = cx + u * sx;
  const pz = cz + u * sz;
  return { point: new THREE.Vector3(px, 0, pz), u };
}

/**
 * Splits a convex or concave XZ polygon by an infinite line through (ax,az)→(bx,bz).
 * Returns [poly1_pts, poly2_pts] (each Vector3[]) or null if the line doesn't
 * produce exactly 2 interior edge intersections.
 */
export function splitPolygon(pts, ax, az, bx, bz) {
  const n = pts.length;
  const intersections = []; // { edgeIndex, point }

  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const hit = lineIntersectSegment(ax, az, bx, bz, p1.x, p1.z, p2.x, p2.z);
    if (hit) {
      intersections.push({ edgeIndex: i, point: hit.point });
    }
  }

  if (intersections.length !== 2) return null;

  // Ensure sorted by edge index so traversal is consistent
  intersections.sort((a, b) => a.edgeIndex - b.edgeIndex);
  const [iA, iB] = intersections;

  // Polygon 1: iA.point → vertices (iA.edgeIndex+1 … iB.edgeIndex) → iB.point
  const poly1 = [iA.point.clone()];
  for (let i = iA.edgeIndex + 1; i <= iB.edgeIndex; i++) {
    poly1.push(pts[i].clone());
  }
  poly1.push(iB.point.clone());

  // Polygon 2: iB.point → vertices (iB.edgeIndex+1 … wrap … iA.edgeIndex) → iA.point
  const poly2 = [iB.point.clone()];
  for (let i = iB.edgeIndex + 1; i < iB.edgeIndex + 1 + (n - iB.edgeIndex - 1 + iA.edgeIndex + 1); i++) {
    poly2.push(pts[i % n].clone());
  }
  poly2.push(iA.point.clone());

  // Reject degenerate (collinear) results
  if (poly1.length < 3 || poly2.length < 3) return null;

  return [poly1, poly2];
}

// ──────────────────────────────────────────── Mesh Helpers ──

/**
 * Returns the XZ footprint of a mesh as Vector3[] on Y=0, or null if not supported.
 */
export function meshToXZPolygon(mesh) {
  const type = mesh.userData.type;

  if (type === 'polygon') {
    const pts = mesh.userData.shapePoints;
    if (!pts || pts.length < 3) return null;
    return pts.map(p => new THREE.Vector3(p.x, 0, p.z));
  }

  // Box or extruded quad — both use BoxGeometry
  if ((type === 'box' || type === 'quad') && mesh.geometry.isBufferGeometry) {
    const p = mesh.geometry.parameters;
    if (!p || !p.width || !p.depth) return null;

    const hw = p.width / 2;
    const hd = p.depth / 2;

    // Local corners (BoxGeometry is centered in X/Z; bottom-anchored in Y)
    const corners = [
      new THREE.Vector3(-hw, 0, -hd),
      new THREE.Vector3(+hw, 0, -hd),
      new THREE.Vector3(+hw, 0, +hd),
      new THREE.Vector3(-hw, 0, +hd),
    ];

    // Transform to world space and project to Y=0
    return corners.map(c => {
      mesh.localToWorld(c);
      c.y = 0;
      return c;
    });
  }

  return null;
}

/**
 * Returns the extrusion height of a mesh (0 for flat shapes).
 */
export function getMeshHeight(mesh) {
  const type = mesh.userData.type;

  if (type === 'polygon') {
    return mesh.userData.extrusionDepth ?? 0;
  }

  if ((type === 'box' || type === 'quad') && mesh.geometry.parameters) {
    return mesh.geometry.parameters.height ?? 0;
  }

  return 0;
}

/**
 * Creates a new polygon mesh from XZ points and an extrusion height.
 * Mirrors DrawingTool._buildShape + _createFaceMesh.
 * Clones the dominant material from sourceMesh.
 */
export function buildPolygonMesh(pts, height, sourceMesh) {
  // Build THREE.Shape using (x, -z) so rotateX(-PI/2) lands correctly on XZ
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, -pts[0].z);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i].x, -pts[i].z);
  }
  shape.closePath();

  let geo;
  if (height > 0.01) {
    geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  } else {
    geo = new THREE.ShapeGeometry(shape);
  }
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();

  // Pick a material from the source mesh — prefer non-edge faces
  let srcMat;
  if (Array.isArray(sourceMesh.material)) {
    // Index 4 = +Z (front face for box), index 2 = +Y, fallback to index 0
    srcMat = sourceMesh.material[4] ?? sourceMesh.material[2] ?? sourceMesh.material[0];
  } else {
    srcMat = sourceMesh.material;
  }
  const mat = srcMat ? srcMat.clone() : new THREE.MeshStandardMaterial({ color: 0x8890a4, roughness: 0.85, side: THREE.DoubleSide });
  mat.side = THREE.DoubleSide;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'CutPolygon';
  mesh.userData = {
    type: 'polygon',
    shape,
    shapePoints: pts.map(p => p.clone()),
    extrusionDepth: height,
  };

  return mesh;
}
