# AGENTS.md — js/

Module map and the abstractions in detail, plus how the design principles
apply to writing game code. Read the root `AGENTS.md` first for the
principles; this file is the concrete layer underneath them.

## Module map

Dependency flow (enforced by `.dependency-cruiser.cjs`; `config.js` is the
leaf):

```
main.js ──▶ game.js, renderer.js, audio.js, menu.js, input.js
game.js ──▶ map.js, tank.js, bullet.js, particles.js, camera.js, ai.js,
            modes.js, systems/, vehicles/
ai.js  ──▶ pathfinder.js, vehicles/, ai/          (thin controller)
ai/    ──▶ config.js                              (swarm, targeting,
            navigation, recovery, aiming — pure helpers over AI state)
menu.js ──▶ lobby.js, menu/                       (thin shell)
menu/  ──▶ config.js, render/vehicles/, render/canvas-utils.js
config.js ──▶ config/                             (barrel; nothing else)
config/  imports nothing                          (the data leaf)
modes.js ──▶ config.js, entity.js                 (uses the public Game API)
map.js  ──▶ map/                                  (facade over the js/map/ package)
map/    ──▶ config.js, utils.js
systems/ ──▶ ai/, bullet.js, config.js, projectiles/, shoot.js, vehicles/, utils.js
vehicles/ ──▶ ai/, config.js, utils.js, shoot.js, squad.js
shoot.js ──▶ bullet.js                            (fire seam: spawnBullet + flashMuzzle)
projectiles/ ──▶ config.js, vehicles/aoe.js       (kind-dispatched projectile lifecycle)
renderer.js ──▶ js/render/*, layout.js      (thin shell)
js/render/ ──▶ config.js, utils.js, draw-helpers.js, formation.js
everything ──▶ config.js, utils.js   (config imports nothing)
```

The render layer is a **package**, not one file. `renderer.js` is a thin
shell (canvas + per-frame layout); every drawing concern lives in a focused
module under `js/render/`:

- `viewport.js` — the two-pass depth-sort orchestration (`renderViewport`)
  plus the pure `collectDepthItems` bucket builder. **The depth contract
  lives here**: flat tiles in pass 1, elevated tiles at depth `gx+gy+1`,
  drones at +2, items pushed tiles → tanks → structures → bullets →
  particles within a bucket.
- `tiles.js` / `buildings.js` / `structures.js` — terrain (data-driven from
  `TILE_VISUALS`), destructible buildings (data-driven from the `BUILDING_STYLES`
  palette + roof-profile table), and base compounds (`structures.js` is a thin
  barrel over `structures/`: one sprite per type + a shared `drawIsoBlock`,
  dispatched by the `STRUCTURE_SPRITES` registry).
- `vehicles/` — the five vehicle sprites, one module each, plus `drawVehicle`
  via a `SPRITES` registry (`index.js`). `js/menu/background.js` imports
  `drawVehicle` from the `vehicles.js` barrel for previews (no prototype hack).
- `effects.js` — bullets (incl. arcing shells) + particles.
- `hud.js` / `minimap.js` / `overlay.js` — score/battle HUDs, minimap,
  game-over + SPG target indicator.
- `projection.js` — shared isometric `P`/`PT` projection closures and the
  alive/flash sprite guard.
- `canvas-utils.js` — the colour palette and colour math, `roundedRect`.
- `damage.js` — the shared damage overlay (cracks + critical flash).

Rules that follow:

- `config.js` imports nothing from the game. Keep every tunable and every
  data table here; do not hardcode gameplay values in logic files.
- `utils.js` imports only `config.js`. It is a leaf of pure helpers.
- Avoid circular dependencies. If two modules need each other, extract a
  third, or push the shared logic down toward the leaf.
- The render package must stay leaf-ish (enforced by dependency-cruiser):
  it may import data/config/utils/draw-helpers/formation — never game
  logic modules.

## The abstractions, in detail

### 1. Data-driven configuration (`config.js`)

`config.js` is a **barrel** over the `js/config/` package — every thematic
data table lives in its own module (`tiles.js`, `constants.js`, `players.js`,
`actions.js`, `options.js`, `vehicles.js`, `structures.js`) and is re-exported
from the single entry point, so `import … from "./config.js"` is always
correct and the dependency leaf rule is enforced at the package boundary.

The single source of truth for everything that varies:

- `TILES` — tile type enum; `TILE_PROPS` — per-tile gameplay semantics
  (passable/solid/road/water/building/height/hp), indexed by that enum;
  `TILE_VISUALS` — per-tile *visual* semantics (draw kind, palette key,
  variation, minimap colour), also indexed by that enum.
- `CONFIG` — flat constants (map size, speed, armour arcs, …).
- `PLAYER_COLORS` — team colours in join order.
- `ACTIONS` — the input action vocabulary (frozen).
- `GAME_TYPES` — `skirmish` / `battle`: win condition, team set, bases flag,
  allowed vehicles, and which `GAME_OPTIONS` each shows.
- `GAME_OPTIONS` + `resolveSettings()` — pre-game options resolved to a flat
  settings object.
- `VEHICLES` — per-vehicle stats, `swarm` identity, `targetPriority`, `armour`,
  and the interaction flags (`flies` / `soft` / `crushable` / `canCrush` /
  `hasSquad`) plus `hudGlyph` / `minimapShape`.
- `TARGET_TYPES` / `TARGET_CLASS_DEFAULTS` — the canonical target-type
  vocabulary and per-class priority defaults (`js/config/targets.js`).
- `SQUAD_MEMBERS` / `SQUAD_ATTENTION_ORDER` — squad member weapons and death
  order.
- `BASE_STRUCTURES` — per-structure HP/size/weaponry/`isShooter`/`fireSound`.
- `MAP_STYLES` — per-biome terrain palette + noise tuning (`js/config/biomes.js`),
  selected by `grid.style`.

**When adding a mechanic, add a parameter here rather than a constant in a
logic file.** `Tank.applyHit()` already reads `VEHICLES[tank.vehicleType].armour`
generically — tuning durability or adding a vehicle is (intended to be) a
config change, not a logic change.

### 2. Entity hierarchy (`entity.js`)

```
GameEntity (entityType, team, color, darkColor)
  ├── Tank                 (vehicle: tank / ifv / drone / spg / squad)   tank.js
  └── BaseStructure        (baseWall / baseTower / baseHQ — data-driven
                            from BASE_STRUCTURES)                        entity.js
```

- `Base` is a **compound container**, not an entity — it holds one team's
  structures in a flat `structures` list, with `hq` / `walls` / `towers`
  as filtered views (so a new structure category is a `BASE_STRUCTURES`
  entry + a layout slot, no edits to `Base`).
- Damage *rules* live in `js/damage.js` — `armour` (directional hit zones +
  data-driven subsystems), `members` (squad), and `hp` (structures) models
  behind one `resolveDamage(entity, zone, damage)` seam, selected by the
  entity's `damageModel` getter.
- Capability getters on `GameEntity` — `targetable`, `collidable`, `mobile`,
  `isShooter`, `isVehicle`, `isStructure`, `size`, and the interaction
  capabilities `flies` / `softTarget` / `crushable` / `canCrush` /
  `chargeable` (plus `incomingDamageMultiplier(map)`) — give targeting,
  collision, and rendering one uniform interface. `Tank` derives its
  interaction capabilities from independent `VEHICLES` flags (`flies`, `soft`,
  `crushable`, `canCrush`, `hasSquad`); `BaseStructure.isShooter` reads
  `BASE_STRUCTURES[type].isShooter`. Consumers read the capability, never a
  type string. **Prefer overriding a capability getter over adding a type check.**

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
  exposes **uniform accessors** — `allTanks`, `humanTanks`, `bots` (as
  records), `factions`, `cameras`, `bases`, `baseStructures`,
  `damageables`, `scores`, `winnerColor` — so the renderer and HUD stay
  game-type-agnostic. The strategies (modes and vehicle behaviours) are
  written against this public surface — the accessors plus `setBases`,
  `creditKill`, `nearestEnemy`, `enemiesOf(team)`, `structureAt(gx, gy)`,
  `getBot(tank)`, and the single damage-application seam
  `applyDamage(entity, source, amount)` / `destroyEntity(entity, source)` —
  never against `_`-prefixed internals.
- The per-frame simulation loop is a thin ordered list in `Game._update`; each
  pass (think, movement, vehicle-update, separation, crush, firing, bullets,
  towers, respawn, smoke, camera, win) lives in `js/systems/` as a
  `(game, …)` function.  A new per-frame concern is one system module + one
  line in the loop, not a new `Game` method.
- **`Game` delegates the two real axes of variation.** Per-vehicle
  firing/attack rules live in the behaviour strategies (`js/vehicles/`,
  dispatched by `getVehicleBehaviour(tank.vehicleType)`); Skirmish-vs-Battle
  branching (spawn, win, scoring, labels) lives in the mode strategy
  (`js/modes.js`, `getMode(gameType)`). New logic belongs behind those seams,
  not as new `if (vehicleType === …)` / `if (typeDef.bases)` branches here.
- The **event bus** (`game.on(event, fn)` / `game.emit(event, data)`) decouples
  cross-cutting concerns. The event names are the frozen `GAME_EVENTS`
  constants (`js/events.js`) with normalised payloads (`fire` → `{ source,
  bullet, sound }`, `destroy` → `{ entity }`); events: `fire`, `hit`,
  `destroy`, `impact`, `destroy_tile`, `win`, `artillery_impact`,
  `drone_strike`, `terrain_changed`. `audio.js` subscribes; `game.js` never
  imports audio. **Wire new sound/UI/pathfinding reactions through an event,
  not a direct call.**

### 5. Vehicle behaviour strategies (`js/vehicles/`)

`getVehicleBehaviour(type)` returns a plain strategy object — one module per
vehicle (`tank.js`, `ifv.js`, `drone.js`, `spg.js`, `squad.js`, plus a shared
`aoe.js` for the `applyBlast` primitive). The hooks:

- `init(tank)` — create this vehicle's per-instance components (the squad
  behaviour sets a `Squad`, the SPG behaviour sets a `Charge` component;
  others no-op).  Components live in a generic `tank.components` map and are
  reached via `tank.component(name)` (and the `squad`/`charge`/`body`
  conveniences), so a new component is `components.set(name, …)` + a getter —
  never a new field on `Tank`.  Called by the `Tank.vehicleType` setter and on
  respawn, so per-vehicle *state* lives in components, never as fields on `Tank`.
- `fire(game, tank, device, dt)` — per-frame firing/attack (drone detonation,
  SPG charge, squad auto-fire, direct fire), built on `spawnBullet` /
  `flashMuzzle` (`js/shoot.js`).
- `move(tank, device, dt, map)` — per-frame movement (rotation, turret, drive).
  `Tank.update()` ticks the generic timers then delegates here, so the entity
  never branches on vehicle type.
- `update(game, tank, dt)` — per-frame component updates (squad steering).
- `aim(ai, me, { target, dist }, map)` — the AI's turret-aim strategy (tank
  turret-aim, IFV opportunistic, SPG hold-to-charge), receiving the canonical
  `{ target, dist }` fire-target shape (`target` has x/y, `dist` is precomputed).
- `aiThink(ai, dt, me, enemies, map, objective)` — AI think-level dispatch.
  The behaviour *contains* the logic here and returns `true` when it consumed
  the whole think: `drone.js` flies the kamikaze, `squad.js` manages dig-in,
  and the base `tank.js` pivots-and-fires when `me.trackDamaged` (via the
  shared `thinkImmobilised`).  The controller no longer owns per-vehicle think.

The projectile lifecycle is *not* a behaviour hook: bullets carry a `kind`
("direct" / "shell") and `js/projectiles/` dispatches movement + terrain /
entity / landing effects (`update` / `onTerrain` / `onEntity` / `onLand`) —
the splash is a property of the projectile, not of the shooter.  Explosions
(and the drone detonation) use one `applyBlast` (`js/vehicles/aoe.js`).

Behaviours share a base (`tank.js`); a new vehicle usually reuses one and
overrides a hook (`{ ...tank, aim: myAim }`). Per-vehicle *traits* that aren't
behaviour live in `VEHICLES` as data: the interaction flags (`flies` / `soft`
/ `crushable` / `canCrush` / `hasSquad` — surfaced as the matching capability
getters; `chargeRate` → `chargeable`), `turret` (`independent` / `fixed` — the
`fixedGun` capability), `firesBullets`, `muzzleFlash`, `fireSound`.
**Never branch on `vehicleType` in game logic — add a trait to `VEHICLES`, a
capability getter, or a hook to a behaviour instead.**

### 6. Game-mode strategies (`modes.js`)

`getMode(gameType)` returns the Skirmish or Battle strategy. Each mode is a
plain object with hooks for everything the modes do differently: `hasBases`,
`init` (battle: compounds + structure map), `spawn`,
`afterSeparation` / `afterBullets`,
`respawn`, `onKill`, `checkWin`, `factionLabel` / `winnerLabel`. The shared
loop stays in `Game`. **A third mode = one `GAME_TYPES` entry + one strategy
object — never more `if (typeDef.bases)` sprinkles.**

### 7. Map + shared geometry API (`map.js` → `js/map/`)

`GameMap` (`js/map.js`) is a facade over the `js/map/` package: `grid.js`
(tile data + tile-property queries, data-driven from `TILE_PROPS`),
`queries.js` (the spatial geometry below), `generation.js` (procedural
terrain, reading the per-biome `MAP_STYLES` table), `compounds.js` (base
layout + spawn helpers; the per-tier compound shapes are dispatched by the
`COMPOUND_STAMPERS` registry, with the square tiers sharing one
`stampSquareCompound`). One implementation per geometric question; nothing
re-implements them:

- `map.canStand(wx, wy, size)` — the four-corner passability box (movement,
  separation, structure pushing, base spawn).
- `map.hasLineOfSight(x1, y1, x2, y2, { skipOrigin, skipTarget })` — the
  LOS query (tanks, towers, squad members, the AI). `skipOrigin` keeps the
  tower-on-its-own-tile exception explicit; `skipTarget` lets a solid
  structure be *seen* (swarm discovery) without its own tile blocking.
- `map.hasWalkableLine(x1, y1, x2, y2)` — the AI's direct-waypoint check.

### 8. The component pattern (`squad.js`)

A squad is **one** `Tank` entity (the leader) that **owns** a `Squad` component
(`tank.squad`), created by the squad behaviour's `init` hook. The component
owns the soldiers, the dig-in
state machine, and the squad damage model; member positions are world-space
and authoritative (rendering, firing, hit tests, run-over all read them).

Prefer this composition over subclassing. When a vehicle needs behaviour that
isn't shared by all vehicles, a **component on the entity** (like `Squad`) is
the established precedent — not a new subclass and not a new `vehicleType`
switch.

### 9. Swarm AI, targeting, navigation, and recovery (`js/ai/`)

`AIController` (`ai.js`, ~205 lines) is the orchestration glue — the
`InputDevice` implementation, the per-life state, and the `think` loop —
over a package of focused helper modules.  There are **no roles**: each
faction owns one `Swarm` (`js/ai/swarm/`), and every bot reacts to its
colony's shared signals; cooperation emerges from simple local rules.

- `swarm/index.js` — the `Swarm` bundle per faction: pheromone `fields`,
  `intel`, the live `tuning` object (shared by reference with the Game,
  so sandbox sliders and sweep overrides apply immediately), the
  faction's human-driven leaders, and its `home` reference point.
- `swarm/fields.js` — `SignalFields`: one tile grid per signal type
  (`trail` / `alarm` / `food` / `visited`, declared in the `SIGNALS`
  table) with deposit / decay / diffusion / peak queries.  `tick(params)`
  reads decay+diffusion from live tuning each update.
- `swarm/intel.js` — `FactionIntel`: what the faction has *discovered*
  (sight range + LOS, checked by the swarm system — objectives are never
  omniscient).  Two views: `knownStructures()` (fog-of-war targetability)
  and `objectives()` (priority-sorted march targets; the dead drop out).
- `swarm/behaviours.js` — `chooseSwarmGoal`: candidate goals (rally /
  objective / trail / convoy / hunt / explore) each scored
  strength × the vehicle's `swarm` sensitivity block (`VEHICLES`);
  argmax wins so A* targets stay discrete.  `spacingOffset` is the
  general personal-space steering (applies to air units too).
  Per-vehicle identity (`attraction`, `follow`, `flank`, `keepRange`,
  `aggression`, `alarm`, `trail`, `explore`, `personalSpace`,
  `engageRange`) is data in `VEHICLES[type].swarm`; every numeric
  parameter is one line in `SWARM_TUNABLES` (`js/config/swarm.js`).
- `targeting.js` — `pickTarget(candidates, priorities, origin, opts)`: the
  shared weighted `weight / distance` scoring core (with range/LOS filters),
  used by `bestTarget(ai, me, enemies)` (over enemies + *discovered*
  structures) and by the watch-tower system (`js/systems/towers.js`).
  `targetPriorityOf(priorities, targetType)` resolves a shooter's weight
  via explicit override → `TARGET_TYPES` class default → 1, so a new
  target type is one `TARGET_TYPES` entry.
- `navigation.js` — `updatePath` (A* refresh), `pickWaypoint` (walkable
  skip-ahead), `steerToPoint` (turn-and-drive), `patrol`.
- `recovery.js` — `updateStuck` (position-history sampling), `handleStuck`
  / `evade` (escalation), `tryShootWall`.
- `aiming.js` — `steerTurretTo` (the shared turret-steering primitive),
  `aimTurretForward`, `updateWobble`.

`js/systems/swarm.js` runs before the think pass: it discovers
structures/objectives for each faction (a unit within SIGHT_RANGE with
LOS — with `skipTarget` so a solid structure's own tile doesn't hide it),
deposits the four signals from observable state (visited under every
unit, alarm under living victims, food on known objectives, trail under
units en route), and ticks decay/diffusion.  Key semantics: the alarm
dies with the victim (no rallying to a corpse); a dead objective's food
is erased on the spot; trail strength falls with distance travelled, so
shorter journeys lay stronger routes; a bot only leads a convoy while
moving or pursuing a goal (`convoyLeadable`), so parked bots can't hold
idle blobs; escorting a leader who marches on the objective
(`ESCORT_BONUS`) turns a trickle into a massed assault.

Behavioural invariants: the AI navigates with A* (`pathfinder.js`) and
follows waypoints (the swarm picks *goals*, the pathfinder routes to
them — this is what will let bots funnel through future choke points
like bridges); navigation and combat are **separated** (bots navigate
toward their goal and fire at enemies they pass).  The public seams the
vehicle behaviours call (`ai.steerTurretTo`, `ai.aimAndFire`,
`ai.tryShootWall`, `ai.holdPosition`, `ai.rng`) stay methods on the
controller; per-vehicle *think* lives in the behaviour's `aiThink`.
**A new signal type = one `SIGNALS` entry + its deposit/sense sites; a
new tunable = one `SWARM_TUNABLES` line; a new vehicle personality =
one `swarm` block in `VEHICLES`.**

Matches are deterministic: `Game` owns a seeded master stream
(`js/rng.js`) and per-bot derived streams, so `settings.seed` reproduces
a match bit-for-bit — the foundation of `tools/sim.js` (headless
metrics), `tools/sweep.js` (parameter optimization), `tools/adopt.js`
(guarded adoption), and `sandbox.html` (visual tuner).

### 10. Menu screens (`js/menu/`)

`Menu` (`menu.js`, ~70 lines) is the shell: the screen state machine and
`update`/`render` dispatch to the active screen strategy. Each screen in
`js/menu/` (`main-screen.js`, `lobby-screen.js`, `about-screen.js`) is a
plain `{ update(menu, input, audio), render(menu, ctx, canvas) }` object
that reads/writes the menu as context — the same strategy-context pattern
the modes use with `Game`. Shared drawing (`background.js`: grid, cursor
bar, vehicle preview) and vehicle info pages + declarative stat bars
(`vehicle-info.js`, whose `vehicleStats(type)` summary derives from `VEHICLES`
via `displayArmour` / `displayDmg` / `displayRoF`) stay independent of any
screen. The pure lobby state
(`lobby.js`) is untouched by rendering. **A new screen = one strategy
object + a `_screens` entry.**

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
- **Do the larger change.** A duplicated helper (e.g. line-of-sight or
  passability queries) is removed by extracting and unifying *all* call sites
  at once — not by adding a fourth copy.
- **Readability.** Keep functions small and single-responsibility, name them
  for what they do, and let the data table say what varies. If a class needs a
  diagram, split it (the map and render-vehicles god objects were split this
  way — see `docs/refactor_opportunities_2nd_round.md`).
- **Comments.** Explain *why*, never *what*. The codebase's own header blocks
  are good examples of *why*-style documentation; a line comment restating
  `this.hp -= amount` is not.

## Known structural debt (do not expand it)

All five refactor rounds are done; these are the current boundaries to keep,
not expand:

- `game.js` stays a thin orchestration shell — the per-frame passes live in
  `js/systems/` (`swarm`, `think`, `movement`, `update`, `firing`,
  `projectiles`, `collision`, `towers`, `respawn`, `effects`, `camera`,
  `win`).  New simulation logic is a system module, not a `Game` method.
- `renderer.js` stays a thin shell over `js/render/`; `js/render/vehicles.js`
  and `js/render/structures.js` stay thin barrels over `js/render/vehicles/`
  and `js/render/structures/` (sprites dispatched by the `SPRITES` /
  `STRUCTURE_SPRITES` registries). New drawing code goes in the right module —
  never back into a god object.
- `map.js` stays a thin facade over `js/map/` (`grid` / `queries` /
  `generation` / `compounds`). Tile semantics live in `TILE_PROPS` + `TILE_VISUALS`;
  the geometry API lives in `queries.js`.

Done — do not reintroduce: vehicle `vehicleType` dispatch (now the behaviour
strategies in `js/vehicles/`, including movement via `move` and think via
`aiThink`), the per-vehicle branches that used to live in `Tank.update()` /
`AIController` (now in the behaviours), duplicated line-of-sight / passability
queries (one `GameMap` geometry API), duplicated firing/blast loops (now
`spawnBullet` / `flashMuzzle` / `applyBlast`), the god-object shapes of
`ai.js` / `menu.js` / `config.js` / `renderer.js` / `render/vehicles.js` /
`map.js` / `game.js` (now thin shells over packages), dead code /
backward-compat shims, the `unitClass === "…"` / `if (squad)` special cases
(now independent `VEHICLES` capability flags), the structure subclasses
(`BaseWall`/`BaseHQ`/`BaseWatchTower` — now one `BaseStructure`), the tile /
structure / HUD / minimap `switch`/`vehicleType ===` dispatch (now
`TILE_VISUALS` / `STRUCTURE_SPRITES` / `hudGlyph` / `minimapShape`), the
bespoke particle emitters (now the `EFFECTS` table + `emit`), the duplicated
targeting loop in `updateWatchTowers` (now `pickTarget` + `targetPriorityOf`),
and `Bullet.sourceType` (now `Bullet.kind` + `js/projectiles/`).

Round five finished the seams the first four left half-open — do not
reintroduce: the split damage *application* (now one
`Game.applyDamage`/`destroyEntity` seam + a `GameEntity.onDestroyed` hook),
the tank-vs-structure iteration splits (now one `damageables`/`enemiesOf`
surface + a `GameEntity.hitTest` capability), the `if (this.squad)` hitbox
proxy cluster and the hardcoded subsystem booleans (now a `body` strategy +
`disabledSubsystems` Set + `SUBSYSTEM_EFFECTS`), the inline think/movement/
update/firing loops in `_update` (now `js/systems/`), the hardcoded structure
category (`entityType === "baseHQ"…` — now `category`/`isObjective` +
`structuresOf`), the depth-sort `switch`/tile `if/else`/HP-bar
duplication (now `DEPTH_DRAWERS`/`DRAW_KINDS`/
`healthColor`/`drawHealthBar`), the `if (gameType === "battle")` lobby
branching and `["skirmish","battle"]` literal (now `teamSet` +
`GAME_TYPE_ORDER` + `mode.hud`), the `grid._compoundTier` side-channel (now an
explicit `half` parameter), and the rematch audio double-subscribe (now an
idempotent `hookIntoGame` + `game.off`).
