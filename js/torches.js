// torches.js — As tochas: a luz quente do labirinto.
// Carrega assets/objects/torch.glb (chama), escala para tamanho humano e crava
// na parede fechada de células escolhidas (becos + pontos do caminho único).
//
// ILUMINAÇÃO OTIMIZADA (fix de FPS): as tochas NÃO têm cada uma sua luz.
// Há um POOL FIXO de LIGHT_POOL PointLights sempre presentes na cena; a cada
// frame os slots ocupam as tochas mais próximas do jogador, com intensidade em
// fade suave conforme a distância (100% até FADE_FULL, zero em FADE_END).
// Consequências:
//   - o número de luzes no shader é CONSTANTE → zero recompilações, e o custo
//     por-pixel cai de 20+ para LIGHT_POOL luzes, qualquer que seja a quantidade
//     de tochas na cena;
//   - sem "pop" visual ao trocar de tocha: a intensidade já é ~0 na fronteira;
//   - a chama continua com emissiva viva à distância (barata, só é material).
// O flicker orgânico por tocha (3 senoides + apagões breves) é mantido e
// modulado por `mood` (o diretor de sustos usa esse ganho para apagões).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/GLTFLoader.js";
import { CELL, WALL_T, deadEnds, closedWalls, solvePath } from "./maze.js";

const TARGET_H = 0.55; // altura da chama (m)
const MAX_TORCHES = 28; // mais tochas no caminho — as luzes são o pool, não o gargalo
const MIN_DIST = 4.5; // metros mínimos entre duas tochas
const START_KEEP_OUT = 4; // o início fica cego de propósito
const FLAME_Y = 1.3; // altura do centro da chama
const FLAME_OFF = 0.26; // distância do centro da chama à face da parede
const POLE_LEN = 0.36; // haste entre a parede e a chama
const BASE_INTENSITY = 16; // candela (física) por tocha ativa
const LIGHT_POOL = 8; // PointLights simultâneas (constante → shader estável)
const FADE_FULL = 6; // até 6 m do jogador, a tocha brilha a 100%
const FADE_END = 10.5; // a 10.5 m a contribuição cai a zero (transição invisível)

const UP = new THREE.Vector3(0, 1, 0);
const OPPOSITE = { n: "s", s: "n", e: "w", w: "e" };

/** Ponto na face interna da parede `dir` da célula (cx,cy) + normal para dentro. */
function wallAnchor(cx, cy, dir) {
  const cxp = (cx + 0.5) * CELL;
  const czp = (cy + 0.5) * CELL;
  const half = WALL_T / 2;
  switch (dir) {
    case "n":
      return { x: cxp, z: cy * CELL + half, nx: 0, nz: 1 };
    case "s":
      return { x: cxp, z: (cy + 1) * CELL - half, nx: 0, nz: -1 };
    case "e":
      return { x: (cx + 1) * CELL - half, z: czp, nx: -1, nz: 0 };
    case "w":
      return { x: cx * CELL + half, z: czp, nx: 1, nz: 0 };
  }
  throw new Error("direção inválida: " + dir);
}

export class TorchManager {
  constructor(scene) {
    this.scene = scene;
    this.template = null; // grupo com a chama centrada na origem
    this.scale = 1;
    this.flameMatBase = null;
    this.poleGeo = null;
    this.poleMat = null;
    this.torches = [];
    this.mood = 1; // o diretor de sustos pode abafar tudo (fase 4)
    this.available = false;
    // Pool fixo de luzes: criado uma vez, nunca entra/sai da cena.
    this.pool = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 11, 2);
      scene.add(l);
      this.pool.push(l);
    }
  }

  /** Carrega torch.glb uma única vez (template compartilhado pelas tochas). */
  async load() {
    const gltf = await new GLTFLoader().loadAsync("assets/objects/torch.glb");
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    this.scale = TARGET_H / size.y;

    // centra a chama na origem do holder (o holder é o que as instâncias posicionam)
    const holder = new THREE.Group();
    gltf.scene.position.copy(box.getCenter(new THREE.Vector3()).negate());
    holder.add(gltf.scene);
    this.template = holder;

    let meshMat = null;
    holder.traverse((o) => {
      if (o.isMesh) meshMat = o.material;
    });
    const base = (meshMat || new THREE.MeshStandardMaterial()).clone();
    base.color.set(0x2a1206);
    base.emissive.set(0xff8c38);
    base.emissiveMap = base.map || null;
    base.emissiveIntensity = 2.2;
    base.roughness = 0.8;
    this.flameMatBase = base;

    this.poleGeo = new THREE.CylinderGeometry(0.014, 0.02, POLE_LEN, 10);
    this.poleMat = new THREE.MeshStandardMaterial({
      color: 0x14100c,
      roughness: 0.85,
      metalness: 0.5,
    });
    this.available = true;
  }

  /** Escolhe as células das tochas: becos primeiro, depois pontos do caminho. */
  chooseCells(maze) {
    const { w, h } = maze;
    const chosen = [];
    const tooClose = (c) =>
      chosen.some(
        (p) => Math.hypot((p.x - c.x) * CELL, (p.y - c.y) * CELL) < MIN_DIST,
      );
    const nearStart = (c) =>
      Math.hypot(c.x + 0.5, c.y + 0.5) * CELL < START_KEEP_OUT;
    const isSpecial = (c) =>
      (c.x === 0 && c.y === 0) || (c.x === w - 1 && c.y === h - 1);
    const tryAdd = (c) => {
      if (chosen.length >= MAX_TORCHES) return false;
      if (isSpecial(c) || nearStart(c) || tooClose(c)) return false;
      chosen.push(c);
      return true;
    };

    const dead = deadEnds(maze).sort(() => Math.random() - 0.5);
    for (const d of dead) tryAdd(d);

    const path = solvePath(maze) || [];
    const step = Math.max(3, Math.floor(path.length / 14)); // caminho mais coberto
    for (
      let i = Math.floor(path.length * 0.18);
      i < path.length * 0.92 && chosen.length < MAX_TORCHES;
      i += step
    ) {
      tryAdd(path[i]);
    }
    return chosen;
  }

  /** Prefere a parede fechada cujas opostas estão abertas (tocha de frente p/ o corredor). */
  chooseWall(maze, x, y) {
    const c = maze.walls[y][x];
    const closed = closedWalls(maze, x, y);
    const preferred = closed.filter((d) => !c[OPPOSITE[d]]);
    const pool = preferred.length ? preferred : closed;
    return pool[(Math.random() * pool.length) | 0];
  }

  /** Reconstrói todas as tochas para o labirinto atual. */
  build(maze) {
    this.clear();
    if (!this.available) return;
    for (const c of this.chooseCells(maze)) this.place(maze, c);
  }

  place(maze, cell) {
    const dir = this.chooseWall(maze, cell.x, cell.y);
    const a = wallAnchor(cell.x, cell.y, dir);
    const n = new THREE.Vector3(a.nx, 0, a.nz);
    const flamePos = new THREE.Vector3(
      a.x + n.x * FLAME_OFF,
      FLAME_Y,
      a.z + n.z * FLAME_OFF,
    );

    const group = this.template.clone();
    group.position.copy(flamePos);
    group.scale.setScalar(this.scale);
    // Geometria real (lida dos vértices): a base/copo fica em +z local e a ponta
    // da chama em −z local. Com θ = atan2(nx,nz) o +z local iria para o corredor
    // (+n) — base p/ o corredor e chama p/ a parede (errado). Soma-se 180° para
    // que a base assente na parede (−n) e a chama aponte para o corredor (+n).
    group.rotation.y = Math.atan2(a.nx, a.nz) + Math.PI;
    let mesh = null;
    group.traverse((o) => {
      if (o.isMesh) {
        mesh = o;
        o.material = this.flameMatBase.clone();
      }
    });
    this.scene.add(group);

    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.position.set(
      a.x + n.x * (POLE_LEN / 2),
      FLAME_Y,
      a.z + n.z * (POLE_LEN / 2),
    );
    pole.quaternion.setFromUnitVectors(UP, n);
    this.scene.add(pole);

    this.torches.push({
      group,
      pole,
      mesh,
      mat: mesh ? mesh.material : null,
      pos: flamePos,
      flicker: 1,
      phase: Math.random() * Math.PI * 2,
      speed: 0.8 + Math.random() * 0.5,
    });
  }

  /** Flicker por tocha + distribuição do pool de luzes para as mais próximas. */
  update(elapsed, playerPos) {
    for (const t of this.torches) {
      const s = t.phase + elapsed * t.speed;
      let f =
        0.8 +
        0.13 * Math.sin(s * 9.3) +
        0.07 * Math.sin(s * 23.7 + 1.7) +
        0.05 * Math.sin(s * 47.1 + 4.2);
      if (Math.sin(s * 1.7 + t.phase * 2.3) > 0.987) f *= 0.45; // apagão breve
      t.flicker = Math.max(0.15, f) * this.mood;
      if (t.mat) t.mat.emissiveIntensity = 2.2 * t.flicker;
      // O MODELO FICA FIXO: o pulso vive apenas na luz — na emissiva da chama
      // (acima) e na intensidade do pool (abaixo). Antes, o scale oscilava a
      // cada frame e a tocha inteira "respirava", o que estava errado.
      t.group.scale.setScalar(this.scale);
    }

    // pool: cada slot ocupa a tocha mais próxima que restou (ordenada por distância)
    const px = playerPos.x,
      py = playerPos.y,
      pz = playerPos.z;
    const near = this.torches
      .map((t) => ({
        t,
        d: Math.hypot(t.pos.x - px, t.pos.y - py, t.pos.z - pz),
      }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i];
      if (i >= near.length) {
        l.intensity = 0;
        continue;
      }
      const { t, d } = near[i];
      l.position.copy(t.pos);
      const fade = Math.max(
        0,
        Math.min(1, (FADE_END - d) / (FADE_END - FADE_FULL)),
      );
      l.intensity = BASE_INTENSITY * t.flicker * fade;
    }
  }

  clear() {
    for (const t of this.torches) {
      this.scene.remove(t.group);
      this.scene.remove(t.pole);
      if (t.mat) t.mat.dispose();
    }
    this.torches = [];
  }

  /** Remove tudo, incluindo recursos compartilhados e o pool de luzes. */
  dispose() {
    this.clear();
    for (const l of this.pool) {
      this.scene.remove(l);
      l.dispose();
    }
    this.pool = [];
    if (this.poleGeo) this.poleGeo.dispose();
    if (this.poleMat) this.poleMat.dispose();
  }

  get count() {
    return this.torches.length;
  }
}
