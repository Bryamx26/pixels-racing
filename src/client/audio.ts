/**
 * Sons synthétisés (aucun fichier) : moteur à rapports, crissement des pneus, vent,
 * vibreurs, turbo, bips du départ et chocs.
 */
export interface CarSound {
  /** Régime moteur 0..1 dans le rapport en cours. */
  rpm: number;
  /** Gaz (0..1). */
  throttle: number;
  /** Vitesse 0..1 (vent). */
  speed: number;
  /** Glisse des pneus 0..1 (crissement). */
  slide: number;
  /** Roues sur les vibreurs. */
  kerb: boolean;
  /** Turbo en cours. */
  boost: boolean;
  /** Terre, herbe ou sable : bruit de graviers au lieu du crissement. */
  rough: boolean;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; osc3: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private tyre: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private kerb: { osc: OscillatorNode; gain: GainNode } | null = null;
  private wasBoost = false;
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
    // Moteur : dent de scie + carré à l'octave basse + un peu d'harmonique, filtré.
    const osc = c.createOscillator(), osc2 = c.createOscillator(), osc3 = c.createOscillator();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    osc3.type = 'sawtooth';
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 3;
    const gain = c.createGain();
    gain.gain.value = 0;
    const g3 = c.createGain();
    g3.gain.value = 0.25;
    osc.connect(filter);
    osc2.connect(filter);
    osc3.connect(g3).connect(filter);
    filter.connect(gain).connect(c.destination);
    for (const o of [osc, osc2, osc3]) o.start();
    this.engine = { osc, osc2, osc3, gain, filter };

    // Bruit blanc en boucle, partagé par les pneus et le vent.
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = (type: BiquadFilterType, f: number, q: number) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = f;
      filter.Q.value = q;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(c.destination);
      src.start();
      return { gain, filter };
    };
    this.tyre = noise('bandpass', 1400, 6);
    this.wind = noise('lowpass', 500, 0.5);
    const k = c.createOscillator();
    k.type = 'square';
    k.frequency.value = 38;
    const kg = c.createGain();
    kg.gain.value = 0;
    k.connect(kg).connect(c.destination);
    k.start();
    this.kerb = { osc: k, gain: kg };
  }

  /** Tous les sons continus de la voiture du joueur ; `on` = false les coupe. */
  setCar(s: CarSound | null, on: boolean): void {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const live = on && !!s && !this.muted;
    const e = this.engine;
    if (s) {
      const f = 38 + s.rpm * 120 + s.speed * 20;
      e.osc.frequency.setTargetAtTime(f, t, 0.03);
      e.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
      e.osc3.frequency.setTargetAtTime(f * 1.5, t, 0.03);
      e.filter.frequency.setTargetAtTime(400 + s.throttle * 900 + s.rpm * 600, t, 0.05);
    }
    e.gain.gain.setTargetAtTime(live ? 0.04 + (s!.throttle > 0.1 ? 0.035 : 0) : 0, t, 0.06);
    // Crissement : plus aigu sur le bitume, grave et granuleux sur la terre.
    this.tyre!.filter.frequency.setTargetAtTime(s?.rough ? 380 : 1300 + (s?.slide ?? 0) * 500, t, 0.05);
    this.tyre!.gain.gain.setTargetAtTime(live ? Math.min(1, s!.slide) * (s!.rough ? 0.18 : 0.09) : 0, t, 0.04);
    this.wind!.gain.gain.setTargetAtTime(live ? s!.speed * s!.speed * 0.06 : 0, t, 0.2);
    this.wind!.filter.frequency.setTargetAtTime(300 + (s?.speed ?? 0) * 900, t, 0.2);
    this.kerb!.gain.gain.setTargetAtTime(live && s!.kerb ? 0.05 : 0, t, 0.02);
    if (s && live && s.boost && !this.wasBoost) this.whoosh();
    this.wasBoost = !!s?.boost;
  }

  /** Compatibilité : coupe tout le son moteur. */
  setEngine(_speed01: number, _throttle: boolean, on: boolean): void {
    if (!on) this.setCar(null, false);
  }

  /** Passage de rapport : petit trou dans le son. */
  shift(): void {
    if (!this.ctx || !this.engine || this.muted) return;
    const g = this.engine.gain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.015, t);
    g.linearRampToValueAtTime(0.07, t + 0.12);
    this.beep(90, 0.06, 'square', 0.05);
  }

  private whoosh(): void {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.5);
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
    this.beep(60 + Math.random() * 40, 0.14, 'square', Math.min(0.22, 0.05 + power / 1800));
    if (power > 200) this.beep(2200 + Math.random() * 800, 0.08, 'triangle', 0.04);
  }
}
