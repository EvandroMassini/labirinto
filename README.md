# LABIRINTO — das Sombras

Jogo de terror em primeira pessoa em um labirinto grande e escuro. Você tem
apenas a lanterna na mão e as tochas penduradas nas paredes. Encontre a única
porta vermelha de saída — e sobreviva ao que anda no escuro.

HTML + CSS + JavaScript puro, com Three.js **r160** (arquivo local em
`assets/vendor/` — o jogo roda **offline**, sem CDN).

> **Feito com IA:** o jogo foi desenvolvido por um agente de IA de
> programação (OpenCode, modelo **Qwen 3.8 27B** via Ollama), sob a direção de
> Evandro Massini.

## Jogar online

Disponível no GitHub Pages: <https://evandromassini.github.io/labirinto/>

## Como rodar

Opcional (recomendado): use o servidor local.

```
node server.js          # http://localhost:8123
```

ou simplesmente dê duplo-clique em `iniciar.bat` (Windows).

Depois abra `http://localhost:8123` no navegador (Chrome/Edge/Firefox
recentes — o jogo usa WebAudio e Pointer Lock).

> `index.html` também abre via `file://`, mas o servidor local evita qualquer
> problema de CORS com módulos ES.

## Licença

Código e assets sob **AGPL-3.0** — veja o arquivo [`LICENSE`](LICENSE).

## Como jogar

| Ação                       | Controle                    |
| -------------------------- | --------------------------- |
| Mover                      | `W` `A` `S` `D`             |
| Olhar                      | Mouse (Pointer Lock ativo)  |
| Correr                     | `Shift`                     |
| Minimapa (enquanto segure) | `M`                         |
| Lanterna (ligar/desligar)  | `L` (liga por padrão)       |
| Pausar                     | `Esc` (sai do Pointer Lock) |
| Recomeçar (novo labirinto) | Botão na tela de vitória    |

- O labirinto é **21×21 células** (≈42 m × 42 m), gerado por _recursive
  backtracker_: sempre há um caminho, muitos becos, e **exatamente uma
  saída** — a porta vermelha.
- O HUD mostra a distância até a saída e uma seta indicativa.
- O minimapa (segurando `M`) só mostra o que você **já visitou**.

## O terror

- **Tochas** (modelo `torch.glb`) com luz quente, flicker independente e
  apagões súbitos.
- **Lanterna do jogador** (facho de luz que segue o olhar): o corredor à
  frente nunca fica totalmente cego.
- **Áudio 100 % procedural** (WebAudio, zero arquivos): vento, batidas de
  coração, sussurros, coruja, gorjeios e um _sting_ grave.
- **Diretor de sustos**: a cada 9–24 s um evento aleatório — sussurro com
  frase em PT-BR, batimento cardíaco, apagão das tochas, coruja, gorjeio,
  _sting_, ou uma **silhueta pálida com olhos brancos** que aparece por
  alguns segundos num corredor distante.
- **Vitória**: ao alcançar a porta, o medo afunda — a mixagem sonora decai
  até quase o silêncio.

## Notas técnicas (honestas)

- **Sem sombras em tempo real, e luzes em "pool".** As ~27 tochas NÃO têm
  cada uma sua luz: um pool fixo de 8 `PointLight` (sempre presentes na cena
  → número de luzes constante no shader, zero recompilações) ocupa a cada
  frame as tochas mais próximas do jogador, com intensidade em fade por
  distância. Somadas à lanterna (1 `SpotLight`) e à luz da porta, a cena
  fica com ~10 luzes no shader — contra 21 pontuais no esquema antigo — e o
  custo por pixel é estável ao longo de todo o jogo. A escuridão fora do
  alcance da lanterna é intencional e faz parte do clima.
- **Áudio sem arquivos.** Sussurros são _sweeps_ de banda-passada (soam
  como sussurros, não são vozes reais); a coruja e os gorjeios são glides
  sintéticos. Nada de gravações.
- **Silhueta do fantasma** é procedural (cápsula + esfera + dois olhos
  brancos), `MeshBasicMaterial` — um "buraco" na cena que não recebe luz.
- **Texturas** fornecidas (4096²) são redimensionadas para 2048² em tempo
  de execução via `CanvasTexture`.
- **Three.js r160** é vendido localmente (pinned), então nada é baixado em
  tempo de jogo.
- **Desempenho** medido no ambiente de teste: ~160 FPS com o pool de 8 luzes
  pontuais + lanterna. O HUD mostra o FPS real (canto inferior esquerdo), e
  a resolução se ajusta sozinha: abaixo de ~45 FPS o pixel ratio cai em
  passos de 0,25 (até 1.0); sobrando desempenho (> 58 FPS), devolve. Máquinas
  fracas podem também reduzir o tamanho da janela.
- **Testes**: o gerador de labirinto é validado headless em
  `test/maze.test.mjs` (20 labirintos aleatórios, 8 asserções: unicidade do
  caminho, becos, colisionadores, dimensões). Rode com
  `node test/maze.test.mjs`.

## Estrutura

```
labirinto/
├─ index.html            # estrutura + importmap + HUD/overlays
├─ style.css             # visual, vinheta, HUD, minimapa, textos de susto
├─ js/
│  ├─ main.js            # ponto de entrada: cena, loop, estados, HUD, saída
│  ├─ maze.js            # geração (recursive backtracker), paredes, colisão
│  ├─ player.js          # movimento em 1ª pessoa (WASD + mouse, AABB)
│  ├─ torches.js         # tochas (GLTF + PointLight + flicker)
│  ├─ audio.js           # mixagem 100% procedural (WebAudio)
│  └─ scares.js          # diretor de sustos + silhueta + frases PT-BR
├─ assets/
│  ├─ objects/torch.glb
│  ├─ textures/{wall,floor,ceiling}.jpg
│  └─ vendor/            # three.module.js r160 + addons (GLTFLoader etc.)
├─ test/maze.test.mjs    # validação headless do labirinto
├─ server.js             # servidor estático simples (porta 8123)
└─ iniciar.bat           # atalho Windows para o servidor
```

## Requisitos

- Navegador moderno com suporte a ES modules, WebAudio e Pointer Lock.
- Node.js ≥ 18 (apenas para o servidor local; o jogo em si é estático).

## Licença dos assets

Texturas e `torch.glb` são fornecidos no projeto. Three.js é distribuído
sob licença MIT.
