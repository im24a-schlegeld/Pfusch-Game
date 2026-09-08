export class GameAudio {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  muted = true;
  unlock() {
    if (this.context) {
      void this.context.resume();
      return;
    }
    try {
      this.context = new AudioContext();
      this.oscillator = this.context.createOscillator();
      this.gain = this.context.createGain();
      this.oscillator.type = 'sawtooth';
      this.oscillator.frequency.value = 45;
      this.gain.gain.value = 0;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 200;
      this.oscillator.connect(filter);
      filter.connect(this.gain);
      this.gain.connect(this.context.destination);
      this.oscillator.start();
    } catch {
      /* Audio is optional. */
    }
  }
  update(speed: number, wheelie: boolean, playing: boolean) {
    if (!this.context || !this.gain || !this.oscillator) return;
    this.gain.gain.setTargetAtTime(
      this.muted || !playing ? 0 : 0.055,
      this.context.currentTime,
      0.06,
    );
    this.oscillator.frequency.setTargetAtTime(
      35 + speed * 1.5 + (wheelie ? 12 : 0),
      this.context.currentTime,
      0.1,
    );
  }
  cue(crash = false) {
    if (this.muted || !this.context) return;
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = crash ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(crash ? 110 : 620, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      crash ? 25 : 1100,
      ctx.currentTime + 0.16,
    );
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
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
    void this.context?.close();
    this.context = null;
  }
}
