// player.js — Controles em primeira pessoa (WASD + mouse) e colisão AABB por eixo
// contra o hash espacial de paredes do labirinto.
import * as THREE from "three";
import { CELL } from "./maze.js";

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(1, 0, 1); // centro da célula inicial (0,0)
    this.yaw = Math.PI; // olhando +z
    this.pitch = 0;
    this.radius = 0.3; // raio da colisão (m)
    this.eyeHeight = 1.6; // altura dos olhos (m)
    this.walkSpeed = 2.1;
    this.sprintSpeed = 3.4;
    this.keys = new Set();
    this.bobT = 0;
    this.bobOffset = 0;
    this.isMoving = false;
    this.sprinting = false;
    this.stepEvent = null; // função opcional (passos)
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch -= dy * 0.0022;
    const lim = Math.PI / 2 - 0.05;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  /** Atualiza posição + colisão. Retorna info do movimento (para passos/bob). */
  update(dt, hash, key) {
    const f = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const s = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    this.sprinting = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");

    if (f === 0 && s === 0) {
      this.isMoving = false;
      this.bobOffset = Math.max(0, this.bobOffset - dt * 0.6);
      return { moving: false };
    }

    // Vetores de frente/direita no plano XZ (câmera: frente = -sin(yaw), -cos(yaw))
    const sin = Math.sin(this.yaw),
      cos = Math.cos(this.yaw);
    let dx = -sin * f + cos * s;
    let dz = -cos * f - sin * s;
    const len = Math.hypot(dx, dz);
    dx /= len;
    dz /= len;

    const speed = this.sprinting ? this.sprintSpeed : this.walkSpeed;
    let dist = speed * dt;
    const maxStep = 0.22;
    const steps = Math.max(1, Math.ceil(dist / maxStep));
    dist /= steps;

    let stepped = false;
    for (let i = 0; i < steps; i++) {
      this.moveAxis("x", dx * dist, hash, key);
      this.moveAxis("z", dz * dist, hash, key);
    }

    // Head-bob + eventos de passo
    const freq = this.sprinting ? 11 : 8.2;
    this.bobT += dt * freq;
    this.bobOffset = Math.min(1, this.bobOffset + dt * 8);
    const phase = this.bobT % (Math.PI * 2);
    if (phase < 0.5 && this._lastPhase > Math.PI * 1.5) {
      stepped = true; // pisada (meio do ciclo)
    }
    this._lastPhase = phase;
    this.isMoving = true;
    return { moving: true, stepped };
  }

  moveAxis(axis, delta, hash, key) {
    if (delta === 0) return;
    const p = this.pos,
      r = this.radius;
    p[axis] += delta;
    const minX = p.x - r,
      maxX = p.x + r;
    const minZ = p.z - r,
      maxZ = p.z + r;
    const x0 = Math.floor(minX / CELL),
      x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL),
      z1 = Math.floor(maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = hash.get(key(cx, cz));
        if (!list) continue;
        for (const b of list) {
          if (
            maxX <= b.minX ||
            minX >= b.maxX ||
            maxZ <= b.minZ ||
            minZ >= b.maxZ
          )
            continue;
          // Colisão: empurra de volta no eixo do movimento
          if (axis === "x") {
            p.x = delta > 0 ? b.minX - r : b.maxX + r;
          } else {
            p.z = delta > 0 ? b.minZ - r : b.maxZ + r;
          }
        }
      }
    }
  }

  /** Posição da câmera (olhos + head-bob suave). */
  cameraPosition() {
    const bob = Math.sin(this.bobT) * 0.045 * this.bobOffset;
    return new THREE.Vector3(this.pos.x, this.eyeHeight + bob, this.pos.z);
  }
}
