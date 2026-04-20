import { useState, useRef, useEffect, useCallback } from 'react';
import { Volume2, VolumeX, Play, Pause } from 'lucide-react';

/**
 * Procedural synthwave ambient generator using Web Audio API.
 * Layered synth engine: sub-bass, sawtooth bass, detuned pads,
 * square arp with delay, noise texture, and pluck hits.
 * Everything evolves over time. Zero external files.
 */

interface SynthEngine {
  ctx: AudioContext;
  master: GainNode;
  allOscillators: OscillatorNode[];
  allIntervals: ReturnType<typeof setInterval>[];
  noiseSource?: AudioBufferSourceNode;
}

const SCALES = [
  [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33],
  [196, 233.08, 261.63, 293.66, 349.23, 392, 466.16, 523.25],
  [174.61, 207.65, 233.08, 261.63, 311.13, 349.23, 415.30, 466.16],
  [164.81, 196, 220, 261.63, 293.66, 329.63, 392, 440],
];

const ARP_PATTERNS = [
  [0, 2, 4, 5, 7, 5, 4, 2],
  [0, 4, 2, 5, 3, 7, 5, 4],
  [7, 5, 4, 2, 0, 2, 4, 5],
  [0, 0, 4, 4, 5, 5, 7, 7],
  [0, 7, 2, 5, 4, 0, 5, 2],
  [0, 2, 0, 4, 0, 5, 0, 7],
];

const BASS_ROOTS = [55, 49, 43.65, 41.20];
const ARP_SPEEDS = [375, 300, 500, 250];

function createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const size = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function createDelay(ctx: AudioContext, time: number, feedback: number, dest: AudioNode): { input: DelayNode } {
  const delay = ctx.createDelay(2);
  delay.delayTime.value = time;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(wet);
  wet.connect(dest);
  return { input: delay };
}

function createSynth(volume: number): SynthEngine {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  const allOscillators: OscillatorNode[] = [];
  const allIntervals: ReturnType<typeof setInterval>[] = [];

  // Main filter
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 3;
  filter.connect(master);

  // Second filter for high-end shimmer
  const hiFilter = ctx.createBiquadFilter();
  hiFilter.type = 'highpass';
  hiFilter.frequency.value = 2000;
  hiFilter.Q.value = 0.5;
  hiFilter.connect(master);

  let scaleIdx = 0;
  let patternIdx = 0;
  let currentScale = SCALES[0];
  let currentPattern = ARP_PATTERNS[0];

  // === SUB BASS (deep sine pulse) ===
  const subGain = ctx.createGain();
  subGain.gain.value = 0.15;
  subGain.connect(master);
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = BASS_ROOTS[0] / 2; // One octave below bass
  sub.connect(subGain);
  allOscillators.push(sub);

  // Sub pulse LFO
  const subLfo = ctx.createOscillator();
  subLfo.type = 'sine';
  subLfo.frequency.value = 0.15;
  const subLfoGain = ctx.createGain();
  subLfoGain.gain.value = 0.08;
  subLfo.connect(subLfoGain);
  subLfoGain.connect(subGain.gain);
  allOscillators.push(subLfo);

  // === SAWTOOTH BASS ===
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0.10;
  bassGain.connect(filter);
  const bass = ctx.createOscillator();
  bass.type = 'sawtooth';
  bass.frequency.value = BASS_ROOTS[0];
  bass.connect(bassGain);
  allOscillators.push(bass);

  // === DETUNED PAD STACK (4 oscillators for thick synth pad) ===
  const padGain = ctx.createGain();
  padGain.gain.value = 0.04;
  padGain.connect(filter);

  const padFreqs = [220, 220, 164.81, 329.63];
  const padTypes: OscillatorType[] = ['sine', 'triangle', 'triangle', 'sine'];
  const padDetunes = [0, 12, 8, -6];

  const pads = padFreqs.map((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = padTypes[i];
    osc.frequency.value = freq;
    osc.detune.value = padDetunes[i];
    osc.connect(padGain);
    allOscillators.push(osc);
    return osc;
  });

  // === ARPEGGIO with delay ===
  const arpGain = ctx.createGain();
  arpGain.gain.value = 0;
  arpGain.connect(filter);
  const arpDelay = createDelay(ctx, 0.375, 0.35, filter);
  arpGain.connect(arpDelay.input);

  const arp = ctx.createOscillator();
  arp.type = 'square';
  arp.frequency.value = 440;
  arp.connect(arpGain);
  allOscillators.push(arp);

  // === PLUCK SYNTH (short attack triangle for Blade Runner hits) ===
  const pluckGain = ctx.createGain();
  pluckGain.gain.value = 0;
  pluckGain.connect(hiFilter);
  const pluckDelay = createDelay(ctx, 0.5, 0.25, hiFilter);
  pluckGain.connect(pluckDelay.input);

  const pluck = ctx.createOscillator();
  pluck.type = 'triangle';
  pluck.frequency.value = 880;
  pluck.connect(pluckGain);
  allOscillators.push(pluck);

  // === NOISE TEXTURE (filtered white noise for atmosphere) ===
  const noiseBuf = createNoiseBuffer(ctx, 4);
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuf;
  noiseSource.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 3000;
  noiseFilter.Q.value = 0.8;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.012;
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(master);

  // Noise sweep LFO
  const noiseLfo = ctx.createOscillator();
  noiseLfo.type = 'sine';
  noiseLfo.frequency.value = 0.05;
  const noiseLfoGain = ctx.createGain();
  noiseLfoGain.gain.value = 2000;
  noiseLfo.connect(noiseLfoGain);
  noiseLfoGain.connect(noiseFilter.frequency);
  allOscillators.push(noiseLfo);

  // === MAIN FILTER LFO ===
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.06;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 500;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  allOscillators.push(lfo);

  // Start everything
  allOscillators.forEach(o => o.start());
  noiseSource.start();


  // === SEQUENCER ===
  let arpIdx = 0;
  let stepCount = 0;
  let currentSpeed = ARP_SPEEDS[0];

  const playArpStep = () => {
    const patIdx = currentPattern[arpIdx % currentPattern.length];
    const note = currentScale[patIdx % currentScale.length];

    // Octave jump for sparkle
    const octaveShift = Math.random() > 0.82 ? 2 : 1;
    arp.frequency.setTargetAtTime(note * octaveShift, ctx.currentTime, 0.01);

    // Velocity variation
    const vel = 0.02 + Math.random() * 0.035;
    arpGain.gain.setTargetAtTime(vel, ctx.currentTime, 0.01);
    const decay = 0.05 + Math.random() * 0.07;
    arpGain.gain.setTargetAtTime(0, ctx.currentTime + 0.08 + Math.random() * 0.12, decay);

    // Occasional rest
    if (Math.random() > 0.88) {
      arpGain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    }

    // Pluck hits on random steps (sparse, high notes)
    if (Math.random() > 0.92) {
      const pluckNote = currentScale[Math.floor(Math.random() * currentScale.length)] * 2;
      pluck.frequency.setTargetAtTime(pluckNote, ctx.currentTime, 0.005);
      pluckGain.gain.setTargetAtTime(0.06 + Math.random() * 0.04, ctx.currentTime, 0.005);
      pluckGain.gain.setTargetAtTime(0, ctx.currentTime + 0.05, 0.15);
    }

    arpIdx++;
    stepCount++;

    // Evolution every 16-32 steps
    if (stepCount % (16 + Math.floor(Math.random() * 16)) === 0) {
      const change = Math.random();

      if (change < 0.25) {
        // Key change
        scaleIdx = (scaleIdx + 1) % SCALES.length;
        currentScale = SCALES[scaleIdx];
        bass.frequency.setTargetAtTime(BASS_ROOTS[scaleIdx], ctx.currentTime, 0.8);
        sub.frequency.setTargetAtTime(BASS_ROOTS[scaleIdx] / 2, ctx.currentTime, 1.2);
        pads[0].frequency.setTargetAtTime(currentScale[0], ctx.currentTime, 0.6);
        pads[1].frequency.setTargetAtTime(currentScale[0], ctx.currentTime, 0.6);
        pads[2].frequency.setTargetAtTime(currentScale[0] * 0.75, ctx.currentTime, 0.6);
        pads[3].frequency.setTargetAtTime(currentScale[2] || currentScale[0] * 1.5, ctx.currentTime, 0.6);
      } else if (change < 0.45) {
        // Pattern change
        patternIdx = (patternIdx + 1) % ARP_PATTERNS.length;
        currentPattern = ARP_PATTERNS[patternIdx];
        arpIdx = 0;
      } else if (change < 0.6) {
        // Speed change
        currentSpeed = ARP_SPEEDS[Math.floor(Math.random() * ARP_SPEEDS.length)];
        clearInterval(arpInterval);
        arpInterval = setInterval(playArpStep, currentSpeed);
        allIntervals[0] = arpInterval;
      } else if (change < 0.75) {
        // Filter sweep
        const target = 400 + Math.random() * 1600;
        filter.frequency.setTargetAtTime(target, ctx.currentTime, 0.3);
        setTimeout(() => filter.frequency.setTargetAtTime(900, ctx.currentTime, 1.5), 3000);
      } else if (change < 0.88) {
        // Noise swell
        noiseGain.gain.setTargetAtTime(0.04 + Math.random() * 0.03, ctx.currentTime, 0.5);
        setTimeout(() => noiseGain.gain.setTargetAtTime(0.012, ctx.currentTime, 2.0), 4000);
      } else {
        // Pad volume swell
        padGain.gain.setTargetAtTime(0.07 + Math.random() * 0.03, ctx.currentTime, 0.8);
        setTimeout(() => padGain.gain.setTargetAtTime(0.04, ctx.currentTime, 1.5), 5000);
      }
    }
  };

  let arpInterval = setInterval(playArpStep, currentSpeed);
  allIntervals.push(arpInterval);

  // Slow chord stab every 15-25 seconds
  const stabInterval = setInterval(() => {
    if (Math.random() > 0.5) return;
    const root = currentScale[0];
    const fifth = currentScale[4] || root * 1.5;
    // Brief sawtooth chord
    const stabOsc1 = ctx.createOscillator();
    const stabOsc2 = ctx.createOscillator();
    const stabGain = ctx.createGain();
    stabOsc1.type = 'sawtooth';
    stabOsc2.type = 'sawtooth';
    stabOsc1.frequency.value = root;
    stabOsc2.frequency.value = fifth;
    stabOsc2.detune.value = 6;
    stabGain.gain.value = 0;
    stabOsc1.connect(stabGain);
    stabOsc2.connect(stabGain);
    stabGain.connect(filter);
    stabOsc1.start();
    stabOsc2.start();
    // Fade in and out
    stabGain.gain.setTargetAtTime(0.04, ctx.currentTime, 0.3);
    stabGain.gain.setTargetAtTime(0, ctx.currentTime + 2, 1.0);
    setTimeout(() => { stabOsc1.stop(); stabOsc2.stop(); }, 6000);
  }, 18000 + Math.random() * 7000);
  allIntervals.push(stabInterval);

  return { ctx, master, allOscillators, allIntervals, noiseSource };
}

export default function MusicPlayer() {
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.3);
  const [muted, setMuted] = useState(false);
  const synthRef = useRef<SynthEngine | null>(null);

  const start = useCallback(() => {
    if (synthRef.current) return;
    synthRef.current = createSynth(muted ? 0 : volume);
    setPlaying(true);
  }, [volume, muted]);

  const stop = useCallback(() => {
    if (!synthRef.current) return;
    const s = synthRef.current;
    s.allIntervals.forEach(i => clearInterval(i));
    s.master.gain.setTargetAtTime(0, s.ctx.currentTime, 0.5);
    setTimeout(() => {
      s.allOscillators.forEach(o => { try { o.stop(); } catch {} });
      try { s.noiseSource?.stop(); } catch {}
      s.ctx.close();
      synthRef.current = null;
    }, 1500);
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.master.gain.setTargetAtTime(
        muted ? 0 : volume,
        synthRef.current.ctx.currentTime,
        0.1
      );
    }
  }, [volume, muted]);

  useEffect(() => {
    return () => { if (synthRef.current) stop(); };
  }, [stop]);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-providence-border/50">
      <button onClick={() => playing ? stop() : start()}
        className="text-gray-500 hover:text-providence-accent transition-colors">
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <button onClick={() => setMuted(!muted)}
        className="text-gray-500 hover:text-gray-300 transition-colors">
        {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>
      <input type="range" min="0" max="1" step="0.05" value={volume}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        className="w-16 accent-providence-accent h-1"
        aria-label="Volume" />
      {playing && (
        <span className="text-[9px] text-gray-600 tracking-wider">SYNTH</span>
      )}
    </div>
  );
}
