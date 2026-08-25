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

There are no bot roles. Every AI vehicle runs the same small set of **local rules over shared pheromone signals** (colony-insect style), and cooperation — convoys, rallies, sieges — *emerges* rather than being scripted. Each faction has its own pheromone fields:

| Signal | Laid by | Effect |
|--------|---------|--------|
| **Trail** | Units marching on a discovered objective — shorter journeys lay stronger trails | Others follow lit routes; the swarm's paths optimize over time and stale ones fade |
| **Alarm** | A *living* unit that was recently hit | Nearby allies rally to the fight. The signal dies with the victim — no rallying to a corpse |
| **Food** | A discovered, still-standing enemy objective | Attracts the swarm; destroyed objectives stop attracting |
| **Visited** | Every unit, wherever it stands | Exploration memory — retreading is repelled, so the colony spreads out instead of blobbing at home |

**Discovery is not omniscient.** A faction learns the enemy base only when a friendly unit actually sees part of the compound (sight range + line of sight). Until then, units explore — preferring unexplored ground away from home. Structures are fog-of-war: only discovered ones can be targeted.

**Convoys form naturally.** Tanks are strong attractors and spearhead; IFVs, squads and drones fall in behind (squads and drones flank to the sides). A bot only leads while it's actually going somewhere — parked bots hold no followers — and a leader marching on the objective gathers an escort, so assaults arrive as a wave. Human-driven vehicles are natural leaders: nearby bots escort you, but the system never steers the human.

**Vehicle identity is data, not code.** Each vehicle type has a `swarm` block in `js/config/vehicles.js`: how strongly it attracts followers, how eagerly it follows, how far it flanks, the standoff range it keeps (SPGs shell from afar), its aggression, and its personal space.

## Tuning the swarm

Every swarm parameter lives in one table — `SWARM_TUNABLES` in `js/config/swarm.js` — and the tooling treats it uniformly:

- **`sandbox.html`** (serve the folder, open `/sandbox.html`) — watch a seeded match with the pheromone fields as heat overlays, scrub every parameter live with sliders, replay any scenario by seed.
- **`tools/sim.js`** — headless deterministic match runner with metrics (first contact, discovery, exploration coverage, clustering, decisiveness):  `node tools/sim.js --seeds 1-20 --map 128 --teamSize 5`
- **`tools/sweep.js`** — samples parameter sets and scores them across seeded matches with weighted goals, worker-parallel but bit-reproducible regardless of thread count:  `node tools/sweep.js --candidates 16`
- **`tools/adopt.js`** — re-validates the winner on disjoint seeds (anti-lucky-seed guard) and regenerates `js/config/swarm.js`, so adopted values apply everywhere at once: game, sandbox, sims, tests.

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
