// scares.js — Diretor de sustos: eventos aleatórios ponderados a cada 9–24 s.
// Sussurros + frases PT-BR, batimento cardíaco, apagões de tochas, corujas,
// gorjeios, punhados graves e uma silhueta pálida (olhos brancos) que aparece
// por alguns segundos num corredor distante. Tudo procedural, sem assets.
import * as THREE from "three";
import { CELL } from "./maze.js";

const PHRASES = [
  "não olhe para trás.",
  "você não é o primeiro.",
  "ela te vê.",
  "apaga a tocha… apaga a sua.",
  "tão perto da saída…",
  "corra.",
  "ela anda com você.",
  "quem apagou o sol?",
  "o labirinto gosta do escuro.",
  "você ouviu isso também, não ouviu?",
];

const WEIGHTS = [
  ["whisper", 0.22],
  ["heartbeat", 0.18],
  ["flicker", 0.18],
  ["hoot", 0.12],
  ["chirp", 0.08],
  ["ghost", 0.14],
  ["sting", 0.08],
];

export class ScareDirector {
  constructor({ scene, camera, audio, torches, scareText }) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.torches = torches;
    this.scareText = scareText;
    this.nextAt = 6; // primeiro susto ~6 s após o início (relógio global)
    this.ghostUntil = 0;
    this.ghostShownAt = 0;
    this.moodUntil = 0;
    this.textTimer = null;
    this.ghost = this.makeGhost();
  }

  /** Silhueta: corpo preto sem luz (buraco na cena) + dois olhos brancos. */
  makeGhost() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshBasicMaterial({
      color: 0x050508,
      transparent: true,
      opacity: 0,
    });
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, 0.85, 6, 12),
      bodyMat,
    );
    body.position.y = 0.95;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 16, 12),
      bodyMat,
    );
    head.position.y = 1.72;
    const eyeMat = new THREE.MeshBasicMaterial({
      color: 0xdfe9ff,
      transparent: true,
      opacity: 0,
    });
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), eyeMat);
    e1.position.set(-0.06, 1.75, 0.15);
    const e2 = e1.clone();
    e2.position.x = 0.06;
    g.add(body, head, e1, e2);
    g.visible = false;
    this.ghostMats = [bodyMat, eyeMat];
    return g;
  }

  /** Chamado a cada frame; avança apenas quando o jogo está rodando. */
  update(elapsed, dt, ctx) {
    if (ctx.state !== "playing") return;

    // restaura o humor das tochas depois de um apagão
    if (this.torches && elapsed > this.moodUntil && this.torches.mood < 1)
      this.torches.mood = 1;

    // silhueta: fade in/out
    if (this.ghost.visible) {
      if (elapsed > this.ghostUntil) {
        this.ghost.visible = false;
      } else {
        const rem = this.ghostUntil - elapsed;
        const fadeIn = Math.min(1, (elapsed - this.ghostShownAt) / 0.4);
        const fadeOut = Math.min(1, rem / 0.6);
        const op = Math.max(0, Math.min(fadeIn, fadeOut)) * 0.92;
        for (const m of this.ghostMats) m.opacity = op;
      }
    }

    if (elapsed >= this.nextAt) {
      this.fire(elapsed, ctx);
      this.nextAt = elapsed + 9 + Math.random() * 15;
    }
  }

  pick() {
    let r = Math.random();
    for (const [name, w] of WEIGHTS) {
      r -= w;
      if (r <= 0) return name;
    }
    return WEIGHTS[0][0];
  }

  fire(elapsed, ctx) {
    const name = this.pick();
    switch (name) {
      case "whisper":
        this.audio.whisper(
          0.8 + Math.random() * 0.5,
          1.8 + Math.random() * 1.4,
        );
        this.say(PHRASES[(Math.random() * PHRASES.length) | 0]);
        break;
      case "heartbeat":
        this.audio.heartbeat(
          0.6 + Math.random() * 0.4,
          4 + ((Math.random() * 4) | 0),
        );
        break;
      case "flicker": {
        const dur = 0.9 + Math.random() * 1.2;
        if (this.torches) {
          this.torches.mood = 0.22;
          this.moodUntil = elapsed + dur;
        }
        if (Math.random() < 0.5)
          this.say(PHRASES[(Math.random() * PHRASES.length) | 0]);
        break;
      }
      case "hoot":
        this.audio.owlHoot();
        break;
      case "chirp":
        this.audio.chirp();
        break;
      case "ghost":
        this.spawnGhost(elapsed, ctx);
        break;
      case "sting":
        this.audio.sting();
        break;
    }
  }

  /** Silhueta a 7–16 m do jogador, sempre de frente para ele. */
  spawnGhost(elapsed, ctx) {
    const { maze, playerPos } = ctx;
    if (!maze || !playerPos) return;
    for (let i = 0; i < 12; i++) {
      const cx = (Math.random() * maze.w) | 0;
      const cy = (Math.random() * maze.h) | 0;
      const x = (cx + 0.5) * CELL;
      const z = (cy + 0.5) * CELL;
      const d = Math.hypot(x - playerPos.x, z - playerPos.z);
      if (d < 7 || d > 16) continue;
      this.ghost.position.set(x, 0, z);
      this.ghost.lookAt(playerPos.x, 1.2, playerPos.z);
      this.ghostShownAt = elapsed;
      this.ghostUntil = elapsed + 1.6 + Math.random() * 1.4;
      this.ghost.visible = true;
      if (Math.random() < 0.6) this.audio.sting();
      break;
    }
  }

  /** Frase PT-BR no HUD (itálica, fade). */
  say(text) {
    if (!this.scareText) return;
    this.scareText.textContent = text;
    this.scareText.classList.add("show");
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = setTimeout(
      () => this.scareText.classList.remove("show"),
      2600,
    );
  }

  /** Limpa estado entre partidas (novo labirinto). */
  clear() {
    this.ghost.visible = false;
    for (const m of this.ghostMats) m.opacity = 0;
    if (this.textTimer) clearTimeout(this.textTimer);
    if (this.scareText) this.scareText.classList.remove("show");
    if (this.torches) this.torches.mood = 1;
    this.nextAt = 0; // reagenda para o próximo frame jogável
  }
}
