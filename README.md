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
| **Skirmish** | Kill race to 10. Up to 4 players; defaults to a free-for-all (each player a different colour) but players can team up. One player faces a single bot. |
| **Battle** | Base objective: destroy the enemy HQ. Two teams (RED vs BLUE), all vehicle types; bots fill each team to the chosen team size. |

## Controls

The keyboard drives a single player:

| Action   | Keyboard |
|----------|:--------:|
| Forward  | W        |
| Backward | S        |
| Rotate left  | A     |
| Rotate right | D     |
| Turret left  | Q     |
| Turret right | E     |
| Fire     | Space        |

The turret rotates independently from the hull, slower than hull rotation. This creates a skill gap between positioning and aiming — you can drive in one direction while shooting in another. AI bots track targets with the turret while navigating along their path.

**Menu:** ↑↓ or W/S to select, ←→ or A/D to change, Enter or Space to confirm, Esc to go back.
**Game over:** Space/Enter for rematch, Esc/R for menu.

## Gamepad

Up to **four** standard-mapping controllers (Xbox, PlayStation, Steam Deck built-in controls) work alongside the keyboard. The first device to press **A / Start** becomes **Player 1**; each additional player presses A/Start to join in turn. The pad mapping is layout-independent (Xbox, PlayStation and Nintendo pads all work). Face buttons are described by position below.

| Action   | Gamepad |
|----------|---------|
| Forward  | **Top face button** (Y / △ / X) — D-pad ↑ or stick ↑ also work |
| Reverse  | **Left face button** (X / □ / Y) — D-pad ↓ or stick ↓ also work |
| Steer left / right | D-pad ←→ (digital) or left stick ←→ (**analog** — turn rate scales with deflection) |
| Turret left / right | LT / RT (**analog** — speed scales with trigger pull) |
| Fire     | **Bottom face button** (A / ✕ / B) — right face button and Start also work |
| Menu: navigate / confirm / back | D-pad or stick / **bottom button** / **right button** |
| Lobby: join / switch team / leave | **A** or Start / **X** (left face) / **B** (right face) |
| Game over: rematch / menu | Bottom button / right button |

Keyboard and gamepads can be used at the same time (e.g. one player on the keyboard, the rest on pads).

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
- In **Skirmish**, the first player or team to **10 kills** wins.
- In **Battle**, each team has a **base compound** (HQ, walls, and watch towers) at their side. Destroy the enemy **HQ** to win (it takes 20 hits); watch towers fire at enemies, and walls block movement. Tanks respawn inside their team's compound.
- **Buildings block movement and bullets** — use them as cover. All buildings are destructible (small: 3 hits, medium: 5, large: 8).
- Each viewport has a **minimap** in the corner showing the full island, all players, and base structures.

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

Individual test suites: `npm run test:ai`, `test:pathfinder`, `test:map`, `test:game`.

Pre-commit hooks (via lefthook) run lint and tests automatically on commit.

## Vehicle Types

In **Battle**, each vehicle is **randomly assigned** at spawn and respawn from the five types — tank, IFV, drone, SPG, squad — each with equal weight. Skirmish always uses tanks.

| Stat | Tank | IFV | Drone | SPG | Squad |
|------|------|---------|-------|-----|-------|
| Speed | 1× | 1.5× | 2× | 0.7× | 0.9× |
| Armour | 2 hits | 1 hit | 1 hit | 1 hit | 5 members |
| Firepower | 1× (full damage) | 0.25× (rapid fire) | Kamikaze (1× at point blank) | 1× arcing shell + splash | Auto-fire (rifle/RPG) |
| Bullet speed | 1× | 1.5× | N/A | N/A (arcing shell) | N/A (member weapons) |
| Turret | Independent rotation | Fixed (fires forward) | N/A | Independent (slow) | N/A (auto-target) |
| Movement | Ground only | Ground only | **Flies over everything** | Ground only | Ground only |
| Minimap | ■ | ◇ | ✕ | ▲ | ● |

**Tanks** are the default — tough, versatile, with an independently rotating turret. Two hits to destroy (with directional subsystem damage), or one rear shot.

**IFVs** are glass cannons — faster movement, rapid-fire autocannon with 1.5× bullet speed, but destroyed by a single hit from anything. Their gun is fixed forward (no turret rotation), so they must aim by steering. The HUD shows your current vehicle type.

IFV bullets deal 25% damage — four hits equal one tank hit. This creates an asymmetric dynamic: IFVs harass and whittle down tanks, but one return shot ends them.

**Drones** are FPV kamikaze quadcopters inspired by modern warfare. They fly over all terrain — buildings, hills, rocks, and water — at 2× speed. They carry no gun; instead, the pilot flies into a target and presses fire to **detonate**. Damage falls off with distance: point-blank deals 1.0 (equivalent to a tank shell), dropping linearly to 0 at the blast radius edge (2.5 tiles). Directional armour applies based on the drone's approach angle — diving into a tank's rear is an instant kill, while a sloppy approach from the front only disables the turret. The drone is always destroyed on detonation, even if it misses.

**SPGs** are heavy self-propelled artillery. Hold **fire** to charge range, then release to launch — the longer the hold, the further the shell flies (up to 25 tiles). Shells arc **over** terrain obstacles and detonate with splash damage, so an SPG can bombard enemies hiding behind buildings. Its gun is an independently rotating turret, but the vehicle is slow and fragile — one hit destroys it, so it must stay at range.

**Squads** are five-man infantry fireteams that fight on their own. Members auto-target and auto-fire independently: the RPG engages vehicles and base structures, the shotgun is a dedicated counter to drones, and rifles/machine-guns engage enemy squads. The squad loses members one by one as it takes damage, and pressing **fire** makes it dig in for reduced incoming damage; buildings provide cover.

## Swarm AI

AI bots have no assigned roles. Instead, each team shares a set of **pheromone signal fields** — tile overlays inspired by colony insects — and every bot re-decides its goal each frame from the signals around it:

| Signal | Laid by | Effect |
|--------|---------|--------|
| **Recruitment** | Every vehicle (tanks and human players most strongly) | Nearby vehicles fall into **convoys** behind the strongest emitter — tanks spearhead, squads and drones hold the flanks. |
| **Trail** | Vehicles heading to a known objective | Marks the route; shorter journeys lay stronger trails, so the swarm converges on the best corridor over time. |
| **Alarm** | A vehicle while it is under attack | Close teammates **rally to the fight**. The signal dies with the victim — no one rallies to a corpse. |
| **Food** | A discovered enemy objective | A beacon that attracts the swarm until the objective is destroyed. |

With no signal to follow, bots **explore** weak-signal ground away from home, so the team spreads out and finds the enemy base (objectives must be *discovered* by line of sight before anyone can attack them). Because vehicles react to the situation rather than obeying an assignment, combined-arms behaviour — convoys, flanking escorts, rallies — emerges on its own.

## Tuning the swarm

All pheromone behaviour is data (`VEHICLES[].signals` and the `SIGNAL_*` / `CONVOY_*` / `EXPLORE_*` constants in `js/config/constants.js`), and there are three tools for tuning it:

- **Sandbox** — open `sandbox.html` (served like the game: `python3 -m http.server 8000`, then visit `/sandbox.html`). It runs an all-bot battle with a full-map view, per-channel pheromone heatmaps, live sliders for every tuning parameter, and a metrics panel (time to first contact, discovery, exploration %, clustering, convoy coherence).
- **Headless simulator** — `npm run sim -- --runs 5` prints match metrics as JSON. Override any parameter with `--set`, e.g. `npm run sim -- --set CONFIG.EXPLORE_VENTURE_WEIGHT=0.2 --set VEHICLES.tank.signals.recruit=1.4 --runs 5`. Matches are deterministic per `--seed`.
- **Optimizer** — `npm run optimize -- --configs 30 --repeats 5` random-searches the tuning space against the defaults as a baseline. Goals are weighted with `--weights`, e.g. `--weights engage=1,discovery=1,declusterMean=0.5` (default `engage=1,discovery=1`). Registered metrics: `engage`, `discovery`, `explore`, `exploreRate`, `decluster`, `declusterMean`, `cohesion`, `kills`, `attrition`, `damage`, `duration` (see `tools/goals.js`). Matches fan out over worker threads (`--threads N`, default all cores; `--threads 1` is the bit-identical sequential reference), and time-of-first-event goals (`engage`, `discovery`) stop each match as soon as it settles — a 30×5 sweep takes seconds, not minutes.
- **Implementing tuned values** — add `--implement` to the optimizer: it re-verifies the winner on fresh seeds (`--verify N`, default 8) and, only if it still beats the baseline, writes it to `js/config/tuning.js`. That generated file is merged over the config defaults at load (`js/config/overrides.js` does the merge, strictly — an unknown key fails loudly), so tuned values apply everywhere: the game, the sandbox, the sims, and the tests. Hand-edits to `tuning.js` work too, but the next `--implement` overwrites them.

## Technical Notes

- **No dependencies.** Pure vanilla JS with ES modules. Works in any modern browser.
- **Rendering** is two-pass: flat ground tiles first (never occlude entities), then elevated tiles + entities depth-sorted. Elevated tiles use `depth + 1` so their side walls correctly occlude entities behind them.
- **Map generation** uses seeded value noise (fBm) for the island shape, then stamps village clusters with paved road networks and connects them with dirt roads using a cardinal-step algorithm.
- **Tank graphics** are fully projected — every polygon is defined in local space, rotated by the tank's angle, and projected through the isometric transform. Hull and tracks use hull angle; turret and barrel use independent turret angle. Layers are stacked with visible 3D extrusion. Damage is shown through colour changes (broken tracks, grey locked turret, darkened hull).
- **Directional armour** uses bearing-based hit detection: the angle from the tank centre to the bullet contact point, relative to the hull facing, determines the hit zone (front ±45°, rear ±45°, sides fill the remainder).
- **Vehicle types** — all five types (tank, IFV, drone, SPG, squad) share the Tank class but differ through per-type behaviour strategies in `js/vehicles/`. Bullets carry damage and speed values. Partial damage accumulates: four 0.25-damage hits trigger the same directional armour effect as one full hit. Drones fly over terrain (map-bounds check instead of passability); their detonation is area-of-effect with linear distance falloff. SPG shells arc over obstacles and splash on impact; a squad is one entity owning five independently firing soldiers (the `Squad` component).
- **Sound** is 100% procedural: noise buffers through bandpass filters for gunshots, low oscillators for explosions, metallic clangs for subsystem hits, sine tones for UI feedback.
- **Pathfinding** uses A\* with an octile heuristic and a wall-proximity cost overlay. Binary min-heap open set. Under 1ms per search on 64×64.
- **Collision** is axis-separated (tanks slide along obstacles) with passability-checked separation to prevent tanks being pushed into walls.
- **Structured context** (`AGENTS.yaml`) captures architecture decisions and coding conventions for AI agents. See [sctx.dev](https://sctx.dev) for details.
