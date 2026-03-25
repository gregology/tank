# Tank Battle

A split-screen isometric pixel-art tank game for two players, running entirely in the browser. No dependencies, no build step.

![Two players battle across a procedurally generated island](https://img.shields.io/badge/players-2-blue) ![No dependencies](https://img.shields.io/badge/dependencies-none-green)

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

## Controls

| Action   | Player 1 (Red) | Player 2 (Blue) |
|----------|:--------------:|:---------------:|
| Forward  | W              | ↑               |
| Backward | S              | ↓               |
| Rotate left  | A          | ←               |
| Rotate right | D          | →               |
| Fire     | Space          | Enter           |
| Restart (after game over) | R | R           |

## How to Play

- Each game generates a **random island** with hills and rocks for cover.
- Tanks drive forward/backward in the direction they're facing, and rotate with left/right.
- **One shot kills.** Dead tanks respawn after 2 seconds.
- First player to **10 kills** wins.
- Hills and rocks **block movement and bullets** — use them as cover.
- Each viewport has a **minimap** in the bottom-right corner showing the full island and both players.

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

### Adding sound

The game emits events you can hook into without modifying core code:

```js
game.on('fire',    ({ tank, bullet }) => { /* play fire sound */ });
game.on('hit',     ({ bullet, victim, killer }) => { /* play hit sound */ });
game.on('destroy', ({ tank }) => { /* play explosion sound */ });
game.on('win',     ({ winner }) => { /* play victory sound */ });
```

### Adding AI

Create a module that reads game state and produces the same interface as `InputManager`:

```js
class AIController {
    isDown(code) { /* return true/false based on AI logic */ }
    wasPressed(code) { /* ... */ }
    endFrame() {}
}
```

Pass it in place of (or alongside) the `InputManager` for a player.

## Technical Notes

- **Rendering** uses a two-pass approach: flat ground tiles are drawn first (they never occlude entities), then elevated tiles and entities are depth-sorted together for correct occlusion.
- **Map generation** uses seeded value noise (fBm) for organic coastlines, hill clusters, and rock placement. Each game gets a unique island.
- **Collision** is axis-separated — tanks slide along obstacles instead of stopping dead.
- **No dependencies.** Pure vanilla JS with ES modules. Works in any modern browser.
