import type { AudioSfxId } from '../domain/preset';

const SAMPLE_RATE = 44100;

export const BUILTIN_SFX_OPTIONS: Array<{ id: AudioSfxId; label: string; durationSec: number }> = [
  { id: 'none', label: 'Sin SFX', durationSec: 0 },
  { id: 'whoosh', label: 'Whoosh Cinemático', durationSec: 0.45 },
  { id: 'impact', label: 'Impact Boom', durationSec: 0.65 },
  { id: 'pop', label: 'Pop / Click UI', durationSec: 0.14 },
  { id: 'riser', label: 'Riser Tensión', durationSec: 0.9 },
  { id: 'tape-stop', label: 'Tape Stop', durationSec: 0.55 },
  { id: 'shutter', label: 'Camera Shutter', durationSec: 0.18 },
];

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function synthesizeSfxSamples(
  sfxId: Exclude<AudioSfxId, 'none' | 'custom'>,
  sampleRate = SAMPLE_RATE
): Float32Array {
  const meta = BUILTIN_SFX_OPTIONS.find((item) => item.id === sfxId);
  const duration = meta?.durationSec ?? 0.4;
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const out = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const progress = i / length;
    const noise = pseudoRandom(i + sfxId.length * 97) * 2 - 1;

    if (sfxId === 'whoosh') {
      const env = Math.sin(Math.PI * progress) ** 1.4;
      const sweep = Math.sin(2 * Math.PI * (140 + 420 * Math.sin(Math.PI * progress)) * t);
      out[i] = (noise * 0.62 + sweep * 0.38) * env * 0.8;
    } else if (sfxId === 'impact') {
      const env = Math.exp(-t * 6.2);
      const subFreq = 115 * Math.exp(-t * 8) + 38;
      const sub = Math.sin(2 * Math.PI * subFreq * t);
      const transient = Math.exp(-t * 45) * noise * 0.55;
      out[i] = (sub * 0.85 + transient) * env * 0.92;
    } else if (sfxId === 'pop') {
      const env = Math.exp(-t * 28);
      const freq = 520 * Math.exp(-t * 16) + 180;
      out[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.85;
    } else if (sfxId === 'riser') {
      const env = progress ** 1.6 * (1 - Math.max(0, (progress - 0.9) * 10));
      const freq = 110 + 980 * progress ** 2;
      const tone = Math.sin(2 * Math.PI * freq * t) * 0.65;
      out[i] = (tone + noise * 0.25) * env * 0.78;
    } else if (sfxId === 'tape-stop') {
      const env = 1 - progress ** 2.2;
      const freq = 420 * (1 - progress * 0.86);
      out[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.78;
    } else if (sfxId === 'shutter') {
      const click1 = Math.exp(-t * 95) * noise;
      const click2 = t > 0.065 ? Math.exp(-(t - 0.065) * 90) * noise * 0.75 : 0;
      const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 38) * 0.4;
      out[i] = (click1 + click2 + body) * 0.9;
    }
  }

  return out;
}

export function dbToLinear(gainDb: number): number {
  return Math.pow(10, Math.max(-36, Math.min(12, gainDb)) / 20);
}

export function buildSfxWavBytes(
  sfxId: Exclude<AudioSfxId, 'none' | 'custom'>,
  gainDb = 0
): Uint8Array {
  const samples = synthesizeSfxSamples(sfxId, SAMPLE_RATE);
  const gain = dbToLinear(gainDb);
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] * gain));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

export function generateSfxWaveformPeaks(
  sfxId: AudioSfxId,
  customBytes?: Uint8Array | null,
  bars = 36
): number[] {
  if (sfxId === 'none') {
    return Array.from({ length: bars }, () => 0);
  }

  if (sfxId === 'custom') {
    if (!customBytes || customBytes.length === 0) {
      return Array.from({ length: bars }, (_, idx) => 0.2 + 0.55 * Math.sin((idx / bars) * Math.PI));
    }
    const step = Math.max(1, Math.floor(customBytes.length / bars));
    return Array.from({ length: bars }, (_, barIdx) => {
      const start = barIdx * step;
      let peak = 0;
      for (let i = start; i < Math.min(customBytes.length, start + step); i += 1) {
        const norm = Math.abs(customBytes[i] - 128) / 128;
        if (norm > peak) peak = norm;
      }
      return Math.max(0.1, Math.min(1, peak));
    });
  }

  const samples = synthesizeSfxSamples(sfxId, 8000);
  const step = Math.max(1, Math.floor(samples.length / bars));
  return Array.from({ length: bars }, (_, barIdx) => {
    const start = barIdx * step;
    let peak = 0;
    for (let i = start; i < Math.min(samples.length, start + step); i += 1) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
    }
    return Math.max(0.08, Math.min(1, peak));
  });
}

export class SfxPreviewEngine {
  private ctx: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      if (!this.ctx) {
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  stop(): void {
    try {
      this.activeSource?.stop();
    } catch {
      // Ignore already-stopped source
    }
    this.activeSource = null;
  }

  async play(options: {
    sfxId: AudioSfxId;
    gainDb: number;
    muted?: boolean;
    customBytes?: Uint8Array | null;
  }): Promise<void> {
    if (options.muted || options.sfxId === 'none') return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    this.stop();

    try {
      let audioBuffer: AudioBuffer | null = null;
      if (options.sfxId === 'custom' && options.customBytes) {
        const copy = options.customBytes.slice().buffer;
        audioBuffer = await ctx.decodeAudioData(copy);
      } else if (options.sfxId !== 'custom') {
        const samples = synthesizeSfxSamples(options.sfxId, ctx.sampleRate);
        audioBuffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
        audioBuffer.getChannelData(0).set(samples);
      }
      if (!audioBuffer) return;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = dbToLinear(options.gainDb);
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start(0);
      this.activeSource = source;
    } catch {
      // Ignore audio decode/playback errors in restricted environments
    }
  }

  playKeystrokeTick(stepSeed = 0, gainDb = -10): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const durationSec = 0.024;
      const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      const pitchShift = 0.9 + pseudoRandom(stepSeed * 31 + 7) * 0.24;
      for (let i = 0; i < len; i += 1) {
        const t = i / ctx.sampleRate;
        const clickEnv = Math.exp(-t * 210);
        const bodyEnv = Math.exp(-t * 95);
        const noise = pseudoRandom(i + stepSeed * 131) * 2 - 1;
        const clickTone = Math.sin(2 * Math.PI * 2350 * pitchShift * t);
        const switchBody = Math.sin(2 * Math.PI * 460 * pitchShift * t);
        data[i] = (noise * 0.52 * clickEnv + clickTone * 0.34 * clickEnv + switchBody * 0.22 * bodyEnv) * 0.75;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = dbToLinear(gainDb);
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
    } catch {
      // Ignore audio errors in headless/restricted environments
    }
  }
}
