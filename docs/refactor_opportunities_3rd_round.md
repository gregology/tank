# Refactor Opportunities — Third Round

**Project:** Tank Battle (split-screen isometric tank game)
**Scope:** long-term extensibility, after the first two rounds of refactoring
**Ordering:** most leverage first

---

## Diagnosis: two rounds decomposed, but three seams are only half-finished — and one god object remains

The first two rounds (see `docs/refactor_opportunities.md` and
`docs/refactor_opportunities_2nd_round.md`) accomplished the *decomposition*:
the god objects (`renderer.js`, `map.js`, `ai.js`, `menu.js`, `config.js`,
`render/vehicles.js`) were cut into packages behind thin shells, and the two
biggest "type codes" (vehicle behaviour, tile semantics) were turned into
strategy/tables. That is real and it held — the aggregate gate is green
(487 tests, ~97% line / ~89% branch / ~94% funcs) and every `js/` module is
measured.

But reading the *shape* that survived reveals that several of round two's
"re-abstractions" stopped at the front door. The line counts have flattened,
not shrunk, and the four largest modules tell the story:

| Module | Lines | What it still is |
|---|---|---|
| `js/game.js` | 643 | the simulation god object: every per-frame system inline |
| `js/map/compounds.js` | 492 | three compound stampers + layout helpers (one concern, but big) |
| `js/ai/roles.js` | 414 | four role strategies + shared position scoring in one file |
| `js/audio.js` | 412 | one `play*` method per sound (procedural synth, self-contained) |

The deeper issues are not line counts, they are seams that were opened but not
finished:

- **`Game` is still the god object the first two rounds left behind.** Every
  per-frame pass — bullet movement, bullet↔terrain/structure collision,
  bullet↔entity hit tests, vehicle separation, crush resolution, structure
  pushing, damage smoke, watch-tower firing, respawn, camera, win check — is a
  private method of `Game` (`js/game.js:272–332`). The strategies (modes,
  vehicles) were extracted, but the *systems* that run the simulation were not.
  The "data + components + systems" north star from round two's "Direction"
  section was named and then not taken.

- **The capability model is a rename, not a re-shape.** Round two's #4 added
  `flies` / `softTarget` / `crushable` / `canCrush` getters — but every one is
  a comparison against the *same* three-way string
  (`VEHICLES[t].unitClass === "air" | "infantry" | "vehicle"`,
  `js/tank.js:171–185`). "Air", "soft", and "crushes" are **orthogonal** axes
  being forced through one 1-of-3 discriminator. A hovering gunship that
  *flies* and *crushes* infantry cannot be expressed; neither can an amphibious
  scout, a soft-but-not-crushable mine-dog, or a flying transport. The getters
  exist, but the data behind them is still a type code.

- **The combat seam stops at targeting.** Round two's #5 unified *choosing* a
  target (`pickTarget`) but left *shooting* untouched. Bullet construction +
  `game.bullets.push` + muzzle flash + `emit("fire")` is copy-pasted four
  times (`js/vehicles/tank.js:127–141`, `spg.js:34–50`, `squad.js:32–51`,
  `js/game.js:623–628`). Watch towers are **not** first-class shooters — they
  still fire through a bespoke loop with `BASE_STRUCTURES.baseTower` hardcoded
  (`js/game.js:611–629`). The projectile `kind` dispatch only covers *landing*
  (`js/projectiles.js`); movement, terrain hits, and entity hits are still
  hardcoded in `Bullet.update` + `game._tickBullets` / `_checkBulletHits`.
  And the radial area-of-effect damage is implemented **three times with two
  different falloff formulas** (`js/vehicles/drone.js:22–31` centre-distance,
  `js/projectiles.js:19–30` edge-distance-with-`hitRadius`,
  `js/vehicles/aoe.js:23–39` edge-distance-with-`size`).

- **Two type codes survive as subclasses + `switch`, outside the vehicle
  strategy.** Base structures are `BaseWall`/`BaseHQ`/`BaseWatchTower`
  subclasses (`js/entity.js:119–141`) built by a hardcoded `buildBase`
  (`js/modes.js:36–66`) and drawn through a `switch (entity.entityType)`
  (`js/render/structures.js:14–26`) whose three draw functions share ~80%
  isometric-block boilerplate. Tile *logic* is data-driven (`TILE_PROPS`), but
  tile *visuals* are still a `switch (tile)` (`js/render/tiles.js:24–95`) plus
  a separate hardcoded `TILE_COLORS` table (`js/render/minimap.js:9–22`).

- **The strategy boundary is still porous.** Vehicle behaviours mutate the raw
  public collections `game.bullets` and `game.particles` directly
  (`js/vehicles/tank.js:136,139`, `spg.js:45,49`, `squad.js:44,50`,
  `drone.js:35`, `aoe.js:36`, `js/projectiles.js:35`) — round two's #3 cleaned
  `modes.js` but not `js/vehicles/*`. The render layer reaches into `game._bots`
  (`js/render/minimap.js:84–85`, `js/render/hud.js:224–227`) — a `_`-prefixed
  field with no public accessor — and the HUD/minimap still branch on
  `vehicleType === "drone" | "ifv" | "spg" | "squad"` (`hud.js:121–153`,
  `minimap.js:54–79`).

- **Smaller, compounding debt.** `targetPriority` is a dense O(N²) matrix —
  every shooter carries a `targetType → weight` row, so adding an N+1th target
  type means editing every other shooter's row (5 vehicles + the tower =
  `js/config/vehicles.js` ×5 + `js/config/structures.js`). The AI keeps
  vehicle-specific *think* logic in the controller, not the behaviour
  (`js/ai.js` `thinkDrone` 209–258, `_thinkImmobilised` 268–294,
  `updateSquadDigIn` 323–334; the behaviours delegate back via `aiThink`,
  `js/vehicles/drone.js:54–57`, `squad.js:117–127`). `particles.js` is one
  `emit*` method per effect (9 emitters, identical loop structure). And
  `VEHICLES.tank` / `spg` / `drone` / `squad` are magic defaults referenced
  ~15 places (`js/map/queries.js:19`, `js/bullet.js:36`, `js/ai/roles.js:41`,
  `js/projectiles.js:17`, `js/ai.js:240,254`, `js/render/effects.js:78`, …).

The opportunities below *finish* the seams that were opened, and take the one
large step (decomposing `Game`) that was explicitly deferred. Each is judged
against the root principle: *how would I add an N+1th of this?*

---

## 1. Extract the simulation loop out of `Game` — the last god object

**Status: ✅ implemented.**

**Evidence.** `js/game.js` (643 lines) is now the largest single logic module.
After `modes.js` and `js/vehicles/*` took the two *axes of variation* out, what
remains is a flat sequence of per-frame systems, each a private method, all
wired in one hardcoded `_update(dt)` (`js/game.js:272–332`):

- `_tickBullets` (420–447) — bullet movement + terrain/structure collision.
- `_checkBulletHits` (449–464) — bullet ↔ entity hit tests.
- `_separatePairs` (529–557) + `collision.js#vehiclesSeparate` — the separation
  *math* lives in `Game`, the *policy* in another file.
- `_resolveCrushes` (472–490) — the crush interaction pass.
- `pushFromStructures` (492–516) — structure push-out.
- `_emitDamageSmoke` (518–527) — damage smoke emitter cooldown.
- `updateWatchTowers` (602–631) — tower firing.
- `_handleRespawns` (336–357) — respawn, vehicle-type re-roll, AI role
  reassignment, and `resetLife` all in one place.
- `_updateCamera` (633–642), `_checkWin` (361–368).

Adding a new per-frame concern (a mine tick, a status effect, a capture-point
tick, a cooldown ability) means editing `_update` and adding fields/methods to
`Game` — the exact "touch the god object" failure the map/render splits removed
everywhere else. `Game` also mixes orchestration (order the systems) with
implementation (each system's body), so neither can change independently.

**Re-abstraction.** Apply the same thin-shell-over-package treatment already
given to `renderer.js`, `map.js`, `ai.js`, `menu.js`, and `config.js`:

- A `js/systems/` package of focused modules, one per pass, each exporting a
  `update(game, dt)` (or narrower signature) in the established
  strategy-context style — e.g. `projectiles.js` (movement + terrain/entity
  hits), `collision.js` (separation + structure push + crush, absorbing the
  current `collision.js` policy), `towers.js`, `respawn.js`, `camera.js`,
  `effects.js` (damage smoke), `win.js`.
- `Game._update` becomes a short, *declarative* ordered list of system calls
  (a `this._systems` array, or an explicit sequence), with the mode hooks
  (`afterSeparation`, `afterBullets`) kept as the two insertion points the
  modes already use.
- `Game` keeps the world-model accessors and the event bus; it stops owning the
  body of each system.

This is **not** an ECS rewrite and needs no new dependencies or build step — it
is the same split the codebase already trusts. Round two's "Direction" section
named "data + components + systems" as the north star; this is the first,
mechanical half of that vector.

**Extensibility payoff.** A new simulation concern is one module + one line in
the ordered list — no edits to `Game`. Systems become independently unit-testable
(they already are exercised through `game.test.js`, but only end-to-end). The
systems that need polymorphism (projectiles, towers) become the natural home for
#3's `kind`/shooter dispatch instead of growing `Game`.

- **Pros:** removes the last god object; makes the simulation loop a readable
  table of passes; gives future systems a place to live that isn't `Game`.
- **Cons:** the largest mechanical move of this round; the pass *order* is a
  behavioural invariant (movement → separation → crush → fire → bullets →
  respawn → win) that the existing `game.test.js` suite must keep pinning.
- **Complexity:** Medium–high (mechanical, but wide and order-sensitive).
- **Extensibility:** Very high — the seam for every future system.
- **Maintainability:** Very high — one file per concern, one ordered list.
- **Elegance:** High — completes the decomposition the first two rounds started.

---

## 2. Replace the three-way `unitClass` enum with independent capability flags

**Status: ✅ implemented.**

**Evidence.** Round two's #4 claimed to "generalise squad and air handling into
entity capabilities", and it did move the *consumers* (`game.js`, `collision.js`,
`viewport.js`) onto getters. But the getters are all derived from a single
three-way string:

```js
// js/tank.js
get flies()     { return VEHICLES[this.vehicleType].unitClass === "air"; }      // 172
get softTarget(){ return VEHICLES[this.vehicleType].unitClass === "infantry"; } // 176
get canCrush()  { return VEHICLES[this.vehicleType].unitClass === "vehicle"; }  // 184
get crushable() { return this.squad?.isCrushable ?? false; }                    // 179
```

`unitClass` ("vehicle" / "infantry" / "air", `js/config/vehicles.js`) is a
1-of-3 discriminator pretending to be three orthogonal properties. The mapping
is fixed: air ⇒ flies; infantry ⇒ soft + crushable; vehicle ⇒ crushes. A unit
that flies *and* crushes (hovering gunship), a soft unit that is not crushable
(armoured sapper), a ground vehicle that does not crush (scout car), or a flying
transport that is solid to friendlies — none can be expressed without growing
the enum and re-auditing every `===` comparison. This is the same "type code"
smell the rounds set out to remove, one level down.

**Re-abstraction.** Promote the interaction dimensions to independent,
composable *flags* on `VEHICLES` (or a `traits` set), and make each capability
getter a single field read rather than a string comparison:

- Replace `unitClass` with per-vehicle booleans (or a `traits` list):
  `flies`, `soft`, `crushable`, `canCrush`, plus whatever the render depth
  bonus and separation policy need (`depthClass` / `floatHeight`, `solidTo`
  if friendly/enemy asymmetry ever needs to differ).
- `Tank`/`GameEntity` getters read the flag directly; `collision.js` and the
  crush/separation systems (see #1) keep reading the *capabilities*, so the
  change is internal to `VEHICLES` + `tank.js`.
- Keep a small migration mapping for the *data* (`unitClass` → the flag set)
  during the transition, then delete `unitClass` everywhere (no backward-compat
  shim, per root principle #2).

This *finishes* round two's #4: the component pattern (`Squad`) and the
capability getters stay; the data behind them stops being a string enum.

**Extensibility payoff.** "What kind of thing is this" becomes a set of
orthogonal answers, so a new *kind* of unit (flyer, hover, amphibious, soft,
crushing, or any combination) is a `VEHICLES` entry choosing its flags — no new
`if` in `game.js`, `tank.js`, `collision.js`, or the renderer.

- **Pros:** deletes the last real "type code" in the entity model; makes the
  capability seam actually general rather than cosmetic.
- **Cons:** the flags must be chosen so today's exact behaviour (friendly vs
  enemy separation asymmetry, drone depth bonus, squad dig-in crush immunity)
  still falls out of the flag reads — a behavioural-equivalence test target.
- **Complexity:** Medium (data migration + a few getter rewrites).
- **Extensibility:** Very high — the seam for every future *kind* of entity.
- **Maintainability:** High — one place says "what is this", and it says it
  explicitly.
- **Elegance:** High — capabilities finally mean what they claim.

---

## 3. Finish the combat seam: first-class shooters, a `kind`-dispatched projectile lifecycle, and one blast primitive

**Status: ✅ implemented.**

**Evidence.** Round two's #5 unified *targeting* (`pickTarget`) and retired
`Bullet.sourceType`, but the rest of the combat pipeline is still bespoke and
duplicated:

1. **Four copies of "shoot a bullet".** Construct `new Bullet(...)` →
   `game.bullets.push(b)` → muzzle-flash particle → `game.emit("fire", …)`:
   `js/vehicles/tank.js:127–141`, `spg.js:34–50`, `squad.js:32–51`, and the
   watch tower `js/game.js:623–628`. Each copy differs in flash kind, event
   payload, and lifetime handling.
2. **Towers are not first-class shooters.** `updateWatchTowers`
   (`js/game.js:602–631`) hardcodes `BASE_STRUCTURES.baseTower`, builds the
   bullet inline, and emits `emitIFVFlash` — it does not use a `fire` hook the
   way every vehicle does. A second tower/missile/tesla turret cannot be added
   by `BASE_STRUCTURES` + a behaviour; it needs a new bespoke loop.
3. **The projectile `kind` only covers landing.** `js/projectiles.js` dispatches
   `applyProjectileImpact` for the shell's *landing*, but movement, terrain
   collision, and entity hit detection are hardcoded in `Bullet.update`
   (`js/bullet.js:66–101`) and `game._tickBullets` / `_checkBulletHits`
   (`js/game.js:420–464`). A guided rocket (homing), a lobbed grenade, a mine,
   or a beam can't be a new `kind`; it needs edits to `Bullet`, `Game`, and the
   renderer.
4. **Area-of-effect damage is three implementations, two formulas.**
   `js/vehicles/drone.js:22–31` (tanks, centre-distance falloff),
   `js/projectiles.js:19–30` (tanks, edge-distance falloff using `hitRadius`),
   `js/vehicles/aoe.js:23–39` (structures, edge-distance falloff using `size`).
   A new explosive weapon copies one of these loops again.

**Re-abstraction.** One combat vocabulary, mirroring `js/vehicles/`:

- A single **fire/spawn** seam: a `shoot(game, shooter, spec)` (or
  `game.spawnProjectile(spec)`) that every shooter — tank, IFV, SPG, squad
  member, watch tower — calls, so construct-push-flash-emit is written once and
  the muzzle-flash/sound differences stay data (`VEHICLES`/`BASE_STRUCTURES`).
- **First-class shooters:** give towers the same `{ fire, … }` shape vehicles
  have (a structure *behaviour* table keyed by `entityType`, or a
  `targetPriority` + `fire` on the structure), so `updateWatchTowers` collapses
  to "for each shooter, pick target + fire" — the same loop as vehicles.
- **A `kind`-dispatched projectile lifecycle** (`js/projectiles/`): each
  projectile `kind` supplies `update`, `onTerrain`, `onEntity`, `onLand`
  behaviours, replacing the hardcoded branches in `Bullet.update` and
  `Game._tickBullets`/`_checkBulletHits`. `Bullet` becomes a dumb payload; the
  behaviour owns how it moves and what it hits.
- **One `applyBlast(game, x, y, { radius, damage, team })` primitive** that
  handles tanks (edge-distance with `hitRadius`) and structures (edge-distance
  with `size`) with a single formula; drone detonation, SPG splash, and any
  future explosion call it.
- As part of the same pass, flatten the **O(N²) `targetPriority` matrix** into
  per-target-*class* defaults + per-shooter overrides, so an N+1th target type
  is a single entry, not five rows edited (`js/config/vehicles.js` ×5 +
  `js/config/structures.js`).

**Extensibility payoff.** A new weapon/projectile (guided missile, mortar,
grenade, mine, beam) is a `kind` behaviour + a `VEHICLES`/`BASE_STRUCTURES`
entry; targeting, LOS, blast, and the fire seam come free. A new turret is a
structure entry + a behaviour, not a bespoke `Game` loop.

- **Pros:** deletes real duplication (four shoot paths, three blast loops, two
  falloff formulas); makes towers testable like vehicles; completes round two's
  #5 rather than leaving it at targeting.
- **Cons:** touches the hot bullet path; the squad primary/fallback firing and
  the shell's arcing/flight must survive the unification unchanged (the existing
  `game.test.js` + `vehicles.test.js` suites are the guardrail).
- **Complexity:** Medium–high.
- **Extensibility:** Very high — the seam for all future combatants and weapons.
- **Maintainability:** Very high — "fix a weapon once, fix it everywhere".
- **Elegance:** High — one combat vocabulary across vehicles and structures.

---

## 4. Make base structures data-driven and registry-dispatched (mirror vehicles)

**Status: ✅ implemented.**

**Evidence.** Base structures are the one entity family still using
subclass-per-type instead of the strategy/registry the vehicles use:

- Three subclasses that differ only by their `entityType` string:
  `BaseWall` / `BaseHQ` / `BaseWatchTower` (`js/entity.js:119–141`).
- A hardcoded `buildBase` that `new`s each subclass by hand
  (`js/modes.js:36–66`).
- A `switch (entity.entityType)` dispatch in the renderer
  (`js/render/structures.js:14–26`), whose three draw functions
  (`drawBaseWall` 31–89, `drawWatchTower` 94–198, `drawBaseHQ` 205–335)
  each re-derive the same isometric block (left/right/top faces, `darken`
  damage tinting, `S`/`bw`/`bd` scaling) — roughly 80% copy-paste.
- The tower's combat config is a hardcoded `BASE_STRUCTURES.baseTower` in
  `game.js` (see #3).

Adding a fourth structure (a bunker, a barracks, a second turret type, a
generator) means: a new subclass, a `BASE_STRUCTURES` entry, a `buildBase`
edit, a `drawBaseStructure` switch arm + a new draw function, and (if it
shoots) a new `Game` loop — six touch points. This is exactly the vehicle
"type code" smell, still present in the structure family.

**Re-abstraction.** Give structures the vehicle treatment:

- One `BaseStructure` class (no subclasses); `BASE_STRUCTURES[entityType]`
  already carries the data (`hp`, `size`, `visHeight`, and for towers the
  firing fields). The tower-only state (`fireCooldown`, `turretAngle`) moves to
  the structure behaviour or is created conditionally from the table.
- A `buildBase` that constructs `new BaseStructure(layout.type, …)` from the
  layout data instead of three `new` calls (with the firing/aim behaviour
  attached via a registry, per #3).
- A structure **sprite registry** (`js/render/structures/`, `SPRITES`-style,
  dispatched by `entityType`) mirroring `js/render/vehicles/` — and a shared
  isometric-block primitive (`drawIsoBlock`) that the three sprites reuse so
  the 80% boilerplate collapses to one helper.

**Extensibility payoff.** A new structure type is a `BASE_STRUCTURES` entry +
(if it shoots) a behaviour + a sprite module — three isolated files, no edits
to `entity.js`, `modes.js`, `game.js`, or a switch. Structures and vehicles
finally obey the same "new kind = table entry + registry" rule.

- **Pros:** removes the last subclass-per-type family and the last
  entity-family `switch`; collapses a large block of copy-paste drawing code.
- **Cons:** the tower's HP-bar/gun-barrel specifics must stay visually intact
  (the `render.test.js` smoke tests pin the entry points); behavioural
  equivalence is the acceptance bar.
- **Complexity:** Medium (data + a render split + a shared draw primitive).
- **Extensibility:** High — the seam for every future structure.
- **Maintainability:** High — one structure model, one drawing helper.
- **Elegance:** High — vehicles and structures mirror each other.

---

## 5. Data-drive tile *visuals* (finish round two's #2)

**Status: ✅ implemented.**

**Evidence.** Round two's #2 made tile *logic* data-driven (`TILE_PROPS` in
`js/config/tiles.js`), but the *visual* semantics are still a type code:

- `drawTile` is a `switch (tile)` over 13 cases (`js/render/tiles.js:24–95`),
  each hardcoding palette colours, flat-vs-elevated-vs-building-vs-water
  behaviour, and wave animation.
- `js/render/minimap.js` keeps a separate hardcoded `TILE_COLORS` table
  (9–22), and `js/render/canvas-utils.js` holds the `PALETTE`.
- The `js/AGENTS.yaml` context block for `config.js` even documents this
  residual: "Visuals still need js/render/tiles.js (drawTile switch),
  js/render/minimap.js (TILE_COLORS), and js/render/canvas-utils.js (PALETTE)."

So adding a tile type today is *not* the "one `TILES` id + one `TILE_PROPS`
row" the docs promise — it is that **plus** a `drawTile` switch arm **plus** a
`TILE_COLORS` entry **plus** possibly a `PALETTE` addition. The data-driven
claim is only half true.

**Re-abstraction.** Extend the data table with a visual row, consumed by both
draw sites:

- Add a `TILE_VISUALS` table (or extend `TILE_PROPS`) with the render-only
  fields: a colour (palette key or literal), a draw *kind*
  (`flat` / `water` / `elevated` / `building`), and the elevation/wave
  parameters the current switch hardcodes.
- `drawTile` becomes a small dispatch over draw *kind* (flat diamond, animated
  water, elevated block, building) reading the table — the per-type data moves
  out of the switch. `minimap` reads the same colour field instead of its own
  `TILE_COLORS`.

**Extensibility payoff.** A new tile type (hedge, crater, minefield, bridge,
snow) is genuinely one `TILES` id + one `TILE_PROPS` row + one `TILE_VISUALS`
row — the logic and the visuals both pick it up automatically, and the AGENTS
"add a tile" recipe becomes true.

- **Pros:** finishes the round-two #2 claim; deletes the last tile switch and
  the second colour table; keeps the two-pass depth contract intact (elevated
  vs flat is now a data field the viewport can read, if it ever needs to).
- **Cons:** the wave animation and the elevated-side shading have subtle
  per-type character that must be captured as table parameters rather than
  lost.
- **Complexity:** Low–medium.
- **Extensibility:** High for terrain/biomes.
- **Maintainability:** High — one table, not three files.
- **Elegance:** High — tiles stop being magic integers in the renderer too.

---

## 6. Complete the strategy boundary and de-type the render/HUD layer

**Status: ✅ implemented.**

**Evidence.** Round two's #3 (world-model API) and #6 (sprite registry) stopped
short at the *vehicle behaviours* and the *HUD/minimap*:

- Vehicle behaviours still mutate the raw public collections directly:
  `game.bullets.push(b)` (`js/vehicles/tank.js:136`, `spg.js:45`,
  `squad.js:44`) and `game.particles.emitX(...)` (six call sites). The
  strategies are still "functions in another file mutating `Game`'s guts" —
  the exact thing #3 set out to remove from `modes.js`.
- The render layer reaches into `game._bots` (`js/render/minimap.js:84–85`,
  `js/render/hud.js:224–227`) — a `_`-prefixed field with no public accessor —
  to draw role letters.
- The HUD still branches on `vehicleType` (a nested ternary
  `hud.js:121–127` plus `=== "squad"` 136 and `=== "drone"` 152–153), and the
  minimap has a four-way `vehicleType ===` marker chain (`minimap.js:54–79`).

So the "strategies depend on a public contract" and "render dispatches by
registry, not string" guarantees are still violated in the two places the
rounds explicitly deferred. It is the difference between "mostly done" and
"done" — and it is exactly where an N+1th vehicle/role still leaks into the
render layer.

**Re-abstraction.** Close the two gaps:

- Route every effect through the world-model surface: a `game.spawnBullet(spec)`
  (from #3) and `game.effects`/`game.emitParticle(...)` (or keep `particles`
  but expose it as a documented, stable accessor) so behaviours never touch the
  raw arrays — they call a method, and `Game` owns the collections.
- Expose bot/role data through a public accessor (`game.bots` returning
  `{ tank, role }` pairs, or a `tankRole(tank)` query) so the HUD/minimap stop
  reading `game._bots`.
- Move the two remaining `vehicleType` branches into data: a minimap *marker*
  table (`{ tank: "square", ifv: "diamond", spg: "triangle", drone: "cross",
  squad: "dot" }`) and a HUD vehicle-label/stat table, so a new vehicle adds a
  row instead of a branch. (The sprite *registry* from round two #6 is already
  correct; this is the HUD/minimap glyph layer.)

**Extensibility payoff.** A new vehicle/role/screen shows up in the HUD and
minimap via a table entry, and no strategy or render module reads a `_`-field
or a `vehicleType` string. The boundary the docs already *claim* becomes the
boundary the code *enforces*.

- **Pros:** removes the last `game._` reads from the render layer and the last
  `vehicleType ===` chains; makes the public surface actually load-bearing.
- **Cons:** wide but mechanical; the role-letter drawing must keep working for
  team-mode bots (the `game.test.js`/`render.test.js` fixtures pin it).
- **Complexity:** Low–medium.
- **Extensibility:** High — this is what makes #2/#3/#4's new kinds *visible*
  without touching the renderer.
- **Maintainability:** High — the renderer stops depending on `Game` internals.
- **Elegance:** High — the strategy and registry patterns are actually finished.

---

## 7. Move AI vehicle-specific think into the behaviours; data-drive particles

**Status: ✅ implemented.**

**Evidence.** Two smaller inconsistencies remain, both "the strategy seam stops
one file early":

- **AI think lives in the controller, not the behaviour.** The vehicle
  behaviour's `aiThink` hook is supposed to "return true when the behaviour
  consumed the whole think" — but for drones and squads it merely delegates
  *back* to the controller: `js/vehicles/drone.js:54–57` calls `ai.thinkDrone`,
  `js/vehicles/squad.js:117–127` calls `ai.updateSquadDigIn`/`ai.holdPosition`.
  The actual drone flight loop (`js/ai.js:209–258`), the immobilised pivot
  (`_thinkImmobilised` 268–294), and squad dig-in (`updateSquadDigIn` 323–334)
  live in `AIController`. A sixth vehicle with novel AI (a hover gunship that
  strafes, a tunneller) must edit `ai.js`, not just its behaviour module —
  undoing the "new vehicle = one behaviour module" promise.
- **Particles are one `emit*` method per effect.** `js/particles.js` has nine
  emitters (`emitExplosion`, `emitMuzzleFlash`, `emitIFVFlash`, `emitImpact`,
  `emitTinyImpact`, `emitDroneExplosion`, `emitSPGFlash`, `emitArtilleryImpact`,
  `emitSmoke`, 60–281) that are all the same loop — colour palette, count,
  speed/size/lifetime ranges, and a directional vs omnidirectional mode — with
  different hardcoded numbers. A new effect is a new copy-pasted method.

**Re-abstraction.**

- Move `thinkDrone`, `_thinkImmobilised`, and `updateSquadDigIn` into the
  respective behaviour modules (drone/squad — and a small shared "immobilised
  pivot" helper for the behaviours that want it), so `aiThink` *contains* the
  logic rather than routing back to the controller. The controller keeps the
  generic glue (role dispatch, pathing, turret steering, stuck recovery) and
  the public seams the behaviours call.
- Data-drive particles: an `EFFECTS` table (colour palette, count, speed/life/
  size ranges, `directional` flag) and a single `emit(effectKey, x, y, angle?)`
  that reads it, so a new visual effect is a table row. (Alternatively, at
  minimum, extract the shared "radial burst" and "directional flash" loops so
  the nine emitters become nine table entries over two primitives.)

**Extensibility payoff.** A new vehicle's AI is one behaviour module; a new
particle effect is one table row. The strategy and data-driven patterns extend
into the two places they currently don't.

- **Pros:** completes the `aiThink` contract; removes a god-object-in-miniature
  from `particles.js`; both are self-contained and low-risk.
- **Cons:** the AI move must preserve the drone's detonation/priority logic and
  the squad's dig-in/cover logic exactly (the `ai.test.js`/`vehicles.test.js`
  suites are the guardrail); particles are visual, so the smoke tests are the
  acceptance bar.
- **Complexity:** Low–medium.
- **Extensibility:** Medium–high (AI per-vehicle) and Medium (particles).
- **Maintainability:** High — logic lives next to the thing it varies with.
- **Elegance:** High — the strategy/table patterns are finally uniform.

---

## Suggested sequencing

Status: **all seven opportunities are ✅ done**, committed one per opportunity
in the suggested order (#1 → #7), each leaving the aggregate gate green
(492 tests / 0 failures; ~97% line / ~89% branch / ~94% funcs; lint and
dependency-cruiser clean at 88 modules):

1. **#1 (extract the simulation systems)** — `Game` is now a thin orchestration
   shell; the per-frame passes live in `js/systems/` (`projectiles`, `collision`,
   `towers`, `respawn`, `effects`, `camera`, `win`).
2. **#2 (capability flags)** — `VEHICLES[].unitClass` replaced with independent
   `flies` / `soft` / `crushable` / `canCrush` / `hasSquad` flags; the capability
   getters are single field reads.
3. **#3 (shooter + projectile + blast seam)** — a shared `spawnBullet`/`flashMuzzle`
   fire seam (`js/shoot.js`), a `kind`-dispatched projectile lifecycle
   (`js/projectiles/` — `direct` / `shell`), one `applyBlast` primitive
   (`js/vehicles/aoe.js`), towers as first-class shooters, and the O(N²)
   `targetPriority` flattened into `TARGET_TYPES` class defaults + overrides
   (`targetPriorityOf`).
4. **#4 (data-driven structures)** — `BaseWall`/`BaseHQ`/`BaseWatchTower`
   subclasses replaced by one `BaseStructure` reading `BASE_STRUCTURES`; sprites
   split into `js/render/structures/` (registry + shared `drawIsoBlock`).
5. **#5 (tile visuals)** — the `drawTile` switch and `TILE_COLORS` replaced by a
   data-driven `TILE_VISUALS` table read by both the tile renderer and minimap.
6. **#6 (strategy boundary + de-typed HUD/minimap)** — `game.bots` exposes
   `{ tank, role }` pairs (render no longer reads `game._bots`); minimap markers
   and HUD labels are data-driven (`minimapShape` / `hudGlyph`), and the
   squad/drone HUD branches read capabilities (`membersAlive` / `blastRadius`).
7. **#7 (AI think + data-driven particles)** — drone flight, squad dig-in, and
   the immobilised pivot moved into the vehicle behaviours' `aiThink`; the
   particle system is a data-driven `EFFECTS` table over one `emit(effect, …)`.

#1 and #3 were the two "larger refactors" this round — and they are the two the
earlier rounds explicitly deferred ("the last god object" and "the combat seam
stops at targeting"). #2, #4, #5, #6, #7 each *finish* a seam the prior rounds
opened but left half-done. None of them needed a new dependency, a build step, or
a framework: the established patterns (thin-shell-over-package, data tables,
strategy objects, registries) were the toolset, applied consistently.

What **not** to do: a wholesale ECS rewrite is still not warranted. The
codebase is ~10k lines with working strategy tables, a working component
(`Squad`), and a clean data leaf. The payoff was in *finishing* those patterns in
the simulation core and the two type-code families (structures, tile visuals)
that dodged the first two rounds — not in replacing them with a framework.
