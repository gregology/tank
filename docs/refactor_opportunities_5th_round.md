# Refactor Opportunities — Fifth Round

**Project:** Tank Battle (split-screen isometric tank game)
**Scope:** long-term extensibility, after the first four rounds of refactoring
**Ordering:** most leverage first

---

## Diagnosis: the *rules* and the *registries* are finished, but the *application* side of the combat seam, the *entity*'s last proxy cluster, and three *half-open* axes (mode, structure category, render dispatch) remain

The first four rounds (see `docs/refactor_opportunities.md`,
`docs/refactor_opportunities_2nd_round.md`,
`docs/refactor_opportunities_3rd_round.md`, and
`docs/refactor_opportunities_4th_round.md`) genuinely finished the **variation
axes** and the **registries**: vehicle behaviour, tile semantics + biomes,
interaction capabilities, the damage *rule chains* (`js/damage.js`), the
projectile *lifecycle* (`Bullet.kind` + `js/projectiles/`), targeting, sound,
particles, events, and the flat `Base.structures` list are all data tables +
strategy objects behind thin shells. That is real and it held: the gate is
green (479 tests, ~97.5% line / ~89% branch / ~93.7% funcs) and every `js/`
module is measured.

But reading the *shape* that survived — specifically the seams round four
opened and stopped at — reveals that four rounds finished the **decision
points** while leaving the **consequences of those decisions** split across
callers, and left three **axes** half-open. The still-big modules tell part of
the story:

| Module | Lines | What it still is |
|---|---|---|
| `js/map/compounds.js` | 498 | three hand-rolled compound stampers + placement policy (the largest logic file, unchanged from round four's diagnosis) |
| `js/game.js` | 479 | orchestration shell, but `_update` still inlines think/movement/firing and `applyHitToTank` owns the *tank-only* half of damage application |
| `js/tank.js` | 347 | the entity still carries the `if (this.squad)` proxy cluster and three hardcoded subsystem fields |
| `js/render/vehicles/spg.js` | 381 | a 380-line sprite (the largest render module) — the "one sprite per vehicle" split, but unexamined |
| `js/render/buildings.js` | 349 | the three-way `tile === BLDG_*` type code the render rounds deferred |

The deeper issues are seams that were **claimed done but only half-built**:

- **The damage seam finished the *rules* but not the *application*.** Round
  four's #2 unified the rule chains behind `resolveDamage`, but the "what
  happens after a hit" logic is still split four ways: `Game.applyHitToTank`
  (cover multiplier → zone → particles → `DESTROY`/`HIT` → `onKill`,
  `js/game.js:378-398`), `BaseStructure.applyDamage` + a caller-interpreted
  result string (`direct.js:41-43`, `aoe.js:39-44` each re-check
  `=== "destroyed"` and call `onStructureDestroyed`), and `resolveCrushes`
  re-implementing the destroyed side-effect (`js/systems/collision.js:89-94`).
  `applyBlast` still branches `if (e.isStructure)` (`js/vehicles/aoe.js:38`)
  to route between the two paths. A shield, a DoT, or a fourth shootable
  thing (crate, prop, neutral) still needs a new branch in the *application*,
  even though the *rules* are data.

- **There is still no single hittable/targetable surface.** `Game.damageables`
  exists (`js/game.js:104-107`) but is used only by `applyBlast`.
  `checkBulletHits` iterates `game.allTanks` only (`js/systems/projectiles.js:
  33`); direct bullets reach structures through the *terrain* path
  (`map.blocksProjectile` → `game.structureAt`, `direct.js:39`) rather than as
  entities; squad firing builds its own `[...allTanks, ...baseStructures]`
  candidate list (`js/vehicles/squad.js:71-74`); watch towers build `enemyTeam`
  from `allTanks` (`js/systems/towers.js:18`); and `bestTarget` concatenates
  `[...enemies, ...ai._enemyStructures]` (`js/ai/targeting.js:74`). That is
  four bespoke "enemy entities" iteration sites — a new shootable thing is
  added to four loops, not one.

- **The entity is still not a data shell.** Round four's #1 moved per-vehicle
  *state* into components, but the `if (this.squad)` proxy cluster the same
  round promised to generalise is still there: `dugIn`, `hpFraction`,
  `membersAlive`, `aliveMembers`, `crushable`, `incomingDamageMultiplier`,
  `distanceToPoint`, `hitRadius`, `hitTest`, `crushedMemberBy`, `crushMember`
  (`js/tank.js:144-246`). Separately, the three subsystem fields
  (`turretDisabled` / `leftTrackDisabled` / `rightTrackDisabled`) are
  hardcoded on `Tank` (`js/tank.js:71-75`) and mutated by `damage.js` via
  `sub.prop` + the one-off `sub.resetTurret` side effect (`js/damage.js:19-25`)
  — a "radio → vision loss" or "engine → speed cut" subsystem still needs a
  new `Tank` field *and* a new `if` in the damage model.

- **The simulation loop is a hybrid.** Round four's #6 extracted bullets/
  collision/towers/respawn/effects/camera/win, but `Game._update`
  (`js/game.js:276-336`) still inlines the AI-think, movement, per-vehicle
  `update`, and firing loops while everything else is a delegated system. The
  "thin ordered list" claim in `js/AGENTS.md` is only half true, and
  `game.js` is still 479 lines.

- **The structure category is still hardcoded.** Round four's #8 flattened
  `Base` to a `structures` list, but the *category* is implicit in the type
  string: `Base.hq/walls/towers` are filtered views hardcoding
  `entityType === "baseHQ"|"baseWall"|"baseTower"` (`js/entity.js:148-156`),
  `Base.alive/x/y` hardcode "the HQ is the living part" (`js/entity.js:161-170`),
  `finishLayout` hardcodes `{ type: "baseTower"|"baseWall"|"baseHQ" }`
  (`js/map/compounds.js:336-341`), and `battle.checkWin`/`hud`/`minimap` read
  `base.alive`/`base.hq`. A bunker/barracks/generator category is a new getter
  plus N edit sites, not a table entry.

- **The render/UI layer still has the deferred type-codes and duplicated
  formulas.** Round four's #10 explicitly deferred four items, and they are
  all still present: the depth-sort `switch (item.kind)` + magic offsets
  (`gx+gy+1`, `flies ? 2 : 0`, `js/render/viewport.js:97-188`); the tile
  draw-kind `if/else` on `visual.draw` (`js/render/tiles.js:27-55`); the
  building `tile === BLDG_*` ternaries whose `fullH 14/22/32` duplicates
  `TILE_PROPS.height` (`js/render/buildings.js:26-29,101-129`); the duplicated
  role vocabulary in `hud.js`/`minimap.js` (scout is "SCT" in one, "F" in the
  other); the copy-pasted HP-bar ramp (`#4a4`/`#da4`/`#d44`) across
  `tower.js`/`hq.js`/`hud.js`; and the blast falloff re-implemented in the HUD
  (`js/render/hud.js:144-159`).

- **The third game mode is still a six-file edit.** The `GAME_TYPES` keys and
  `getMode(gameType)` dispatch are clean, but the mode's *team-set*, *HUD*, and
  *labels* still leak: `lobby.js` branches `if (gameType === "battle")` for
  `cycleTeam`/`defaultTeam`/`setGameType` (`js/lobby.js:52-76,88`);
  `lobby-screen.js` hardcodes `["skirmish","battle"]` and a separate
  `GAME_TYPE_LABELS`/`DESC` table (`js/menu/lobby-screen.js:11-19,115`); and
  `renderer.js` branches `if (game.hasBases) drawBattleHUD else drawScoreHUD`
  (`js/renderer.js:57-58`). A capture-the-flag or king-of-the-hill mode touches
  all six, contradicting the "one `GAME_TYPES` entry + one strategy" promise.

- **The data leaf still leaks.** Round four's #7 promoted the terrain *palette*
  but not the procedural constants: `MIN_VILLAGE_DIST 14`, village attempt
  counts, building-size thresholds `0.45/0.8/0.6` (`js/map/generation.js:
  73-75,280-284`); compound tier thresholds `80/160`, tower/entrance angles
  (`js/map/compounds.js:38,218-245`); AI range/engage/patrol literals
  (`js/ai/roles.js` throughout); aim deadzone-adjacent thresholds and fire-delay
  ranges (`js/vehicles/tank.js:203,219`, `ifv.js:23,28`, `drone.js:52,71,77`).
  The destroyed-tile fallback hardcodes `T.GRASS` (`js/map/grid.js:109-111`,
  `compounds.js:424,454-456`) so a desert biome still grows grass when a tile
  breaks.

- **A few small but real boundary defects survived.** `main.js` re-calls
  `audio.hookIntoGame(game)` on rematch (`js/main.js:51`), but `Game.restart()`
  /`_init()` never clear `_listeners`, so audio double-subscribes on every
  rematch and every sound plays N times. `systems/towers.js:50` emits
  `sound: cfg.fireSound ?? "tower"` but there is no `"tower"` key in `SOUNDS`
  (a latent dead reference). `getBaseSpawnPoint` reads `grid._compoundTier`
  (`js/map/compounds.js:397`), a `_`-prefixed field set as a side effect by
  `buildBaseCompounds` (`js/map/compounds.js:38`) — hidden state on the grid
  that must be set before a different method reads it.

The opportunities below **finish** these seams. None needs a new dependency or
a build step; the established idioms (strategy objects, data tables,
components, registries, one-accessor surfaces, one-system-per-pass) are the
toolset, applied to the *application* side, the *entity*'s last proxy cluster,
and the three half-open axes the first four rounds left.

---

## 1. Finish the damage seam: one `receiveDamage` application path

**Status:** ✅ implemented.

**Evidence.** `resolveDamage` (`js/damage.js`) unified the *rules*, but the
*application* — cover multiplier, zone selection, the particle/event burst, and
the kill/destroy side-effects — is still split. `Game.applyHitToTank`
(`js/game.js:378-398`) is the tank-only path: it multiplies cover, computes the
zone, calls `tank.applyHit`, then emits `explosion`/`impact`/`tinyImpact` and
`DESTROY`/`HIT`, and calls `mode.onKill`. Structures have *no* equivalent: they
call `structure.applyDamage()` and the caller (`direct.onTerrain`,
`applyBlast`) re-checks `=== "destroyed"` and manually calls
`game.onStructureDestroyed` (`direct.js:41-43`, `aoe.js:39-44`). `applyBlast`
routes between the two with an `if (e.isStructure)` branch (`aoe.js:38`), and
`resolveCrushes` re-implements the destroyed side-effect a third time
(`js/systems/collision.js:89-94`).

**Re-abstraction.** Collapse the split into one application seam on the damage
layer (or the entity), e.g. `receiveDamage(source, zone, amount)` returning a
normalised `{ result, target }` — or, cleaner, have `resolveDamage` itself own
the *standard* side-effects through injected hooks. The move:

- Give every damageable a single entry point (`receiveDamage(source, zone,
  amount)` on `GameEntity`, or a `Game.applyDamageTo(entity, source, amount)`
  that dispatches through the entity's model and then applies the *shared*
  post-hit side-effects — explosion particle, `DESTROY`/`HIT` event, kill
  credit, structure-clearing).
- Delete `applyHitToTank`'s special position: the cover multiplier becomes part
  of the model (`incomingDamageMultiplier` already exists as a capability), the
  zone computation is armour-model-specific (already is), and the particle/event
  burst is the same three-way result → effect mapping for every damageable.
- Make `applyBlast`, `checkBulletHits`, `direct.onEntity`, and `resolveCrushes`
  all call the one path with no `isStructure` branch. Structure destruction
  (clear tiles → `terrain_changed`) becomes the structure model's "destroyed"
  side-effect, symmetric with `mode.onKill` for tanks.

**Extensibility payoff.** A shield (intercept before the model), a DoT (a model
that schedules follow-up damage), an EMP (a subsystem effect registered as
data), or a fourth shootable kind (crate, flag, neutral prop, generator) is a
model or a hook — no new branches in `Game`, `applyBlast`, the projectile
systems, or the crush system. Damage stops being a two-track railroad.

- **Pros:** removes the largest remaining split-brain in the combat core; makes
  "what happens when a thing takes damage" one place; the three damage models
  become symmetric (today only tanks get particles/events/credit through a
  dedicated method).
- **Cons:** touches the hottest path; behavioural equivalence (rear instant-kill,
  dig-in/cover multiplier, structure tile-clearing, skirmish score credit) must
  be preserved exactly — `game.test.js`/`vehicles.test.js`/`entity.test.js`
  are the guardrail.
- **Complexity:** Medium-large (the design-sensitive item this round).
- **Extensibility:** Very high — the seam for every future damage/status mechanic.
- **Maintainability:** Very high — "fix damage once, fix it everywhere" for real.
- **Elegance:** High — `resolveDamage` finally earns its name as the whole seam,
  not just the rule half.

---

## 2. Give the simulation one entity/target surface

**Status:** ✅ implemented.

**Evidence.** `Game.damageables` (`js/game.js:104-107`) is the intended single
surface, but only `applyBlast` uses it. `checkBulletHits` iterates
`game.allTanks` (`js/systems/projectiles.js:33`); direct bullets reach
structures via the terrain path (`map.blocksProjectile` → `structureAt`,
`direct.js:39`) rather than as entities — so a direct bullet can *not* hit a
shootable thing that isn't on a blocking tile. Squad firing builds its own
candidate list (`js/vehicles/squad.js:71-74`), watch towers build `enemyTeam`
from `allTanks` (`js/systems/towers.js:18`), and `bestTarget` concatenates
`[...enemies, ...ai._enemyStructures]` (`js/ai/targeting.js:74`). There is also
no "enemy entities of team X" accessor, so every consumer re-implements the
`e.alive && e.team !== team` filter.

**Re-abstraction.**

- Make `checkBulletHits` iterate the same surface `applyBlast` does
  (`game.damageables` or a narrower `game.hittables`), and let the projectile
  behaviour's `onEntity` apply to tanks *and* structures uniformly — retiring
  the "structures are damaged through `onTerrain`" detour (or keeping `onTerrain`
  only for the tile-under-the-bullet, never for the structure entity).
- Add a filtered accessor (e.g. `game.enemiesOf(team)` or
  `game.damageables.filter(...)` behind a named getter) and point squad firing,
  watch towers, and `bestTarget` at it, so "enemy targetable things" is one
  place and one filter.
- Decide the *surface* once: a `GameEntity`-capability (`targetable`) plus the
  one list, so a new shootable/targetable thing (crate, flag, neutral structure,
  prop) is added to one list, not four loops.

**Extensibility payoff.** A new shootable or targetable entity is one entity +
one capability + one list entry; the bullet/AoE/tower/squad/AI loops never edit.
Direct bullets and AoE finally treat structures as first-class entities.

- **Pros:** removes the tank-vs-structure loop duplication round four only half
  removed; fixes the asymmetry where a direct bullet hits a structure "through
  the floor" rather than "as a thing"; one filter instead of four.
- **Cons:** medium mechanical; the "structure is a blocking tile *and* an
  entity" overlap must be resolved so a bullet doesn't damage a structure twice
  (once as terrain, once as entity) — `game.test.js`/`render.test.js` pin this.
- **Complexity:** Medium.
- **Extensibility:** High — the seam for every future target and shootable.
- **Maintainability:** High — one surface, one filter.
- **Elegance:** High — completes round four's #3 "one hittable surface" promise.

---

## 3. Finish the entity/component boundary: a `body`/`hitbox` strategy and data-driven subsystems

**Status:** ✅ implemented.

**Evidence.** Round four's #1 claimed "`Tank` is a data shell", but two clusters
of per-type coupling remain. First, the squad proxy cluster: `dugIn`,
`hpFraction`, `membersAlive`, `aliveMembers`, `crushable`,
`incomingDamageMultiplier`, `distanceToPoint`, `hitRadius`, `hitTest`,
`crushedMemberBy`, `crushMember` all branch `if (this.squad)` / `this.squad?.`
(`js/tank.js:144-246`). Second, the subsystem fields: `turretDisabled` /
`leftTrackDisabled` / `rightTrackDisabled` are plain fields on `Tank`
(`js/tank.js:71-75`) that `damage.js` mutates by name via `sub.prop`, with a
one-off `sub.resetTurret` special case (`js/damage.js:19-25`). The "hitbox
strategy" and "data-driven subsystem" from round four's #1/#2 were named and not
built.

**Re-abstraction.**

- Generalise the distributed hitbox: give `Tank` a `body` (or `hitbox`) strategy
  — single-body by default, multi-body when a `Squad` component exists — and
  delegate `hitTest`/`distanceToPoint`/`hitRadius`/`hpFraction` to it
  *unconditionally*, so the `if (this.squad)` checks disappear rather than
  relocate. The capability getters that are squad-only (`membersAlive`,
  `aliveMembers`, `dugIn`, `crushedMemberBy`, `crushMember`) become part of the
  component's own surface, reached via a generic `component` lookup rather than
  a named `squad` field with null-checks.
- Make subsystems data-driven end-to-end: instead of `sub.prop` naming a
  hardcoded `Tank` field and `sub.resetTurret` a special side-effect, let the
  armour table declare an *effect* the model applies through a small, registered
  handler (e.g. `subsystems[zone] = { effect: "disableTurret" }` resolved by a
  `SUBSYSTEM_EFFECTS` table, or a `disable(subsystem)` method on the entity).
  The three boolean fields become a `disabledSubsystems` Set (or a subsystem
  component), and `trackDamaged`/`fixedGun` read it.

**Extensibility payoff.** A sixth vehicle with novel state (shield, fuel, ammo)
is one behaviour + one component; a fourth subsystem (engine → speed cut, radio →
vision loss) is a table row + a handler, with no new `Tank` field and no new
`if`. `Tank` finally means "a vehicle shell", not "tank-drone-squad-SPG-with-tracks".

- **Pros:** deletes the last `if (this.squad)` cluster and the last hardcoded
  subsystem fields; makes components the *general* home for per-vehicle state
  (round four's #1, actually finished).
- **Cons:** design-sensitive — the "delegate unconditionally" move touches every
  squad proxy and the damage model's side-effect together; `game.test.js`/
  `squad.test.js`/`vehicles.test.js` are the guardrail.
- **Complexity:** Medium-high.
- **Extensibility:** Very high — the canonical "add the N+1th vehicle/subsystem".
- **Maintainability:** Very high — the entity stops pretending a squad is a tank
  with extra fields.
- **Elegance:** High — completes the component pattern the codebase already
  claims as its precedent.

---

## 4. Finish the systems extraction: make `_update` a uniform ordered list

**Status:** ✅ implemented.

**Evidence.** Round four's #6 extracted the physics/win/respawn/camera passes,
but `Game._update` (`js/game.js:276-336`) still inlines four loops: the AI-think
loop (with mode `aiObjective`/`enemyStructures` resolution inline), the human +
bot movement loops, the per-vehicle `update` dispatch, and the human + bot
firing loops. The result is a hybrid: half the passes are `js/systems/` modules
called from thin wrapper methods, half are inline loops in the shell. The
`js/AGENTS.md` claim "each pass lives in `js/systems/`" is only half true.

**Re-abstraction.** Extract the remaining passes into `js/systems/` following the
existing `(game, …)` convention:

- `js/systems/think.js` — the AI-think loop (mode objective resolution + `ai.think`).
- `js/systems/movement.js` — human + bot `tank.update()` loops.
- `js/systems/update.js` — the per-vehicle behaviour `update` dispatch.
- `js/systems/firing.js` — the human + bot firing loops.

`Game._update` becomes a short, explicit, ordered list of system calls (bullets
→ think → movement → vehicle-update → separation → crush → firing → … → win),
so a new per-frame concern has one unambiguous home and the pass order is
visible in one place.

**Extensibility payoff.** `Game`'s internal loops become refactorable without
touching the shell; a new per-frame pass (visibility, healing, capture scoring)
is one module + one line. The "thin ordered list" documented boundary becomes
the boundary the code enforces.

- **Pros:** completes round four's #6 (the "optional" half); removes the last
  inline simulation loops from the shell; the pass order is pinned by
  `game.test.js`.
- **Cons:** mechanical and order-sensitive; the think loop's
  objective/enemyStructures plumbing is the one non-trivial extraction.
- **Complexity:** Low-medium.
- **Extensibility:** Medium-high — the seam for every future per-frame system.
- **Maintainability:** High — uniform systems, uniform shell.
- **Elegance:** High — completes round three's #1 for real.

---

## 5. Data-drive the structure category (and the base's "living part")

**Status:** ✅ implemented.

**Evidence.** Round four's #8 flattened `Base` to a `structures` list, but the
*category* is still implicit in the type string. `Base.hq/walls/towers` are
filtered views hardcoding `entityType === "baseHQ"|"baseWall"|"baseTower"`
(`js/entity.js:148-156`); `Base.alive/x/y` hardcode "the HQ is the living part"
(`js/entity.js:161-170`); `finishLayout` stamps hardcoded
`{ type: "baseTower"|"baseWall"|"baseHQ" }` entries (`js/map/compounds.js:
336-341`); and `battle.checkWin`/`hud`/`minimap` read `base.alive`/`base.hq`
(`modes.js:205-208`). Adding a bunker/barracks/generator category is a new
getter + new filtered-view branches + a new `checkWin`/HUD reach — not a table
row.

**Re-abstraction.**

- Add a `category` (or `role`) field to `BASE_STRUCTURES` (e.g.
  `{ category: "wall" | "tower" | "hq" | … }`) and derive `Base`'s filtered
  views generically (`structuresOf(category)` or a `byCategory` map), so
  `hq`/`walls`/`towers` become conveniences over one generic query.
- Data-drive "what makes the base alive / its objective target": a
  `BASE_STRUCTURES[].isObjective` (or a per-category `objective` flag) that
  `Base.alive`, `checkWin`, and the HUD read, instead of assuming the HQ is the
  objective. The compound layout (`finishLayout`) emits category-tagged
  structure specs, not type-string-tagged ones.

**Extensibility payoff.** A fourth structure category (bunker, barracks,
generator, anti-air) or a different objective structure (a "flag"/"core" that
isn't an HQ) is a `BASE_STRUCTURES` entry + a layout slot + a sprite — no edits
to `Base`, `modes.js`, the HUD, or the minimap.

- **Pros:** removes the last hardcoded 3-bucket taxonomy in the entity layer;
  makes the base objective a data field instead of an "HQ is special" assumption.
- **Cons:** medium and design-sensitive (the "objective" semantics must survive
  the battle win/HUD/spawn logic exactly); `entity.test.js`/`modes.test.js`/
  `map.test.js` pin it.
- **Complexity:** Medium.
- **Extensibility:** High for structures and base objectives.
- **Maintainability:** High — one structure model, one category query.
- **Elegance:** High — structures finish the vehicle treatment (categories like
  capabilities).

---

## 6. De-type the render/UI layer: depth sort, draw kinds, role vocabulary, and shared HUD/sprite primitives

**Status:** ✅ implemented.

**Evidence.** Round four's #10 explicitly deferred four items, all still present.
The depth contract is a `switch (item.kind)` with five hardcoded cases and magic
offsets (`gx+gy+1` for elevated tiles, `flies ? 2 : 0` for drones,
`js/render/viewport.js:97-188`). The tile draw-kind is an `if/else` on
`visual.draw` (`js/render/tiles.js:27-55`). Buildings carry a three-way
`tile === BLDG_SMALL|MEDIUM|LARGE` type code whose `fullH 14/22/32` duplicates
`TILE_PROPS.height` (`js/render/buildings.js:26-29,101-129`). The role
vocabulary is duplicated with an inconsistency (scout is "SCT" in
`hud.js:216`, "F" in `minimap.js:9`). The HP-bar ramp (`#4a4`/`#da4`/`#d44`) is
copy-pasted across `tower.js:83`, `hq.js:130`, and `hud.js:99`; the damaged-shade
`darken(...)/topCol/leftCol/rightCol` block is copy-pasted across the three
structure sprites; and the blast falloff is re-implemented in the HUD
(`hud.js:144-159`), diverging from `applyBlast`'s `hitRadius`-aware falloff.

**Re-abstraction.**

- Make depth a data field (`renderDepth` / `depthClass`) on the entity/tile and
  register the item-kind → draw-function mapping in a small table, so a new
  entity kind (an underpass at −1, a high flyer at +3) is a data value + a table
  row, not edits to both `collectDepthItems` and `drawDepthBuckets`.
- Collapse the tile draw-kind `if/else` into a `DRAW_KINDS` registry (like
  `STRUCTURE_SPRITES` already is), and drive the building palette/height/roof
  from `TILE_PROPS`/`TILE_VISUALS` (a `building: {height, style}` row) instead
  of `tile === BLDG_*`.
- Source the role glyph/label vocabulary from `AI_ROLES` (one table exported by
  `roles.js`, with per-role HUD/minimap glyphs as data) and share a single
  `drawHealthBar` / `drawDamagedShade` / `blastDamageAt(origin, target, radius)`
  primitive across HUD and structure sprites.

**Extensibility payoff.** A new vehicle/tile/entity-kind/structure/role shows up
correctly in the depth sort, HUD, minimap, and sprites via table entries; the
HP-bar/falloff/damage-shade formulas stop drifting between logic and render.

- **Pros:** finishes round three's #6 / round four's #10 (the deferred half);
  deletes the last copy-paste clusters and the role-vocabulary inconsistency.
- **Cons:** the depth-sort change is the design-sensitive piece (the two-pass
  flat-vs-elevated invariant is load-bearing, pinned by `render.test.js`); the
  sprite/HP-bar collapse must keep the visuals intact.
- **Complexity:** Medium (several small mechanical items + one design item).
- **Extensibility:** High — this is what makes every other new kind *visible*
  without touching the renderer.
- **Maintainability:** High — one table/primitive per concern.
- **Elegance:** High — the registry pattern is finally uniform across logic and
  render.

---

## 7. Make a third game mode one `GAME_TYPES` entry + one strategy — end to end

**Status:** ✅ implemented.

**Evidence.** The `getMode(gameType)` dispatch and the mode strategy's
spawn/win/scoring hooks are clean, but the mode's *team-set*, *HUD*, and *labels*
still leak out of `modes.js`. `lobby.js` branches `if (gameType === "battle")`
in `cycleTeam`/`defaultTeam` and toggles a hardcoded two-type list in
`setGameType` (`js/lobby.js:52-76,88`); `factions.js` re-derives the team rule
from `def.teamSet === "two"` (`js/factions.js:24`); `lobby-screen.js` hardcodes
`["skirmish","battle"]` and a parallel `GAME_TYPE_LABELS`/`DESC` table
(`js/menu/lobby-screen.js:11-19,115`); and `renderer.js` branches
`if (game.hasBases) drawBattleHUD else drawScoreHUD` (`js/renderer.js:57-58`).

**Re-abstraction.**

- Push the team-set rule and the HUD choice into the mode strategy (or its
  `GAME_TYPES` declaration): `GAME_TYPES[type].teamSet` already exists — have
  `lobby.js` read it instead of `if (gameType === "battle")`, and give the mode
  a `hud` hook (or a `hud: "battle"|"score"` key) so `renderer.js` dispatches
  `game.mode.drawHUD(...)` instead of branching on `hasBases`.
- Source the ordered game-type list and its labels from config (a `GAME_TYPE_ORDER`
  array + per-type `label`/`desc` in `GAME_TYPES`), and have `lobby-screen.js`
  iterate it instead of a hardcoded `["skirmish","battle"]`.

**Extensibility payoff.** A capture-the-flag / king-of-the-hill / assault mode is
one `GAME_TYPES` entry + one `MODES` strategy (with its own HUD hook and team
rule) — no edits to `lobby.js`, `factions.js`, `lobby-screen.js`, or
`renderer.js`. The "third mode" promise becomes literally true.

- **Pros:** removes the last game-type branching outside `modes.js`/config;
  makes the mode's UI surface (HUD, labels, team rule) part of the strategy.
- **Cons:** medium and order-sensitive — the lobby team-cycling and the HUD
  dispatch are the two non-trivial moves; `lobby.test.js`/`modes.test.js`/
  `render.test.js` pin them.
- **Complexity:** Medium.
- **Extensibility:** Very high — the axis every future game mode needs.
- **Maintainability:** High — one mode vocabulary, one dispatch.
- **Elegance:** High — completes round two's mode strategy for the UI layer.

---

## 8. Promote the remaining procedural/AI/combat tunables to the leaf (and make tile fallbacks biome-aware)

**Status:** ✅ implemented.

**Evidence.** Round four's #7 promoted the terrain *palette* (`MAP_STYLES`) but
not the procedural or AI constants, and round four's #10 promoted only `AIM_DEADZONE`
and the charge helpers. Still as literals: village spacing/density/attempt counts
and building-size thresholds (`MIN_VILLAGE_DIST 14`, `0.45/0.8/0.6`,
`js/map/generation.js:73-75,280-284`); compound tier thresholds/radii and
entrance/tower angles (`80/160`, `Math.PI/12`, `js/map/compounds.js:38,218-245`);
AI range/engage/patrol literals (`25`, `10`, `fireRange + 5`, `2`/`3`, `6`,
patrol angle `0.8 + rng*1.0`, `js/ai/roles.js` throughout); aim/fire-delay
thresholds (`0.3`/`0.4`, `0.25 + rng*0.35`, drone detonate `20`/`0.7`/`0.5`/
`0.3`, `js/vehicles/tank.js`/`ifv.js`/`drone.js`). The destroyed/cleared-tile
fallback hardcodes `T.GRASS`/`T.SAND` (`js/map/grid.js:109-111`,
`compounds.js:424,454-456`), so a desert biome still grows grass; squad weapons
hardcode their muzzle flash and tracer (`"ifvFlash"`, `tracer: true`,
`js/vehicles/squad.js:42,47`) instead of reading `SQUAD_MEMBERS[].muzzleFlash`.

**Re-abstraction.**

- Move per-style procedural constants into `MAP_STYLES` (village spacing, attempt
  counts, building-size thresholds) and per-biome fallback tiles (`destroyedTile`
  = the biome's grass/sand/dirt), so `damageTile`/`clearAroundBase`/`clearPath`
  read the style instead of hardcoding grass/sand.
- Promote the AI/combat tunables into `CONFIG` (role ranges/patrol cadence/engage
  distances) and `VEHICLES`/`SQUAD_MEMBERS` (aim thresholds, fire-delay ranges,
  drone detonate range, per-weapon muzzle flash + tracer), so tuning is a config
  change, not an edit inside a role/behaviour.
- Keep the noise *algorithm* internals (octave math, hash seeds) local, per the
  round-four #7 recommendation.

**Extensibility payoff.** A new biome (desert/snow/city) is a `MAP_STYLES` entry
that also owns its destroyed-tile fallback; a new role/weapon is tuned in config,
not in a strategy; the data leaf stops leaking into `generation.js`,
`compounds.js`, the roles, and the vehicle aim strategies.

- **Pros:** removes the worst remaining config-leaf offenders; fixes the
  grass-on-a-desert biome bug in passing; makes "feel" tuning a data change.
- **Cons:** wide but mechanical; the design judgement is which constants are
  per-style/per-vehicle data vs generator-internal (recommend: per-style and
  per-vehicle only).
- **Complexity:** Medium (mostly mechanical).
- **Extensibility:** High for biomes, roles, and weapons.
- **Maintainability:** High — one table, no more inline tunables.
- **Elegance:** High — map/AI/combat tuning gets the same treatment tiles got.

---

## 9. Close the boundary defects: event-bus restart, the dead sound key, and the `_compoundTier` side-channel

**Status:** ✅ implemented.

**Evidence.** Three small but real defects survive the boundary rounds:

1. **Event-bus double-subscribe on rematch.** `main.js` re-calls
   `audio.hookIntoGame(game)` on rematch (`js/main.js:51`, with a comment
   misdiagnosing it as "new ParticleSystem"), but `Game.restart()`/`_init()` never
   clear `this._listeners` (`js/game.js:159-167,173-183`). After N rematches the
   audio manager has subscribed N times, so every sound plays N times. The event
   bus has no `off`/unsubscribe and no listener reset on restart.
2. **Dead `"tower"` sound key.** `systems/towers.js:50` emits
   `sound: cfg.fireSound ?? "tower"`, but `SOUNDS` (`js/audio.js:28-169`) has no
   `"tower"` key — the fallback is a silent no-op (today masked because
   `BASE_STRUCTURES.baseTower.fireSound` is set to `"ifv"`).
3. **`grid._compoundTier` side-channel.** `getBaseSpawnPoint` reads
   `grid._compoundTier` (`js/map/compounds.js:397`), a `_`-prefixed field set as
   a side effect by `buildBaseCompounds` (`js/map/compounds.js:38`). It only
   works if the compounds were built first, and the layout already carries
   `half`/`size` — the tier is re-derived from hidden grid state instead of
   passed explicitly.

**Re-abstraction.**

- Give the event bus a `off(event, fn)` and clear (or rebuild) the listener map
  in `Game.restart()`; have `main.js` subscribe once (`hookIntoGame` is
  idempotent), removing the rematch re-subscribe.
- Remove the dead `?? "tower"` fallback (emit `cfg.fireSound` only, or add a
  real `tower` sound if one is wanted).
- Pass the compound tier/size explicitly: `getBaseSpawnPoint` should read the
  layout's `half`/`size` (or the `Base`'s stored `compoundSize`) rather than a
  hidden `_compoundTier` on the grid.

**Extensibility payoff.** The event bus becomes safe to re-enter (a future
observer can subscribe/unsubscribe without leaking); no silent sound no-ops; and
the map's public API no longer depends on hidden `_`-state ordering.

- **Pros:** fixes three real defects with minimal surface; removes the last
  `_`-field cross-boundary reach outside `game.js`.
- **Cons:** low risk; the restart-listener change must not drop the
  `terrain_changed` → pathfinder subscription that `Game` itself registers.
- **Complexity:** Low.
- **Extensibility:** Medium — the event bus finally has a clean lifecycle.
- **Maintainability:** High — no double-sounds, no dead keys, no hidden state.
- **Elegance:** High — closes the last `_`-leaks the earlier rounds missed.

---

## 10. De-duplicate the target/fire-target shape, the angle-diff helper, and the menu stat mirror

**Status:** ✅ implemented.

**Evidence.** Three residual duplication clusters remain:

1. **The target shape.** `bestTarget` returns `{ target, dist }`
   (`js/ai/targeting.js:72-75`), but every role and `thinkImmobilised`/`drone`
   manually re-wrap it into `{ x, y, dist }` (`roles.js` throughout,
   `vehicles/tank.js:133-139`, `vehicles/drone.js:48-54`). `fireTarget` is a
   second, slightly different shape from `pickTarget`'s `{ target, dist }`, so
   consumers convert by hand.
2. **The angle-diff normalisation.** The "wrap a difference to [−π, π]" loop is
   copy-pasted in `tank.aim`, `ifv.aim`, `spg.aim`, `drone.aiThink`, and
   `thinkImmobilised` (e.g. `js/vehicles/tank.js:196-213,145-150`), alongside the
   `Math.abs(diff) > THRESHOLD` "is it aimed" check.
3. **The menu stat mirror.** `VEHICLE_INFO[].stats` (`SPD/ARM/DMG/ROF/TUR`,
   `js/menu/vehicle-info.js:12-107`) is a hand-maintained copy of `VEHICLES` that
   drifts from `STAT_METRICS` (which derives the same values, `:113-126`) — two
   stat vocabularies rendered side-by-side in `about-screen.js`. Related,
   `VEHICLES.squad.bulletSpeed/bulletDamage/bulletCooldown: 0`
   (`js/config/vehicles.js:205-207`) are dead shape-keeping fields now that the
   menu reads `display*`.

**Re-abstraction.**

- Settle one target shape (`{ target, dist }`, with `x/y` read from `target`) and
  have roles/behaviours consume it directly, deleting the `{x, y, dist}`
  re-wrapping.
- Extract a shared `angleDiff(a, b)` (and a `isAimedWithin(diff, threshold)`)
  helper into `utils.js`, and use it in the five aim/navigation sites.
- Derive `VEHICLE_INFO[].stats` from `STAT_METRICS` (or directly from `VEHICLES`
  + a `turret` capability) instead of hand-copying, and delete the dead squad
  single-shot fields.

**Extensibility payoff.** A new target source, a new aim strategy, or a new
vehicle stat flows through one shape/helper/derivation instead of five hand
copies; the menu stops being a place where stats silently drift from gameplay.

- **Pros:** removes the last mechanical copy-paste clusters; deletes dead data;
  makes the AI/aim surface consistent.
- **Cons:** wide but trivial; the `fireTarget` shape change touches every role and
  the vehicle aim strategies together — `roles.test.js`/`vehicles.test.js`/
  `menu.test.js` pin it.
- **Complexity:** Low-medium.
- **Extensibility:** Medium — consistency makes future AI/menu work cheaper.
- **Maintainability:** High — one shape, one helper, one stat source.
- **Elegance:** High — the last "relocated duplication" is actually removed.

---

## Suggested sequencing

Status: **all ten opportunities are ✅ done**, committed one per opportunity in
the suggested order (#1 → #10), each leaving the aggregate gate green
(479 tests / 0 failures; ~97.5% line / ~89.4% branch / ~93.8% funcs; lint and
dependency-cruiser clean at 97 modules):

1. **#1 (damage application seam)** — `Game.applyDamage(entity, source, amount)` +
   `Game.destroyEntity(entity, source)` + a `GameEntity.onDestroyed(game, source)`
   hook; `applyBlast`/`direct.onEntity`/`direct.onTerrain`/`resolveCrushes` all call
   the one path with no `isStructure` branch. `applyHitToTank` deleted.
2. **#2 (one entity/target surface)** — `GameEntity.hitTest` default + `Game.enemiesOf(team)`;
   `checkBulletHits` iterates `game.damageables`; squad firing and watch towers use
   the one filtered accessor.
3. **#3 (entity/component boundary)** — `Tank` delegates hitbox/hp to a `body`
   (`singleBody` / `Squad`); `disabledSubsystems` Set + a `SUBSYSTEM_EFFECTS` table
   replace the three hardcoded boolean fields and `sub.prop`/`sub.resetTurret`.
4. **#4 (systems extraction)** — `js/systems/think.js`/`movement.js`/`update.js`/
   `firing.js`; `Game._update` is a thin ordered list.
5. **#5 (structure category)** — `BASE_STRUCTURES[].category`/`isObjective` +
   `Base.structuresOf(category)`; `hq`/`walls`/`towers` are data-driven views.
6. **#6 (render de-typing)** — depth-sort `DEPTH_DRAWERS` registry + named offsets;
   tile `DRAW_KINDS` registry; `ROLE_PRESENTATION` config; shared `healthColor`/
   `drawHealthBar` primitives.
7. **#7 (third game mode)** — `GAME_TYPES[].label`/`.desc` + `GAME_TYPE_ORDER`;
   lobby team rules read `teamSet`; the renderer dispatches the HUD via `mode.hud`.
8. **#8 (tunables to the leaf)** — `MAP_STYLES.island.destroyedTile` (biome-aware
   destroyed-tile fallback); squad-weapon `muzzleFlash`/`tracer` data;
   `CONFIG.OBJECTIVE_ENGAGE_RANGE`/`SNIPER_FIRE_MARGIN`.
9. **#9 (boundary defects)** — `Game.off` + idempotent `hookIntoGame` (no rematch
   double-subscribe); removed the dead `"tower"` sound key; `getBaseSpawnPoint`
   takes `half` explicitly (no `grid._compoundTier` side-channel).
10. **#10 (shape/helper de-dup)** — shared `angleDiff`/`normalizeAngleSigned` in
    `utils.js` used by all aim/navigation sites; deleted the dead squad
    single-shot fields.

#1 and #6 were the round's "larger refactors"; #2 and #3 were the design-sensitive
finishes; #4, #5, #7, #8, and #10 were medium mechanical; #9 fixed a live bug. No
new dependency or build step was introduced — the established seams (one
application path, one entity surface, data tables, registries, systems) were
applied to the places the first four rounds left half-open.

---

## Direction (the north star, not a standalone task)

The codebase is now most of the way from "data + components + systems (with a few
split-brain callers)" to **"data + components + systems, uniformly applied"**. This
round closed the last four half-open seams by *finishing* them, not re-shaping
them:

- The combat seam now *applies* damage once (`applyDamage`/`destroyEntity`) and
  *iterates* the world once (`damageables`/`enemiesOf`).
- The component pattern now *delegates* the hitbox/hp to a `body` and *data-drives*
  subsystems through a `disabledSubsystems` Set + effect table.
- The registries now extend to the *depth sort*, the *draw kinds*, the *structure
  category*, and the *game-type list*.
- The data leaf now data-drives the *biome destroyed-tile fallback*, the
  *squad-weapon flash/tracer*, and the *shared objective-engage / sniper-margin
  tunables*.

What **not** to do: a wholesale ECS rewrite is still not warranted. The codebase
is ~11.5k lines with working strategy tables, a working component, a clean data
leaf, and a green gate. The payoff was in *finishing* those patterns in the
application path, the entity, the structure category, the mode axis, and the
render dispatch — not in replacing them.
