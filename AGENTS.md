# AGENTS.md — Tank Battle

Canonical guide for anyone (human or agent) working in this repository. It
describes **how we design abstractions, how we write code, and how we test**.
The per-directory guides (`js/AGENTS.md`, `test/AGENTS.md`) give the details;
this file gives the principles and the map.

## What this project is

A split-screen isometric pixel-art tank game. Vanilla JavaScript, ES modules,
**zero runtime dependencies**, no build step, HTML5 Canvas, served over HTTP
(not `file://`). Two game modes: **Skirmish** (score race, no bases) and
**Battle** (base objective with towers).

---

## Guiding principles

These are normative. Hold every change to them, in order of importance.

### 1. Design abstractions for future extensibility

Prefer a seam you can grow *through* — an interface, a data table, a strategy,
a component — over one more `if (type === "x")` branch.

- The project already leans data-driven: `VEHICLES`, `BASE_STRUCTURES`,
  `SQUAD_MEMBERS`, `GAME_TYPES`, `GAME_OPTIONS` in `js/config.js` are tables,
  not code. A new vehicle / role / mode / option should usually be a **new
  entry in a table** or a **new object behind an existing interface**, not a
  new `switch` arm.
- Before locking a shape, ask: *"How would I add an N+1th of this?"* If the
  honest answer is "touch six files", the abstraction is not extensible enough
  and should be refactored *now*, not worked around.
- New seams are an investment. Spend it where variation is real (vehicles,
  weapons, game modes), not where you merely *anticipate* variation.

### 2. Backwards compatibility is tech debt

Do not preserve an old shape "just in case". Dead code, legacy fields, and
`// Backward-compat` shims are liabilities, not assets.

- When an API changes, **migrate every call site** and delete the old path.
  Two live ways to do one thing is worse than a temporary broken window.
- Examples already removed (opportunity #10): `js/map.js#_createBase()`
  (dead code), the `randomMap().towers` backward-compat field in
  `test/helpers.js`, the unused `utils.js` projection helpers, and stale
  mode text in `AGENTS.yaml` / `README.md`. Keep new changes free of such
  shims.

### 3. Larger refactors beat quick fixes

A small patch that papers over a structural problem is *worse* than a larger
change that removes it. Do the bigger, cleaner thing even if it means
substantially more work.

- One clean refactor that removes a class of problem beats many one-line
  `if`s accumulated over time.
- Conversely, do not gold-plate: a refactor is justified when it removes real
  duplication, a real "type code", or a real god object — not to satisfy taste.

### 4. Tests must catch real bugs, not decorate the suite

A test has value only if a *realistic defect* would fail it. Tests that assert
trivia ("returns 0 for 0") or freeze implementation details without guarding
behaviour are vanity and should be removed or rewritten.

- Write tests around **behaviour and invariants** a refactor could break:
  movement rules, the damage model, pathfinding escape, faction-fill rules.
- Before writing a test, name the bug it would catch. If you can't, it isn't
  earning its place.
- See `test/AGENTS.md` for the full philosophy.

### 5. Prefer human-readable code over clever or "complete" objects

Functions and objects should be easy to read top-to-bottom and internalize.
If a reader needs a diagram to hold a class in their head, it is too complex.

- Favour small, single-responsibility units with obvious names over deeply
  nested, config-driven mega-objects.
- A flat, explicit function is often clearer than a "powerful" abstraction
  with many modes. Power is only worth it when it collapses genuine
  duplication, not when it merely relocates it.

### 6. Inline comments are a code smell

If you need a comment to explain *what* the code does, the code is not clear
enough. Rename, extract a function, or simplify — don't annotate.

- Comments are for **why** (a non-obvious decision, an invariant, an external
  constraint), never for *what*.
- A comment that restates the code is actively harmful: it doubles the reading
  surface and can rot out of sync. Use comments sparingly, and only when they
  add information the code itself cannot carry.

---

## Architecture at a glance

```
main.js      composition root: state machine (menu ↔ playing) + RAF loop
config.js    the data "leaf": barrel over js/config/ — every constant and
             data table lives in the js/config/ package
game.js      match simulation: tanks, bullets, bases, event bus — the shared
             loop; mode + vehicle behaviour are delegated to strategies
modes.js     game-mode strategy: Skirmish vs Battle hooks (spawn, win, scoring)
vehicles/    per-vehicle behaviour strategies (fire/move/update/aim/aiThink),
             one module per vehicle, dispatched from vehicleType
entity.js    entity hierarchy (GameEntity → Tank / BaseStructure)
tank.js      vehicle entity + data-driven damage model + hitbox capabilities
ai.js        bot brain: thin controller over the js/ai/ package
ai/          AI package: roles (ROLE_STRATEGIES), targeting (pickTarget),
             navigation (path/A*/steering), recovery (stuck/evade/blast),
             aiming (turret steering)
pathfinder.js  A* + wall-cost overlay
map.js       thin facade over js/map/: tile data + queries, spatial geometry,
             procedural generation, base-compound layout
map/         grid (data + tile-property queries), queries (geometry),
             generation (terrain), compounds (base layout + spawns)
renderer.js  thin shell: canvas, viewport layout, per-frame draw order
render/      render package: viewport (two-pass depth sort), tiles,
             buildings, vehicles/ (sprite registry), structures, effects,
             HUD, minimap, overlays — plus shared projection/colour helpers
menu.js      pre-game screens: thin shell over the js/menu/ screen strategies
menu/        menu package: per-screen strategies (main/lobby/about),
             background drawing + vehicle preview, vehicle info + stat bars,
             shared input helpers; builds the MatchConfig via lobby.js
input.js     InputDevice / Keyboard / Gamepad / InputManager
lobby.js     player/team joining state
audio.js     procedural Web Audio, subscribes to the game event bus
particles.js particle system
camera.js    per-player viewport follow
bullet.js    projectile entity (carries a `kind`: direct | shell)
projectiles.js  projectile landing behaviour (dispatched by bullet.kind)
collision.js vehicle separation (capability-based: flies / softTarget)
formation.js squad member formation steering
factions.js  pure "who fights whom" planner
layout.js    HUD layout helpers
utils.js     math/geometry helpers
draw-helpers.js canvas primitives
```

The dependency rule (enforced by `.dependency-cruiser.cjs`): `config.js` and
everything under `js/config/` are a **leaf** — they import nothing from the
rest of the game. Everything may import *the barrel*, and `utils.js` only
imports config. Keep it that way.

## The abstractions you must know

These are the load-bearing seams. New code should extend them, not route
around them. (Details live in `js/AGENTS.md`.)

- **Data-driven tables in `config.js`** — `TILES` + `TILE_PROPS` (per-tile
  semantics), `CONFIG`, `PLAYER_COLORS`, `ACTIONS`, `GAME_TYPES`,
  `GAME_OPTIONS`, `VEHICLES`, `SQUAD_MEMBERS`, `SQUAD_ATTENTION_ORDER`,
  `BASE_STRUCTURES`. Gameplay values that vary belong here, not hardcoded in
  logic files.
- **Entity hierarchy + capability getters** (`entity.js`) — `GameEntity` is the
  root; `Tank` and `BaseStructure` extend it. Capability getters
  (`targetable`, `collidable`, `mobile`, `isShooter`, `isVehicle`,
  `isStructure`, `size`, `flies`, `softTarget`, `crushable`, `canCrush`,
  `chargeable`, `incomingDamageMultiplier`) give targeting/collision/rendering
  one uniform interface regardless of concrete type.
- **`InputDevice` interface** (`input.js`) — `isDown` / `wasPressed` / `analog`
  / `endFrame` over the shared `ACTIONS` vocabulary. Humans (keyboard/gamepad)
  and the AI implement the *same* interface, so gameplay code never cares who
  is driving.
- **`Game` + event bus** (`game.js`) — a match is described by a `MatchConfig`
  and materialised by `Game`. Cross-cutting concerns (audio, UI) subscribe via
  `game.on(event, fn)`; `game.js` never imports audio. Uniform accessors
  (`allTanks`, `humanTanks`, `factions`, `cameras`, `bases`, `baseStructures`,
  `scores`) keep the renderer game-type-agnostic.
- **Vehicle behaviour strategy** (`js/vehicles/`) — `getVehicleBehaviour(type)`
  returns a strategy object (`fire` / `move` / `update` / `aim` / `aiThink`
  hooks). `Game` and `ai.js` never branch on `vehicleType`; `Tank.update()`
  delegates movement to `move`. Adding a vehicle is one `VEHICLES` entry + one
  behaviour module (or a reused one). Per-vehicle *traits* (`unitClass`,
  `turret`, `firesBullets`, `fireSound`, `muzzleFlash`) are data fields in
  `VEHICLES`, surfaced as capability getters. Arcing-shell landing is a
  projectile behaviour (`js/projectiles.js`), not a vehicle hook.
- **Game-mode strategy** (`modes.js`) — `getMode(gameType)` returns the
  Skirmish or Battle strategy (spawn, win condition, scoring, labels). The
  shared simulation loop stays in `Game`; a third mode is one `GAME_TYPES`
  entry + one strategy object.
- **Map + shared geometry API** (`map.js` → `js/map/`) — `GameMap` is a facade
  over `js/map/` (`grid` / `queries` / `generation` / `compounds`), with tile
  semantics data-driven from `TILE_PROPS`. `canStand`, `hasLineOfSight`, and
  `hasWalkableLine` are the one place movement, separation, spawning, LOS, and
  the AI answer the same geometric questions.
- **Component pattern** (`squad.js`) — a squad is *one* `Tank` entity that
  *owns* a `Squad` component (`tank.squad`) of individual soldiers. Prefer
  composition like this over subclass explosion; the entity's interaction
  capabilities (`flies` / `softTarget` / `crushable` / `canCrush`) express
  "what kind of thing is this" without type checks.
- **AI role strategies** (`js/ai/roles.js`) — each bot role (cavalry /
  sniper / defender / scout) is a plain strategy object with a
  `goal(ai, ctx)` hook, dispatched from `ai.role`; the AI helper modules
  (`js/ai/targeting.js`, `navigation.js`, `recovery.js`, `aiming.js`) are
  the seams for target selection, path steering, stuck recovery, and
  turret aiming. `AIController` is the orchestration glue only.
- **Pure planner** (`factions.js`) — "who fights whom" is computed by a pure
  function (`planFactions`) with no entities/input/rendering, so it unit-tests
  in isolation.

## Current hot spots

Both refactor rounds are done (`docs/refactor_opportunities.md` and
`docs/refactor_opportunities_2nd_round.md`). The boundaries to keep, in brief:

- The god objects are gone: `renderer.js`, `map.js`, `ai.js`, `menu.js`,
  `config.js`, and the render vehicle sprites are all thin shells over
  packages (`js/render/`, `js/map/`, `js/ai/`, `js/menu/`, `js/config/`,
  `js/render/vehicles/`). Put new code in the right module; never grow a
  shell back into a god object.
- Variation is data + strategies, not type codes: vehicle behaviour
  (`js/vehicles/`, incl. movement), tile semantics (`TILE_PROPS`), entity
  interaction capabilities (`flies` / `softTarget` / `crushable` /
  `canCrush` / `chargeable`), projectile landing (`Bullet.kind` +
  `js/projectiles.js`), and targeting (`pickTarget`). A new vehicle, tile,
  unit kind, projectile, or turret is a table entry / strategy / capability,
  not another `if (type === …)`.
- The strategies are written against the public `Game` world-model API
  (accessors + `setBases` / `creditKill` / `nearestEnemy`), never `_`-prefixed
  internals.
- Coverage is honest: every `js/` module (including each file under the
  packages) is imported by at least one test, and the aggregate gate sits at
  ~97% line / ~89% branch / ~94% funcs. Keep it that way — a new module that
  no test imports silently drops out of the report, so any new file needs a
  test suite too.

Treat these as the boundaries to maintain, and apply the principles above when
you touch them.

## Per-directory guides

- `js/AGENTS.md` — module map and the abstractions in detail, plus how the
  design principles apply to writing game code.
- `test/AGENTS.md` — testing philosophy, stack, and conventions.
