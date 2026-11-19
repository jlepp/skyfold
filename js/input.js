// Tilt / keyboard / touch input, unified into a single normalized {x, y} in [-1, 1].
// x: negative = bank left, positive = bank right
// y: negative = dive, positive = climb

const DEG = Math.PI / 180;
const INVERT_KEY = 'skyfold_invertTilt';

export class InputController {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.mode = 'none'; // 'tilt' | 'keyboard' | 'touch'
    this.invert = localStorage.getItem(INVERT_KEY) === '1';

    this._rawBeta = 0;
    this._rawGamma = 0;
    this._restBeta = 0;
    this._restGamma = 0;
    this._calibrated = false;
    this._gotOrientation = false;

    this._keys = { left: false, right: false, up: false, down: false };
    this._touchActive = false;
    this._touchOrigin = null;
    this._touchCurrent = null;

    this._onOrientation = this._onOrientation.bind(this);
    this._onMotion = this._onMotion.bind(this);
    this.onShake = null; // set by the game; called when the phone is shaken
    this._lastAcc = null;
    this._jolts = [];
    this._lastShake = 0;
    // Rest pose is only valid for the orientation it was captured in.
    const recal = () => { if (this._calibrated) this.calibrate(600); };
    if (screen.orientation) screen.orientation.addEventListener('change', recal);
    else window.addEventListener('orientationchange', recal);
    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));

    window.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: true });
    window.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: true });
    window.addEventListener('touchend', () => this._onTouchEnd(), { passive: true });
  }

  setInvert(v) {
    this.invert = v;
    localStorage.setItem(INVERT_KEY, v ? '1' : '0');
  }

  isSecureContext() {
    return window.isSecureContext === true;
  }

  hasOrientationSupport() {
    return typeof DeviceOrientationEvent !== 'undefined';
  }

  needsIOSPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  // Must be called from within a user-gesture handler on iOS.
  async requestPermission() {
    if (this.needsIOSPermission()) {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') return false;
      } catch (e) {
        return false;
      }
    }
    window.addEventListener('deviceorientation', this._onOrientation);
    this._startMotion();
    return true;
  }

  // Shake detection (debug toggle). Best effort: iOS may ask for a separate
  // devicemotion permission, and failing it must not affect tilt.
  async _startMotion() {
    if (typeof DeviceMotionEvent === 'undefined') return;
    try {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') return;
      }
    } catch (e) { return; }
    window.addEventListener('devicemotion', this._onMotion);
  }

  _onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null) return;
    const last = this._lastAcc;
    this._lastAcc = { x: a.x, y: a.y, z: a.z };
    if (!last) return;
    const jerk = Math.hypot(a.x - last.x, a.y - last.y, a.z - last.z);
    const now = performance.now();
    if (jerk > 12) this._jolts.push(now);
    this._jolts = this._jolts.filter((t) => now - t < 900);
    if (this._jolts.length >= 4 && now - this._lastShake > 1500) {
      this._lastShake = now;
      this._jolts = [];
      if (this.onShake) this.onShake();
    }
  }

  // Current tilt numbers for the debug overlay (degrees, relative to rest).
  debugInfo() {
    return {
      mode: this.mode,
      angle: screenAngle(),
      tiltX: this._rawGamma - this._restGamma,
      tiltY: this._rawBeta - this._restBeta,
      x: this.x, y: this.y,
    };
  }

  _onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    this._gotOrientation = true;
    // Work from the gravity direction in screen coordinates rather than raw
    // beta/gamma, which swap roles (and hit gimbal lock) in landscape.
    const b = e.beta * DEG, g = e.gamma * DEG;
    const ux = -Math.cos(b) * Math.sin(g); // device "up" vector, device axes
    const uy = Math.sin(b);
    const uz = Math.cos(b) * Math.cos(g);
    const angle = screenAngle();
    let right, up; // gravity's "up" vector along screen right / screen up
    if (angle === 90) { right = -uy; up = ux; }
    else if (angle === 270) { right = uy; up = -ux; }
    else if (angle === 180) { right = -ux; up = -uy; }
    else { right = ux; up = uy; }
    // _rawGamma: degrees the right edge is tipped down; _rawBeta: degrees the
    // top edge is tipped away from the player (0 = screen upright).
    this._rawGamma = -Math.asin(Math.max(-1, Math.min(1, right))) / DEG;
    this._rawBeta = Math.atan2(uz, up) / DEG;
  }

  // Sample current resting angle as the neutral pose. Returns a promise that
  // resolves once calibration has captured a stable-enough reading.
  calibrate(durationMs = 1200) {
    return new Promise((resolve) => {
      const samples = [];
      const start = performance.now();
      const tick = () => {
        if (this._gotOrientation) samples.push([this._rawBeta, this._rawGamma]);
        if (performance.now() - start < durationMs) {
          requestAnimationFrame(tick);
        } else {
          if (samples.length > 0) {
            const n = samples.length;
            this._restBeta = samples.reduce((s, v) => s + v[0], 0) / n;
            this._restGamma = samples.reduce((s, v) => s + v[1], 0) / n;
            this._calibrated = true;
            this.mode = 'tilt';
          }
          resolve(this._calibrated);
        }
      };
      requestAnimationFrame(tick);
    });
  }

  _onKey(e, down) {
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': this._keys.left = down; break;
      case 'ArrowRight': case 'KeyD': this._keys.right = down; break;
      case 'ArrowUp': case 'KeyW': this._keys.up = down; break;
      case 'ArrowDown': case 'KeyS': this._keys.down = down; break;
    }
    if (down && e.code === 'KeyG' && this.onShake) this.onShake(); // desktop debug toggle
    if (down && this.mode !== 'tilt') this.mode = 'keyboard';
  }

  _onTouchStart(e) {
    if (this.mode === 'tilt') return;
    const t = e.touches[0];
    this._touchActive = true;
    this._touchOrigin = { x: t.clientX, y: t.clientY };
    this._touchCurrent = { x: t.clientX, y: t.clientY };
    this.mode = 'touch';
  }

  _onTouchMove(e) {
    if (!this._touchActive) return;
    const t = e.touches[0];
    this._touchCurrent = { x: t.clientX, y: t.clientY };
  }

  _onTouchEnd() {
    this._touchActive = false;
    this._touchOrigin = null;
  }

  // Call once per frame; updates this.x / this.y in [-1, 1].
  update() {
    if (this.mode === 'tilt' && this._calibrated) {
      const TILT_RANGE_X = 20; // degrees of gamma for full deflection
      const TILT_RANGE_Y = 18; // degrees of beta for full deflection
      let dx = (this._rawGamma - this._restGamma) / TILT_RANGE_X;
      let dy = (this._rawBeta - this._restBeta) / TILT_RANGE_Y;
      if (this.invert) { dx = -dx; dy = -dy; }
      this.x = clamp(dx, -1, 1);
      this.y = clamp(dy, -1, 1);
    } else if (this.mode === 'keyboard') {
      const tx = (this._keys.right ? 1 : 0) - (this._keys.left ? 1 : 0);
      const ty = (this._keys.up ? 1 : 0) - (this._keys.down ? 1 : 0);
      this.x = lerp(this.x, tx, 0.18);
      this.y = lerp(this.y, ty, 0.18);
    } else if (this.mode === 'touch' && this._touchActive && this._touchOrigin) {
      const DRAG_RANGE = 90; // px for full deflection
      let dx = (this._touchCurrent.x - this._touchOrigin.x) / DRAG_RANGE;
      let dy = (this._touchCurrent.y - this._touchOrigin.y) / DRAG_RANGE;
      this.x = clamp(dx, -1, 1);
      this.y = clamp(-dy, -1, 1);
    } else {
      // ease back to neutral when no active input
      this.x = lerp(this.x, 0, 0.1);
      this.y = lerp(this.y, 0, 0.1);
    }
  }
}

function screenAngle() {
  const a = (screen.orientation && screen.orientation.angle !== undefined)
    ? screen.orientation.angle
    : (window.orientation || 0);
  return ((a % 360) + 360) % 360;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
