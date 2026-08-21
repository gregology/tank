# Refactor Opportunities Report

**Project:** Tank Battle (split-screen isometric tank game)
**Scope:** Long-term maintainability & extensibility refactor
**Ordering:** Most impactful first

---

## Executive summary

The codebase is cleanly modular at the *file* level (40+ small-to-medium ES modules,
good separation of `config` → `utils` → logic → `renderer`), but it has one very
large exception and several cross-cutting smells that will make every future
feature harder to ship safely:

1. **`js/renderer.js` was a 3,061-line "god object" with zero test coverage** — it
   drew tiles, buildings, five vehicle types, base structures, bullets, particles,
   two HUDs, a minimap, and a game-over screen, all through one class.
   **✅ Decomposed into the `js/render/` package (see #1); `renderer.js` is now a
   thin shell and the package has ~100% line coverage.**
2. **~4,600 lines (roughly a third of `js/`) had no tests at all.** The 92% coverage
   number was an illusion: the coverage gate never imported `renderer`, `menu`, `audio`,
   `particles`, `camera`, or `draw-helpers`, so they were excluded rather than measured.
   **✅ Fixed (see #2): every `js/` module is now imported by at least one test and the
   aggregate gate is ~96% line / ~88% branch / ~94% funcs.**
3. **Vehicle types are a "type code"**, not a type system. 46 hardcoded
   `vehicleType === "x"` checks are scattered across `game.js`, `tank.js`, `ai.js`,
   `renderer.js`, `squad.js`, `menu.js`, and `config.js`. Adding a vehicle today touches
   ~6 files.
   **✅ Fixed (see #3): vehicle behaviour is now a strategy table (`js/vehicles/`),
   dispatched by `getVehicleBehaviour(type)`; the ~46 logic checks are gone (the only
   remaining type dispatch is per-sprite drawing in `js/render/`).**
4. **Backwards-compat cruft and stale docs** remain (`_createBase()` dead code, a
   "backward-compat" field in `test/helpers.js`, `AGENTS.yaml` still describing
   "pvp/pvb/team" modes that no longer exist, a README vehicle table missing SPG/squad).

The opportunities below are ordered by how much long-term leverage they provide.
Opportunities 1 and 2 are explicitly the "larger refactors" the team asked for;
they are also each other's prerequisites, so they are intentionally listed together.

---

## Current state (baseline)

| Module | Lines | Direct test | Coverage line % |
|---|---|---|---|
| `render/` package (was `renderer.js`) | ~3,020 | ✓ `render.test.js` | ~100 (line) |
| `renderer.js` (shell) | 65 | ✓ (via render) | 100 |
| `ai.js` | 1,005 | ✓ `ai.test.js`, `roles.test.js` | 85.3 |
| `map.js` | 1,161 | ✓ `map.test.js` | 92.0 |
| `game.js` | 629 | ✓ `game.test.js` (Game suite) | ~100 |
| `menu.js` | 743 | ✓ `menu.test.js` | 98.8 |
| `config.js` | 615 | ✓ (indirect) | 100 |
| `tank.js` | 442 | ✓ (indirect) | 96.1 |
| `audio.js` | 412 | ✓ `audio.test.js` | 100 |
| `input.js` | 311 | ✓ `input.test.js` | 92.6 |
| `particles.js` | 289 | ✓ `particles.test.js` | 100 |
| `pathfinder.js` | 230 | ✓ `pathfinder.test.js` | 100 |
| `squad.js` | 226 | ✓ `squad.test.js` | 98.1 |
| `modes.js` | 245 | ✓ `modes.test.js` | ~100 |
| `vehicles/` package | ~420 | ✓ `vehicles.test.js` | ~95 (line) |
| `formation.js` | 149 | ✓ (via squad) | 84.6 |
| `lobby.js` | 144 | ✓ `lobby.test.js` | 99.3 |
| `bullet.js` | 107 | ✓ (via game) | 94.2 |
| `camera.js` | 23 | ✓ `camera.test.js` | 100 |
| rest (entity, utils, layout, factions, collision, draw-helpers) | < 200 each | ✓ | 98–100 |

- **455 tests, 0 failures**, all in Node's built-in runner.
- Coverage gate passes honestly at ~97% line / ~90% branch / ~94% funcs: every
  `js/` module is imported by at least one test (no silent exclusions).

---

## 1. Decompose `renderer.js` — the 3,061-line god object

**Status: ✅ implemented.** `renderer.js` is now a thin shell over a
`js/render/` package: `viewport.js` (two-pass depth sort, incl. the pure
`collectDepthItems`), `tiles.js`, `buildings.js`, `vehicles.js`,
`structures.js`, `effects.js`, `hud.js`, `minimap.js`, `overlay.js`, plus
shared `projection.js`, `canvas-utils.js`, and `damage.js`. The menu
prototype hack is gone (`menu.js` imports `drawVehicle` directly) and the
duplicated `_roundedRect`/colour helpers are unified in
`js/render/canvas-utils.js`. `test/render.test.js` covers the depth contract
and smoke-tests every draw entry point with a recording fake 2D context.
The bullets below describe the original problem; the approach is what was
built (modulo one change: smoke tests drive the package through hand-built
game fixtures so the coverage report stays scoped to the render layer).

**Impact: highest.** This is the largest module in the project, it is the single
biggest barrier to adding visual content, and it has no safety net.

`Renderer` currently owns every visual concern as private methods of one class:
tile rendering (`_drawTile`, `_diamond`, `_elevatedTile`, `_drawDamageOverlay`),
building rendering (`_drawBuilding`, `_drawGableRoof`, `_drawFlatRoof`, `_wallWindow`,
`_wallDoor`), five vehicle renderers (`_drawTank`, `_drawIFV`, `_drawSPG`, `_drawDrone`,
`_drawSquad`, plus `_drawSoldier` and `_soldierWeapon`), base structures
(`_drawBaseWall`, `_drawWatchTower`, `_drawBaseHQ`), bullets/particles, two HUDs,
the minimap, the game-over overlay, and the SPG targeting indicator. Each vehicle
renderer re-declares the same projection boilerplate (`ca/sa`, `HTW/HTH`, the `P`
and `PT` closures, the alive/flash guard, and local `parseHex`/`mix` helpers).

**Suggested approach (larger refactor, preferred):** split into a `js/render/`
package of focused modules, e.g. `tiles.js`, `buildings.js`, `vehicles.js` (or one
file per vehicle), `structures.js`, `effects.js` (bullets/particles), `hud.js`,
`minimap.js`, `overlay.js`, with a shared `canvas-utils.js` (see #6) and a shared
"sprite context" that provides the `P`/`PT` projection closures once.

- **Pros**
  - Each visual domain becomes independently readable and changeable (tweak a
    building → open `buildings.js`, not search a 3k-line file).
  - Enables per-module tests (see #2) and, later, isolated rework of one vehicle.
  - Removes the duplicated projection/color boilerplate repeated in every draw method.
- **Cons**
  - Large mechanical move; touches every render call site in `menu.js` (which calls
    `_drawVehicle` via the prototype hack, see #4).
  - Risk of subtle ordering regressions (the two-pass depth-sort contract must be
    preserved — see `AGENTS.yaml` rendering notes).
- **Complexity:** Medium–high. The logic is not algorithmically hard, but the sheer
  volume (3k lines) and the depth-sort invariant make it a careful, test-first move.
- **Extensibility:** Very high. A new tile/vehicle/building becomes a small, isolated
  addition in the right file.
- **Maintainability:** Very high. Eliminates the project's worst single point of churn.
- **Elegance:** High. Replaces one giant class with cohesive modules and removes
  large amounts of copy-paste.

---

## 2. Add test coverage for the untested modules (regression safety net)

**Status: ✅ implemented.** Every `js/` module is now imported by at least one
test. `test/game.test.js` gained a full Game suite (construction/faction
fill, event bus, update/restart, all five firing paths, win conditions,
respawn, bullet/terrain/structure collisions, artillery splash, crush
resolution, watch towers, LOS, cameras, labels) driven through the public
`Game` seam with zero-bot matches for determinism. New suites:
`test/menu.test.js` (all three screens, input orchestration, render smoke
with the recording context), `test/audio.test.js` (fake `window.AudioContext`
with recording nodes; every sound plus the full `hookIntoGame` event wiring),
`test/particles.test.js` (every emitter + lifecycle), `test/camera.test.js`.
`test/helpers.js` gained `fakeDevice({ held, pressed })`, a one-shot
InputDevice for driving human tanks and menus. The bullets below describe
the original problem; the approach is what was built.

**Impact: highest (prerequisite for everything else).** ~4,600 lines — `renderer`,
`menu`, `audio`, `particles`, `camera`, `draw-helpers` — are entirely outside the
coverage gate. Any refactor touching them (which is every opportunity on this list)
is currently blind. The team explicitly wants to avoid regressions during refactor;
that is impossible without this first.

**Suggested approach:** add a canvas shim / `node-canvas`-style fake 2D context for
renderer and menu smoke tests (assert calls happen, clipping/depth ordering holds,
no exceptions for each vehicle/tile/structure/HUD state), a Web Audio stub for
`AudioManager` wiring tests, and pure unit tests for `particles`/`draw-helpers`.
Then re-point `test:coverage` so those files are actually included in the report.

- **Pros**
  - Converts the refactor from "hope it still looks right" to "tests prove it".
  - Catches the visual regressions (flicker, occlusion, missing sprites) that are
    otherwise only found by playing the game.
  - Makes the coverage gate honest instead of silently excluding a third of the code.
- **Cons**
  - A minimal canvas fake is real work; pixel-accurate golden tests are brittle and
    best kept out of CI (use them for smoke/contract, not pixel-diff).
  - Browser-only APIs (`performance.now`, `requestAnimationFrame`, `AudioContext`)
    need stubs.
- **Complexity:** Medium. No new heavy deps needed — a hand-rolled recording 2D
  context is ~100 lines and matches the project's zero-dependency philosophy.
- **Extensibility:** Medium. Enables the rest, but doesn't itself add features.
- **Maintainability:** High. Future visual changes get immediate feedback.
- **Elegance:** Medium–high. A recording-context test harness is a clean, reusable seam.

---

## 3. Replace the vehicle "type code" with polymorphic behaviour

**Status: ✅ implemented.** Vehicle behaviour is now a strategy table in
`js/vehicles/` — one module per behaviour (`tank.js`, `ifv.js`, `drone.js`,
`spg.js`, `squad.js`, plus a shared `aoe.js`), dispatched by
`getVehicleBehaviour(type)` in `js/vehicles/index.js`. Each behaviour is a
plain object with five hooks: `fire(game, tank, device, dt)` (per-frame
firing/attack), `update(game, tank, dt)` (component update), `onShellImpact`
(arcing-shell landing), `aim(ai, me, target, map)` (AI turret-aim strategy),
and `aiThink(ai, dt, me, enemies, map, objective)` (AI think-level dispatch).
`game._handleFiring` and the AI's `_aimAndFire`/`think` are now one-line
dispatches. The remaining `vehicleType === "x"` sites in logic are gone:
`tank.js` reads data (`VEHICLES[].unitClass` / `.turret` / `.firesBullets`),
`collision.js` and the crush/push rules read `unitClass`
(`vehicle` / `infantry` / `air`), and `audio.js` reads `VEHICLES[].fireSound`.
The only remaining per-type dispatch is sprite drawing in `js/render/` (the
legitimate visual layer). New suites: `test/vehicles.test.js` (each behaviour
in isolation against a stub game) and the existing `game.test.js` firing
tests now drive the behaviours through `_handleFiring`. Adding a vehicle
today is one `VEHICLES` entry + one behaviour module (or a reused one).

**Impact: very high (the biggest *logic* refactor).** 46 `vehicleType === "x"`
branches are spread across `game.js` (`_handleFiring`, `_handleSPGFiring`,
`_handleDroneAttack`, `_handleSquadFiring`, `_handleArtilleryImpact`, `_resolveCrushes`),
`tank.js` (`update`, `applyHit`, `fixedGun`, `isShooter`), `ai.js` (`think`,
`_aimAndFire`), `renderer.js`, and `squad.js`. `config.js`'s `VEHICLES` table already
data-drives *stats* well; the missing piece is *behaviour*. Adding a vehicle currently
means editing ~6 files and remembering every switch.

Note: the project has a recorded decision that "tanks, IFVs, drones (and now SPG,
squad) share the `Tank` class". Respect that by using a **strategy/component** pattern
rather than subclassing: give each vehicle a "behaviour" (movement, firing, combat,
drawing) object — the codebase already demonstrates this pattern with the `Squad`
component (`tank.squad`).

**Suggested approach:** extract per-vehicle firing/attack behaviour out of `Game`
into behaviour modules (e.g. `js/vehicles/drone.js`, `spg.js`, `squad.js`, `tank.js`),
each exposing `fire(owner, device, dt, ctx)` / `applyHit` / `update` hooks, dispatched
from one small table keyed by `vehicleType`. Mirrors the existing `Squad` component
and the `targetPriority` data-driven style.

- **Pros**
  - New vehicles become one new module + one `VEHICLES` entry + one renderer, instead
    of six scattered edits.
  - `game.js` (1,065 lines) shrinks dramatically as SPG/drone/squad logic moves out.
  - Each vehicle's rules become unit-testable in isolation.
- **Cons**
  - Touches the hot path; requires careful regression testing (see #2).
  - Risk of over-engineering if the abstraction is forced too early; needs a crisp
    interface so unusual vehicles (drone flies, squad has N soldiers, SPG charges)
    don't leak special cases back into `Game`.
- **Complexity:** High. This is the most design-sensitive refactor on the list.
- **Extensibility:** Very high. Adding a vehicle type is the canonical "extend" case.
- **Maintainability:** Very high. Removes 46 scattered magic-string checks.
- **Elegance:** High. Turns "poor-man's polymorphism" into an explicit, cohesive strategy.

---

## 4. Extract a reusable vehicle-sprite module; remove the prototype hack

**Status: ✅ implemented (as part of #1).** `js/render/vehicles.js` exports
`drawVehicle(ctx, tankLike, sx, sy)`; both `Renderer` and `menu.js` import it —
the `Object.create(Renderer.prototype)` hack and the `_vehicleRenderer` state
are gone, and the menu preview is covered by `test/render.test.js`.

**Impact: high.** `menu.js` renders vehicle previews with:

```js
if (!this._vehicleRenderer) this._vehicleRenderer = Object.create(Renderer.prototype);
this._vehicleRenderer._drawVehicle(ctx, fakeTank, 0, 0);
```

This couples the menu to the renderer's *internal* method shape and to a hand-built
`fakeTank` object, and it silently depends on `_drawVehicle` never touching `this`-
state. It is exactly the kind of coupling that breaks during the renderer split (#1).

**Suggested approach:** extract the vehicle drawing methods into a standalone module
(e.g. `js/render/vehicles.js`) with a stable public entry point
`drawVehicle(ctx, tankLike, sx, sy)` that both `Renderer` and `Menu` import, replacing
the prototype hack with a real `import`.

- **Pros**
  - Removes a fragile, non-obvious coupling between menu and renderer.
  - Vehicle sprites become reusable in HUDs, tooltips, and future UI without fake objects.
- **Cons**
  - The fake-tank shape still needs a small contract (type, angle, colors, timers).
- **Complexity:** Low–medium. Mostly a move; rides on top of #1.
- **Extensibility:** High. Clean vehicle-sprite API for any screen.
- **Maintainability:** High. No more `Object.create(Renderer.prototype)`.
- **Elegance:** High. Real dependency instead of a prototype hack.

---

## 5. Consolidate duplicated geometry/queries (line-of-sight, passability)

**Status: ✅ implemented.** The shared geometry API lives on `GameMap`:
`map.canStand(wx, wy, size)` (the four-corner passability box — movement,
separation, structure pushing, and base spawn all use it now),
`map.hasLineOfSight(x1, y1, x2, y2, { skipOrigin })` (the one LOS query —
tanks, watch towers, squad members, and the AI share it; `skipOrigin` keeps
the tower-on-its-own-tile exception explicit), and
`map.hasWalkableLine(x1, y1, x2, y2)` (the AI's waypoint-skip check).
Deleted: `game._canStand`, `game._hasLineOfSight`, `tank._canOccupy`,
`ai._los`, `ai._walkable`, and the test helper's private reimplementation
(`simulateTeam` now calls `map.canStand`). The AI and Game now answer the
same geometric questions with one implementation.

**Impact: high.** The same few geometric questions are re-implemented in several places
with subtly different semantics — a classic source of hard-to-find bugs:

- "Can a vehicle stand at (x,y)?" — `tank._canOccupy` (uses `size * 0.85`),
  `game._canStand` (defaults to tank size), `map.getBaseSpawnPoint` (inline 4-corner
  check), and `test/helpers.js`'s `simulateTeam` (inline `canStand`). Four copies.
- "Is there line of sight?" — `game._hasLineOfSight` (skips the shooter's own tile)
  vs `ai._los` (does not) vs `ai._walkable` (passability sampling). Three copies with
  different boundary behaviour.

**Suggested approach:** promote these to methods on `GameMap` (or a `js/queries.js`
spatial module): `map.canStand(wx, wy, size)`, `map.hasLineOfSight(x1,y1,x2,y2, opts)`.
Make the AI reuse the same LOS as `Game` (or explicitly document the difference).

- **Pros**
  - One source of truth for collision geometry; fixing a corner case fixes all callers.
  - Removes the test helper's private reimplementation of game physics (tests then
    exercise the real code).
- **Cons**
  - Semantics differ subtly today (own-tile skipping, sample density); unifying them
    requires confirming which behaviour is correct for each caller.
- **Complexity:** Low–medium. Mechanical consolidation + a few behavioural decisions.
- **Extensibility:** High. New entities get correct collision/LOS for free.
- **Maintainability:** High. Kills a whole class of "I fixed it here but not there" bugs.
- **Elegance:** High. DRY with a single, well-tested geometry API.

---

## 6. Consolidate colour & canvas helpers

**Status: ✅ implemented (as part of #1).** All colour math lives in
`js/render/canvas-utils.js` (`rgb`, `hexToRgb`, `shadeHex`, `mixHex`,
`mixRgb`, `mixGrey`, `darken`, `scaleRgb`, `lerpPt`, `roundedRect`); the SPG
`parseHex`/`mix` closures and the three base-structure `darken` closures use
the shared helpers, and `menu.js` imports `roundedRect` instead of defining
its own.

**Impact: medium–high.** Colour math is duplicated in multiple places: `renderer.js`
defines `rgb`, `hexToRgb`, `shadeHex`, `mixHex`, `scaleRgb`, `lerpPt`; `_drawSPG`
re-defines `parseHex` + `mix`; `_drawBaseWall`/`_drawWatchTower`/`_drawBaseHQ` each
re-define a `darken` closure; and `_roundedRect` is defined verbatim in **both**
`renderer.js` and `menu.js`.

**Suggested approach:** a `js/canvas-utils.js` (or `js/color.js`) exporting `rgb`,
`hexToRgb`, `shadeHex`, `mixHex`, `scaleRgb`, `roundedRect`, and a `darken` helper.
Have `renderer.js`, `menu.js`, and the future `render/` package share it.

- **Pros**
  - Removes ~5 copies of the same hex→RGB→shade math.
  - Consistency of visual treatment (e.g. damage darkening) across all draw sites.
- **Cons**
  - Trivial refactor, but wide (many call sites); needs a mechanical sweep.
- **Complexity:** Low.
- **Extensibility:** Medium. New draw code imports helpers instead of re-deriving them.
- **Maintainability:** Medium–high. One place to fix colour handling.
- **Elegance:** High. Obvious DRY win.

---

## 7. Introduce a game-mode strategy (Skirmish vs Battle branching in `Game`)

**Status: ✅ implemented.** The mode branching now lives in `js/modes.js`:
a `skirmish` and a `battle` strategy object (dispatched by
`getMode(gameType)` in `Game`'s constructor) with hooks for every divergence
— `init` (battle: compounds + structure map), `spawn`, `setupBot`,
`aiObjective` / `enemyStructures`, `afterSeparation` / `afterBullets` (battle:
structure pushing + watch towers), `respawn`, `onKill` (skirmish: score +
reserved respawn), `checkWin`, and the HUD labels. `Game` no longer branches
on `typeDef.bases` anywhere; the shared simulation loop is mode-agnostic and
the mode hooks are unit-tested in isolation (`test/modes.test.js`). Adding a
third mode = one `GAME_TYPES` entry + one strategy object.

**Impact: medium–high.** `Game` branches on `this.typeDef.bases` throughout `_init`,
`_spawn`, `_update`, `_handleRespawns`, `_checkWin`, `factionLabel`, and `winnerLabel`.
The two modes (score race vs base objective) share most of the simulation but diverge
in spawn, win condition, and scoring. This is the same type-code smell as #3, applied
to game modes.

**Suggested approach:** a small `GameMode` strategy (or `mode` object with
`spawn`, `checkWin`, `onKill` hooks), leaving the shared simulation loop in `Game`.
`GAME_TYPES` in `config.js` already declares `win`, `teamSet`, `bases`, `vehicles`,
`options` — the runtime branching could be driven by that same declaration.

- **Pros**
  - Adding a third mode becomes a config entry + one strategy instead of more
    `if (def.bases)` sprinkles.
  - Win-condition and scoring rules become independently testable.
- **Cons**
  - Touches the core loop; needs the safety net from #2.
  - The two modes are not huge; the abstraction is only worth it if a third mode is
    plausible (the stale `AGENTS.yaml` "three modes" note suggests the team has
    oscillated here before).
- **Complexity:** Medium.
- **Extensibility:** High. This is the natural seam for new match rules.
- **Maintainability:** High. Removes base-vs-score branching from the hot loop.
- **Elegance:** Medium–high. A clean strategy, though lower reward than #3 if only two modes exist.

---

## 8. Split `ai.js` (1,109 lines): roles, targeting, navigation, stuck recovery

**Impact: medium–high.** `AIController` mixes five concerns: role strategies
(`_cavalryGoal`, `_sniperGoal`, `_defenderGoal`, `_scoutGoal`), position scoring
(`_findBestPosition`, `_computeFlankPoint`), drone behaviour, immobilised behaviour,
path following, turret aiming/firing (`_aimAndFire` with three vehicle sub-paths),
and stuck/evade recovery. Role dispatch is already a switch in `_chooseGoalAndTarget`
— a ready-made strategy seam.

**Suggested approach:** extract each role into a strategy object (mirroring how
`GAME_TYPES`/`VEHICLES` are data-driven), extract a `Targeting` helper and a
`Steering` helper, and keep `AIController` as the orchestration glue. Also unify the
AI's `_los` with the shared LOS from #5.

- **Pros**
  - AI roles become small, testable, independently-tunable units (the roles tests
    already exercise them — splitting makes that explicit).
  - New bot behaviours no longer inflate a 1,100-line class.
- **Cons**
  - AI is timing- and state-heavy; splitting must preserve `_path`, `_flankPoint`,
    `_sniperPos`, stuck timers, etc., across the boundary.
  - The `roles.test.js`/`ai.test.js` suites have a ~5% accepted flake rate; refactoring
    must keep the deterministic helpers front and centre.
- **Complexity:** Medium–high.
- **Extensibility:** High. New roles = new strategy + a `roleWeights` entry.
- **Maintainability:** High. Five concerns, five files.
- **Elegance:** High. The existing switch already hints at this design.

---

## 9. Split `menu.js` (759 lines) and `config.js` (563 lines)

**Impact: medium.** Two well-organised but oversized files:

- `menu.js` mixes input orchestration with rendering for three screens (main, lobby,
  about) plus a `_drawStatCompare` that re-derives display stats from `VEHICLES` with
  ad-hoc special-casing (squad, drone). Extract per-screen modules/classes and a
  shared `Menu` shell; derive the stat bars from a single declarative source.
- `config.js` is a deliberate dependency "leaf" (enforced by `dependency-cruiser`), so
  splitting it must keep that invariant. It holds `TILES`, `CONFIG`, `PLAYER_COLORS`,
  `ACTIONS`, `GAME_TYPES`, `GAME_OPTIONS`, `VEHICLES`, `SQUAD_MEMBERS`,
  `SQUAD_ATTENTION_ORDER`, `BASE_STRUCTURES` — natural thematic modules
  (`tiles.js`, `vehicles.js`, `options.js`), re-exported from a single `config.js`
  entry so the leaf rule and all existing imports stay intact.

- **Pros**
  - Screens become independent; adding a screen doesn't touch the others.
  - Config stays the single import point while each domain is editable in isolation.
- **Cons**
  - Mechanical churn across many imports; lower leverage than #1/#3.
  - `config.js` split adds a package unless a re-export barrel is used.
- **Complexity:** Low–medium.
- **Extensibility:** Medium–high.
- **Maintainability:** Medium–high.
- **Elegance:** Medium. Fine-grained modules, but must preserve the leaf boundary.

---

## 10. Remove dead code and stale docs (backward-compat debt)

**Impact: medium (explicitly requested).** The team asked that backwards compatibility
be treated as debt and removed. Concrete instances found:

- `js/map.js:_createBase()` — dead code, never called anywhere (superseded by
  `buildBaseCompounds` / `_stampCompound*`). Remove.
- `test/helpers.js:randomMap()` returns a `towers` field with a literal
  `// Backward-compat` comment; its consumers only use `map`/`layouts`. Remove the
  vestigial field and update the helper contract.
- `AGENTS.yaml` is stale: it still documents "three modes: pvp (split screen),
  pvb (human vs AI), and team (5v5)" and a "duel/team pattern" — the actual modes are
  `skirmish` / `battle`. The "To add a new game mode" recipe points at a `menu.modes`
  array that no longer exists (it's `GAME_TYPES` in `config.js` now).
- `README.md` vehicle mix is stale: it says "50% tank, 30% IFV, 20% drone" while
  `VEHICLES` now defines five types (tank/ifv/drone/spg/squad) with equal
  `spawnWeight: 3`, and the vehicle stat table has no SPG or squad rows.
- `js/utils.js` exports `screenToWorld` / `worldDirToScreen` that are unused by any
  production module (only `utils.test.js` round-trips them). Either wire them up or
  delete them.

**Suggested approach:** delete/trim dead code, then reconcile `AGENTS.yaml` and
`README.md` against the current implementation (modes = skirmish/battle; five
vehicle types; SPG/squad mechanics). Add a lightweight "docs drift" check if desired.

- **Pros**
  - Removes landmines: a future dev reading `AGENTS.yaml` today is actively misled.
  - Shrinks the surface area tests and refactors must cover.
- **Cons**
  - Low risk, but touching `AGENTS.yaml` affects the agent workflow; do it deliberately.
- **Complexity:** Low.
- **Extensibility:** Medium. Accurate docs make extension recipes actually work.
- **Maintainability:** Medium–high. Honest docs and no dead code.
- **Elegance:** Medium. Hygiene more than architecture.

---

## Suggested sequencing

Status: **#1 + #4 + #6 ✅ done** (renderer decomposition, sprite module,
canvas helpers), **#2 ✅ done** (test coverage for every previously-unmeasured
module), and **#3 + #5 + #7 ✅ done** (vehicle behaviour strategy,
consolidated geometry queries, game-mode strategy — the logic-layer
counterpart, now safely testable). The remaining plan:

1. **#10** (dead code + stale docs) — cheap, and removes misleading guidance
   before any further work.
2. **#8 + #9** (AI and menu/config splits) — the remaining module decomposition.

Each opportunity is independently valuable, but this order maximises safety
and keeps every large refactor under a growing test net.
