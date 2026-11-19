import * as THREE from '../vendor/three.module.js';
import { InputController } from './input.js?v=20261113b';
import { AudioEngine } from './audio.js?v=20261113b';
import { createPaperPlane } from './plane.js?v=20261113b';
import { Track, levelScale, PLANE_BOUND_X, PLANE_BOUND_Y, LANES_X, ALT } from './track.js?v=20261113b';

const BASE_DISTANCE = 11500; // level 1 length; later levels scale (see levelScale in track.js)
const SPEED_MIN = 25;
const SPEED_MAX = 70;
const DIFFICULTY_POW = 1.6;
const BOOST_DECAY_PER_SEC = 14;
const bestKey = (lvl) => lvl === 1 ? 'skyfold_bestTime' : 'skyfold_bestTime_L' + lvl;

const $ = (id) => document.getElementById(id);

const els = {
  hud: $('hud'), hudTime: $('hud-time'), hudBest: $('hud-best'),
  hudProgressFill: $('hud-progress-fill'), hudBoost: $('hud-boost'),
  title: $('title-screen'), startBtn: $('start-btn'),
  invertCheckbox: $('invert-checkbox'),
  bestTimeDisplay: $('best-time-display'), bestTimeValue: $('best-time-value'),
  insecureWarning: $('insecure-warning'), motionDeniedWarning: $('motion-denied-warning'),
  calibrateScreen: $('calibrate-screen'), calibrateCount: $('calibrate-count'),
  crashScreen: $('crash-screen'), crashProgress: $('crash-progress'),
  debugReadout: $('debug-readout'), debugLevels: $('debug-levels'),
  hudLevel: $('hud-level'),
  finishNextBtn: document.querySelector('.finish-next-btn'),
  finishScreen: $('finish-screen'), finishTime: $('finish-time'), finishBest: $('finish-best'),
};

const input = new InputController();
const audio = new AudioEngine();

let state = 'title'; // title | calibrating | playing | crashed | finished
let titleArmed = false;

let currentDistance = 0;
let elapsedTime = 0;
let boostBonus = 0;
let level = 1;
let planeX = 0, planeY = 0;

// ---------- renderer / scene ----------

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 2.4, 7.5);

scene.add(new THREE.AmbientLight(0x8866aa, 0.9));
const sun = new THREE.DirectionalLight(0xffddaa, 1.1);
sun.position.set(4, 10, 6);
scene.add(sun);

const plane = createPaperPlane();
scene.add(plane);

const track = new Track(scene, BASE_DISTANCE, 1);

// ---------- ring pickup burst ----------

const BASE_FOV = 62;
let fovKick = 0;
const bursts = [];
const sparkGeo = new THREE.SphereGeometry(0.09, 6, 6);
const waveGeo = new THREE.TorusGeometry(1, 0.06, 8, 40);

function spawnRingBurst(x, y, speed) {
  const group = new THREE.Group();
  group.position.set(x, y, 0);

  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xffd84a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sparks = [];
  for (let i = 0; i < 28; i++) {
    const m = new THREE.Mesh(sparkGeo, sparkMat);
    const a = Math.random() * Math.PI * 2;
    const v = 3 + Math.random() * 6;
    sparks.push({ m, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: (Math.random() - 0.5) * 4 });
    group.add(m);
  }
  const waveMat = new THREE.MeshBasicMaterial({
    color: 0xfff2a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const wave = new THREE.Mesh(waveGeo, waveMat);
  group.add(wave);

  scene.add(group);
  bursts.push({ group, sparks, sparkMat, wave, waveMat, age: 0, speed });
  fovKick = 9;
}

function updateBursts(dt) {
  const LIFE = 0.7;
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.age += dt;
    const t = b.age / LIFE;
    if (t >= 1) {
      scene.remove(b.group);
      b.sparkMat.dispose(); b.waveMat.dispose();
      bursts.splice(i, 1);
      continue;
    }
    b.group.position.z += b.speed * dt * 0.6; // drift back past the camera with the world
    for (const s of b.sparks) {
      s.m.position.x += s.vx * dt;
      s.m.position.y += s.vy * dt;
      s.m.position.z += s.vz * dt;
      s.vx *= 0.96; s.vy *= 0.96;
    }
    b.sparkMat.opacity = 1 - t;
    b.wave.scale.setScalar(0.6 + t * 4.5);
    b.waveMat.opacity = (1 - t) * 0.9;
  }
  fovKick *= Math.exp(-dt * 8);
  const fov = BASE_FOV + fovKick;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

// ---------- debug grid (shake the phone, or press G) ----------
// A 5x3 lane grid drawn in the plane's own Z=0 plane, with the cell the
// airplane is currently in highlighted, plus a live tilt readout.

const LANE_W = LANES_X[1] - LANES_X[0];
const BANDS = [ALT.HIGH, ALT.MID, ALT.LOW]; // top to bottom
const BAND_H = ALT.HIGH - ALT.MID;
const debugGrid = new THREE.Group();
debugGrid.visible = false;
debugGrid.renderOrder = 999;
scene.add(debugGrid);

{
  const x0 = LANES_X[0] - LANE_W / 2, x1 = LANES_X[LANES_X.length - 1] + LANE_W / 2;
  const y0 = ALT.LOW - BAND_H / 2, y1 = ALT.HIGH + BAND_H / 2;
  const pts = [];
  for (let i = 0; i <= LANES_X.length; i++) {
    const x = x0 + i * LANE_W;
    pts.push(x, y0, 0, x, y1, 0);
  }
  for (let j = 0; j <= BANDS.length; j++) {
    const y = y1 - j * BAND_H;
    pts.push(x0, y, 0, x1, y, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0x00f0ff, transparent: true, opacity: 0.9, depthTest: false,
  }));
  lines.renderOrder = 999;
  debugGrid.add(lines);
}

const debugCell = new THREE.Mesh(
  new THREE.PlaneGeometry(LANE_W, BAND_H),
  new THREE.MeshBasicMaterial({ color: 0xff2e88, transparent: true, opacity: 0.35, depthTest: false }),
);
debugCell.renderOrder = 998;
debugGrid.add(debugCell);

function nearestIndex(arr, v) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[best] - v)) best = i;
  return best;
}

function updateDebug() {
  if (!debugGrid.visible) return;
  const lane = nearestIndex(LANES_X, planeX);
  const band = nearestIndex(BANDS, planeY);
  debugCell.position.set(LANES_X[lane], BANDS[band], 0);
  const d = input.debugInfo();
  els.debugReadout.textContent =
    `lane ${lane + 1}/5  height ${['HIGH', 'MID', 'LOW'][band]}\n` +
    `plane x ${planeX.toFixed(2)}  y ${planeY.toFixed(2)}\n` +
    `input x ${d.x.toFixed(2)}  y ${d.y.toFixed(2)}\n` +
    `tilt  x ${d.tiltX.toFixed(1)}\u00b0  y ${d.tiltY.toFixed(1)}\u00b0\n` +
    `mode ${d.mode}  screen ${d.angle}\u00b0${input.invert ? '  INVERT' : ''}`;
}

input.onShake = () => {
  debugGrid.visible = !debugGrid.visible;
  els.debugReadout.classList.toggle('hidden', !debugGrid.visible);
  els.debugLevels.classList.toggle('hidden', !debugGrid.visible);
};

// Debug level picker: jumps straight to a level (ignores unlock progress).
for (const btn of els.debugLevels.querySelectorAll('button')) {
  btn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  btn.addEventListener('click', () => {
    setLevel(parseInt(btn.dataset.level, 10));
    if (state === 'playing') beginRun(); // restart the run on the new level
  });
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- best time display ----------

function loadBestTime() {
  const v = parseFloat(localStorage.getItem(bestKey(level)));
  return isFinite(v) ? v : null;
}

function refreshBestTimeUI() {
  const best = loadBestTime();
  if (best !== null) {
    els.bestTimeValue.textContent = formatTime(best);
    els.bestTimeDisplay.classList.remove('hidden');
    els.hudBest.textContent = 'BEST ' + formatTime(best);
  } else {
    els.bestTimeDisplay.classList.add('hidden');
    els.hudBest.textContent = '';
  }
}
refreshBestTimeUI();

// ---------- levels ----------

function setLevel(n) {
  level = Math.max(1, n);
  track.loadLevel(level);
  els.hudLevel.textContent = 'LV ' + level;
  for (const b of els.debugLevels.children) b.classList.toggle('active', +b.dataset.level === level);
  refreshBestTimeUI();
}

setLevel(1);

input.setInvert(els.invertCheckbox.checked = input.invert);
els.invertCheckbox.addEventListener('change', () => input.setInvert(els.invertCheckbox.checked));

// ---------- title screen flow ----------

if (!input.isSecureContext()) els.insecureWarning.classList.remove('hidden');

els.startBtn.addEventListener('click', onStartTap);

async function onStartTap() {
  if (!titleArmed) {
    titleArmed = true;
    audio.unlock();
    audio.startTitleMusic();
    requestFullscreenAndOrientation();
    els.startBtn.textContent = 'TAP TO FLY';
    return;
  }
  audio.unlock(); // re-resume on every tap in case iOS suspended the context
  audio.stopTitleMusic();
  els.title.classList.add('hidden');

  const wasIOSPrompt = input.needsIOSPermission();
  const granted = await input.requestPermission();
  if (wasIOSPrompt && !granted) els.motionDeniedWarning.classList.remove('hidden');

  await runCalibration(1400);
  beginRun();
}

function requestFullscreenAndOrientation() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) { try { req.call(el); } catch (e) {} }
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }
}

function runCalibration(durationMs) {
  els.calibrateScreen.classList.remove('hidden');
  const steps = 3;
  let n = steps;
  els.calibrateCount.textContent = String(n);
  const stepMs = durationMs / steps;
  const timer = setInterval(() => {
    n -= 1;
    els.calibrateCount.textContent = n > 0 ? String(n) : 'GO';
  }, stepMs);

  return input.calibrate(durationMs).finally(() => {
    clearInterval(timer);
    els.calibrateScreen.classList.add('hidden');
  });
}

function beginRun() {
  currentDistance = 0;
  elapsedTime = 0;
  boostBonus = 0;
  planeX = 0; planeY = 0;
  track.reset();
  els.crashScreen.classList.add('hidden');
  els.finishScreen.classList.add('hidden');
  els.hud.classList.remove('hidden');
  refreshBestTimeUI();
  audio.startWhoosh();
  state = 'playing';
}

// ---------- crash / finish retry ----------

document.querySelector('.crash-retry-btn').addEventListener('click', retryRun);
document.querySelector('.finish-retry-btn').addEventListener('click', retryRun);
els.finishNextBtn.addEventListener('click', () => { setLevel(level + 1); retryRun(); });

async function retryRun() {
  audio.unlock();
  els.crashScreen.classList.add('hidden');
  els.finishScreen.classList.add('hidden');
  await runCalibration(700);
  beginRun();
}

// ---------- game loop ----------

let lastFrame = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  input.update();

  if (state === 'playing') {
    tickPlaying(dt);
  } else {
    idleAnimate(dt);
  }

  updateBursts(dt);
  updateDebug();
  renderer.render(scene, camera);
}

function idleAnimate(dt) {
  plane.position.y = 0.3 + Math.sin(performance.now() * 0.0012) * 0.15;
  plane.rotation.z = Math.sin(performance.now() * 0.0009) * 0.12;
  camera.position.x += (0 - camera.position.x) * 0.05;
  camera.position.y += (2.4 - camera.position.y) * 0.05;
  camera.lookAt(0, 0.3, -20);
}

function tickPlaying(dt) {
  const f = Math.min(currentDistance / track.totalDistance, 1);
  boostBonus = Math.max(0, boostBonus - BOOST_DECAY_PER_SEC * dt);
  const baseSpeed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * Math.pow(f, DIFFICULTY_POW);
  const speed = (baseSpeed + boostBonus) * track.speedMult;
  const speedFrac = THREE.MathUtils.clamp((speed - SPEED_MIN) / (SPEED_MAX + 30 - SPEED_MIN), 0, 1);

  currentDistance += speed * dt;
  elapsedTime += dt;

  const targetX = input.x * PLANE_BOUND_X;
  const targetY = input.y * PLANE_BOUND_Y;
  planeX += (targetX - planeX) * Math.min(1, dt * 4.5);
  planeY += (targetY - planeY) * Math.min(1, dt * 4.5);

  plane.position.set(planeX, planeY, 0);
  plane.rotation.z = -input.x * 0.9;
  plane.rotation.x = input.y * 0.35;
  plane.rotation.y = Math.PI + input.x * 0.25;

  camera.position.x += (planeX * 0.15 - camera.position.x) * Math.min(1, dt * 3);
  camera.position.y += (planeY * 0.15 + 2.4 - camera.position.y) * Math.min(1, dt * 3);
  camera.position.z = 7.5;
  camera.rotation.z = -input.x * 0.12;
  camera.lookAt(planeX * 0.25, planeY * 0.25 + 0.3, -30);

  audio.updateWhoosh(speedFrac, input.x);

  const result = track.update(currentDistance, elapsedTime, planeX, planeY);

  if (result.boosted) {
    boostBonus += result.boostAmount;
    audio.playBoost();
    spawnRingBurst(result.boostPos.x, result.boostPos.y, speed);
    flashBoostHud();
  }

  updateHud(f);

  if (result.crashed) {
    onCrash();
  } else if (result.finished) {
    onFinish();
  }
}

let boostFlashTimer = null;
function flashBoostHud() {
  els.hudBoost.classList.remove('hidden');
  if (boostFlashTimer) clearTimeout(boostFlashTimer);
  boostFlashTimer = setTimeout(() => els.hudBoost.classList.add('hidden'), 700);
}

function updateHud(f) {
  els.hudTime.textContent = formatTime(elapsedTime);
  els.hudProgressFill.style.width = (Math.min(f, 1) * 100).toFixed(1) + '%';
}

function onCrash() {
  state = 'crashed';
  audio.stopWhoosh();
  audio.playCrash();
  els.hud.classList.add('hidden');
  els.crashProgress.textContent =
    Math.round(Math.min(currentDistance / track.totalDistance, 1) * 100) + '% of the way there';
  els.crashScreen.classList.remove('hidden');
}

function onFinish() {
  state = 'finished';
  audio.stopWhoosh();
  audio.playFinish();
  els.hud.classList.add('hidden');

  const best = loadBestTime();
  const isNewBest = best === null || elapsedTime < best;
  if (isNewBest) localStorage.setItem(bestKey(level), String(elapsedTime));

  els.finishTime.textContent = 'TIME ' + formatTime(elapsedTime);
  els.finishBest.classList.toggle('hidden', !isNewBest);
  els.finishScreen.classList.remove('hidden');
  refreshBestTimeUI();
}

function formatTime(seconds) {
  const total = Math.round(seconds * 10) / 10; // avoid e.g. "1:60.0" from rounding at the boundary
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

animate();
