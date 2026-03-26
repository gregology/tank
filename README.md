# Tank Battle

A split-screen isometric pixel-art tank game running entirely in the browser. No dependencies, no build step.

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
| **Player vs Bot** | Human (P1, red) vs AI opponent (P2, blue), full screen |
| **5v5 Team Battle** | Human + 4 AI allies vs 5 AI enemies, tower-based objective |

## Controls

| Action   | Player 1 (Red) | Player 2 (Blue) |
|----------|:--------------:|:---------------:|
| Forward  | W              | ↑               |
| Backward | S              | ↓               |
| Rotate left  | A          | ←               |
| Rotate right | D          | →               |
| Turret left  | Q          | ,               |
| Turret right | E          | .               |
| Fire     | Space          | Enter           |

The turret rotates independently from the hull, slower than hull rotation. This creates a skill gap between positioning and aiming — you can drive in one direction while shooting in another. AI bots track targets with the turret while navigating along their path.

**Menu:** ↑↓ or W/S to select, Enter or Space to start.
**Game over:** Space/Enter for rematch, R for menu.

## How to Play

- Each game generates a **random island** with villages, buildings, and road networks.
- Tanks drive forward/backward in the direction they're facing, and rotate with left/right.
- The **turret and barrel** rotate independently with Q/E or ,/. — aim while moving.
- **Directional armour** determines hit effects based on where a shot lands:
  - **Front hit** — disables turret rotation (can still move and fire forward)
  - **Side hit** — disables the track on that side (can only pivot, not drive straight)
  - **Rear hit** — instant kill (one hit from behind)
  - **Second hit from any direction** — destroyed
- Damaged tanks trail **smoke** and show visual damage (broken tracks, locked turret with red ✕, darkened hull).
- In **1v1** and **vs Bot**, first to **10 kills** wins.
- In **5v5 Team Battle**, each team has a **tower** at their base. Destroy the enemy tower to win (towers take 10 hits). Tanks respawn at their team's base.
- **Buildings block movement and bullets** — use them as cover. All buildings are destructible (small: 3 hits, medium: 5, large: 8).
- Each viewport has a **minimap** in the corner showing the full island, all players, and towers.

## Development

### Setup

```bash
npm install
npx lefthook install
```

### Commands

| Command | Purpose |
|---|---|
| `npm test` | Run all tests |
| `npm run test:coverage` | Tests + coverage thresholds |
| `npm run lint` | Biome lint check |
| `npm run lint:fix` | Auto-fix lint + format |
| `npm run check` | Lint + test + coverage + architecture (full local CI) |
| `npm run graph:validate` | Check architectural boundaries |
| `npm run mutation` | Mutation testing (slow, run periodically) |

Individual test suites: `npm run test:ai`, `test:pathfinder`, `test:map`, `test:game`, `test:roles`.

Pre-commit hooks (via lefthook) run lint and tests automatically on commit.

## Vehicle Types

In 5v5 Team Battle, each vehicle is **randomly assigned** at spawn and respawn (40% chance of IFV). Duel modes always use tanks.

| Stat | Tank | IFV |
|------|------|---------|
| Speed | 1× | 1.5× |
| Armour | 2 hits | 1 hit (destroyed instantly) |
| Firepower | 1× (full damage) | 0.25× (rapid fire, low damage) |
| Bullet speed | 1× | 1.5× |
| Turret | Independent rotation | Fixed (fires forward) |

**Tanks** are the default — tough, versatile, with an independently rotating turret. Two hits to destroy (with directional subsystem damage), or one rear shot.

**IFVs** are glass cannons — faster movement, rapid-fire autocannon with 1.5× bullet speed, but destroyed by a single hit from anything. Their gun is fixed forward (no turret rotation), so they must aim by steering. The HUD shows your current vehicle type. On the minimap, IFVs appear as diamonds ◇ while tanks are squares ■.

IFV bullets deal 25% damage — four hits equal one tank hit. This creates an asymmetric dynamic: IFVs harass and whittle down tanks, but one return shot ends them.

## AI Bot Roles

In 5v5 Team Battle, each AI bot is randomly assigned a **role** at spawn and respawn. Roles determine navigation strategy and combat priorities:

| Role | Symbol | Behaviour |
|------|--------|-----------|
| **Cavalry** | C | Aggressive rush straight to the enemy tower. Engages anything in its path. First to arrive but often first to die. |
| **Sniper** | S | Finds a firing position at range from the enemy tower and bombards it from a distance. Avoids close combat (self-defence only). |
| **Defender** | D | Patrols near the friendly tower and intercepts incoming enemies. Switches to cavalry if the tower falls. |
| **Scout** | F | Takes a wide flanking route to reach the enemy tower from an unexpected angle. Engages enemies only in close range. |

Role letters appear on the minimap next to allied bot dots, and an allied roster is shown in the bottom-left of the HUD.

The mix of roles creates more dynamic and unpredictable battles instead of two blobs colliding in the middle of the map. Each respawn re-rolls the role, so team composition shifts throughout the match.

## Technical Notes

- **No dependencies.** Pure vanilla JS with ES modules. Works in any modern browser.
- **Rendering** is two-pass: flat ground tiles first (never occlude entities), then elevated tiles + entities depth-sorted. Elevated tiles use `depth + 1` so their side walls correctly occlude entities behind them.
- **Map generation** uses seeded value noise (fBm) for the island shape, then stamps village clusters with paved road networks and connects them with dirt roads using a cardinal-step algorithm.
- **Tank graphics** are fully projected — every polygon is defined in local space, rotated by the tank's angle, and projected through the isometric transform. Hull and tracks use hull angle; turret and barrel use independent turret angle. Layers are stacked with visible 3D extrusion. Damage is shown through colour changes (broken tracks, grey locked turret, darkened hull).
- **Directional armour** uses bearing-based hit detection: the angle from the tank centre to the bullet contact point, relative to the hull facing, determines the hit zone (front ±45°, rear ±45°, sides fill the remainder).
- **Vehicle types** — tanks and IFVs share the Tank class but differ in speed, armour, fire rate, and turret behaviour. Bullets carry damage and speed values. Partial damage accumulates: four 0.25-damage hits trigger the same directional armour effect as one full hit.
- **Sound** is 100% procedural: noise buffers through bandpass filters for gunshots, low oscillators for explosions, metallic clangs for subsystem hits, sine tones for UI feedback.
- **Pathfinding** uses A\* with an octile heuristic and a wall-proximity cost overlay. Binary min-heap open set. Under 1ms per search on 64×64.
- **Collision** is axis-separated (tanks slide along obstacles) with passability-checked separation to prevent tanks being pushed into walls.
- **Structured context** (`AGENTS.yaml`) captures architecture decisions and coding conventions for AI agents. See [sctx.dev](https://sctx.dev) for details.
