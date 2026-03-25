# Tank Battle

A split-screen isometric pixel-art tank game running entirely in the browser. No dependencies, no build step.

![1-2 players](https://img.shields.io/badge/players-1--2-blue) ![No dependencies](https://img.shields.io/badge/dependencies-none-green) ![Procedural sound](https://img.shields.io/badge/sound-procedural-orange)

## Setup

The game uses ES modules, so it must be served over HTTP (not `file://`).

**Using Python (built into macOS/Linux):**

```bash
cd tank
python3 -m http.server 8000
```

**Using Node.js:**

```bash
cd tank
npx serve .
```

Then open **http://localhost:8000** in your browser.

## Game Modes

Choose from the start menu:

| Mode | Description |
|------|-------------|
| **1v1 Split Screen** | Two human players on one keyboard |
| **Player vs Bot** | Human (P1, red) vs AI opponent (P2, blue) |

## Controls

| Action   | Player 1 (Red) | Player 2 (Blue) |
|----------|:--------------:|:---------------:|
| Forward  | W              | ↑               |
| Backward | S              | ↓               |
| Rotate left  | A          | ←               |
| Rotate right | D          | →               |
| Fire     | Space          | Enter           |

**Menu:** ↑↓ or W/S to select, Enter or Space to start.
**Game over:** Space/Enter for rematch, R for menu.

## How to Play

- Each game generates a **random island** with hills and rocks for cover.
- Tanks drive forward/backward in the direction they're facing, and rotate with left/right.
- **One shot kills.** Dead tanks respawn after 2 seconds.
- First player to **10 kills** wins.
- Hills and rocks **block movement and bullets** — use them as cover.
- Each viewport has a **minimap** in the bottom-right corner showing the full island and both players.

## Project Structure

```
tank/
├── index.html               Entry point
├── css/
│   └── style.css            Full-screen canvas, pixel-art rendering
└── js/
    ├── main.js         (80)  State machine (menu → game → menu)
    ├── config.js       (60)  All tunable constants
    ├── utils.js        (58)  Isometric projection & math helpers
    ├── input.js        (48)  Keyboard input manager
    ├── camera.js       (23)  Smooth-follow camera
    ├── map.js         (181)  Procedural island generation (fBm noise)
    ├── tank.js        (115)  Tank entity (movement, collision, treads)
    ├── bullet.js       (51)  Projectile entity
    ├── particles.js   (109)  Particle system (explosions, flash, impacts)
    ├── game.js        (220)  Game state, collision, event bus, AI wiring
    ├── renderer.js    (690)  Isometric renderer (split-screen, depth-sorted)
    ├── ai.js          (165)  AI tank controller (chase, aim, avoid, fire)
    ├── audio.js       (150)  Procedural sound effects (Web Audio API)
    └── menu.js        (155)  Start menu with mode selection
```

## Extending the Game

The codebase is modular and designed to be extended.

### Tuning gameplay

All constants live in [`js/config.js`](js/config.js) — tank speed, bullet speed, fire cooldown, win score, controls, tile sizes, etc.

### Adding new terrain types

1. Add the tile ID to `TILES` in `config.js`.
2. Handle generation in `map.js` (`_tileAt` method).
3. Set passability/projectile rules in `map.js` (`isPassable`, `blocksProjectile`, `tileHeight`).
4. Add rendering in `renderer.js` (`_drawTile` switch).
5. Add a colour to the minimap in `renderer.js` (`_drawMinimap`).

### Adding new entity types (power-ups, mines, etc.)

1. Create a new class (see `bullet.js` or `tank.js` as templates).
2. Add instances to `game.js` — update in `update()`, add to the renderer's entity list in `_renderViewport`.
3. Render in `renderer.js` — add a new `kind` constant and drawing method.

### Sound system

All sounds are procedurally synthesised via the Web Audio API — no audio files. The `AudioManager` hooks into the game's event bus:

```js
game.on('fire',    () => audio.playShoot());
game.on('destroy', () => audio.playExplosion());
game.on('impact',  () => audio.playImpact());
game.on('win',     () => audio.playWin());
```

Add new sounds by creating methods on `AudioManager` and wiring them to game events.

### AI system

The `AIController` (`js/ai.js`) implements the same `isDown(code)` interface as `InputManager`, so it's a drop-in replacement. Behaviours:

- **Chase** — rotate toward + advance on the enemy
- **Fire** — shoot when aimed and has line-of-sight (ray-marched)
- **Avoid** — steer around obstacles by probing left/right
- **Unstick** — random evasive manoeuvre after being blocked
- **Patrol** — gentle weave when enemy is dead
- **Aim wobble** — slight random offset for human-like imperfection

To add difficulty levels, tune `aimWobble`, `fireDelay`, and the aim threshold in `ai.js`.

### Adding new game modes

1. Add a new entry to `menu.modes` in `menu.js`.
2. Handle the mode string in `Game` constructor (`game.js`).
3. Wire up any new input sources in `main.js`.

## Technical Notes

- **Rendering** uses a two-pass approach: flat ground tiles first (can't occlude entities), then elevated tiles + entities depth-sorted together. Elevated tiles use `depth + 1` to ensure their side walls correctly occlude entities behind them.
- **Map generation** uses seeded value noise (fBm) for organic coastlines, hill clusters, and rock placement. Each game gets a unique island.
- **Tank graphics** are fully projected — every polygon is defined in local space (+x forward), rotated by the tank's angle, and projected through the isometric transform. Tracks, hull, turret, and barrel are stacked with visible 3D extrusion.
- **Sound** is 100% procedural: noise buffers through bandpass filters for gunshots, low oscillators for explosions, sine tones for UI.
- **Collision** is axis-separated — tanks slide along obstacles instead of stopping dead.
- **No dependencies.** Pure vanilla JS with ES modules. Works in any modern browser.
