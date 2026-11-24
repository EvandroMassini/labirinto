// test/maze.test.mjs — verifica a geração do labirinto sem navegador.
// Importa o maze.js real, removendo apenas a geometria THREE (não testável em Node puro).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert";

const here = path.dirname(fileURLToPath(import.meta.url));
let src = readFileSync(path.join(here, "..", "js", "maze.js"), "utf8");

// remove imports de módulos que não existem em Node (three)
src = src
  .replace(/^import .*$/gm, "")
  // remove buildMazeGeometry (usa THREE) — o resto é JS puro
  .replace(/export function buildMazeGeometry[\s\S]*?\n\}\n/, "");

const tmp = path.join(here, "__maze_pure.mjs");
writeFileSync(tmp, src);
const M = await import(pathToFileURL(tmp).href);

const { generateMaze, wallBoxes, buildColliders, deadEnds, closedWalls, CELL } =
  M;

const W = 21,
  H = 21;
let failures = 0;

for (let t = 0; t < 20; t++) {
  const m = generateMaze(W, H);
  const { walls } = m;

  // 1) labirinto perfeito: contagem de passagens abertas = W*H - 1
  let passages = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!walls[y][x].s) passages++;
      if (!walls[y][x].e) passages++;
    }
  assert.strictEqual(
    passages,
    W * H - 1,
    `maze ${t}: passagens ${passages} != ${W * H - 1}`,
  );

  // 2) conectividade: todas as 441 células alcançáveis de (0,0)
  const seen = new Set(["0,0"]);
  const q = [[0, 0]];
  while (q.length) {
    const [x, y] = q.pop();
    const c = walls[y][x];
    const nbs = [
      [x, y - 1, !c.n],
      [x, y + 1, !c.s],
      [x + 1, y, !c.e],
      [x - 1, y, !c.w],
    ];
    for (const [nx, ny, open] of nbs) {
      if (!open || nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const k = nx + "," + ny;
      if (!seen.has(k)) {
        seen.add(k);
        q.push([nx, ny]);
      }
    }
  }
  assert.strictEqual(
    seen.size,
    W * H,
    `maze ${t}: só ${seen.size} células alcançáveis`,
  );

  // 3) saída (20,20) alcançável do início (0,0) — garantido por 1+2, mas verifica explicitamente
  assert.ok(seen.has("20,20"), `maze ${t}: saída inacessível`);

  // 4) paredes da fronteira existem (nenhuma saída falsa)
  let borderOk = true;
  for (let x = 0; x < W; x++) {
    if (!walls[0][x].n) borderOk = false;
    if (!walls[H - 1][x].s) borderOk = false;
  }
  for (let y = 0; y < H; y++) {
    if (!walls[y][0].w) borderOk = false;
    if (!walls[y][W - 1].e) borderOk = false;
  }
  assert.ok(borderOk, `maze ${t}: fronteira com furos`);

  // 5) geometria das caixas: paredes de fronteira ficam centradas na linha da grade,
  //    então o mundo real é [-WALL_T/2, 42+WALL_T/2]; corredores = CELL - WALL_T
  const { WALL_T } = M;
  const EPS = 0.001;
  const boxes = wallBoxes(m);
  for (const b of boxes) {
    assert.ok(
      b.cx - b.sx / 2 >= -WALL_T / 2 - EPS &&
        b.cx + b.sx / 2 <= W * CELL + WALL_T / 2 + EPS &&
        b.cz - b.sz / 2 >= -WALL_T / 2 - EPS &&
        b.cz + b.sz / 2 <= H * CELL + WALL_T / 2 + EPS,
      `maze ${t}: caixa fora do mundo cx=${b.cx} cz=${b.cz}`,
    );
  }
  assert.strictEqual(CELL - WALL_T, 1.65, "largura do corredor");

  // 6) colisores: jogador em cada célula aberta não começa dentro de parede
  const { colliders } = buildColliders(boxes);
  const inWall = (px, pz, r = 0.3) =>
    colliders.some(
      (c) =>
        px + r > c.minX &&
        px - r < c.maxX &&
        pz + r > c.minZ &&
        pz - r < c.maxZ,
    );
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const cxp = (x + 0.5) * CELL,
        czp = (y + 0.5) * CELL;
      assert.ok(
        !inWall(cxp, czp),
        `maze ${t}: centro da célula ${x},${y} dentro de parede`,
      );
    }

  // 7) becos existem e têm 3 paredes fechadas
  const dead = deadEnds(m);
  assert.ok(dead.length >= 5, `maze ${t}: só ${dead.length} becos`);
  for (const d of dead) {
    const cw = closedWalls(m, d.x, d.y);
    assert.strictEqual(
      cw.length,
      3,
      `maze ${t}: beco ${d.x},${d.y} com ${cw.length} paredes`,
    );
  }

  // 8) solvePath: caminho (0,0) -> (20,20), passos válidos, sem repetir célula
  const p = M.solvePath(m);
  assert.ok(p && p.length > 0, `maze ${t}: solvePath vazio`);
  assert.deepStrictEqual(p[0], { x: 0, y: 0 }, `maze ${t}: início errado`);
  assert.deepStrictEqual(
    p[p.length - 1],
    { x: W - 1, y: H - 1 },
    `maze ${t}: fim errado`,
  );
  const uniq = new Set(p.map((c) => c.x + "," + c.y));
  assert.strictEqual(uniq.size, p.length, `maze ${t}: solvePath repete célula`);
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1],
      b = p[i];
    const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    assert.strictEqual(
      d,
      1,
      `maze ${t}: salto ${a.x},${a.y}->${b.x},${b.y} não adjacente`,
    );
    const ax = b.x - a.x,
      ay = b.y - a.y;
    const open =
      (ay === -1 && !m.walls[a.y][a.x].n) ||
      (ay === 1 && !m.walls[a.y][a.x].s) ||
      (ax === 1 && !m.walls[a.y][a.x].e) ||
      (ax === -1 && !m.walls[a.y][a.x].w);
    assert.ok(
      open,
      `maze ${t}: passo ${a.x},${a.y}->${b.x},${b.y} atravessa parede`,
    );
  }
}

console.log(
  `OK: 20 labirintos 21x21 validos (perfeitos, conectados, fronteira fechada, becos OK)`,
);
