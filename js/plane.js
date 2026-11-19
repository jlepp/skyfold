import * as THREE from '../vendor/three.module.js';

// Builds a low-poly procedural paper-dart mesh: a folded fuselage plus two
// swept wings with a slight dihedral, flat-shaded like creased paper.
export function createPaperPlane() {
  const group = new THREE.Group();

  const paperMat = new THREE.MeshStandardMaterial({
    color: 0xf4f1e8,
    flatShading: true,
    roughness: 0.85,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xd8d2c0,
    flatShading: true,
    roughness: 0.9,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  // Fuselage: a thin vertical triangular spine (the centre fold).
  const spine = trianglesMesh([
    0, 0.16, 0.95,   0, 0.04, -0.65,   0, 0.30, -0.55,
  ], shadeMat);
  group.add(spine);

  // Left wing (two triangles forming a swept, slightly upturned wing).
  const leftWing = trianglesMesh([
    0, 0.16, 0.95,   0, 0.30, -0.55,   -0.95, 0.05, -0.35,
    0, 0.16, 0.95,   -0.95, 0.05, -0.35,   -0.35, 0.06, 0.25,
  ], paperMat);
  group.add(leftWing);

  // Right wing (mirrored).
  const rightWing = trianglesMesh([
    0, 0.16, 0.95,   0.95, 0.05, -0.35,   0, 0.30, -0.55,
    0, 0.16, 0.95,   0.35, 0.06, 0.25,   0.95, 0.05, -0.35,
  ], paperMat);
  group.add(rightWing);

  // Small tail fins to sell the fold.
  const leftFin = trianglesMesh([
    0, 0.30, -0.55,   -0.18, 0.05, -0.6,   -0.35, 0.06, 0.25,
  ], shadeMat);
  group.add(leftFin);
  const rightFin = trianglesMesh([
    0, 0.30, -0.55,   0.35, 0.06, 0.25,   0.18, 0.05, -0.6,
  ], shadeMat);
  group.add(rightFin);

  group.scale.setScalar(1.15);
  group.rotation.y = Math.PI; // nose points toward -Z (forward, away from camera)

  return group;
}

function trianglesMesh(flatVerts, material) {
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array(flatVerts);
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}
