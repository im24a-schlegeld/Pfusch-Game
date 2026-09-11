import {
  ENGINE_SOUNDS,
  engineRPM,
  soundId,
  type EngineSoundId,
} from './engineSound';

/** Procedural combustion, induction noise and mechanical partials; no third-party recordings. */
function engineVoice(ctx: AudioContext, output: AudioNode, id: EngineSoundId) {
  const profile = ENGINE_SOUNDS[id];
  const combustion = ctx.createOscillator(),
    mechanical = ctx.createOscillator();
  const filter = ctx.createBiquadFilter(),
    gain = ctx.createGain(),
    mechanicalGain = ctx.createGain();
  const real = new Float32Array(65),
    imaginary = new Float32Array(65);
  for (let i = 1; i < real.length; i++) {
    real[i] =
      Math.exp(-i * (id === '450' ? 0.04 : 0.015)) /
      i ** profile.harmonicFalloff;
    imaginary[i] = (id === '125' ? 0.45 : 0.12) * real[i] * (i % 2 ? 1 : -1);
  }
  combustion.setPeriodicWave(ctx.createPeriodicWave(real, imaginary));
  mechanical.type = id === '701' ? 'triangle' : 'sine';
  filter.type = 'lowpass';
  filter.Q.value = id === '125' ? 1.6 : 0.7;
  gain.gain.value = profile.level;
  mechanicalGain.gain.value = profile.level * 0.14;
  combustion.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  mechanical.connect(mechanicalGain);
  mechanicalGain.connect(output);
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate),
    data = buffer.getChannelData(0);
  let rng = 1709;
  for (let i = 0; i < data.length; i++) {
    rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
    data[i] = rng / 2147483648 - 1;
  }
  const noise = ctx.createBufferSource(),
    noiseFilter = ctx.createBiquadFilter(),
    noiseGain = ctx.createGain();
  noise.buffer = buffer;
  noise.loop = true;
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = id === '125' ? 1900 : id === '450' ? 650 : 3200;
  noiseFilter.Q.value = 0.6;
  noiseGain.gain.value = profile.noise;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(output);
  combustion.start();
  mechanical.start();
  noise.start();
  return {
    update(rpm: number, load: number) {
      const t = ctx.currentTime;
      combustion.frequency.setTargetAtTime(
        (rpm / 60) * profile.firingPerRevolution,
        t,
        0.1,
      );
      mechanical.frequency.setTargetAtTime(
        (rpm / 60) * (id === '125' ? 2.03 : 1.01),
        t,
        0.12,
      );
      filter.frequency.setTargetAtTime(
        profile.cutoff * (0.7 + load * 0.6),
        t,
        0.12,
      );
      gain.gain.setTargetAtTime(profile.level * (0.7 + load * 0.3), t, 0.08);
      noiseGain.gain.setTargetAtTime(profile.noise * (0.5 + load), t, 0.1);
    },
    dispose() {
      combustion.stop();
      mechanical.stop();
      noise.stop();
      for (const node of [
        combustion,
        mechanical,
        noise,
        filter,
        gain,
        mechanicalGain,
        noiseFilter,
        noiseGain,
      ])
        node.disconnect();
    },
  };
}

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private tunnelSend: GainNode | null = null;
  private voice: ReturnType<typeof engineVoice> | null = null;
  private bikeId: EngineSoundId = '450';
  muted = true;
  unlock() {
    if (this.context) {
      void this.context.resume();
      return;
    }
    try {
      const ctx = (this.context = new AudioContext());
      const master = (this.master = ctx.createGain()),
        bus = (this.bus = ctx.createGain());
      master.gain.value = 0;
      bus.connect(master);
      master.connect(ctx.destination);
      const send = (this.tunnelSend = ctx.createGain()),
        delay = ctx.createDelay(0.5);
      const reflection = ctx.createBiquadFilter(),
        feedback = ctx.createGain(),
        wet = ctx.createGain();
      send.gain.value = 0;
      delay.delayTime.value = 0.095;
      reflection.type = 'lowpass';
      reflection.frequency.value = 2600;
      feedback.gain.value = 0.25;
      wet.gain.value = 0.48;
      bus.connect(send);
      send.connect(delay);
      delay.connect(reflection);
      reflection.connect(wet);
      wet.connect(master);
      reflection.connect(feedback);
      feedback.connect(delay);
      this.voice = engineVoice(ctx, bus, this.bikeId);
    } catch (error) {
      console.warn('Engine audio could not start', error);
      void this.context?.close();
      this.context = null;
    }
  }
  update(
    speed: number,
    throttle: boolean,
    playing: boolean,
    bike = this.bikeId as string,
    tunnel = 0,
    forward = false,
  ) {
    if (!this.context || !this.master || !this.bus) return;
    const id = soundId(bike);
    if (id !== this.bikeId) {
      this.voice?.dispose();
      this.bikeId = id;
      this.voice = engineVoice(this.context, this.bus, id);
    }
    this.master.gain.setTargetAtTime(
      this.muted || !playing ? 0 : 0.8,
      this.context.currentTime,
      0.06,
    );
    this.voice?.update(
      engineRPM(id, speed, throttle, forward),
      throttle ? 1 : forward ? 0.2 : 0.55,
    );
    this.tunnelSend?.gain.setTargetAtTime(
      Math.max(0, Math.min(1, tunnel)) * 0.45,
      this.context.currentTime,
      0.2,
    );
  }
  cue(crash = false) {
    if (this.muted || !this.context) return;
    const ctx = this.context,
      osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = crash ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(crash ? 110 : 620, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      crash ? 25 : 1100,
      ctx.currentTime + 0.16,
    );
    gain.gain.setValueAtTime(0.045, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.21);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  dispose() {
    this.voice?.dispose();
    this.voice = null;
    void this.context?.close();
    this.context = null;
  }
}
