// audio.js — Áudio 100% procedural (WebAudio, zero arquivos externos).
// Vento (ruído filtrado em loop), animais noturnos (corujas, gorjeios),
// batimento cardíaco, sussurros (ruído filtrado com varredura de frequência),
// passos (rajadas de ruído) e reverb gerado (impulso de ruído em decaimento).
// Tudo começa após gesto do usuário (botão ENTRAR), como exige o navegador.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
  }

  get running() {
    return !!this.ctx && this.ctx.state === "running";
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC());

    // master -> compressor -> destino
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -22;
    this.comp.ratio.value = 5;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // reverb: resposta de impulso gerada (ruído em decaimento exponencial)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(ctx, 2.6, 2.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.4;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    // ruído branco compartilhado (2 s, em loop)
    this.noise = this.makeNoise(ctx, 2);

    this.startWind();
    this.started = true; // só marca como iniciado quando tudo funcionou
  }

  /** Roteia um nó para o reverb (send). */
  send(node, amount) {
    if (!this.reverb) return;
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g);
    g.connect(this.reverb);
  }

  makeNoise(ctx, seconds) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(ctx, duration, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * duration);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /** Vento constante: ruído -> bandpass, com LFOs de rajada e "respiração". */
  startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 380;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.055;
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    this.send(g, 0.5);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07; // rajadas lentas
    const lfoG = ctx.createGain();
    lfoG.gain.value = 220;
    lfo.connect(lfoG);
    lfoG.connect(bp.frequency);

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.11; // respiração do volume
    const lfo2G = ctx.createGain();
    lfo2G.gain.value = 0.02;
    lfo2.connect(lfo2G);
    lfo2G.connect(g.gain);

    src.start();
    lfo.start();
    lfo2.start();
  }

  /** Pancada de graves (sinoidal com decaimento) — usada no coração e no sub. */
  thump(t, freq, gain, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Coração: pares "tum-tá" com intervalo que acelera com a intensidade. */
  heartbeat(intensity = 1, beats = 4) {
    if (!this.ctx) return;
    let t = this.ctx.currentTime + 0.05;
    const iv = 0.9 / (0.7 + 0.6 * intensity);
    for (let i = 0; i < beats; i++) {
      this.thump(t, 62, 0.5 * intensity, 0.22);
      this.thump(t + 0.26, 48, 0.34 * intensity, 0.18);
      t += iv;
    }
  }

  /** Sussurro: ruído em bandpass com varredura + sílabas (AM lenta). */
  whisper(level = 1, dur = 2.2) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(2300, t + dur * 0.4);
    bp.frequency.linearRampToValueAtTime(900, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16 * level, t + 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    this.send(g, 0.7);

    const am = ctx.createOscillator();
    am.frequency.value = 5.5;
    const amG = ctx.createGain();
    amG.gain.value = 0.05 * level;
    am.connect(amG);
    amG.connect(g.gain);

    src.start(t);
    src.stop(t + dur + 0.1);
    am.start(t);
    am.stop(t + dur);
  }

  /** Coruja: 2-3 "tuc" graves com glide. */
  owlHoot() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.1;
    const hoots = 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < hoots; i++) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(360, t);
      o.frequency.linearRampToValueAtTime(300, t + 0.28);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.05);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g);
      g.connect(this.master);
      this.send(g, 0.8);
      o.start(t);
      o.stop(t + 0.35);
      t += 0.45;
    }
  }

  /** Gorjeio noturno: 2-4 blips agudos curtos. */
  chirp() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.05;
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = "sine";
      const f0 = 2400 + Math.random() * 1200;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f0 * 1.3, t + 0.03);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.04, t + 0.01);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.045);
      o.connect(g);
      g.connect(this.master);
      this.send(g, 0.6);
      o.start(t);
      o.stop(t + 0.06);
      t += 0.09 + Math.random() * 0.08;
    }
  }

  /** Passo: rajada curta de ruído (lowpass ~480 Hz) com leve pan. */
  footstep() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 480;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 90;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = (Math.random() - 0.5) * 0.3;
      g.connect(pan);
      pan.connect(this.master);
    } else {
      g.connect(this.master);
    }
    this.send(g, 0.25);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.12);
  }

  /** Punhado: duas serra-ondas graves desafinadas + sub (susto). */
  sting() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [55, 58.3].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 260;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.master);
      this.send(g, 0.9);
      o.start(t);
      o.stop(t + 1.5);
    });
    this.thump(t, 38, 0.3, 1.0);
  }

  /** Vitória: abafa a ambientação (o medo some, sobra o silêncio). */
  win() {
    if (!this.ctx) return;
    const g = this.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(0.12, this.ctx.currentTime, 0.6);
  }

  /** Repõe a mixagem (após vitória/reinício). */
  resetMix() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.5);
  }

  suspend() {
    if (this.ctx && this.ctx.state === "running")
      this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended")
      this.ctx.resume().catch(() => {});
  }
}
