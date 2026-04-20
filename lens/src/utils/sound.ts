/**
 * Providence Sound Manager, generates tones via Web Audio API.
 * No external audio files needed. All sounds are procedural.
 *
 * Sound design:
 * - pingEvent: soft high ping for new events
 * - alertAct: deep two-tone alert for ACT-tier blocks
 * - lockSound: satisfying mechanical "lock" for successful blocks
 * - newCountryChime: ascending three-note chime for first-time countries
 * - spikeWarning: pulsing low warning for traffic spikes
 * - clickSound: subtle UI click
 * - Adaptive ambient hum that intensifies with threat level
 */

let ctx: AudioContext | null = null;
let enabled = true;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSoundEnabled(on: boolean) { enabled = on; }
export function isSoundEnabled() { return enabled; }

function playTone(freq: number, duration: number, volume = 0.08, type: OscillatorType = 'sine') {
  if (!enabled) return;
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + duration);
  } catch { /* audio not available */ }
}

function playNoise(duration: number, volume: number) {
  if (!enabled) return;
  try {
    const c = getCtx();
    const bufferSize = c.sampleRate * duration;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    const source = c.createBufferSource();
    source.buffer = buffer;
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 5;
    gain.gain.setValueAtTime(volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    source.connect(filter).connect(gain).connect(c.destination);
    source.start();
  } catch { /* */ }
}

/** Soft ping, new event arrived */
export function pingEvent() {
  playTone(880, 0.15, 0.04);
}

/** Deep two-tone alert, ACT-tier response fired */
export function alertAct() {
  playTone(220, 0.4, 0.1, 'triangle');
  setTimeout(() => playTone(165, 0.5, 0.08, 'triangle'), 150);
}

/** Satisfying mechanical "lock" sound for successful firewall blocks */
export function lockSound() {
  if (!enabled) return;
  try {
    const c = getCtx();
    const t = c.currentTime;

    // Metallic click
    playNoise(0.03, 0.12);

    // Low thud
    const thud = c.createOscillator();
    const thudGain = c.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(120, t);
    thud.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    thudGain.gain.setValueAtTime(0.15, t);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    thud.connect(thudGain).connect(c.destination);
    thud.start(t);
    thud.stop(t + 0.25);

    // Confirmation tone (slightly delayed)
    setTimeout(() => {
      playTone(440, 0.15, 0.06);
      setTimeout(() => playTone(554, 0.2, 0.05), 80);
    }, 100);
  } catch { /* */ }
}

/** Ascending three-note chime for new country first seen */
export function newCountryChime() {
  if (!enabled) return;
  playTone(523, 0.2, 0.05); // C5
  setTimeout(() => playTone(659, 0.2, 0.05), 120); // E5
  setTimeout(() => playTone(784, 0.3, 0.04), 240); // G5
}

/** Pulsing low warning for traffic spikes */
export function spikeWarning() {
  if (!enabled) return;
  try {
    const c = getCtx();
    const t = c.currentTime;

    for (let i = 0; i < 3; i++) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 110;
      const start = t + i * 0.25;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.06, start + 0.08);
      gain.gain.linearRampToValueAtTime(0, start + 0.2);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    }
  } catch { /* */ }
}

/** Subtle click, UI interaction */
export function clickSound() {
  playTone(1200, 0.05, 0.03);
}

/** Adaptive ambient hum that responds to threat level */
let hum: {
  osc: OscillatorNode;
  gain: GainNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  filter: BiquadFilterNode;
} | null = null;

export function startAmbient() {
  if (!enabled || hum) return;
  try {
    const c = getCtx();

    // Base drone
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;

    // Filter for warmth
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    filter.Q.value = 1;

    // LFO for subtle movement
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.15;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 30;
    lfo.connect(lfoGain).connect(filter.frequency);

    // Master gain
    const gain = c.createGain();
    gain.gain.value = 0.025;

    osc.connect(filter).connect(gain).connect(c.destination);
    osc.start();
    lfo.start();

    hum = { osc, gain, lfo, lfoGain, filter };
  } catch { /* */ }
}

/** Update ambient intensity based on threat level (0-100) */
export function setAmbientIntensity(threatLevel: number) {
  if (!hum) return;
  try {
    const c = getCtx();
    const t = c.currentTime;
    // Volume scales with threat: 0.025 at calm, 0.06 at critical
    const vol = 0.025 + (threatLevel / 100) * 0.035;
    hum.gain.gain.setTargetAtTime(vol, t, 0.5);
    // Filter opens with threat: 200Hz at calm, 600Hz at critical
    const freq = 200 + (threatLevel / 100) * 400;
    hum.filter.frequency.setTargetAtTime(freq, t, 0.5);
    // LFO speeds up: 0.15Hz at calm, 0.8Hz at critical
    const lfoFreq = 0.15 + (threatLevel / 100) * 0.65;
    hum.lfo.frequency.setTargetAtTime(lfoFreq, t, 0.5);
  } catch { /* */ }
}

export function stopAmbient() {
  if (hum) {
    const c = getCtx();
    hum.gain.gain.setTargetAtTime(0, c.currentTime, 0.5);
    const h = hum;
    hum = null;
    setTimeout(() => {
      try { h.osc.stop(); h.lfo.stop(); } catch { /* */ }
    }, 1500);
  }
}
