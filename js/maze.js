// maze.js — Geração do labirinto (algoritmo "recursive backtracker" -> labirinto perfeito:
// exatamente UMA trajetória entre qualquer dois pontos = uma única saída real),
// extração das caixas de parede, geometria texturizada mesclada e colisores AABB.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/BufferGeometryUtils.js";

export const CELL = 2; // largura do corredor (m)
export const WALL_H = 2.3; // altura do corredor (m)
export const WALL_T = 0.35; // espessura da parede (m)
const TILE = 2; // 1 tile da textura = 2 metros

const DIRS = [
  { dx: 0, dy: -1, wall: "n", opp: "s" },
  { dx: 0, dy: 1, wall: "s", opp: "n" },
  { dx: 1, dy: 0, wall: "e", opp: "w" },
  { dx: -1, dy: 0, wall: "w", opp: "e" },
];

/** Gera o labirinto. walls[y][x] = { n, s, e, w } (true = parede presente). */
export function generateMaze(w, h) {
  const walls = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ n: true, s: true, e: true, w: true })),
  );
  const visited = Array.from({ length: h }, () => new Array(w).fill(false));
  const stack = [];
  let cx = 0,
    cy = 0;
  visited[cy][cx] = true;
  let carved = 1;
  const total = w * h;

  while (carved < total) {
    const options = DIRS.filter((d) => {
      const nx = cx + d.dx,
        ny = cy + d.dy;
      return nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx];
    });
    if (options.length === 0) {
      if (stack.length === 0) break;
      [cx, cy] = stack.pop();
      continue;
    }
    const d = options[Math.floor(Math.random() * options.length)];
    walls[cy][cx][d.wall] = false;
    walls[cy + d.dy][cx + d.dx][d.opp] = false;
    stack.push([cx, cy]); // permite voltar por aqui quando encalhar
    cx += d.dx;
    cy += d.dy;
    visited[cy][cx] = true;
    carved++;
  }
  return { walls, w, h };
}

/** Lista as caixas de parede (sem duplicatas): cada parede pertence a uma célula (N/W) ou à fronteira (S/E). */
export function wallBoxes(maze) {
  const { walls, w, h } = maze;
  const boxes = [];
  const add = (cx, cz, sx, sz) => boxes.push({ cx, cz, sx, sz });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = walls[y][x];
      if (c.n) add((x + 0.5) * CELL, y * CELL, CELL + WALL_T, WALL_T);
      if (c.w) add(x * CELL, (y + 0.5) * CELL, WALL_T, CELL + WALL_T);
      if (y === h - 1 && c.s)
        add((x + 0.5) * CELL, (y + 1) * CELL, CELL + WALL_T, WALL_T);
      if (x === w - 1 && c.e)
        add((x + 1) * CELL, (y + 0.5) * CELL, WALL_T, CELL + WALL_T);
    }
  }
  return boxes;
}

/** Escala os UVs de uma BoxGeometry para a textura repetir a cada 2 m (1 tile = 2 m). */
function scaleBoxUVs(g, w, h, d) {
  const uv = g.attributes.uv;
  const scales = [
    [d / TILE, h / TILE], // +x
    [d / TILE, h / TILE], // -x
    [w / TILE, d / TILE], // +y
    [w / TILE, d / TILE], // -y
    [w / TILE, h / TILE], // +z
    [w / TILE, h / TILE], // -z
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = scales[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** Cria a geometria única (mesclada) de todas as paredes. */
export function buildMazeGeometry(boxes) {
  const geos = [];
  for (const b of boxes) {
    let g = new THREE.BoxGeometry(b.sx, WALL_H, b.sz);
    g = scaleBoxUVs(g, b.sx, WALL_H, b.sz);
    g.translate(b.cx, WALL_H / 2, b.cz);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

/** Cria colisores AABB + hash espacial por célula para colisão O(1) local. */
export function buildColliders(boxes) {
  const colliders = boxes.map((b) => ({
    minX: b.cx - b.sx / 2,
    maxX: b.cx + b.sx / 2,
    minZ: b.cz - b.sz / 2,
    maxZ: b.cz + b.sz / 2,
  }));
  const hash = new Map();
  const key = (x, z) => x + "," + z;
  for (const c of colliders) {
    const x0 = Math.floor(c.minX / CELL),
      x1 = Math.floor((c.maxX - 0.001) / CELL);
    const z0 = Math.floor(c.minZ / CELL),
      z1 = Math.floor((c.maxZ - 0.001) / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = key(x, z);
        let list = hash.get(k);
        if (!list) {
          list = [];
          hash.set(k, list);
        }
        list.push(c);
      }
    }
  }
  return { colliders, hash, key };
}

/** BFS do início (0,0) até o fim (w-1,h-1). Labirinto perfeito => caminho único.
 *  Retorna [{x,y}, ...] ou null se inalcançável. */
export function solvePath(maze) {
  const { walls, w, h } = maze;
  const ex = w - 1,
    ey = h - 1;
  const prev = new Map();
  const seen = new Set(["0,0"]);
  const q = [[0, 0]];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === ex && y === ey) break;
    const c = walls[y][x];
    const nbs = [
      [x, y - 1, !c.n],
      [x, y + 1, !c.s],
      [x + 1, y, !c.e],
      [x - 1, y, !c.w],
    ];
    for (const [nx, ny, open] of nbs) {
      if (!open || nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const k = nx + "," + ny;
      if (!seen.has(k)) {
        seen.add(k);
        prev.set(k, x + "," + y);
        q.push([nx, ny]);
      }
    }
  }
  const target = ex + "," + ey;
  if (!seen.has(target)) return null;
  const path = [];
  let k = target;
  while (k) {
    const [x, y] = k.split(",").map(Number);
    path.push({ x, y });
    k = prev.get(k);
  }
  path.reverse();
  return path;
}

/** Células de beco (3 paredes fechadas) — bons lugares para tochas. */
export function deadEnds(maze) {
  const { walls, w, h } = maze;
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = walls[y][x];
      const open = [!c.n, !c.s, !c.e, !c.w].filter(Boolean).length;
      if (open === 1) out.push({ x, y });
    }
  }
  return out;
}

/** Paredes fechadas de uma célula (para escolher o lado onde cravar a tocha). */
export function closedWalls(maze, x, y) {
  const c = maze.walls[y][x];
  const out = [];
  if (c.n) out.push("n");
  if (c.s) out.push("s");
  if (c.e) out.push("e");
  if (c.w) out.push("w");
  return out;
}
