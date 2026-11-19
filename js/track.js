import * as THREE from '../vendor/three.module.js';
import * as F from './furniture.js?v=20261113b';

// World layout ---------------------------------------------------------
// The plane itself never actually moves along Z; instead everything else
// (obstacles, the ground grid) scrolls toward the camera as `currentDistance`
// increases. Forward = -Z. An obstacle's visual Z is:
//   z = currentDistance - obstacle.distance
// which is negative while still ahead, crosses 0 right as the plane reaches
// it, and goes positive once passed (and can be culled).

export const LANES_X = [-5.2, -2.6, 0, 2.6, 5.2];
export const ALT = { LOW: -1.6, MID: 0, HIGH: 1.6 };
export const PLANE_BOUND_X = 5.8;
export const PLANE_BOUND_Y = 2.1;

const CROSS_THRESHOLD = 0; // z >= this means the plane has reached the obstacle
const PLANE_MARGIN = 0.28; // forgiveness added to every collision half-extent

const SLALOM_ROW_GAP = 50;

// Per-level scaling. Every level takes about the same clock time (see
// TARGET_SECONDS below) while speed grows LEVEL_SPEED_GROWTH x per level and
// obstacle density grows sqrt(LEVEL_OBSTACLE_GROWTH) x per level, so the
// difficulty climbs exponentially and becomes impossible around level 9-10.
export const LEVEL_OBSTACLE_GROWTH = 1.5;
export const LEVEL_SPEED_GROWTH = 1.1;
// Every level should take about TARGET_SECONDS to fly. Speed ramps within a
// level as baseSpeed(f) = 25 + 45 f^1.6 (see main.js), so the flight time is
// distance * SPEED_RAMP_INTEGRAL / speedMult, where SPEED_RAMP_INTEGRAL is the
// integral of 1/baseSpeed(f) over f in 0..1 (~0.02614). Solving for distance:
const TARGET_SECONDS = 120;
const SPEED_RAMP_INTEGRAL = 0.02614;
const BASE_LEVEL_DISTANCE = 11500; // must match BASE_DISTANCE in main.js
export function levelScale(level) {
  const speedMult = Math.pow(LEVEL_SPEED_GROWTH, level - 1);
  // Density (obstacles per unit distance) keeps growing exponentially forever;
  // levels get longer in distance only to hold the clock time constant.
  const densityMult = Math.pow(LEVEL_OBSTACLE_GROWTH, (level - 1) / 2);
  const lengthMult = (TARGET_SECONDS * speedMult / SPEED_RAMP_INTEGRAL) / BASE_LEVEL_DISTANCE;
  return { lengthMult, densityMult, speedMult };
}

export function generateLevel(totalDistance, densityMult = 1) {
  const obstacles = [];
  let d = 380;
  let rowIndex = 0;

  // Every row guarantees at least one safe path (an open lane, or an
  // altitude the beam doesn't cover), so the level is always beatable.
  while (d < totalDistance - 420) {
    const f = d / totalDistance;
    const spacing = lerp(230, 95, easeInOut(f)) / densityMult;
    let openLaneIdx = randInt(0, LANES_X.length - 1);
    let extent = spacing; // distance consumed by this pattern

    if (f > 0.2 && chance(0.18)) {
      // Limbo beam: spans every lane at one altitude; fly under/over it.
      const band = chance(0.5) ? ALT.HIGH : ALT.LOW;
      obstacles.push({
        type: 'beam', distance: d, x: 0, y: band,
        halfW: 6.6, halfH: 0.95, resolved: false,
      });
      obstacles.push({
        type: 'boost', distance: d + spacing * 0.4, x: LANES_X[randInt(0, 4)], y: 0,
        radius: 1.15, resolved: false,
      });
    } else if (f > 0.3 && chance(0.2)) {
      // Slalom: a run of closely spaced walls whose gap drifts one lane at a time.
      const rows = randInt(4, 6);
      let lane = openLaneIdx;
      for (let r = 0; r < rows; r++) {
        const rd = d + r * SLALOM_ROW_GAP;
        for (let i = 0; i < LANES_X.length; i++) {
          if (i === lane) continue;
          obstacles.push({
            type: 'block', distance: rd, x: LANES_X[i], y: 0,
            halfW: 0.9, halfH: 2.4, resolved: false,
          });
        }
        lane = clamp(lane + pick([-1, 1]), 0, LANES_X.length - 1);
      }
      extent = rows * SLALOM_ROW_GAP + spacing * 0.5;
      obstacles.push({
        type: 'boost', distance: d + extent - spacing * 0.3, x: LANES_X[lane], y: 0,
        radius: 1.15, resolved: false,
      });
    } else {
      const laneIdxs = shuffle([0, 1, 2, 3, 4].filter((i) => i !== openLaneIdx));
      const blockedCount = Math.min(f < 0.15 ? 2 : f < 0.6 ? 3 : 4, laneIdxs.length);

      for (let k = 0; k < blockedCount; k++) {
        const cx = LANES_X[laneIdxs[k]];
        const roll = Math.random();
        if (f > 0.6 && roll < 0.2) {
          obstacles.push({
            type: 'bird', distance: d, x: cx, y: pick([ALT.LOW, ALT.MID, ALT.HIGH]),
            baseX: cx, amp: 1.1 + Math.random() * 0.6, freq: 0.8 + Math.random() * 0.9,
            phase: Math.random() * Math.PI * 2,
            halfW: 0.55, halfH: 0.55, resolved: false,
          });
        } else if (f > 0.45 && roll < 0.38) {
          obstacles.push({
            type: 'drifter', distance: d, x: cx, y: 0, baseY: 0, ampY: 1.7,
            freq: 1.0 + Math.random() * 0.8, phase: Math.random() * Math.PI * 2,
            halfW: 0.6, halfH: 0.6, resolved: false,
          });
        } else if (f > 0.3 && roll < 0.55) {
          // Flickering floor lamp: dark = safe right now. Decoy next to a solid wall.
          obstacles.push({
            type: 'laser', distance: d, x: cx, y: 0, freq: 2.2 + Math.random() * 1.2,
            phase: Math.random() * Math.PI * 2, active: true,
            halfW: 0.5, halfH: 2.4, resolved: false,
          });
        } else if (f > 0.4 && roll < 0.72) {
          // Window: blocked above and below, thread the middle.
          for (const y of [ALT.HIGH, ALT.LOW]) {
            obstacles.push({
              type: 'block', distance: d, x: cx, y,
              halfW: 0.9, halfH: 0.95, resolved: false,
            });
          }
        } else if (f > 0.35 && roll < 0.86) {
          obstacles.push({
            type: 'block', distance: d, x: cx, y: chance(0.5) ? ALT.HIGH : ALT.LOW,
            halfW: 0.9, halfH: 0.95, resolved: false,
          });
        } else {
          obstacles.push({
            type: 'block', distance: d, x: cx, y: 0,
            halfW: 0.9, halfH: 2.4, resolved: false,
          });
        }
      }

      if (rowIndex % 3 === 0) {
        obstacles.push({
          type: 'boost', distance: d + spacing * 0.35, x: LANES_X[openLaneIdx], y: 0,
          radius: 1.15, resolved: false,
        });
      }
    }

    d += extent;
    rowIndex++;
  }

  return obstacles;
}

export class Track {
  constructor(scene, baseDistance, level = 1) {
    this.scene = scene;
    this.baseDistance = baseDistance;
    this.obstacles = [];
    this._finishGroup = null;

    this._buildSky();
    this._buildGround();
    this.loadLevel(level);
  }

  // (Re)builds obstacles and the finish line for the given level.
  loadLevel(level) {
    for (const o of this.obstacles) this.scene.remove(o.mesh);
    if (this._finishGroup) this.scene.remove(this._finishGroup);

    const { lengthMult, densityMult, speedMult } = levelScale(level);
    this.level = level;
    this.speedMult = speedMult;
    this.totalDistance = Math.round(this.baseDistance * lengthMult);
    this.obstacles = generateLevel(this.totalDistance, densityMult);
    this._buildObstacleMeshes();
    this._buildFinishLine();
    this.reset();
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(600, 24, 16);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x1a0838);
    const mid = new THREE.Color(0x6a1b8f);
    const bottom = new THREE.Color(0xff7fae);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 600; // -1..1
      const t = THREE.MathUtils.clamp((y + 0.15) / 1.15, 0, 1);
      const c = y > -0.05
        ? top.clone().lerp(mid, 1 - THREE.MathUtils.clamp(t, 0, 1))
        : mid.clone().lerp(bottom, THREE.MathUtils.clamp((-y) * 3, 0, 1));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
    this.scene.add(new THREE.Mesh(geo, mat));

    const sunTex = makeSunTexture();
    const sunMat = new THREE.SpriteMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false });
    const sun = new THREE.Sprite(sunMat);
    sun.scale.set(140, 140, 1);
    sun.position.set(0, 20, -480);
    this.scene.add(sun);

    this.scene.fog = new THREE.Fog(0xb84fa0, 60, 340);
    this.scene.background = new THREE.Color(0x1a0838);
  }

  _buildGround() {
    const tex = makeGridTexture();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(20, 240);
    this._gridTexture = tex;

    const geo = new THREE.PlaneGeometry(90, 1400);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, -2.6, -580);
    this.scene.add(mesh);
    this._ground = mesh;
  }

  _buildObstacleMeshes() {
    for (const o of this.obstacles) {
      let mesh;
      if (o.type === 'block') {
        mesh = o.halfH > 2 ? F.bookshelf(o.halfW * 2, o.halfH * 2) : F.sofa(o.halfW * 2, o.halfH * 2);
      } else if (o.type === 'beam') {
        mesh = o.y > 0 ? F.ceilingShelf(o.halfW * 2, o.halfH * 2) : F.sofa(o.halfW * 2, o.halfH * 2);
      } else if (o.type === 'laser') {
        mesh = F.floorLamp(o.halfW * 2, o.halfH * 2);
      } else if (o.type === 'drifter') {
        mesh = F.sputnik();
      } else if (o.type === 'bird') {
        mesh = F.plant();
      } else if (o.type === 'boost') {
        mesh = F.sunburstMirror();
      }
      mesh.position.set(o.x, o.y, currentZOf(o, 0));
      this.scene.add(mesh);
      o.mesh = mesh;
    }
  }

  _buildFinishLine() {
    const group = new THREE.Group();
    const checkerTex = makeCheckerTexture();
    const bannerGeo = new THREE.PlaneGeometry(12.4, 5);
    const bannerMat = new THREE.MeshBasicMaterial({ map: checkerTex, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.y = 0.4;
    group.add(banner);

    const pillarGeo = new THREE.BoxGeometry(0.3, 6, 0.3);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x111133, emissive: 0x00f0ff, emissiveIntensity: 1.2 });
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(side * 6.3, 0.6, 0);
      group.add(pillar);
    }

    this.scene.add(group);
    this._finishGroup = group;
  }

  reset() {
    for (const o of this.obstacles) { o.resolved = false; o.collected = false; }
    this.update(0, 0, 0, 0);
  }

  // Returns { crashed, boosted, boostAmount, finished }
  update(currentDistance, elapsed, planeX, planeY) {
    const result = { crashed: false, boosted: false, boostAmount: 0, finished: false };

    this._gridTexture.offset.y = -(currentDistance / 6);

    for (const o of this.obstacles) {
      const z = currentDistance - o.distance;

      let cx = o.x;
      if (o.type === 'bird') {
        cx = o.baseX + Math.sin(elapsed * o.freq + o.phase) * o.amp;
      }
      let cy = o.y;
      if (o.type === 'drifter') cy = o.baseY + Math.sin(elapsed * o.freq + o.phase) * o.ampY;
      if (o.type === 'laser') {
        o.active = Math.sin(elapsed * o.freq + o.phase) > -0.15;
        o.mesh.userData.setActive(o.active);
      }
      o.mesh.position.x = cx;
      o.mesh.position.y = cy;
      o.mesh.position.z = z;
      o.mesh.visible = !o.collected && z > -260 && z < 6;

      if (o.type === 'bird' || o.type === 'drifter') {
        o.mesh.rotation.y += 0.03;
      } else if (o.type === 'boost') {
        o.mesh.rotation.z += 0.05;
      }
      // 'block' meshes stay axis-aligned: the collision check below assumes
      // an unrotated box, so spinning it would desync the visual from the hitbox.

      if (!o.resolved && z >= CROSS_THRESHOLD) {
        o.resolved = true;
        const dx = Math.abs(planeX - cx);
        const dy = Math.abs(planeY - cy);
        if (o.type === 'boost') {
          const dist = Math.hypot(planeX - cx, planeY - cy);
          if (dist < o.radius + PLANE_MARGIN) {
            result.boosted = true;
            o.collected = true;
            result.boostPos = { x: cx, y: cy };
            result.boostAmount = 22;
          }
        } else if (o.type !== 'laser' || o.active) {
          if (dx < o.halfW + PLANE_MARGIN && dy < o.halfH + PLANE_MARGIN) {
            result.crashed = true;
          }
        }
      }
    }

    const finishZ = currentDistance - this.totalDistance;
    this._finishGroup.position.z = finishZ;
    if (finishZ >= CROSS_THRESHOLD) result.finished = true;

    return result;
  }
}

function currentZOf(o, currentDistance) { return currentDistance - o.distance; }

function makeGridTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 63); ctx.lineTo(64, 63);
  ctx.moveTo(0, 0); ctx.lineTo(0, 64);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

function makeSunTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 220, 120, 1)');
  grad.addColorStop(0.4, 'rgba(255, 140, 90, 0.9)');
  grad.addColorStop(0.75, 'rgba(255, 60, 140, 0.5)');
  grad.addColorStop(1, 'rgba(255, 60, 140, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5; i++) {
    const y = 150 + i * 18;
    ctx.fillRect(0, y, 256, 5);
  }
  return new THREE.CanvasTexture(c);
}

function makeCheckerTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  const n = 8;
  const cw = c.width / n, ch = c.height / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#fff' : '#111';
      ctx.fillRect(x * cw, y * ch, cw, ch);
    }
  }
  return new THREE.CanvasTexture(c);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function chance(p) { return Math.random() < p; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
