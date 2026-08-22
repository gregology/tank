# Refactor Opportunities — Fourth Round

**Project:** Tank Battle (split-screen isometric tank game)
**Scope:** long-term extensibility, after the first three rounds of refactoring
**Ordering:** most leverage first

---

## Diagnosis: three rounds finished the *variation axes*, but the *entity*, the *data leaf*, and four *registries* are still half-open

The first three rounds (see `docs/refactor_opportunities.md`,
`docs/refactor_opportunities_2nd_round.md`, and
`docs/refactor_opportunities_3rd_round.md`) accomplished a great deal and it
held: the god objects were cut into packages behind thin shells, the vehicle
"type code" became a behaviour strategy table (`js/vehicles/`), tile logic and
visuals became `TILE_PROPS`/`TILE_VISUALS`, the interaction capabilities became
independent `VEHICLES` flags, the simulation loop was extracted into
`js/systems/`, a combat seam appeared (`js/shoot.js`, `js/projectiles/`,
`applyBlast`), structures/particles/HUD/minimap became data-driven, and the
strategy boundary was closed in the render layer. The aggregate gate is green
(492 tests, ~97% line / ~89% branch / ~94% funcs) and every `js/` module is
measured.

But reading the *shape* that survived reveals that three rounds finished the
**axes of variation** (vehicles, tiles, modes, structures, effects) while
leaving the **entity model**, the **data leaf**, and several **registries**
half-open. The four/five largest remaining modules tell part of the story:

| Module | Lines | What it still is |
|---|---|---|
| `js/map/compounds.js` | 492 | three hand-rolled compound stampers + placement policy + spawn math (one concern, but big) |
| `js/game.js` | 467 | orchestration shell, but `_update` still inlines think/movement/firing loops |
| `js/ai/roles.js` | 414 | four role strategies + shared position scoring in one file |
| `js/audio.js` | 412 | one hand-built synth graph per sound (the particle-before-round-3 pattern) |
| `js/tank.js` | 395 | the entity still owns per-vehicle state and the whole damage state machine |

The deeper issues are seams that were *claimed* done but stopped at the front
door:

- **The entity is still the fat object the rounds were supposed to remove.**
  Round two's #1 said "move per-vehicle state out of `Tank`", but the SPG's
  `chargeTime`/`isCharging` still live on `Tank` (`js/tank.js:84-86`) and are
  reset by hand in `kill()`/`respawnAt()` (`js/tank.js:369-386`); the behaviour
  strategies are stateless module objects that can only *read* `tank.*`, never
  *own* their vehicle's state. Round two's #4 said "delegate to the squad
  component unconditionally", but ~10 methods still branch `if (this.squad)`
  (`distanceToPoint`, `hitRadius`, `hitTest`, `hpFraction`, `membersAlive`,
  `aliveMembers`, `crushMember`, `crushedMemberBy`, `dugIn`,
  `incomingDamageMultiplier` — `js/tank.js:129-225`). The component pattern
  exists (Squad) but is bolted on with null-checks, not generalised.

- **The damage *rules* are code, not data, and are split across four files.**
  Durability *numbers* are data (`VEHICLES[].armour`), but the rule chain —
  rear instant-kill, subsystem knock-out, member-death-per-whole-point, HP
  decrement — is hardcoded in `Tank.applyHit` (`js/tank.js:307-344`),
  `Squad.applyDamage` (`js/squad.js:151-163`), `BaseStructure.applyDamage`
  (`js/entity.js:110-119`), and the caller-side orchestration
  `Game.applyHitToTank` (`js/game.js:367-387`). `SUBSYSTEM_PROPS`
  (`js/tank.js:54-58`) hardcodes the key→property map, and `_applySubsystem`
  hardcodes the turret side-effect (`js/tank.js:350-363`). A shield, a DoT, an
  EMP, or a fourth subsystem (engine/radio) cannot be a config change.

- **The projectile seam is half-open.** The `kind`-dispatched lifecycle is real
  (`js/projectiles/`), but a bullet's `kind` is *derived* from a boolean
  (`js/bullet.js:58` `this.kind = arcing ? "shell" : "direct"`), so
  `spawnBullet` (`js/shoot.js:30-55`) cannot express a third kind — the "one
  module + a `kind`" promise is unreachable. `Bullet` is not a `GameEntity`
  (`js/bullet.js:15`), and `checkBulletHits` iterates only `game.allTanks`
  (`js/systems/projectiles.js:28-42`) while `applyBlast` maintains a separate
  structure loop (`js/vehicles/aoe.js`) — there is no single
  hittable/damageable surface. In the renderer, a bullet's visual is inferred
  from `bullet.damage < 1.0` (`js/render/effects.js:15`), which misclassifies
  the tower's 0.1 and the squad's 0.12/0.1/0.3 shots as "IFV tracer".

- **The data leaf is leaky.** Gameplay-relevant procedural constants (noise
  thresholds, band widths, compound sizes, village spacing, building counts)
  are literals in `js/map/generation.js` and `js/map/compounds.js`, not in
  `js/config/`. Audio frequencies/gains/durations are all literals
  (`js/audio.js`). AI range/engage/patrol tunables are literals
  (`js/ai/roles.js:74,245,271`, the aim deadzone `0.08` is duplicated across
  four behaviour files). Dead config (`SCOUT_FLANK_OFFSET`/`SNIPER_FLANK_OFFSET`
  in `js/config/constants.js:44-45`) is never read.

- **Several "one table entry" promises still require N file edits.**
  - The **structure taxonomy** is hardcoded in three places: `BASE_STRUCTURES`
    keys, the `Base` container's `hq`/`walls`/`towers` fields +
    `allStructures` (`js/entity.js:126-156`), and `buildBase`'s three
    hand-`new`ed types (`js/modes.js:36-66`) plus the stampers' fixed
    `{walls, towers, hqTiles}` layout schema (`js/map/compounds.js`).
  - The **game-type list** is enumerated literally in three places: the
    two-way toggle (`js/lobby.js:88`), the render loop
    (`js/menu/lobby-screen.js:115`), and the label/desc table
    (`js/menu/lobby-screen.js:11-19`) — even though `modes.js` already
    dispatches cleanly via `getMode(gameType)`.
  - **Squad targeting** uses a parallel vocabulary (`SQUAD_MEMBERS[].primary
    /fallbackTargets` flat name lists + `pickSquadTarget`) that ignores
    `TARGET_TYPES`/`TARGET_CLASS_DEFAULTS`/`targetPriorityOf`, so an N+1th
    target type is a `TARGET_TYPES` entry *plus* N `SQUAD_MEMBERS` edits.
  - **Muzzle flash** routes through a 3-arm `if/else` on an intermediate name
    (`js/shoot.js:16-20`) rather than storing the `EFFECTS` key directly.

- **The strategy/system boundary is still porous in three spots.**
  `js/systems/respawn.js:26` reads `game._bots`; `js/projectiles/direct.js:37`
  calls the private `game._getStructureAt`; `js/game.js:417-419`
  `_invalidatePathfinders` reaches `ai._pf?.invalidate()`. These are exactly
  the `_`-field couplings the rounds removed elsewhere.

- **The render layer still has residual type codes and duplicated formulas.**
  The depth-sort contract is magic offsets (`gx+gy+1`, `flies ? 2 : 0`) plus a
  `switch (item.kind)` and a hardcoded bucket order
  (`js/render/viewport.js:97-188`). The charge-range formula is duplicated
  four times (viewport, HUD, `spg.js`, render SPG) and the blast falloff is
  re-implemented in the HUD. The HUD/minimap role vocab is a second,
  slightly-inconsistent copy of the AI role names. Menu stat bars
  (`js/menu/vehicle-info.js`) still `type === "squad"|"tank"` special-case.

The opportunities below *finish* these seams. None needs a new dependency or a
build step; the established idioms (thin-shell-over-package, data tables,
strategy objects, registries, components, events) are the toolset, applied to
the places the first three rounds left half-done.

---

## 1. Complete the entity/component boundary — make `Tank` a data shell

**Status:** open.

**Evidence.** Round two's #1 claimed to move per-vehicle state out of `Tank`,
but it did not: `chargeTime`/`isCharging` (SPG-only, `js/tank.js:84-86`) and
`_squad` (squad-only, `js/tank.js:88-89`) are plain fields, threaded through
`kill()` (`js/tank.js:369-372`) and `respawnAt()` (`js/tank.js:380-386`). The
behaviour strategies (`js/vehicles/*`) are stateless module objects, so the
SPG's charge state is declared on the entity and mutated by the behaviour
(`js/vehicles/spg.js:23-31,49-56`). Separately, ~10 squad-proxy methods on
`Tank` branch `if (this.squad)` / `this.squad?` (`js/tank.js:129-225`) — the
"delegate unconditionally" refactor round two's #4 promised but stopped short
of.

**Re-abstraction.** Give behaviours a lifecycle for per-instance state, and let
`Tank` delegate its hitbox unconditionally:

- Add optional `init(tank)` / `reset(tank)` hooks to the behaviour strategy
  object. `spg.init` attaches a small `Charge` component (chargeTime/isCharging
  + its clamp math); `squad.init` attaches the existing `Squad` component;
  others no-op. `Tank.kill()`/`respawnAt()` call
  `getVehicleBehaviour(type).reset(tank)` instead of hand-clearing
  `chargeTime`/`_squad`.
- Keep only truly-universal state on `Tank` (position, angle, turret, team,
  hp/damageAccum, cooldowns, flash/recoil timers).
- Generalise the distributed hitbox: `Tank` delegates `hitTest`/`distanceToPoint`
  /`hitRadius`/`hpFraction` to a `hitbox` strategy (single-body by default,
  multi-body when a `Squad` component exists) so the `if (this.squad)` checks
  disappear rather than relocate.

This is the *completion* of round two's #1 and #4, not a new mechanism. `Squad`
is already the reference component; the move is to let behaviours/components
own their state and to make the delegation unconditional.

**Extensibility payoff.** A sixth vehicle with novel state (shield, fuel, ammo,
a teleport cooldown, a deploy/undeploy phase) is one behaviour module + one
component — no edits to `Tank`, `game.js`, or the other vehicles. A new
multi-body or soft entity inherits the hitbox strategy rather than a new
`if (this.squad)`.

- **Pros:** deletes the SPG/squad special-casing the rounds kept deferring;
  makes each behaviour's state unit-testable in isolation like its firing
  already is; `Tank` finally means "a vehicle shell", not "tank-drone-squad-SPG".
- **Cons:** touches construction, death, and respawn — the two behaviours with
  state (spg, squad) must migrate together with no partial state; the existing
  `game.test.js` firing/respawn suites are the guardrail.
- **Complexity:** Medium-high (design-sensitive).
- **Extensibility:** Very high — the canonical "add the N+1th vehicle".
- **Maintainability:** Very high — kills the last per-vehicle state and
  squad-branch cluster in the entity.
- **Elegance:** High — the component pattern already exists; this finishes it.

---

## 2. Extract the damage model into a `damageModel` seam with data-driven subsystems

**Status:** open.

**Evidence.** Durability numbers are data, but the damage *rules* are code split
across four files: `Tank.applyHit`'s rule chain (rear instant-kill →
already-damaged kill → accumulate → hp threshold → subsystem trigger →
rear-at-threshold kill, `js/tank.js:307-344`); `Squad.applyDamage`
("1 whole point kills the next member", `js/squad.js:151-163`);
`BaseStructure.applyDamage` (hp decrement, `js/entity.js:110-119`); and the
caller-side `Game.applyHitToTank` (multiplier → zone → result-string →
particle/event branch, `js/game.js:367-387`). `SUBSYSTEM_PROPS`
(`js/tank.js:54-58`) and the turret side-effect (`js/tank.js:350-363`) are
hardcoded. `applyBlast` (`js/vehicles/aoe.js`) keeps a separate tank loop and
structure loop with subtly different falloff (`hitRadius` vs `size`).

**Re-abstraction.** One small damage seam in the established data/strategy
idiom — not an ECS rewrite:

- Add a `damageModel` key to `VEHICLES[].armour` (or a parallel field) selecting
  a model object: `"armour"` (the directional rule chain), `"members"` (squad),
  `"hp"` (structures). `Tank.applyHit`/`BaseStructure.applyDamage` delegate to
  `getDamageModel(entity).resolveHit(entity, zone, damage) -> result`, so the
  rule chain lives in ~20-line model modules rather than on the entity.
- Make the armour subsystem table data-driven: replace `SUBSYSTEM_PROPS` +
  the `if (key === "turret")` side-effect with `armour.subsystems[zone] =
  { prop, onApply }` entries so a fourth subsystem (engine → speed cut, radio →
  vision loss) is a table row, not a new `if`.
- Fold `Game.applyHitToTank`'s multiplier/particle/event orchestration into the
  damage system (or keep it as the single public entry point that dispatches to
  the model) so the "what happens on a hit" logic is one place, and have
  `applyBlast` call the same model per entity instead of two bespoke loops.

**Extensibility payoff.** A shield, a fire/DoT, an EMP that disables a
subsystem for a timed window, per-member armour, or a new subsystem is a model
or a table entry — no new branches in `Tank`, `Game`, or the AoE system. The
combat seam round three #3 opened at *targeting/firing* finally extends to
*damage resolution*.

- **Pros:** removes a real split-brain (the damage concern is spread over four
  files); makes the three damage models unit-testable in isolation; deletes the
  hardcoded subsystem map.
- **Cons:** touches the hottest path; behavioural equivalence (rear
  instant-kill, squad one-member-per-point, dig-in/cover multiplier) must be
  preserved exactly — the `game.test.js`/`squad.test.js`/`vehicles.test.js`
  suites are the guardrail.
- **Complexity:** Medium-large (the largest design-sensitive item this round).
- **Extensibility:** Very high — the seam for every future damage mechanic.
- **Maintainability:** Very high — "fix damage once, fix it everywhere".
- **Elegance:** High — durability numbers and damage rules finally both live in
  data + strategies.

---

## 3. Finish the projectile seam: `Bullet` as an entity, `kind` as a parameter, one hittable surface

**Status:** open.

**Evidence.** Three gaps in what round three #3 claimed to finish:

1. `Bullet` is not a `GameEntity` (`js/bullet.js:15`) — it re-implements
   `alive`/`x`/`y`/`team` that `GameEntity` already provides.
2. `kind` is derived, not injected: `this.kind = arcing ? "shell" : "direct"`
   (`js/bullet.js:58`), and `spawnBullet` exposes `arcing` but no `kind`
   (`js/shoot.js:30-55`). Adding a guided rocket/grenade/mine means editing
   `Bullet`'s constructor *and* `spawnBullet`, contradicting
   `js/projectiles/index.js:11-13`'s "one module + a `kind`".
3. There is no single hittable/damageable surface: `checkBulletHits` iterates
   only `game.allTanks` (`js/systems/projectiles.js:28-42`), and structures are
   reached via a parallel `_getStructureAt` path in `direct.js:37-41`; `applyBlast`
   keeps two loops. In the renderer, the bullet visual is inferred from
   `bullet.damage < 1.0` (`js/render/effects.js:15`) rather than `bullet.kind`.

**Re-abstraction.**

- Make `kind` a first-class parameter of `Bullet`/`spawnBullet` (defaulting to
  `"direct"`), so the "new projectile = one module + a `kind`" promise becomes
  literally true.
- Have `Bullet` extend `GameEntity` (or expose the shared `hitTest`/`size`
  capability), so bullets are part of the same entity surface as tanks and
  structures.
- Introduce one `hittable`/`damageable` iteration surface (a capability getter
  plus a single `for (const e of game.entities)` loop in the bullet and AoE
  systems) so a new shootable thing (crate, flag, neutral structure, prop) is
  added once, not to every iteration site.
- Drive the bullet's render visual from `bullet.kind` (and/or an explicit
  visual field) instead of the `damage < 1.0` magnitude heuristic.

**Extensibility payoff.** A new projectile is genuinely one `js/projectiles/`
module + one `kind`; a new shootable entity is one entity + one capability, no
edits to the bullet/AoE/tower loops; bullet visuals stop misclassifying
tower/squad shots.

- **Pros:** makes the `kind` abstraction actually reachable; removes the
  tank-vs-structure loop duplication; closes the last non-entity in the
  simulation core.
- **Cons:** touches the hot bullet path and the render smoke tests (the
  `effects.js` visual change must keep the tracer/tracer-colour contract); the
  entity unification is the design-sensitive part.
- **Complexity:** Medium.
- **Extensibility:** High — the seam for every future projectile and target.
- **Maintainability:** High — one iteration surface instead of parallel loops.
- **Elegance:** High — `GameEntity` finally earns its name as the single entity
  root.

---

## 4. Data-drive the audio engine and the event→sound mapping

**Status:** open.

**Evidence.** `js/audio.js` (412 lines) is the particle-system *before* round
three's #7: 14 `play*` methods (`playShoot`…`playWin`, `js/audio.js:61-381`),
each hand-building the identical oscillator/noise → biquad filter → envelope →
destination graph with hardcoded frequencies/gains/durations. Only `_env`,
`_makeNoise`, `_noiseSrc` are shared (`js/audio.js:385-411`); the *graph* is
not. The event→sound mapping is two inline chains — `hookIntoGame`'s weapon
branch (`js/audio.js:36-41`) and `playVehicleShoot`'s `fireSound` branch
(`js/audio.js:52-57`) — over a heterogeneous `fire` payload
(`{tank,bullet}` vs `{tank,bullet,weapon}` vs `{tower,bullet}`). A concrete
bug falls out of this: the watch tower fires every 0.15s but carries no
`weapon` and no `tank`, so it silently falls through to `playShoot()` — the
heavy tank thud — because `BASE_STRUCTURES.baseTower` has no `fireSound`
(`js/config/structures.js:14-24`).

**Re-abstraction.** The `EFFECTS` + `emit` treatment, applied to sound:

- A `SOUNDS` table (per sound: `layers[]`, each layer `{ kind: "osc"|"noise",
  type, freq: [start,end]|fixed, curve, filter: {type, Q, freqStart, freqEnd},
  delay, gainPeak, gainDur }`) plus one `play(soundKey, opts)` engine that
  builds the graph from a layer.
- An `EVENT_SOUNDS` mapping (event name → sound key) so `hookIntoGame` is a
  one-line `this.play(EVENT_SOUNDS[event])`, and `VEHICLES.fireSound` /
  `SQUAD_MEMBERS[].weapon` / a new `BASE_STRUCTURES[].fireSound` each carry the
  *sound key* directly.
- Normalize the `fire` event payload to carry one `sound` key (see #5), fixing
  the tower-sound bug by adding `fireSound: "tower"` (or the autocannon sound)
  to `baseTower` in config.

**Extensibility payoff.** A new sound (new weapon, new vehicle, powerup pickup,
distinct structure-destroyed) is a `SOUNDS` row + a mapping entry — no new
method, no new branch chain. ~412 lines collapse to a ~100-line engine + a
~150-line table + a ~15-line mapping, net smaller and O(1) to extend.

- **Pros:** removes the last "one method per sound" god-object-in-miniature;
  fixes a real bug (tower sound) in passing; mirrors the proven particle idiom.
- **Cons:** the schema must express the exact hand-tuned envelopes or timbres
  silently change — this needs A/B listening, and tests should assert "each key
  resolves and plays without throwing" rather than exact audio.
- **Complexity:** Medium (design-sensitive schema).
- **Extensibility:** High — the seam for every future sound.
- **Maintainability:** High — one engine, one table.
- **Elegance:** High — audio finally obeys the same data-driven rule as particles.

---

## 5. Give the event bus a typed, normalised contract

**Status:** open.

**Evidence.** `game.on`/`game.emit` take bare magic strings with no registry
(`js/game.js:132-138`); the names exist only in a comment (`js/game.js:25-26`).
Payload shapes are ad-hoc and unvalidated: `fire` carries three different shapes
(`{tank,bullet}` in `vehicles/tank.js`/`spg.js`, `{tank,bullet,weapon}` in
`vehicles/squad.js:46`, `{tower,bullet}` in `systems/towers.js:48`); `destroy`
carries `{tank}` or `{structure}`; `impact` carries `{bullet}` or `{}`. A typo'd
event name silently no-ops, and consumers (audio) re-derive meaning by probing
fields.

**Re-abstraction.**

- Add a `GAME_EVENTS` constant table (frozen name constants, in `js/config/`
  or a tiny `js/events.js`) and replace the ~11 literal strings in emitters and
  `audio.js` with the constants.
- Normalize payloads: `fire` → `{ source, bullet, sound? }` (source being the
  tank/tower/squad-member that fired, `sound` the config-derived sound key from
  #4); `destroy` → `{ entity }`; `impact` → `{ source, point }` (or `{bullet}`).
- Add a `terrain_changed` (or `map_changed`) event that fires when a tile is
  damaged or a structure is destroyed, and have pathfinding invalidation
  subscribe to it — this is the seam that lets #6 remove the `ai._pf` reach.

**Extensibility payoff.** New events are declared once, payload contracts are
visible at the declaration, and a typo fails loudly (a missing key) instead of
silently. Cross-cutting concerns (audio, pathfinding, future UI/rumble/replays)
subscribe to one vocabulary instead of hand-probing heterogeneous objects.

- **Pros:** removes a whole class of silent-wiring bugs; makes the world-model
  event surface self-documenting.
- **Cons:** mechanical churn across every `emit`/`on` call site; the payload
  normalisation is the only part with any design judgement.
- **Complexity:** Low-medium (mostly mechanical).
- **Extensibility:** High — this is the seam for every future observer.
- **Maintainability:** High — one contract instead of ~11 magic strings.
- **Elegance:** High — matches the `ACTIONS` vocabulary precedent for input.

---

## 6. Close the last strategy/system boundary leaks

**Status:** open.

**Evidence.** Three `_`-prefixed reaches remain, contradicting the documented
"strategies/systems depend on the public world-model surface" rule:

- `js/systems/respawn.js:26` reads `game._bots` (the public `bots` getter
  strips the `ai` handle, `js/game.js:106-108`, forcing the reach).
- `js/projectiles/direct.js:37` calls the private `game._getStructureAt`
  (`js/game.js:436-438`).
- `js/game.js:417-419` `_invalidatePathfinders` reaches `ai._pf?.invalidate()`
  — the only cross-boundary AI reach.

Related, `Game._update` (`js/game.js:265-325`) is a *hybrid*: the physics/win/
respawn/camera passes are delegated to `js/systems/`, but the AI-think,
movement, per-vehicle `update`, and firing passes are still inline loops. The
"each pass lives in `js/systems/`" claim is only half true.

**Re-abstraction.**

- Promote two public accessors: `getBot(tank)` (or `botFor(tank)`) returning
  the full `{ ai, tank, enemies }` handle, and a public `structureAt(gx, gy)`
  (rename/promote `_getStructureAt`). Point `respawn.js` and `direct.js` at
  them.
- Replace `_invalidatePathfinders`'s `ai._pf` reach with the `terrain_changed`
  event from #5 (the AI subscribes and invalidates its own pathfinder).
- Optionally finish the systems extraction: move the AI-think, movement, and
  firing loops in `_update` into `js/systems/think.js`, `movement.js`,
  `firing.js` so the ordered list is uniform (either all systems or all inline,
  not a mix).

**Extensibility payoff.** `Game`'s internals (`_bots`, `_structureMap`,
pathfinder lifecycle) become refactorable without breaking the systems; a new
per-frame pass has one unambiguous home.

- **Pros:** removes the exact internal-shape coupling the prior rounds removed
  elsewhere; makes the "thin ordered list of systems" claim true.
- **Cons:** mechanical, but the systems extraction of think/movement/firing is
  wide and order-sensitive (the `game.test.js` suite pins the pass order).
- **Complexity:** Low-medium.
- **Extensibility:** Medium-high — the boundary the docs already claim becomes
  the boundary the code enforces.
- **Maintainability:** High.
- **Elegance:** High — completes round three's #1 and #6.

---

## 7. Data-drive map generation: a biome/style seam + promote procedural constants to the leaf

**Status:** open.

**Evidence.** `js/map/generation.js` is a fixed island pipeline with no
`style`/`biome` parameter (the facade only takes
`width/height/villageDensity`, `js/map.js:40`). Tile ids and noise thresholds
are literals: `baseTile` hardcodes `DEEP_WATER/SHALLOW_WATER/SAND/DARK_GRASS/
GRASS` with thresholds `0.06/3/*8/-1.8/-3.5/0.12/0.52` (`js/map/generation.js:
34-45`); `layDirtRoad` only converts `GRASS||DARK_GRASS → DIRT` (`:139`);
`stampVillage` hardcodes `PAVED` + `BLDG_*` with `0.4/0.45/0.8` (`:209-276`);
`scatterRoadsideBuildings` hardcodes sizes/counts (`:169-201`). Density/spacing
constants (`MIN_VILLAGE_DIST 14`, attempt counts, coast insets) are literals in
`placeVillages`. These are the biggest config-leaf offenders in the codebase.

**Re-abstraction.**

- Introduce a `MAP_STYLES` (or `BIOMES`) table in `js/config/` holding the
  per-style values: `{ baseTiles, roadTile, roadSourceTiles, buildingTiles,
  coastNoise, thresholds }`.
- Decompose `generate()` into named, composable passes (`layCoast`,
  `paintTerrain`, `placeVillages`, `connectRoads`, `scatterBuildings`) so a
  style swaps the table and a new feature is a new pass appended to the
  pipeline, not an edit inside one function.
- Promote the per-style procedural constants (densities, band widths, compound
  tier thresholds/radii, spawn attempt counts) into thematic `CONFIG` groups;
  leave the noise *algorithm* internals (octave math) local.

**Extensibility payoff.** A desert/snow/city map is a `MAP_STYLES` entry, not a
rewrite of four functions; a new map feature (rivers, forests, craters) is a new
pipeline pass; map "feel" is tuned in config, not logic.

- **Pros:** enables the stated biome future; deletes the worst data-leaf leak;
  makes generation testable pass-by-pass.
- **Cons:** medium mechanical extraction; the design judgement is deciding which
  noise tuning is per-style data vs. generator-internal (recommend: only
  per-style values become config).
- **Complexity:** Medium (mostly mechanical).
- **Extensibility:** High for terrain/biomes.
- **Maintainability:** High — one table, composable passes.
- **Elegance:** High — map generation gets the same table treatment tiles did.

---

## 8. Decompose `map/compounds.js` and generalise the structure taxonomy

**Status:** open.

**Evidence.** Two coupled problems:

1. `js/map/compounds.js` (492 lines, the largest logic file) bundles three
   hand-rolled per-tier stampers (`stampCompoundSmall/Medium/Large`,
   `:118-281`), shared layout helpers, placement policy (`clearAroundBase`,
   `clearPath`, `connectCompoundToRoad`), and spawn math (`getBaseSpawnPoint`,
   `getSpawnPoint`). The compound geometry is duplicated: `getBaseSpawnPoint`
   re-derives `half = small?5 : medium?7 : 10` (`:392`) — the same 5/7/10 as the
   stampers' `half`/`RADIUS` (`:121,152,189`); the tier thresholds `80/160` and
   radii `7/10/14` (`:35-36`) are literals.
2. The structure taxonomy is hardcoded in three places: `BASE_STRUCTURES` keys;
   `Base`'s `hq`/`walls`/`towers` fields + `allStructures` (`js/entity.js:
   126-156`); and `buildBase`'s three hand-`new`ed types over a fixed
   `{walls, towers, hqTiles, hqCenter}` layout schema (`js/modes.js:36-66`).

**Re-abstraction.** Mirror the `js/render/structures/` split:

- Keep generic layout/spawn helpers in one module; make the compound *shape* a
  data/strategy seam — a `COMPOUND_STAMPERS` registry keyed by shape/tier with
  a shared `classifyEdge`/`placeRing` primitive (safer than one over-parameterised
  mega-spec, per AGENTS principle #5). Store `size`/`half`/`radius` on the
  returned layout so `getBaseSpawnPoint` and `buildBase` read it instead of
  re-deriving tier→size.
- Generalise `Base` to hold a single `structures` list (tagged by role) and
  derive `hq`/`walls`/`towers` as filtered views, so a fourth structure
  category (bunker, barracks, generator) is a `BASE_STRUCTURES` entry + a
  layout slot + a sprite — no edits to `Base` or `buildBase`.

**Extensibility payoff.** A new base type (fortress, outpost) or a fourth
compound tier is a registry/table entry; the `half`/size geometry stops
drifting between stampers and spawn helpers.

- **Pros:** splits the largest remaining logic file; removes the last
  hardcoded 3-bucket taxonomy; de-duplicates the tier geometry (a real
  drift-prone copy).
- **Cons:** medium-large and design-sensitive (the three shapes genuinely
  differ — square vs circular, entrance logic); behavioural equivalence of the
  compounds is the acceptance bar (`map.test.js`).
- **Complexity:** Medium-large.
- **Extensibility:** High for structures and base layouts.
- **Maintainability:** High — one structure model, one layout seam.
- **Elegance:** High — structures finish the vehicle treatment.

---

## 9. Unify the targeting vocabulary and finish the AI package

**Status:** open.

**Evidence.** Four residual AI/targeting seams:

1. **Squad targeting bypasses `TARGET_TYPES`.** `SQUAD_MEMBERS[].primaryTargets
   /fallbackTargets` are flat name lists (`js/config/vehicles.js:245-288`) and
   `pickSquadTarget` (`js/squad.js:32-61`) is its own loop — it does not call
   `pickTarget`/`targetPriorityOf`. A new target type needs a `TARGET_TYPES`
   entry *plus* N `SQUAD_MEMBERS` edits. (There is also a third hand-rolled
   threat loop in `roles.js:170-182`.)
2. **The O(N²) `targetPriority` matrix was "flattened" but re-inflated.** Every
   vehicle enumerates all 8 target types (`js/config/vehicles.js:73,105,137,169,
   204`); several entries just restate their class default (e.g. `tank.baseWall:5`,
   `squad.drone:3`), so the class-default abstraction is unused in practice.
3. **Per-role state lives on the controller.** `AIController` enumerates
   `_sniperPos`/`_flankPoint`/`_flankReached`/`_patrolAngle`/`_patrolTimer` in
   its constructor and `resetLife` (`js/ai.js:64-73,114-125`), so a fifth role
   with state forces controller edits.
4. **`roles.js` bundles two concerns.** The role registry/dispatch and the
   shared position scoring (`findBestPosition`/`computeFlankPoint`,
   `js/ai/roles.js:313-414`) live in one file; the role-name vocabulary is
   stringly-typed (`AI_ROLES` is unused at runtime, unknown roles silently fall
   back to `DEFAULT_ROLE`, `roles.js:61-62`).

**Re-abstraction.**

- Point squads at the shared core: express `primaryTargets`/`fallbackTargets`
  as priorities through `targetPriorityOf`/`TARGET_CLASS_DEFAULTS` (a thin
  primary/fallback wrapper may remain, but the scoring/LOS core must be shared).
- Strip `VEHICLES[].targetPriority` down to overrides only (delete entries equal
  to their class default) so an N+1th target type is genuinely one `TARGET_TYPES`
  entry.
- Move per-role state off the controller into per-life strategy instances
  (`{ goal, reset }`) or an opaque `ai.roleState` slot the strategy owns.
- Split `roles.js`: extract `findBestPosition`/`computeFlankPoint` into
  `js/ai/positioning.js` (mirroring the `vehicles/` one-module-per-concern
  split), and make `AI_ROLES` the single source of the role-name vocabulary
  (guard `ROLE_STRATEGIES`/`roleWeights` against unknown keys).

**Extensibility payoff.** A new target type is one `TARGET_TYPES` entry for
every shooter *including squads*; a new role is one `ROLE_STRATEGIES` entry +
a `roleWeights` entry, with its state encapsulated in the strategy.

- **Pros:** deletes the second (and third) targeting vocabulary; removes the
  re-inflated matrix; makes role state self-contained; splits the 414-line
  roles file.
- **Cons:** the primary/fallback squad semantics must survive unification (the
  one genuine difference); role-state migration must not change behaviour.
- **Complexity:** Medium (targeting/roles), low (matrix trim, vocabulary).
- **Extensibility:** High — the seam for every future combatant and role.
- **Maintainability:** High — one targeting vocabulary, one role vocabulary.
- **Elegance:** High — completes round two's #5 and round three's #7.

---

## 10. De-type the render/HUD/menu layer and sweep the remaining magic numbers into the leaf

**Status:** open.

**Evidence.** Round three's #6 de-typed `hud.js`/`minimap.js` glyphs, but the
render/UI layer still has residual type codes and duplicated formulas:

- **Depth-sort contract** (`js/render/viewport.js:97-188`): magic offsets
  (`gx+gy+1` for elevated tiles, `flies ? 2 : 0` for drones), a
  `switch (item.kind)` with five hardcoded cases, and a hardcoded bucket push
  order (tiles → tanks → structures → bullets → particles). A new entity kind
  needing a distinct depth layer (an underpass at −1, a high flyer at +3)
  requires editing both `collectDepthItems` and `drawDepthBuckets`.
- **Residual type-code dispatches:** the tile draw-kind `if/else` on
  `visual.draw` (`js/render/tiles.js:27-54`); the per-building-size palette/
  height/roof ternaries (`js/render/buildings.js:26-29,112-129,149` — whose
  `fullH` 14/22/32 duplicates `TILE_PROPS.height`); the soldier-weapon
  `switch (type)` (`js/render/vehicles/squad.js:97-107`) plus a preview types
  array duplicating `SQUAD_ATTENTION_ORDER`.
- **Duplicated sprite boilerplate:** the damaged-shade block (tank vs ifv),
  disabled-track palette, and the HP-bar ramp `#4a4/#da4/#d44` are copy-pasted
  across wall/tower/hq (`js/render/structures/*`) and the HUD (`hud.js:99`).
- **Duplicated gameplay formulas:** the charge-range formula appears four times
  (`viewport.js:76`, `hud.js:187`, `vehicles/spg.js:25-28`,
  `render/vehicles/spg.js:364`); the blast falloff is re-implemented in
  `hud.js:150,157` (diverging from `aoe.js`); the role vocabulary is duplicated
  in `hud.js:216-217`/`minimap.js:9` with an inconsistency ("F" vs "SCT").
- **Menu still special-cases vehicles:** `js/menu/vehicle-info.js` `STAT_METRICS`
  has three `type === "squad"|"tank"` value functions (`:122,130,137`), and
  `about-screen.js:183` has `activeType === "drone" ? "N/A"`; `VEHICLE_INFO`
  mirrors display stats by hand and can drift from `VEHICLES`.
- **Magic numbers + dead config:** the aim deadzone `0.08` is duplicated across
  four behaviour files; AI range/engage/patrol literals are inline; `flashMuzzle`
  is a 3-arm `if/else` over an intermediate key (`js/shoot.js:16-20`);
  `SCOUT_FLANK_OFFSET`/`SNIPER_FLANK_OFFSET` (`js/config/constants.js:44-45`)
  are never read.

**Re-abstraction.**

- Make depth a capability/data field (`depthClass` or `renderDepth` on the
  entity/tile) and register the item-kind → draw-function mapping in a small
  table instead of the `switch`; keep the two-pass flat-vs-elevated invariant.
- Collapse the tile draw-kind `if/else`, the building ternaries, the
  soldier-weapon switch, the damaged-shade/HP-bar/track-palette blocks, and the
  role vocab into tables/registries (a `DRAW_KINDS` table, a shared
  `drawHealthBar`/`drawDamagedShade` primitive, a role-glyph table sourced from
  `AI_ROLES`).
- Extract the charge-range and blast-falloff math into one shared helper (used
  by viewport, HUD, behaviour, and render) so the formulas can't drift.
- Derive menu stat bars and `VEHICLE_INFO` from `VEHICLES` (with explicit
  player-facing overrides, not inline `type ===` branches); source team colours
  from `PLAYER_COLORS`.
- Promote the repeated tunables (aim deadzone, AI ranges/patrol cadence, dug-in
  fire-rate, cover-engage margin) into `CONFIG`/`VEHICLES`, and delete the dead
  config constants. Replace `flashMuzzle`'s `if/else` with a direct `EFFECTS`
  key lookup.

**Extensibility payoff.** A new vehicle/tile/entity-kind shows up correctly in
the depth sort, HUD, minimap, menu, and sprites via table entries; a new effect
or formula has one home; the data leaf stops leaking into the render/menu/AI
layers.

- **Pros:** finishes the de-typing round three #6 started; deletes the last
  copy-paste clusters and formula drift; wide but mechanical.
- **Cons:** the depth-sort change is the design-sensitive piece (the two-pass
  invariant is load-bearing, pinned by `render.test.js`); the sprite/HP-bar
  collapse must keep the visuals intact.
- **Complexity:** Medium (several small mechanical items + one design item).
- **Extensibility:** High — this is what makes all the other new kinds *visible*
  without touching the renderer.
- **Maintainability:** High — one table/primitive per concern.
- **Elegance:** High — the registry pattern is finally uniform across logic and
  render.

---

## Suggested sequencing

Status: **all ten opportunities are open** (none implemented yet). The order
above is the recommended sequence, grouped for review:

- **Structural (largest leverage):** #1 (entity/component boundary) and #2
  (damage-model seam) are the two "larger refactors" this round, and they are
  each other's neighbours: #1 empties `Tank` of state so #2's damage model has
  a clean host. #3 (projectile/entity surface) rides on #2's damageable
  surface.
- **The last god-objects-in-miniature:** #4 (audio) is the single highest
  copy-paste payoff and fixes a real bug; #8 (compounds) splits the largest
  remaining logic file.
- **Boundary/contract tightening (fast, safe, unblock the rest):** #5 (event
  bus), #6 (boundary leaks), #9 (targeting/role vocabulary) — each is mostly
  mechanical and removes the "touch N files" surprises that would otherwise
  bite the structural work.
- **Data-leaf and render finish:** #7 (map biome seam) and #10 (de-type render/
  HUD/menu + magic-number sweep) complete the data-driven and registry patterns
  in the two places the rounds kept deferring.

#1 and #2 are the round's "larger refactors", just as #1 and #3 were in round
three; #4 is the round's most mechanically rewarding single change. Every item
keeps the aggregate gate green (492 tests, lint, dependency-cruiser) as the
guardrail, and each leaves the codebase smaller, not larger.

## Direction (the north star, not a standalone task)

The codebase is now most of the way from "fat entity + god orchestrator +
strategies that mutate everything" to **"data + components + systems"**. The
remaining distance is not a new architecture — it is *finishing* the one that
already exists:

- `Squad` is a component; the missing pieces are making components the general
  home for per-vehicle *state* (#1) and per-entity *damage* (#2), so `Tank` and
  `Bullet` become data shells.
- `config.js` data-drives stats; the missing pieces are data-driving *semantics*
  that still live as literals: map styles (#7), audio timbres (#4), AI tunables
  (#9/#10), and the event vocabulary (#5).
- The registries exist (vehicles, structures, particles); the missing pieces are
  extending them to depth-sort, projectile construction, the structure
  taxonomy, and the game-type list (#3, #8, #10).

What **not** to do: a wholesale ECS rewrite is still not warranted. The codebase
is ~10k lines with working strategy tables, a working component, and a clean
data leaf. The payoff is in *finishing* those patterns in the entity, the
combat seam, the data leaf, and the four half-open registries — not in replacing
them with a framework. Per root principle #3, refactor where there is real
duplication, a real type code, or a real god object: #1, #2, #4, #7, #8, and
#10 are exactly those; #3, #5, #6, and #9 are the boundary/contract tightening
that makes the rest safe to do.
