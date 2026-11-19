// Procedural audio: demoscene-style chiptune title loop, wind whoosh while
// flying, crash thud and finish fanfare. Everything is synthesized with the
// Web Audio API -- no audio files.

const NOTE = {
  C3: 130.81, D3: 146.83, Ds3: 155.56, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, As3: 233.08, B3: 246.94,
  C4: 261.63, D4: 293.66, Ds4: 311.13, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, As4: 466.16, B4: 493.88,
  C5: 523.25, D5: 587.33, Ds5: 622.25, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
  C6: 1046.50, 0: 0,
};

// A short arpeggiated demoscene-ish loop: bass + lead + noise hat.
// Each row = one 16th-note step. 0 = rest.
const BASS_PATTERN = ['C3',0,'C3','C3', 'Ds3',0,'Ds3',0, 'F3',0,'F3','F3', 'G3',0,'A3',0];
const LEAD_PATTERN = [
  'C5','Ds5','G4','C5', 'Ds5','F5','Ds5','C5', 'D5','F5','A4','D5', 'F5','G5','F5','D5',
  'C5','Ds5','G4','C5', 'Ds5','F5','Ds5','C5', 'A4','C5','Ds5','G5', 'F5','Ds5','C5',0,
];
const HAT_PATTERN = [1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1];

const STEP_SECONDS = 0.145; // tempo

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this._titleTimer = null;
    this._titleStep = 0;
    this._nextStepTime = 0;
    this._titlePlaying = false;

    this._whooshNodes = null;
    this._whooshOn = false;
  }

  // Must be called from a user gesture. Safe to call again on later taps:
  // it re-resumes a context that iOS suspended/interrupted.
  unlock() {
    // iOS mutes Web Audio when the ring/silent switch is on unless the page
    // declares a "playback" audio session (iOS 16.4+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}

    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      // Older iOS: a looping silent <audio> element moves audio onto the
      // media channel so the silent switch doesn't mute it.
      this._startSilentElement();
      // Play a 1-sample silent buffer inside the gesture to fully unlock.
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.ctx.createBuffer(1, 1, 22050);
        src.connect(this.ctx.destination);
        src.start(0);
      } catch (e) {}
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.resume();
      });
    }
    this.resume();
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  }

  _startSilentElement() {
    try {
      // 0.1s silent 8-bit mono WAV, generated in code (no file needed).
      const n = 800, bytes = new Uint8Array(44 + n);
      const dv = new DataView(bytes.buffer);
      const w = (o, str) => { for (let i = 0; i < str.length; i++) bytes[o + i] = str.charCodeAt(i); };
      w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true);
      dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
      w(36, 'data'); dv.setUint32(40, n, true);
      bytes.fill(128, 44);
      const el = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
      el.loop = true;
      el.setAttribute('playsinline', '');
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
      this._silentEl = el;
    } catch (e) {}
  }

  // ---------- Title screen chiptune loop ----------

  startTitleMusic() {
    if (!this.ctx || this._titlePlaying) return;
    this._titlePlaying = true;
    this._titleStep = 0;
    this._nextStepTime = this.ctx.currentTime + 0.05;
    this._scheduleTitleLoop();
  }

  stopTitleMusic() {
    this._titlePlaying = false;
    if (this._titleTimer) { clearTimeout(this._titleTimer); this._titleTimer = null; }
  }

  _scheduleTitleLoop() {
    if (!this._titlePlaying) return;
    const lookahead = 0.2;
    while (this._nextStepTime < this.ctx.currentTime + lookahead) {
      this._playStep(this._titleStep, this._nextStepTime);
      this._titleStep = (this._titleStep + 1) % LEAD_PATTERN.length;
      this._nextStepTime += STEP_SECONDS;
    }
    this._titleTimer = setTimeout(() => this._scheduleTitleLoop(), 50);
  }

  _playStep(i, t) {
    const bassNote = BASS_PATTERN[i % BASS_PATTERN.length];
    const leadNote = LEAD_PATTERN[i % LEAD_PATTERN.length];
    const hat = HAT_PATTERN[i % HAT_PATTERN.length];

    if (bassNote) this._tone(NOTE[bassNote], t, STEP_SECONDS * 0.9, 'triangle', 0.22);
    if (leadNote) this._tone(NOTE[leadNote], t, STEP_SECONDS * 0.85, 'square', 0.11);
    if (hat) this._hat(t);
  }

  _tone(freq, t, dur, type, gainAmt) {
    if (!freq) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(gainAmt, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _hat(t) {
    const buf = this._noiseBuffer(0.04);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
  }

  _noiseBuffer(seconds) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------- Flight whoosh (continuous, modulated by speed/turn) ----------

  startWhoosh() {
    if (!this.ctx || this._whooshOn) return;
    this._whooshOn = true;

    const bufSrc = this.ctx.createBufferSource();
    bufSrc.buffer = this._loopingNoiseBuffer(2);
    bufSrc.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.6;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;

    bufSrc.connect(filter).connect(gain).connect(this.ctx.destination);
    bufSrc.start();

    this._whooshNodes = { bufSrc, filter, gain };
  }

  // speedFrac in [0,1], turn in [-1,1] (abs used for intensity)
  updateWhoosh(speedFrac, turn) {
    if (!this._whooshOn || !this._whooshNodes) return;
    const t = this.ctx.currentTime;
    const { filter, gain } = this._whooshNodes;
    const targetFreq = 350 + speedFrac * 1600 + Math.abs(turn) * 500;
    const targetGain = 0.05 + speedFrac * 0.09;
    filter.frequency.setTargetAtTime(targetFreq, t, 0.15);
    gain.gain.setTargetAtTime(targetGain, t, 0.15);
  }

  stopWhoosh() {
    if (!this._whooshOn) return;
    this._whooshOn = false;
    const nodes = this._whooshNodes;
    this._whooshNodes = null;
    if (!nodes) return;
    const t = this.ctx.currentTime;
    nodes.gain.gain.setTargetAtTime(0.0001, t, 0.1);
    setTimeout(() => { try { nodes.bufSrc.stop(); } catch (e) {} }, 400);
  }

  _loopingNoiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.06 * white) / 1.06; // gentle low-pass toward pink-ish noise
      data[i] = last * 3.2;
    }
    return buf;
  }

  // ---------- One-shot effects ----------

  playBoost() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Coin-style pickup: quick rising arpeggio, a sparkle on top, and a swept "whoom".
    this._tone(NOTE.C5, t, 0.1, 'square', 0.15);
    this._tone(NOTE.E5, t + 0.05, 0.12, 'square', 0.15);
    this._tone(NOTE.G5, t + 0.1, 0.12, 'square', 0.15);
    this._tone(NOTE.C6, t + 0.15, 0.3, 'square', 0.14);
    this._tone(NOTE.C6 * 2, t + 0.15, 0.25, 'triangle', 0.08);

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.42);
  }

  playCrash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    const buf = this._noiseBuffer(0.5);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + 0.45);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.5, t);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(oscGain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  playFinish() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const seq = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6];
    seq.forEach((f, i) => this._tone(f, t + i * 0.13, 0.3, 'square', 0.16));
  }
}
