# AGENTS.md — js/

Module map and the abstractions in detail, plus how the design principles
apply to writing game code. Read the root `AGENTS.md` first for the
principles; this file is the concrete layer underneath them.

## Module map

Dependency flow (enforced by `.dependency-cruiser.cjs`; `config.js` is the
leaf):

```
main.js ──▶ game.js, renderer.js, audio.js, menu.js, input.js
game.js ──▶ map.js, tank.js, bullet.js, particles.js, camera.js, ai.js
ai.js  ──▶ pathfinder.js
renderer.js ──▶ config.js, utils.js
everything ──▶ config.js, utils.js   (config.js imports nothing)
```

Rules that follow:

- `config.js` imports nothing from the game. Keep every tunable and every
  data table here; do not hardcode gameplay values in logic files.
- `utils.js` imports only `config.js`. It is a leaf of pure helpers.
- Avoid circular dependencies. If two modules need each other, extract a
  third, or push the shared logic down toward the leaf.

## The abstractions, in detail

### 1. Data-driven configuration (`config.js`)

The single source of truth for everything that varies:

- `TILES` — tile type enum.
- `CONFIG` — flat constants (map size, speed, armour arcs, role ranges, …).
- `PLAYER_COLORS` — team colours in join order.
- `ACTIONS` — the input action vocabulary (frozen).
- `GAME_TYPES` — `skirmish` / `battle`: win condition, team set, bases flag,
  allowed vehicles, and which `GAME_OPTIONS` each shows.
- `GAME_OPTIONS` + `resolveSettings()` — pre-game options resolved to a flat
  settings object.
- `VEHICLES` — per-vehicle stats, `roleWeights`, `targetPriority`, `armour`.
- `SQUAD_MEMBERS` / `SQUAD_ATTENTION_ORDER` — squad member weapons and death
  order.
- `BASE_STRUCTURES` — per-structure HP/size/weaponry.

**When adding a mechanic, add a parameter here rather than a constant in a
logic file.** `Tank.applyHit()` already reads `VEHICLES[tank.vehicleType].armour`
generically — tuning durability or adding a vehicle is (intended to be) a
config change, not a logic change.

### 2. Entity hierarchy (`entity.js`)

```
GameEntity (entityType, team, color, darkColor)
  ├── Tank                 (vehicle: tank / ifv / drone / spg / squad)   tank.js
  └── BaseStructure
        ├── BaseWall       1×1 fortification wall
        ├── BaseHQ         1×2 command tent
        └── BaseWatchTower 1×1 armed guard tower
```

- `Base` is a **compound container**, not an entity — it holds one team's HQ,
  walls, and towers.
- Capability getters on `GameEntity` — `targetable`, `collidable`, `mobile`,
  `isShooter`, `isVehicle`, `isStructure`, `size` — give targeting, collision,
  and rendering one uniform interface. Subclasses override the ones that apply
  to them. **Prefer overriding a capability getter over adding a type check.**

### 3. The `InputDevice` interface (`input.js`)

```js
device.isDown(action)     // held this frame
device.wasPressed(action) // newly pressed this frame
device.analog(action)     // 0..1 magnitude (steering/triggers), else 0/1
device.endFrame()         // clear one-frame edges at end of frame
```

All over the shared `ACTIONS` vocabulary — no key-code indirection.

- `KeyboardDevice` and `GamepadDevice` implement it for humans.
- The AI (`ai.js`) implements the **same interface**, so gameplay code never
  branches on "is this a human or a bot".
- `gamepadToActions(gp)` is a pure function (exported for tests) that maps a
  standard gamepad snapshot to `{ held, axes }`.
- `InputManager` is the device registry: owns the keyboard, creates/refreshes
  `GamepadDevice`s from `navigator.getGamepads()`, and drives `poll()` /
  `endFrame()` each frame.

### 4. `Game` and the event bus (`game.js`)

A match is a `MatchConfig` (built by the lobby in `menu.js`):

```js
{
  gameType: "skirmish" | "battle",
  humans:   [ { device, color, darkColor, label, team } ],
  settings: { mapSize, buildingDensity, baseType?, teamSize? },
}
```

- `planFactions()` (`factions.js`) is the **pure** planner: given the game type
  and humans, it decides factions and bot-fill counts. `Game` materialises the
  plan into `Tank` / `Camera` / `AIController` entities.
- `Game` owns the simulation: tanks, bullets, bases, win logic, scores. It
  exposes **uniform accessors** — `allTanks`, `humanTanks`, `factions`,
  `cameras`, `bases`, `baseStructures`, `scores`, `winnerColor` — so the
  renderer and HUD stay game-type-agnostic.
- The **event bus** (`game.on(event, fn)` / `game.emit(event, data)`) decouples
  cross-cutting concerns. Events: `fire`, `hit`, `destroy`, `impact`,
  `destroy_tile`, `win`, `artillery_impact`, `drone_strike`. `audio.js`
  subscribes; `game.js` never imports audio. **Wire new sound/UI reactions
  through an event, not a direct call.**

### 5. The component pattern (`squad.js`)

A squad is **one** `Tank` entity (the leader) that **owns** a `Squad` component
(`tank.squad`), created lazily. The component owns the soldiers, the dig-in
state machine, and the squad damage model; member positions are world-space
and authoritative (rendering, firing, hit tests, run-over all read them).

Prefer this composition over subclassing. When a vehicle needs behaviour that
isn't shared by all vehicles, a **component on the entity** (like `Squad`) is
the established precedent — not a new subclass and not a new `vehicleType`
switch.

### 6. AI roles and navigation (`ai.js`, `pathfinder.js`)

- The AI navigates with A* (`pathfinder.js`), then follows waypoints. Reactive
  obstacle avoidance is a light fallback for dynamic obstacles, not the primary
  navigation. When stuck, the AI shoots destructible terrain.
- Navigation and combat are **separated**: bots navigate toward their
  objective and fire at enemies they pass, rather than chasing.
- Roles (`cavalry`, `sniper`, `defender`, `scout`) select goals, targets, and
  candidate positions; per-role tuning lives in `CONFIG` and `VEHICLES[].roleWeights`.

## Code-quality rules (applied to js/)

The root principles, made concrete for this directory:

- **Extensibility over type checks.** If you find yourself writing
  `if (tank.vehicleType === "...")`, stop: that's the "type code" smell. The
  data-driven way is a `VEHICLES[type]` field, a capability getter, a strategy,
  or a component. Add the N+1th vehicle the same way the previous five are
  (or refactor first so they all are).
- **Delete, don't preserve.** When you change an API, migrate every caller and
  remove the old path. No `// backward compat` fields, no dead methods kept
  "in case".
- **Do the larger change.** A duplicated helper (e.g. `_roundedRect`, colour
  math, line-of-sight) is removed by extracting and unifying *all* call sites
  at once — not by adding a fourth copy.
- **Readability.** Keep functions small and single-responsibility, name them
  for what they do, and let the data table say what varies. If a class needs a
  diagram, split it (`renderer.js` and `ai.js` are the current worst cases —
  see `docs/refactor_opportunities.md`).
- **Comments.** Explain *why*, never *what*. The codebase's own header blocks
  are good examples of *why*-style documentation; a line comment restating
  `this.hp -= amount` is not.

## Known structural debt (do not expand it)

These are the current violations of the principles above; the plan to remove
them is in `docs/refactor_opportunities.md`. While they still exist, do not
make them worse:

- `renderer.js` — a ~3,000-line god object with **no tests**. Do not add more
  responsibilities to it; extract, don't append.
- `ai.js` and `game.js` — ~1,100 lines each, multiple roles/responsibilities.
- `vehicleType === "x"` dispatch — ~47 checks across six files: `game.js`,
  `tank.js`, `ai.js`, `renderer.js`, `collision.js`, `audio.js`.
- Duplicated `_roundedRect` (`renderer.js`, `menu.js`), colour helpers, and
  line-of-sight / passability queries.
- Dead code: `map.js#_createBase()` is never called.
