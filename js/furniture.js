import * as THREE from '../vendor/three.module.js';

// Mid-century modern living-room furniture built from primitives. Every
// builder returns a Group whose bounds match the obstacle's hitbox
// (width = halfW*2, height = halfH*2, depth ~0.9), centred on the origin.

const PALETTE = {
  walnut: 0x7a4a2b, teak: 0xb06a35, mustard: 0xe0a526, teal: 0x1f8a8a,
  orange: 0xe2582b, cream: 0xf1e6cf, brass: 0xd9a441, green: 0x3f8f4f,
  charcoal: 0x2b2b33,
};
const mats = {};
function mat(name, emissive = 0.12) {
  if (!mats[name]) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: PALETTE[name], emissive: PALETTE[name], emissiveIntensity: emissive,
      roughness: 0.7, metalness: name === 'brass' ? 0.6 : 0.05,
    });
  }
  return mats[name];
}
function box(g, w, h, d, x, y, z, m) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}
function leg(g, x, y, z, len, m) { // tapered splayed leg
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, len, 6), m);
  mesh.position.set(x, y, z);
  g.add(mesh);
}

// Tall teak bookshelf with books and a few open cubbies.
export function bookshelf(w, h) {
  const g = new THREE.Group();
  const d = 0.9, t = 0.08;
  box(g, w, h, 0.06, 0, 0, -d / 2 + 0.03, mat('walnut'));
  box(g, t, h, d, -w / 2 + t / 2, 0, 0, mat('teak'));
  box(g, t, h, d, w / 2 - t / 2, 0, 0, mat('teak'));
  const shelves = 6;
  const cols = ['mustard', 'teal', 'orange', 'cream'];
  for (let i = 0; i <= shelves; i++) {
    const y = -h / 2 + (i * h) / shelves;
    box(g, w, t, d, 0, y + (i === shelves ? -t / 2 : i === 0 ? t / 2 : 0), 0, mat('teak'));
    if (i < shelves) {
      const slot = h / shelves;
      let x = -w / 2 + 0.2;
      for (let b = 0; b < 4 && i % 3 !== 2; b++) {
        const bw = 0.12 + ((i * 7 + b * 3) % 4) * 0.03, bh = slot * (0.55 + ((i + b) % 3) * 0.1);
        box(g, bw, bh, 0.5, x, y + t / 2 + bh / 2 + 0.02, 0, mat(cols[(i + b) % 4]));
        x += bw + 0.04;
      }
    }
  }
  return g;
}

// Low sofa / credenza on splayed legs. `wide` stretches it across the room.
export function sofa(w, h) {
  const g = new THREE.Group();
  const legH = h * 0.28, bodyH = h - legH;
  const cush = mat(w > 8 ? 'teal' : 'mustard');
  box(g, w, bodyH * 0.45, 0.9, 0, -h / 2 + legH + bodyH * 0.225, 0, cush);
  box(g, w, bodyH * 0.55, 0.25, 0, -h / 2 + legH + bodyH * 0.72, -0.32, cush);
  const arm = Math.min(0.3, w * 0.1);
  box(g, arm, bodyH * 0.8, 0.9, -w / 2 + arm / 2, -h / 2 + legH + bodyH * 0.4, 0, mat('walnut'));
  box(g, arm, bodyH * 0.8, 0.9, w / 2 - arm / 2, -h / 2 + legH + bodyH * 0.4, 0, mat('walnut'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    leg(g, sx * (w / 2 - 0.2), -h / 2 + legH / 2, sz * 0.32, legH, mat('walnut'));
  }
  return g;
}

// Hanging wall shelf with pendant lamps (the overhead beam).
export function ceilingShelf(w, h) {
  const g = new THREE.Group();
  box(g, w, 0.12, 0.8, 0, h / 2 - 0.4, 0, mat('walnut'));
  const n = Math.max(3, Math.round(w / 3));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / n;
    box(g, 0.03, h * 0.5, 0.03, x, h / 2 - 0.4 - h * 0.25, 0, mat('charcoal'));
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(i % 2 ? 'orange' : 'mustard', 0.6));
    shade.position.set(x, -h / 2 + 0.45, 0);
    shade.rotation.x = Math.PI;
    g.add(shade);
  }
  return g;
}

// Tall arc floor lamp; shade glows while "on". Returns group with setActive().
export function floorLamp(w, h) {
  const g = new THREE.Group();
  box(g, 0.05, h * 0.92, 0.05, 0, -h * 0.04, 0, mat('brass'));
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.08, 16), mat('charcoal'));
  base.position.y = -h / 2 + 0.04;
  g.add(base);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xfff1c0, emissive: 0xffc23c, emissiveIntensity: 1.8, transparent: true,
  });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 0.7, 16, 1, true), shadeMat);
  shade.material.side = THREE.DoubleSide;
  shade.position.y = h / 2 - 0.35;
  g.add(shade);
  g.userData.setActive = (on) => {
    shadeMat.emissiveIntensity = on ? 1.8 : 0.05;
    shadeMat.color.set(on ? 0xfff1c0 : 0x4a4038);
    shadeMat.opacity = on ? 0.95 : 0.35;
  };
  return g;
}

// Sputnik starburst chandelier.
export function sputnik() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat('brass', 0.5));
  g.add(core);
  const dirs = new THREE.IcosahedronGeometry(1, 1).attributes.position;
  const seen = new Set();
  for (let i = 0; i < dirs.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(dirs, i).normalize();
    const key = v.toArray().map((n) => n.toFixed(2)).join();
    if (seen.has(key)) continue;
    seen.add(key);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4), mat('brass'));
    rod.position.copy(v).multiplyScalar(0.45);
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
    g.add(rod);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), mat('cream', 1.5));
    bulb.position.copy(v).multiplyScalar(0.78);
    g.add(bulb);
  }
  return g;
}

// Potted plant in a ceramic planter on a stand.
export function plant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.28, 0.5, 12), mat('orange'));
  pot.position.y = -0.3;
  g.add(pot);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), mat('green'));
    leaf.scale.set(0.6, 1.3, 0.25);
    leaf.position.set(Math.cos(a) * 0.3, 0.2 + (i % 2) * 0.15, Math.sin(a) * 0.3);
    leaf.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    g.add(leaf);
  }
  return g;
}

// Round sunburst mirror (the boost hoop).
export function sunburstMirror() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 8, 24), new THREE.MeshStandardMaterial({
    color: 0x332200, emissive: 0xffc23c, emissiveIntensity: 1.3, roughness: 0.3,
  })));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const ray = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.05), mat('brass', 0.8));
    ray.position.set(Math.cos(a) * 1.28, Math.sin(a) * 1.28, 0);
    ray.rotation.z = a - Math.PI / 2;
    g.add(ray);
  }
  return g;
}
