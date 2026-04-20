import { useState, useRef, useEffect, useCallback } from 'react';
import { Volume2, VolumeX, Play, Pause } from 'lucide-react';

/**
 * Procedural synthwave ambient generator using Web Audio API.
 * Creates a layered drone with bass, pad, and arpeggio that
 * sounds like a cyberpunk dashboard soundtrack.
 * Zero external files, zero licensing issues.
 */

interface SynthNodes {
  ctx: AudioContext;
  master: GainNode;
  bass: OscillatorNode;
  bassGain: GainNode;
  pad1: OscillatorNode;
  pad2: OscillatorNode;
  padGain: GainNode;
  arp: OscillatorNode;
  arpGain: GainNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  filter: BiquadFilterNode;
  arpInterval?: ReturnType<typeof setInterval>;
}

// Scale pools: dark cyberpunk keys to cycle through
const SCALES = [
  [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33],  // A minor pentatonic
  [196, 233.08, 261.63, 293.66, 349.23, 392, 466.16, 523.25], // G minor pentatonic
  [174.61, 207.65, 233.08, 261.63, 311.13, 349.23, 415.30, 466.16], // F minor pentatonic
  [164.81, 196, 220, 261.63, 293.66, 329.63, 392, 440], // E minor pentatonic
];

const ARP_PATTERNS = [
  [0, 2, 4, 5, 7, 5, 4, 2],       // ascending/descending
  [0, 4, 2, 5, 3, 7, 5, 4],       // broken chord
  [7, 5, 4, 2, 0, 2, 4, 5],       // descending/ascending
  [0, 0, 4, 4, 5, 5, 7, 7],       // doubled steps
  [0, 7, 2, 5, 4, 0, 5, 2],       // random jumps
  [0, 2, 0, 4, 0, 5, 0, 7],       // pedal tone
];

const BASS_ROOTS = [55, 49, 43.65, 41.20]; // A1, G1, F1, E1

const ARP_SPEEDS = [375, 300, 500, 250]; // BPM variations

function createSynth(volume: number): SynthNodes {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  // Low-pass filter for warmth
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800;
  filter.Q.value = 2;
  filter.connect(master);

  // Pick initial key
  let scaleIdx = 0;
  let patternIdx = 0;
  let currentScale = SCALES[0];
  let currentPattern = ARP_PATTERNS[0];

  // Bass drone
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0.12;
  bassGain.connect(filter);
  const bass = ctx.createOscillator();
  bass.type = 'sawtooth';
  bass.frequency.value = BASS_ROOTS[0];
  bass.connect(bassGain);

  // Pad layer 1 (A3 = 220Hz)
  const padGain = ctx.createGain();
  padGain.gain.value = 0.06;
  padGain.connect(filter);
  const pad1 = ctx.createOscillator();
  pad1.type = 'sine';
  pad1.frequency.value = 220;
  pad1.connect(padGain);

  // Pad layer 2 (E3 = 164.81Hz, slight detune for width)
  const pad2 = ctx.createOscillator();
  pad2.type = 'triangle';
  pad2.frequency.value = 164.81;
  pad2.detune.value = 8;
  pad2.connect(padGain);

  // Arpeggio (will be modulated)
  const arpGain = ctx.createGain();
  arpGain.gain.value = 0;
  arpGain.connect(filter);
  const arp = ctx.createOscillator();
  arp.type = 'square';
  arp.frequency.value = 440;
  arp.connect(arpGain);

  // LFO for filter sweep
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 400;
  lfoGain.connect(filter.frequency);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.08;
  lfo.connect(lfoGain);

  // Start everything
  bass.start();
  pad1.start();
  pad2.start();
  arp.start();
  lfo.start();

  // Arpeggio pattern with evolution
  let arpIdx = 0;
  let stepCount = 0;
  let currentSpeed = ARP_SPEEDS[0];

  const playArpStep = () => {
    const patIdx = currentPattern[arpIdx % currentPattern.length];
    const note = currentScale[patIdx % currentScale.length];

    // Occasional octave jump for sparkle
    const octaveShift = Math.random() > 0.85 ? 2 : 1;
    arp.frequency.setTargetAtTime(note * octaveShift, ctx.currentTime, 0.01);

    // Vary velocity randomly
    const vel = 0.02 + Math.random() * 0.03;
    arpGain.gain.setTargetAtTime(vel, ctx.currentTime, 0.01);

    // Vary note length
    const decay = 0.06 + Math.random() * 0.06;
    arpGain.gain.setTargetAtTime(0, ctx.currentTime + 0.1 + Math.random() * 0.1, decay);

    // Occasional rest (silence)
    if (Math.random() > 0.9) {
      arpGain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    }

    arpIdx++;
    stepCount++;

    // Every 16-32 steps, evolve something
    if (stepCount % (16 + Math.floor(Math.random() * 16)) === 0) {
      const change = Math.random();

      if (change < 0.3) {
        // Change key
        scaleIdx = (scaleIdx + 1) % SCALES.length;
        currentScale = SCALES[scaleIdx];
        // Glide bass to new root
        bass.frequency.setTargetAtTime(BASS_ROOTS[scaleIdx], ctx.currentTime, 0.8);
        // Shift pads
        pad1.frequency.setTargetAtTime(currentScale[0], ctx.currentTime, 0.5);
        pad2.frequency.setTargetAtTime(currentScale[0] * 0.75, ctx.currentTime, 0.5);
      } else if (change < 0.6) {
        // Change arp pattern
        patternIdx = (patternIdx + 1) % ARP_PATTERNS.length;
        currentPattern = ARP_PATTERNS[patternIdx];
        arpIdx = 0;
      } else if (change < 0.8) {
        // Change speed
        currentSpeed = ARP_SPEEDS[Math.floor(Math.random() * ARP_SPEEDS.length)];
        clearInterval(arpInterval);
        arpInterval = setInterval(playArpStep, currentSpeed);
      } else {
        // Filter sweep moment
        const sweepTarget = 400 + Math.random() * 1200;
        filter.frequency.setTargetAtTime(sweepTarget, ctx.currentTime, 0.3);
        setTimeout(() => {
          filter.frequency.setTargetAtTime(800, ctx.currentTime, 1.0);
        }, 2000);
      }
    }
  };

  let arpInterval: ReturnType<typeof setInterval> = setInterval(playArpStep, currentSpeed);

  return { ctx, master, bass, bassGain, pad1, pad2, padGain, arp, arpGain, lfo, lfoGain, filter, arpInterval };
}

export default function MusicPlayer() {
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.3);
  const [muted, setMuted] = useState(false);
  const synthRef = useRef<SynthNodes | null>(null);

  const start = useCallback(() => {
    if (synthRef.current) return;
    synthRef.current = createSynth(muted ? 0 : volume);
    setPlaying(true);
  }, [volume, muted]);

  const stop = useCallback(() => {
    if (!synthRef.current) return;
    const s = synthRef.current;
    clearInterval(s.arpInterval);
    s.master.gain.setTargetAtTime(0, s.ctx.currentTime, 0.5);
    setTimeout(() => {
      s.bass.stop(); s.pad1.stop(); s.pad2.stop(); s.arp.stop(); s.lfo.stop();
      s.ctx.close();
      synthRef.current = null;
    }, 1500);
    setPlaying(false);
  }, []);

  // Update volume
  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.master.gain.setTargetAtTime(
        muted ? 0 : volume,
        synthRef.current.ctx.currentTime,
        0.1
      );
    }
  }, [volume, muted]);

  // Cleanup on unmount
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
