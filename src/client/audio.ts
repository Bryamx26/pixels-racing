/** Sons synthétisés (aucun fichier) : moteur, bips du départ, chocs. */
export class Sound {
  private ctx: AudioContext | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  muted = false;

  /** À appeler depuis un geste de l'utilisateur (les navigateurs l'exigent). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const c = this.ctx;
    const osc = c.createOscillator(), osc2 = c.createOscillator();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain = c.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(c.destination);
    osc.start();
    osc2.start();
    this.engine = { osc, osc2, gain, filter };
  }

  /** Régime moteur selon la vitesse (0..1) ; `on` = false coupe le moteur. */
  setEngine(speed01: number, throttle: boolean, on: boolean): void {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    // Petit passage de rapports : le régime retombe tous les 25 % de vitesse.
    const gear = Math.min(3, Math.floor(speed01 * 4));
    const rpm = (speed01 * 4 - gear) * 0.7 + 0.3 + gear * 0.08;
    const f = 45 + rpm * 90;
    this.engine.osc.frequency.setTargetAtTime(f, t, 0.05);
    this.engine.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(throttle ? 900 : 500, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(on && !this.muted ? (throttle ? 0.07 : 0.045) : 0, t, 0.08);
  }

  beep(freq: number, dur = 0.15, type: OscillatorType = 'square', vol = 0.12): void {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur);
  }

  bump(power: number): void {
    this.beep(70 + Math.random() * 40, 0.12, 'square', Math.min(0.2, 0.05 + power / 2000));
  }
}
