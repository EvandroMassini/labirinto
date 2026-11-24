// main.js — Ponto de entrada: renderer, cena escura, texturas, labirinto,
// porta de saída, controles em primeira pessoa e loop de jogo.
//
// FASES:
//   1: labirinto + controles           ✓
//   2: saída, vitória, HUD, minimapa   ✓ (este arquivo)
//   3: tochas (torch.glb + luzes + flicker)   ✓
//   4: áudio procedural + diretor de sustos   ✓
//   5: polimento + README                   ✓
import * as THREE from "three";
import {
  CELL,
  WALL_H,
  WALL_T,
  generateMaze,
  wallBoxes,
  buildMazeGeometry,
  buildColliders,
} from "./maze.js";
import { Player } from "./player.js";
import { TorchManager } from "./torches.js";
import { GameAudio } from "./audio.js";
import { ScareDirector } from "./scares.js";

// ---------- constantes ----------
const MAZE_W = 21; // células
const MAZE_H = 21;
const WORLD_W = MAZE_W * CELL; // 42 m
const WORLD_D = MAZE_H * CELL;

// Saída: porta na face leste da célula (MAZE_W-1, MAZE_H-1)
const EXIT_CELL = { x: MAZE_W - 1, y: MAZE_H - 1 };
const DOOR = {
  x: WORLD_W - WALL_T / 2 - 0.04, // face interna da parede leste
  z: (EXIT_CELL.y + 0.5) * CELL, // centro da célula (41)
  w: 1.1,
  h: 2.0,
};
const EXIT_POINT = new THREE.Vector3(DOOR.x, 1.0, DOOR.z);
const WIN_DIST = 1.2; // distância do jogador à porta para vencer

// ---------- DOM ----------
const canvas = document.getElementById("game");
const startOverlay = document.getElementById("start-overlay");
const pauseOverlay = document.getElementById("pause-overlay");
const winOverlay = document.getElementById("win-overlay");
const btnStart = document.getElementById("btn-start");
const btnResume = document.getElementById("btn-resume");
const btnAgain = document.getElementById("btn-again");
const exitInfoEl = document.getElementById("exit-info");
const exitArrowEl = document.getElementById("exit-arrow");
const winTimeEl = document.getElementById("win-time");
const minimapEl = document.getElementById("minimap");

// ---------- renderer ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
} catch (err) {
  startOverlay.innerHTML =
    "<h1>WEBGL INDISPONÍVEL</h1><p class='desc'>Este jogo precisa de WebGL. Ative aceleração de hardware no navegador.</p>";
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// Diagnóstico: qual renderizador a GPU está usando (1x no console).
// Se aparecer "SwiftShader"/"Software", o navegador está em modo CPU (lento).
try {
  const __gl = renderer.getContext();
  const __dbg = __gl.getExtension("WEBGL_debug_renderer_info");
  const __gpu = __dbg
    ? __gl.getParameter(__dbg.UNMASKED_RENDERER_WEBGL)
    : __gl.getParameter(__gl.RENDERER);
  const __vendor = __dbg
    ? __gl.getParameter(__dbg.UNMASKED_VENDOR_WEBGL)
    : __gl.getParameter(__gl.VENDOR);
  console.log("[labirinto] GPU:", __gpu, "| vendor:", __vendor);
} catch (e) {
  /* extensão ausente: ignora */
}

// ---------- cena ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.FogExp2(0x05060a, 0.08); // escuridão engole o horizonte (suave até ~15 m)

const camera = new THREE.PerspectiveCamera(
  72,
  window.innerWidth / window.innerHeight,
  0.05,
  90,
);
camera.rotation.order = "YXZ";
const cameraEuler = new THREE.Euler(0, 0, 0, "YXZ");

// Luz ambiente fraca e fria — a luz quente vem da lanterna do jogador e das tochas
scene.add(new THREE.AmbientLight(0x1f2840, 0.75));

// Lanterna do jogador: SpotLight presa à câmera, apontando para frente/baixo.
// É o que garante o corredor à frente sempre visível (fix de "jogo muito escuro").
const LANTERN_INTENSITY = 24;
const lantern = new THREE.SpotLight(
  0xffd2a0,
  LANTERN_INTENSITY,
  18,
  0.85,
  0.62,
  2,
);
lantern.position.set(0, -0.12, -0.3);
const lanternTarget = new THREE.Object3D();
lanternTarget.position.set(0, -0.5, -5);
camera.add(lantern);
camera.add(lanternTarget);
lantern.target = lanternTarget;
scene.add(camera); // necessário para o alvo do spot estar na cena

// Tecla L liga/desliga a lanterna. Desligamos com intensity=0 (e NÃO com
// visible=false): manter a luz na cena evita que o three.js recompile os
// shaders das materiais (mudança no nº de luzes visíveis causa stutter).
let lanternOn = true;
const lanternToast = document.getElementById("lantern-toast");
function setLantern(on) {
  lanternOn = on;
  lantern.intensity = on ? LANTERN_INTENSITY : 0;
  lanternToast.textContent = on ? "LANTERNA LIGADA" : "LANTERNA DESLIGADA";
  lanternToast.classList.add("show");
  clearTimeout(lanternToast._t);
  lanternToast._t = setTimeout(
    () => lanternToast.classList.remove("show"),
    1200,
  );
}

// ---------- estado ----------
let state = "loading"; // loading | ready | playing | paused | won
let minimapHeld = false;
let runStart = null; // performance.now() quando o jogador entra no labirinto

// ---------- textura com downscale para 2048 (VRAM) ----------
function loadTextureDownscaled(path, target = 2048) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, target / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      resolve(tex);
    };
    img.onerror = () => reject(new Error("falha ao carregar " + path));
    img.src = path;
  });
}

// ---------- materiais compartilhados (criados 1x) ----------
let wallMat, floorMat, ceilingMat;

// ---------- labirinto (reconstruído a cada nova partida) ----------
let maze, boxes, hash, key;
let wallMesh, doorMesh, doorMat, doorLight;
const player = new Player(camera);
const visited = new Set();
const torches = new TorchManager(scene);

// ---------- fase 4: áudio procedural + diretor de sustos ----------
const audio = new GameAudio();
const scareText = document.getElementById("scare-text");
const scares = new ScareDirector({ scene, camera, audio, torches, scareText });
scene.add(scares.ghost);
player.stepEvent = () => audio.footstep();

function buildMazeWorld() {
  // limpa o mundo anterior
  torches.clear();
  scares.clear();
  if (wallMesh) {
    scene.remove(wallMesh);
    wallMesh.geometry.dispose();
  }
  if (doorMesh) {
    scene.remove(doorMesh);
    scene.remove(doorLight);
    doorMesh.geometry.dispose();
    doorMat.dispose();
    doorLight.dispose();
  }
  visited.clear();

  // novo labirinto
  maze = generateMaze(MAZE_W, MAZE_H);
  boxes = wallBoxes(maze);
  ({ hash, key } = buildColliders(boxes));

  wallMesh = new THREE.Mesh(buildMazeGeometry(boxes), wallMat);
  wallMesh.matrixAutoUpdate = false;
  scene.add(wallMesh);

  // tochas na parede: becos + pontos do caminho único (≤ 20 luzes)
  torches.build(maze);

  // porta de saída: painel vermelho brilhante + luz vermelha fraca
  doorMat = new THREE.MeshStandardMaterial({
    color: 0x2a0808,
    emissive: 0xff2a18,
    emissiveIntensity: 1.6,
    roughness: 0.6,
    metalness: 0.1,
  });
  doorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, DOOR.h, DOOR.w),
    doorMat,
  );
  doorMesh.position.set(DOOR.x, DOOR.h / 2, DOOR.z);
  scene.add(doorMesh);

  doorLight = new THREE.PointLight(0xff3020, 10, 7, 2);
  doorLight.position.set(DOOR.x - 0.4, 1.6, DOOR.z);
  scene.add(doorLight);

  // jogador de volta ao início
  player.pos.set(CELL / 2, 0, CELL / 2);
  player.yaw = Math.PI; // olhando +z (interior do labirinto)
  player.pitch = 0;
  player.keys.clear();
  player.bobT = 0;
  player.bobOffset = 0;
  visited.add("0,0");
}

async function init() {
  try {
    // tochas: carrega o modelo uma única vez (falha não derruba o jogo)
    try {
      await torches.load();
    } catch (torchErr) {
      console.error("Tochas indisponíveis (torch.glb):", torchErr);
    }

    const [wallTex, floorTex, ceilingTex] = await Promise.all([
      loadTextureDownscaled("assets/textures/wall.jpg"),
      loadTextureDownscaled("assets/textures/floor.jpg"),
      loadTextureDownscaled("assets/textures/ceiling.jpg"),
    ]);

    wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: 0.95,
      metalness: 0.0,
    });

    const planeTex = (tex) => {
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set(WORLD_W / 2, WORLD_D / 2);
      return t;
    };
    floorMat = new THREE.MeshStandardMaterial({
      map: planeTex(floorTex),
      roughness: 0.97,
    });
    ceilingMat = new THREE.MeshStandardMaterial({
      map: planeTex(ceilingTex),
      roughness: 1.0,
    });

    buildMazeWorld();

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_W, WORLD_D),
      floorMat,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(WORLD_W / 2, 0, WORLD_D / 2);
    scene.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_W, WORLD_D),
      ceilingMat,
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(WORLD_W / 2, WALL_H, WORLD_D / 2);
    scene.add(ceiling);

    state = "ready";
  } catch (err) {
    console.error(err);
    startOverlay.innerHTML =
      "<h1>ERRO AO CARREGAR</h1><p class='desc'>As texturas não carregaram. Verifique se os arquivos existem em assets/textures.</p>";
  }
}
init();

// ---------- HUD visível apenas durante o jogo ----------
const hudEls = ["exit-info", "exit-arrow", "hint", "crosshair"].map((id) =>
  document.getElementById(id),
);
function setHudVisible(v) {
  for (const el of hudEls) el.style.visibility = v ? "visible" : "hidden";
}
setHudVisible(false);

// ---------- HUD da saída (distância + seta) ----------
function updateExitHud() {
  const dx = EXIT_POINT.x - player.pos.x;
  const dz = EXIT_POINT.z - player.pos.z;
  const dist = Math.hypot(dx, dz);
  exitInfoEl.innerHTML =
    dist < 2.5
      ? "A PORTA ESTÁ PERTO…"
      : "SAÍDA &nbsp;·&nbsp; " + Math.ceil(dist) + " m";
  // seta: ângulo do alvo em relação à frente do jogador
  const targetTheta = Math.atan2(-dx, -dz); // ângulo "yaw" do alvo
  let rel = targetTheta - player.yaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  exitArrowEl.style.transform = "translate(-50%,-50%) rotate(" + rel + "rad)";
}

// ---------- minimapa ----------
function drawMinimap() {
  const ctx = minimapEl.getContext("2d");
  const S = minimapEl.width;
  const scale = S / WORLD_W;
  ctx.clearRect(0, 0, S, S);

  // células visitadas
  ctx.fillStyle = "rgba(110,135,195,0.22)";
  for (const k of visited) {
    const [x, y] = k.split(",").map(Number);
    ctx.fillRect(
      x * CELL * scale,
      y * CELL * scale,
      CELL * scale,
      CELL * scale,
    );
  }

  // paredes
  ctx.fillStyle = "rgba(170,190,235,0.85)";
  const lw = 2;
  for (let y = 0; y < MAZE_H; y++)
    for (let x = 0; x < MAZE_W; x++) {
      const c = maze.walls[y][x];
      if (c.n)
        ctx.fillRect(x * CELL * scale, y * CELL * scale - lw, CELL * scale, lw);
      if (c.w)
        ctx.fillRect(x * CELL * scale - lw, y * CELL * scale, lw, CELL * scale);
      if (y === MAZE_H - 1 && c.s)
        ctx.fillRect(
          x * CELL * scale,
          (y + 1) * CELL * scale,
          CELL * scale,
          lw,
        );
      if (x === MAZE_W - 1 && c.e)
        ctx.fillRect(
          (x + 1) * CELL * scale,
          y * CELL * scale,
          lw,
          CELL * scale,
        );
    }

  // saída (ponto vermelho)
  ctx.fillStyle = "#ff4530";
  ctx.beginPath();
  ctx.arc(DOOR.x * scale, DOOR.z * scale, 4, 0, Math.PI * 2);
  ctx.fill();

  // jogador (triângulo orientado)
  const fx = -Math.sin(player.yaw),
    fz = -Math.cos(player.yaw);
  const a = Math.atan2(fz, fx);
  const px = player.pos.x * scale,
    pz = player.pos.z * scale;
  ctx.fillStyle = "#cfe2ff";
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, 4);
  ctx.lineTo(-4, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------- estados / pointer lock ----------
function setPlaying() {
  const isNewRound = state === "ready" || state === "won";
  state = "playing";
  if (isNewRound) scares.nextAt = clock.elapsedTime + 6; // 1º susto ~6 s após a entrada
  audio.resume();
  if (runStart === null) runStart = performance.now();
  startOverlay.classList.add("hidden");
  pauseOverlay.classList.add("hidden");
  winOverlay.classList.add("hidden");
  minimapEl.style.display = "none";
  setHudVisible(true);
}

function lockPointer() {
  const p = canvas.requestPointerLock({ unadjustedMovement: true });
  if (p && p.catch) p.catch(() => {}); // re-lock após Esc tem cooldown (~1,25 s)
}

function winGame() {
  state = "won";
  audio.win(); // o medo some: a mixagem afunda, sobra o silêncio
  const secs = Math.floor(
    (performance.now() - (runStart || performance.now())) / 1000,
  );
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  winTimeEl.textContent =
    "Tempo no escuro: " +
    mm +
    ":" +
    ss +
    "  ·  passos dados entre paredes que ninguém vê.";
  if (document.pointerLockElement) document.exitPointerLock();
  setHudVisible(false);
  minimapEl.style.display = "none";
  winOverlay.classList.remove("hidden");
}

btnStart.addEventListener("click", () => {
  if (state !== "ready") return;
  audio.start(); // fase 4: WebAudio exige gesto do usuário
  lockPointer();
});

btnResume.addEventListener("click", () => {
  if (state === "paused") lockPointer();
});

btnAgain.addEventListener("click", () => {
  // nova partida: novo labirinto
  buildMazeWorld();
  audio.resetMix();
  runStart = null;
  if (document.pointerLockElement) document.exitPointerLock();
  winOverlay.classList.add("hidden");
  setPlaying();
  lockPointer();
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) {
    if (state === "ready" || state === "paused") setPlaying();
  } else if (state === "playing") {
    state = "paused";
    player.keys.clear();
    audio.suspend();
    pauseOverlay.classList.remove("hidden");
    minimapEl.style.display = "none";
    minimapHeld = false;
    setHudVisible(false);
  }
});

// ---------- teclado / mouse ----------
window.addEventListener("keydown", (e) => {
  if (state !== "playing") return;
  player.keys.add(e.code);
  if (e.code === "KeyM") {
    minimapHeld = true;
    minimapEl.style.display = "block";
    drawMinimap();
  }
  if (e.code === "KeyL") setLantern(!lanternOn);
});

window.addEventListener("keyup", (e) => {
  player.keys.delete(e.code);
  if (e.code === "KeyM") {
    minimapHeld = false;
    minimapEl.style.display = "none";
  }
});

window.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.look(e.movementX, e.movementY);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- FPS (HUD) + resolução adaptativa ----------
// Mede o FPS real (tempo de wall-clock) a cada ~1,5 s e exibe no canto.
// Se o PC sustenta < 45 FPS, reduz o pixel ratio em passos de 0,25 (até 1.0);
// se sobra desempenho (> 58 FPS), devolve até o limite original. Isso ataca a
// outra fonte de "quadro a quadro": telas HiDPI renderizando 2–3× os pixels.
const fpsEl = document.getElementById("fps");
const baseRatio = Math.min(window.devicePixelRatio, 2);
const perf = { frames: 0, t0: performance.now(), ratio: baseRatio, fps: 0 };
function applyRatio(r) {
  perf.ratio = r;
  renderer.setPixelRatio(r);
  renderer.setSize(window.innerWidth, window.innerHeight);
}
function perfTick() {
  perf.frames++;
  const now = performance.now();
  const span = now - perf.t0;
  if (span < 1500) return;
  perf.fps = (perf.frames * 1000) / span;
  perf.frames = 0;
  perf.t0 = now;
  if (perf.fps < 45 && perf.ratio > 1) {
    applyRatio(Math.max(1, +(perf.ratio - 0.25).toFixed(2)));
  } else if (perf.fps > 58 && perf.ratio < baseRatio) {
    applyRatio(Math.min(baseRatio, +(perf.ratio + 0.25).toFixed(2)));
  }
  fpsEl.textContent = Math.round(perf.fps) + " FPS";
  fpsEl.style.color =
    perf.fps < 30 ? "#ff6b52" : perf.fps < 55 ? "#ffd27a" : "#9fe8a0";
}

// ---------- loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  perfTick(); // mede FPS real + resolução adaptativa

  torches.update(clock.elapsedTime, player.pos); // a chama vive mesmo pausado

  if (state === "playing") {
    // diretor de sustos: avança só enquanto o jogo roda
    scares.update(clock.elapsedTime, dt, {
      state,
      maze,
      playerPos: player.pos,
    });

    const info = player.update(dt, hash, key);
    if (info.stepped && player.stepEvent) player.stepEvent();

    // registra célula visitada (minimapa)
    visited.add(
      Math.floor(player.pos.x / CELL) + "," + Math.floor(player.pos.z / CELL),
    );

    // chegou à porta?
    if (
      EXIT_POINT.distanceToSquared(
        new THREE.Vector3(player.pos.x, 1.0, player.pos.z),
      ) <
      WIN_DIST * WIN_DIST
    ) {
      winGame();
    } else {
      updateExitHud();
    }

    if (minimapHeld) drawMinimap();
  }

  const cp = player.cameraPosition();
  camera.position.copy(cp);
  cameraEuler.set(player.pitch, player.yaw, 0);
  camera.quaternion.setFromEuler(cameraEuler);

  renderer.render(scene, camera);
});

// Debug (console do navegador)
window.__lab = {
  get maze() {
    return maze;
  },
  get player() {
    return player;
  },
  get hash() {
    return hash;
  },
  get key() {
    return key;
  },
  scene,
  camera,
  torches,
  lantern,
  setLantern,
  audio,
  scares,
  EXIT_POINT: DOOR,
  get state() {
    return state;
  },
  setPlaying,
  winGame,
  buildMazeWorld, // usado em testes
};
