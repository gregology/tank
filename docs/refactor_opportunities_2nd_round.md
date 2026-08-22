# Refactor Opportunities — Second Round

**Project:** Tank Battle (split-screen isometric tank game)
**Scope:** long-term extensibility, after the first round of refactoring
**Ordering:** most leverage first

---

## Diagnosis: round one relocated code, it did not re-shape the abstractions

The first round (see `docs/refactor_opportunities.md`, opportunities #1–#10)
succeeded at *decomposition*: the god objects were cut into packages
(`js/render/`, `js/ai/`, `js/menu/`, `js/config/`), a vehicle-behaviour
strategy table was introduced (`js/vehicles/`), a game-mode strategy was
introduced (`js/modes.js`), and the geometry queries were consolidated on
`GameMap`. That is genuinely useful.

But the round was largely **relocation, not re-abstraction**. The evidence is
in the line counts:

| Measure | Before (084f6b2) | After (HEAD) |
|---|---|---|
| `js/` total lines | 10,498 | **10,949** (+451) |
| `test/` total lines | 3,648 | **6,742** (+3,094) |

The four biggest files were split (`renderer.js` 3,061 → shell 65 + package,
`ai.js` 1,109 → 343 + package, `menu.js` 759 → 71 + package, `config.js`
563 → 19 + package), yet the codebase *grew*. Each relocated function picked
up a doc header, an import block, an export, and a dispatch hop — the cost
of moving code around — without the deeper simplification that would have
made the total *shrink*.

The underlying shapes survived, just spread across more files:

- **The `Tank` class is still one entity for five vehicles.** `Tank.update()`
  branches on `unitClass === "air"`, `isCharging` (SPG), `squadComponent`
  (dig-in), `turret === "fixed"`, and `trackDamaged`; the entity carries
  SPG-only state (`chargeTime`/`isCharging`) and squad-only state (`_squad`).
  Opportunity #3 moved *firing* into behaviours, but left *movement and state*
  in the entity — the behaviour `update(game, tank, dt)` hook is a no-op for
  four of the five vehicles.
- **`TILES` is still a type code.** `TILES` is a bare integer enum;
  `GameMap.isSolid` / `isPassable` / `blocksProjectile` / `tileHeight` /
  `setTile` each re-declare the tile-type semantics as `switch` / `if` chains.
  Adding a tile type is five edits in one file, not one table entry.
- **The strategies receive the whole mutable `Game`.** `modes.js` and
  `js/vehicles/*` reach into `game._allTanks`, `game._bases`, `game._scores`,
  `game._structureMap`, `game._humanTanks`, `game._nearestEnemy`, and mutate
  `game.bullets` / `game.particles` / `game.emit`. The "strategy" is a
  function in another file coupled to ~15 private fields of `Game`, not a
  boundary. (The strategy-context pattern is deliberate and fine for the
  small AI controllers; it is the wrong granularity for a 629-line `Game`.)
- **`squad` and `air` leak into every layer.** `game.js` special-cases squads
  in `applyHitToTank` and `_resolveCrushes`, and air in `pushFromStructures`;
  `tank.js` special-cases squads in `distanceToPoint` / `hitTest` /
  `hitRadius` / `hpFraction`. The `Squad` component is the right pattern, but
  it is bolted on with `if (this.squad)` rather than generalised into the
  capability model.
- **Targeting is implemented three times.** `ai/targeting.js#bestTarget`,
  `squad.js#pickSquadTarget`, and the inline loop in `game.updateWatchTowers`
  all independently re-derive "priority-weight / distance" target scoring plus
  LOS. `Bullet.sourceType` is a parallel type-code that routes arcing shells.
- **`render/vehicles.js` is now the largest file in the repo (1,168 lines)** —
  the render split left all five sprites plus the `if (vehicleType === …)`
  dispatch in one module, recreating the god object at one level down.

There are still 16 `vehicleType ===` sites, 4 `unitClass === "air"` sites,
14 `.squad` references in `game.js`+`tank.js` alone, and 25 `isCharging` /
`chargeTime` references. The type code was not removed; it was renamed
(`unitClass`, `turret`, `isCharging`, `sourceType`) and re-split.

The opportunities below change the *shape*, not the location. They are larger
than round one in places — that is the point. Each one is judged against the
root principle: *how would I add an N+1th of this?*

---

## 1. Complete the vehicle strategy — move movement and per-vehicle state out of `Tank`

**Status: ✅ implemented.**

**Evidence.** Opportunity #3 moved firing/aim/think into `js/vehicles/`, but
`Tank.update()` (js/tank.js:188–292) still encodes the movement model for
*all* five vehicles as one method with data-field branches: flying (`unitClass
=== "air"`, `_canFly`), SPG deployment (`isCharging`), squad dig-in
(`squadComponent`, `canMove`), fixed turret (`turret === "fixed"`), and track
damage. The entity also owns per-vehicle state that only one type ever uses:
`chargeTime`/`isCharging` (SPG), `_squad` (squad), `_canFly` (drone). The
behaviour hook that *should* own this — `update(game, tank, dt)` — is a no-op
for tank/ifv/drone/spg. Adding a sixth vehicle that moves differently (a
hovering gunship, a tunneller, a tracked howitzer that must deploy) means
adding more `if`s to `Tank.update()`, exactly the smell #3 claimed to remove.

**Re-abstraction.** Make `Tank` a generic vehicle shell — position, angle,
health/armour, team, a `vehicleType` key, and the shared timers — and move
per-vehicle movement and per-vehicle state into the behaviour strategy:

- Rename/repurpose the existing `update(game, tank, dt)` hook into the
  movement hook. `tank` gets the ground-vehicle movement (rotate / turret /
  drive / `canStand` slide); `drone` gets the fly-over-bounds movement;
  `spg` gets the charge-locked movement; `squad` delegates to the `Squad`
  component's dig-in lock.
- Move `chargeTime`/`isCharging` into the SPG behaviour's state (or a small
  `Charge` component on the tank), and `_canFly` into the drone behaviour.
- `Tank.update()` becomes a single `getVehicleBehaviour(type).update(...)`.
  The `turret === "fixed"` and `trackDamaged` branches either become data
  reads the movement hook performs, or capability getters (they already are:
  `fixedGun`, `trackDamaged`).

This is the *completion* of #3, not a new mechanism. The strategy seam already
exists; it just stops at the entity's front door.

**Extensibility payoff.** A new movement model (flight, hover, deploy/undeploy,
burrow) is one behaviour module — no edits to `Tank`, `game.js`, or the other
vehicles. The entity stops accumulating a field for every future vehicle.

- **Pros:** completes an abstraction the codebase already claims to have;
  deletes the `flying` / `isCharging` / `squadLocked` branch cluster; makes
  each vehicle's movement unit-testable in isolation like its firing already is.
- **Cons:** touches the hot path (`Tank.update` runs for every entity every
  frame); state migration (`chargeTime`, `_squad`, `_canFly`) must not change
  behaviour, so the existing `game.test.js` firing/respawn suites are the
  safety net.
- **Complexity:** High (design-sensitive, like #3).
- **Extensibility:** Very high — this is the canonical "add the N+1th vehicle".
- **Maintainability:** Very high — kills the last per-vehicle `if` cluster in
  the entity.
- **Elegance:** High — `Tank` becomes what its name promises: a tank, not a
  tank-drone-squad-SPG.

---

## 2. Make the tile system data-driven and split `GameMap`

**Status: ✅ implemented.**

**Evidence.** `TILES` (js/config/tiles.js) is a bare integer enum with no
semantics. The semantics are instead re-declared in `GameMap` as
`switch`/`if` chains: `isSolid` (js/map.js:77–86), `isPassable` (89–92),
`blocksProjectile` (101–111), `setTile`'s HP switch (54–70), and `tileHeight`
(317–334). Five methods must be edited to add a tile type. `GameMap` is also
still the largest logic module (1,141 lines) because it bundles four concerns:
the tile grid + damage (data), the geometry/spatial queries (`canStand` / LOS /
`hasWalkableLine` / `countCoverTiles` / `nearestBuilding` / `nearestPassable`),
the procedural generation (noise, villages, roads, buildings), and the base
compound stampers (`buildBaseCompounds` + three `_stampCompound*` + helpers).

**Re-abstraction.**

1. **Data-drive tile semantics.** Replace the integer enum with a `TILES`
   table of per-type *properties* — `{ passable, solid, blocksProjectile,
   height, hp, destructible }` — and make the query methods single reads
   (`this.tiles[i]`'s type → its property). Adding a tile type (a hedge, a
   crater, a minefield tile, a bridge) becomes one table entry; the queries,
   pathfinder, and renderer pick it up automatically.
2. **Split `GameMap` into a `js/map/` package**, with the public `GameMap`
   class as a thin facade preserving the geometry API (`canStand`,
   `hasLineOfSight`, `hasWalkableLine`) that `game.js`, `ai.js`, `squad.js`,
   and `formation.js` already depend on:
   - `grid.js` — the `Uint8Array` tile/hp storage, `getTile`/`setTile`/
     `damageTile`, and the tile-property queries.
   - `queries.js` — the spatial geometry (`canStand`, LOS, walkable-line,
     cover/neighbour searches).
   - `generation.js` — noise primitives + village/road/building placement.
   - `compounds.js` — `buildBaseCompounds` + the three stampers.
   - `map.js` (facade) — composes them, keeps `GameMap` as the single import.

**Extensibility payoff.** New terrain/biomes and new map features are isolated;
new spatial queries don't grow one class; a new tile type is a config change,
not five `switch` edits. This is the vehicle-strategy treatment (#3) applied to
tiles — the other big "type code" left in the codebase.

- **Pros:** removes the remaining `switch`/`if` tile chains; splits the
  current largest logic module; the query API is already well-tested
  (`map.test.js`), so the facade is a safe move.
- **Cons:** the tile table must be designed carefully so `isSolid` /
  `blocksProjectile` / `height` / HP all collapse to field reads without
  per-type special cases (height differs from a simple flag — a per-type
  numeric, not a boolean, covers it); the generation code is order-sensitive
  (village → road → building), so the split must preserve call order.
- **Complexity:** Medium (data table) + Medium (mechanical split).
- **Extensibility:** Very high for terrain; High for map features.
- **Maintainability:** High — one place per concern.
- **Elegance:** High — tiles stop being magic integers everywhere.

---

## 3. Give the strategies a real boundary — a `Game` world-model API

**Status: ✅ implemented.**

**Evidence.** The mode strategies (`js/modes.js`) and vehicle behaviours
(`js/vehicles/*`) are passed the whole `Game` and reach into its private
fields: `game._allTanks`, `game._bases`, `game._scores`, `game._structureMap`,
`game._humanTanks`, `game._nearestEnemy` (modes.js:72–73, 97, 103–104, 130–131,
137, 161–172, 176–189, 208, 212); `game.bullets`, `game.particles`, `game.emit`,
`game.applyHitToTank`, `game.damageTileAt`, `game.onStructureDestroyed`,
`game.map` (vehicles/*). A third game mode (capture-the-flag, king-of-the-hill)
or a sixth vehicle cannot be written without reading all of `game.js` and
touching `_`-prefixed internals. The `_` prefix is a naming convention, not an
enforced boundary — nothing stops a strategy from mutating anything.

**Re-abstraction.** Give `Game` a small, documented *world-model* surface and
have the strategies depend on that, not on the object's guts. Either:

- **A curated public API** on `Game` — `allTanks`, `tanksOf(team)`, `enemyOf
  (team)`, `bases`, `baseOf(team)`, `structures`, `setScore(faction, n)`,
  `spawnPointFor(tank)`, `emit(event, data)`, `damageStructure(s, amount)` —
  that replaces direct `_`-field reads, and hides the rest (fields truly
  private via `#` or a closure, or at minimum renamed so a linter/`depcruise`
  rule rejects `game._*` from outside `game.js`); **or**
- **An explicit context object** per strategy call (`{ map, tanks, bases,
  scores, spawnPointFor, emit, … }`), assembled once per frame/hook by
  `Game`, so a strategy only sees the operations it needs.

The first is less churn; the second is a stronger boundary. Either way, the
strategies stop being "functions that happen to live in another file" and
become implementable against a contract.

**Extensibility payoff.** A new mode/vehicle is written against a documented
interface; `Game`'s internals can change (rename `_bases`, swap the score
store, add a spatial index) without every strategy breaking. The N+1th author
reads the interface, not the whole class.

- **Pros:** turns the strategy pattern from cosmetic into real; makes the
  `_`-field coupling explicit and then removes it; enables the strategies to be
  tested with a fake context instead of a hand-built full `Game`.
- **Cons:** medium mechanical churn across `modes.js` and `js/vehicles/*`;
  risks over-abstracting the wrong seam if the API is made too fine-grained
  (per principle #1, spend the boundary where variation is real — it is, here).
- **Complexity:** Medium–high (design of the API surface).
- **Extensibility:** High — this is what makes #1 and a third mode pay off.
- **Maintainability:** High — `Game` internals become refactorable.
- **Elegance:** High — the strategies finally have a contract.

---

## 4. Generalise the entity/capability model so `squad` and `air` stop being special cases

**Status: ✅ implemented.**

**Evidence.** The `Squad` component (js/squad.js) is the right precedent, but
its special-ness is scattered as `if` checks instead of being expressed through
the capability getters that `entity.js` already defines:

- `game.js` `applyHitToTank` (line 390) multiplies damage `if (tank.squad …)`;
  `_resolveCrushes` (458–477) is a whole method that exists only because
  squads are crushable; `pushFromStructures` (481) skips `unitClass === "air"`.
- `tank.js` branches on `this.squad` in `distanceToPoint` (168), `hitRadius`
  (177), `hitTest` (181), `hpFraction` (131), `membersAlive` (137),
  `aliveMembers` (142), `dugIn` (125).
- `collision.js` and `viewport.js` read `unitClass === "air"` / `"infantry"`
  directly to decide separation and depth-sort.

**Re-abstraction.** Express "multi-body", "soft/crushable", and "flies" through
the capability model, so the *consumers* (`game.js`, `tank.js`, `collision.js`,
`viewport.js`) stop special-casing:

- Promote the distributed-hitbox behaviour to capabilities on the entity —
  `hitTest(x,y)`, `distanceToPoint(x,y)`, `hitRadius`, `hpFraction` — with the
  single-body implementation as the base (`GameEntity`/`Tank`) and the
  multi-body implementation living entirely in the `Squad` component, which
  `Tank` delegates to *unconditionally* rather than via `if (this.squad)`.
- Add data-driven capabilities for the interactions that are currently
  `unitClass` strings: `separationClass` / `canCrush` / `crushable` /
  `flyHeight` (or a `depthClass` for render), so `collision.js`,
  `pushFromStructures`, `_resolveCrushes`, and the depth-sort read a
  capability instead of comparing `unitClass` strings.
- The `_resolveCrushes` loop becomes a general "overlap interaction" pass that
  consults the capability (a crush interaction between a `crush`-capable unit
  and a `crushable` unit), not a squad-specific method.

**Extensibility payoff.** A new "soft" or "flying" unit (a flock of birds, a
hovering scout, a minefield-clearing roller) inherits the interaction rules by
setting capabilities — no new `if` in `game.js`, `tank.js`, `collision.js`, or
the renderer. The `Squad` component stops being the one hand-special-cased
component and becomes the reference implementation of the general pattern.

- **Pros:** removes ~14 `.squad` references and 4 `unitClass === "air"`
  references from the core; makes the component pattern actually general.
- **Cons:** capability design must be careful not to re-introduce a string
  enum under a new name; crush and separation have subtle team/class
  interactions (friendly vs enemy) that the capability must express without
  losing the current behaviour.
- **Complexity:** Medium–high.
- **Extensibility:** Very high — this is the seam for every future *kind* of
  entity, not just vehicle.
- **Maintainability:** High — one place defines "what kind of thing is this".
- **Elegance:** High — the entity hierarchy finally earns its `GameEntity`
  root.

---

## 5. Unify targeting/aiming/firing behind one "shooter" seam; retire `Bullet.sourceType`

**Status: ✅ implemented.**

**Evidence.** "Choose the best target by priority-weight / distance with LOS"
exists three times:

1. `js/ai/targeting.js#bestTarget` (tanks).
2. `js/squad.js#pickSquadTarget` (squad members — primary/fallback variant).
3. Inline in `game.js#updateWatchTowers` (587–603) — the tower re-derives the
   same weight/distance scoring and LOS loop by hand.

The tower's `targetPriority` already lives in `BASE_STRUCTURES.baseTower`
(js/config/structures.js:22), but no shared function consumes it. Separately,
`Bullet` carries `sourceType` (a vehicle-type string) plus an `arcing` flag
(js/bullet.js:52–57) so `game._tickBullets` can route a landing shell back to
the right behaviour's `onShellImpact` (js/game.js:412–414) — a parallel
type-code alongside the vehicle one.

**Re-abstraction.** One targeting/aiming/firing seam shared by every *shooter*
(tank, IFV, SPG, drone, squad member, watch tower — and future turrets):

- Extract `pickTarget(candidates, priorityTable, { los, range })` as the single
  weighted scoring function; `bestTarget` (AI) and `pickSquadTarget` (primary/
  fallback) and `updateWatchTowers` all call it. Squads keep their
  primary/fallback layer as a thin wrapper, but the scoring/LOS core is shared.
- Make watch towers first-class shooters: a tower holds the same
  `targetPriority` + `aim`/`fire` interface the vehicle behaviours use, so
  `updateWatchTowers` shrinks to "for each shooter, pick target + fire" with no
  bespoke loop.
- Replace `Bullet.sourceType` + `arcing` with a projectile *kind*: a shell
  carries a behaviour/strategy reference (or a small `Projectile` behaviour
  table like `js/vehicles/`) so impact handling is polymorphic, not a
  string switch.

**Extensibility payoff.** A new turret (missile, mortar, tesla) or a new
projectile (lobbed grenade, guided rocket, mine) is a `BASE_STRUCTURES`/
`VEHICLES` entry + a behaviour — targeting, LOS, and impact routing come free.
The watch tower stops being the one place the game re-implements AI by hand.

- **Pros:** deletes a real duplication (three targeting loops); removes the
  `sourceType` string dispatch; towers become testable like vehicles.
- **Cons:** the primary/fallback squad semantics must survive unification
  (that's the one genuine difference, and it is worth keeping as a wrapper);
  `Bullet` routing touches the hot bullet path.
- **Complexity:** Medium.
- **Extensibility:** High — the seam for all future combatants.
- **Maintainability:** High — "fix targeting once, fix it everywhere".
- **Elegance:** High — one combat vocabulary.

---

## 6. Decompose `render/vehicles.js` and register sprites like behaviours

**Status: ✅ implemented.**

**Evidence.** `js/render/vehicles.js` is now the **largest file in the repo
(1,168 lines)** — bigger than the `map.js` and `game.js` it was meant to
relieve. It holds all five sprites (`drawTank` 46, `drawSquad` 363, `drawIFV`
469, `drawSPG` 689, `drawDrone` 1,062) plus `drawSoldier`/`soldierWeapon` and a
`drawVehicle` dispatch that is the one remaining `if (vehicleType === …)` chain
(lines 21–33). The render split moved the god object down one level instead of
removing it. Two render-only type branches also remain: the SPG targeting
indicator (`viewport.js:74` checks `vehicleType === "spg"`) and the air
depth-bonus (`viewport.js:140` reads `unitClass === "air"`).

**Re-abstraction.** Mirror the `js/vehicles/` registry in the render layer:

- Split into `js/render/vehicles/` — one module per sprite (`tank.js`,
  `ifv.js`, `drone.js`, `spg.js`, `squad.js`) plus a shared `soldier.js` and
  an `index.js` exporting `drawVehicle` via a `SPRITES` table keyed by type.
- Replace the `if (vehicleType === …)` dispatch with the table lookup
  (`SPRITES[type] ?? drawTank`), exactly as `getVehicleBehaviour` does.
- Push the two remaining render type-branches into data: a `renderDepthClass`
  (or reuse a general capability from #4) and a `showTargetIndicator` /
  indicator hook so the viewport stops string-matching `"spg"`.

**Extensibility payoff.** Adding a vehicle becomes: `VEHICLES` entry +
`js/vehicles/` behaviour + `js/render/vehicles/` sprite — three isolated files
and two registry entries, no edits to a 1,168-line module or the viewport. The
render layer gets the same "new sprite = one module" property the logic layer
already has.

- **Pros:** removes the last explicit `vehicleType ===` dispatch; kills the
  biggest remaining file; sprites become independently tweakable.
- **Cons:** purely mechanical churn (the sprite functions are self-contained);
  the shared projection/`createDrawHelpers` context must be threaded through
  without changing the depth-sort contract.
- **Complexity:** Low–medium.
- **Extensibility:** High.
- **Maintainability:** High.
- **Elegance:** High — visual and logic layers mirror each other.

---

## Direction (the north star, not a standalone task)

The codebase is halfway from "fat entity + god orchestrator + strategies that
mutate everything" to **"data + components + systems"**:

- `Squad` is already a component; the vehicle behaviours are proto-systems.
- `config.js` already data-drives stats; the missing piece is data-driving
  *semantics* (tiles, capabilities, projectile kind, sprite kind).

Opportunities #1, #2, #4, and #5 are each a step along that vector: make the
*entities* data + capability getters, make the *variation* tables, and make the
*systems* the only place logic lives. They can be done independently and in any
order, but #1 (complete the vehicle strategy) and #3 (give strategies a real
boundary) have the highest leverage because they unlock the rest.

What **not** to do: a wholesale ECS rewrite is not warranted. The codebase is
~11k lines with a working component (Squad) and working strategy tables; the
payoff is in *finishing* those patterns consistently, not in replacing them
with a framework. Per root principle #3, refactor where there is real
duplication, a real type code, or a real god object — #1–#6 above are exactly
those, and nothing on this list needs a new dependency or a build step.

---

## Status: all six implemented

Status: **all six opportunities are ✅ done**, committed one per opportunity in
the suggested order (#1 → #3 → #2 → #4 → #5 → #6):

1. **#1** — movement + per-vehicle state moved out of `Tank.update()` into the
   behaviour strategies' `move` hook (tank/ifv ground, drone fly, SPG
   charge-lock, squad dig-in).
2. **#3** — mode strategies now use the public `Game` world-model API
   (`setBases`, `creditKill`, `nearestEnemy`, and the accessors) instead of
   `_`-prefixed fields.
3. **#2** — tile semantics data-driven via `TILE_PROPS`; `GameMap` split into
   the `js/map/` package (`grid` / `queries` / `generation` / `compounds`)
   behind a thin facade.
4. **#4** — squad/air handling generalised into entity capability getters
   (`flies` / `softTarget` / `crushable` / `canCrush` + `incomingDamageMultiplier`);
   `game.js`, `collision.js`, and the depth-sort read capabilities, not
   `unitClass`/`if (squad)`.
5. **#5** — the shared `pickTarget` weighted-targeting core replaces the
   duplicated `bestTarget`/`updateWatchTowers` loops; `Bullet.sourceType` is
   retired in favour of `Bullet.kind` + `js/projectiles.js`.
6. **#6** — `render/vehicles.js` (1,168 lines) split into `js/render/vehicles/`
   (one sprite module each) dispatched by the `SPRITES` registry; the render
   layer's `vehicleType === "spg"` checks became the `chargeable` capability.

The aggregate gate stayed green throughout: 487 tests / 0 failures, ~97% line /
~89% branch / ~94% funcs coverage, lint and dependency-cruiser clean. The
AGENTS guides were reconciled to the new architecture in the final commit.
