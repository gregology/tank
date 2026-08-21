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
- Examples already flagged for removal: `js/map.js#_createBase()` (dead),
  the `randomMap().towers` backward-compat field in `test/helpers.js`, and
  stale mode text in the older YAML files and `README.md`. These should be
  deleted, not maintained.

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
config.js    the data "leaf": every constant and data table lives here
game.js      match simulation: tanks, bullets, bases, win logic, event bus
entity.js    entity hierarchy (GameEntity → Tank / BaseStructure)
tank.js      vehicle entity + data-driven damage model (applyHit)
ai.js        bot brain; implements the same InputDevice interface as humans
pathfinder.js  A* + wall-cost overlay
map.js       map generation, passability, tile queries
renderer.js  thin shell: canvas, viewport layout, per-frame draw order
render/      render package: viewport (two-pass depth sort), tiles,
             buildings, vehicles, structures, effects, HUD, minimap,
             overlays — plus shared projection/colour helpers
input.js     InputDevice / Keyboard / Gamepad / InputManager
menu.js      pre-game screens; builds the MatchConfig
lobby.js     player/team joining state
audio.js     procedural Web Audio, subscribes to the game event bus
particles.js particle system
camera.js    per-player viewport follow
bullet.js    projectile entity
collision.js vehicle separation
formation.js squad member formation steering
factions.js  pure "who fights whom" planner
layout.js    HUD layout helpers
utils.js     math/geometry helpers
draw-helpers.js canvas primitives
```

The dependency rule (enforced by `.dependency-cruiser.cjs`): `config.js` is a
**leaf** — it imports nothing from the rest of the game. Everything may import
*it*, and `utils.js` only imports config. Keep it that way.

## The abstractions you must know

These are the load-bearing seams. New code should extend them, not route
around them. (Details live in `js/AGENTS.md`.)

- **Data-driven tables in `config.js`** — `TILES`, `CONFIG`, `PLAYER_COLORS`,
  `ACTIONS`, `GAME_TYPES`, `GAME_OPTIONS`, `VEHICLES`, `SQUAD_MEMBERS`,
  `SQUAD_ATTENTION_ORDER`, `BASE_STRUCTURES`. Gameplay values that vary belong
  here, not hardcoded in logic files.
- **Entity hierarchy + capability getters** (`entity.js`) — `GameEntity` is the
  root; `Tank` and `BaseStructure` extend it. Capability getters
  (`targetable`, `collidable`, `mobile`, `isShooter`, `isVehicle`,
  `isStructure`, `size`) give targeting/collision/rendering one uniform
  interface regardless of concrete type.
- **`InputDevice` interface** (`input.js`) — `isDown` / `wasPressed` / `analog`
  / `endFrame` over the shared `ACTIONS` vocabulary. Humans (keyboard/gamepad)
  and the AI implement the *same* interface, so gameplay code never cares who
  is driving.
- **`Game` + event bus** (`game.js`) — a match is described by a `MatchConfig`
  and materialised by `Game`. Cross-cutting concerns (audio, UI) subscribe via
  `game.on(event, fn)`; `game.js` never imports audio. Uniform accessors
  (`allTanks`, `humanTanks`, `factions`, `cameras`, `bases`, `baseStructures`,
  `scores`) keep the renderer game-type-agnostic.
- **Component pattern** (`squad.js`) — a squad is *one* `Tank` entity that
  *owns* a `Squad` component (`tank.squad`) of individual soldiers. Prefer
  composition like this over subclass explosion.
- **Pure planner** (`factions.js`) — "who fights whom" is computed by a pure
  function (`planFactions`) with no entities/input/rendering, so it unit-tests
  in isolation.

## Current hot spots

The refactor backlog is tracked in `docs/refactor_opportunities.md`. In brief,
the known structural debt is:

- The old `renderer.js` god object was split into the `js/render/` package
  (opportunity #1) — keep it that way: new drawing code goes into the right
  `js/render/` module, never back into `renderer.js`.
- Vehicle behaviour is dispatched by ~47 `vehicleType === "x"` checks across
  six files ("type code") rather than polymorphism/strategy — despite the
  vehicles sharing one `Tank` class.
- Duplicated helpers: line-of-sight and passability queries (the duplicated
  colour math and `_roundedRect` now live in `js/render/canvas-utils.js`).
- Coverage is now honest: every `js/` module is imported by at least one test
  (opportunity #2 done), and the aggregate gate sits at ~96% line / ~88%
  branch / ~94% funcs. Keep it that way — a new module that no test imports
  silently drops out of the report, so any new file needs a test suite too.

Treat these as the top of the queue, and apply the principles above when you
touch them.

## Per-directory guides

- `js/AGENTS.md` — module map and the abstractions in detail, plus how the
  design principles apply to writing game code.
- `test/AGENTS.md` — testing philosophy, stack, and conventions.
