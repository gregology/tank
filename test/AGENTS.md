# AGENTS.md — test/

Testing philosophy, stack, and conventions. Read the root `AGENTS.md` first
for the principles; this file turns principle #4 ("tests must catch real bugs,
not decorate the suite") into concrete practice.

## Stack

- **Runner:** Node's built-in `node --test` (`test/*.test.js`). No framework —
  import from `node:test` and `node:assert/strict`.
- **Coverage:** `node --test --experimental-test-coverage`, with thresholds
  `--test-coverage-lines=85 --test-coverage-branches=85
  --test-coverage-functions=80` (see `npm run test:coverage`).
- **Mutation testing:** Stryker (`npm run mutation`) to verify tests actually
  *catch* changes, not just execute lines.
- **Lint / format:** Biome.
- **Architecture:** dependency-cruiser (`npm run graph:validate`).

## Philosophy

### Tests exist to catch real bugs — not to be decorative

A test has value only if a **realistic defect** would fail it. Before writing
a test, name the bug it would catch. If you can't, it isn't earning its place.

- **Good tests** assert *behaviour and invariants* a refactor could break:
  - movement/collision rules (a tank must not be pushed into impassable
    terrain),
  - the damage model (rear hits on a tank are instant-kill; squad damage
    kills one member per whole point),
  - pathfinding (a bot escapes a U-shape instead of getting stuck),
  - faction-fill rules (Battle fills each team to `teamSize`; solo Skirmish
    adds exactly one bot).
- **Vanity tests** are those that freeze implementation details or assert
  trivia — e.g. "the function returns 0 when given 0" or asserting a private
  field's value in a way that a refactor would (and should) break without any
  behaviour change. Rewrite or remove them.

### Test the seam, not the implementation

Test through the public interface — the function, the class method, the
component — so the test stays green across an internal refactor. A test that
must be rewritten every time the implementation is cleaned up is testing the
wrong thing.

### Coverage is a floor, not a goal

The coverage thresholds are a **minimum safety net**, not a target to game.
Hitting 85% by asserting getters does not protect the game; it just makes the
number lie.

**Known caveat:** the reported coverage is now honest — every `js/` module is
imported by at least one test. The render layer (`renderer.js` + the whole
`js/render/` package) is measured via `test/render.test.js`'s
recording-context smoke tests; the match simulation, menus, audio, particles,
camera, the game-mode strategies, the vehicle behaviours, and the AI package
are measured by `game.test.js` (Game suite), `menu.test.js`, `audio.test.js`,
`particles.test.js`, `camera.test.js`, `modes.test.js`, `vehicles.test.js`,
`ai.test.js`, `arbitration.test.js`, `signals.test.js`, `discovery.test.js`,
and `ai-modules.test.js` (the latter pins the
`js/ai/` seams directly). The aggregate gate (~97% line / ~90% branch / ~94%
funcs at last check) is a floor, not a target — keep the untested-modules gap
closed: any new module must be imported by a test or it silently drops out of
the report.

### Determinism where it matters; tolerance where it can't be

- **Deterministic where possible.** Use explicit flat maps (`customMap`) for
  obstacle-course and navigation tests so random terrain can't flake the test.
- **Config values are not fixtures.** The suite runs against whatever
  `js/config/tuning.js` contains — a feature, since tuned values that break
  behaviour *should* fail tests. But it means a test may never secretly
  depend on a tunable value. The rule: **invariant tests stay
  value-agnostic** — derive geometry from live config (read the constant,
  like the crowding and flank-offset tests do) or make the geometry robust
  across the plausible range (e.g. a wall block wider than any sane
  repulsion offset). **Scenario tests that genuinely need a specific stage
  declare it** via `withParams([["CONFIG.X", v], …], fn)` from helpers,
  which restores the live values afterwards. Never inherit a tunable value
  implicitly.
- **Tolerant where the system is genuinely random.** AI aim wobble introduces
  ~5% nondeterminism. For critical AI tests, use generous time limits and
  progress-based assertions ("final distance decreased") instead of exact
  arrival checks.
- Never fix a flaky test by loosening an assertion past the point where it
  still catches the bug — that converts a real test into a vanity test.

### Tests are part of the refactor, not a gate before it

When a refactor changes behaviour intentionally, the tests change *with* it.
The goal is not to keep the old tests green by adding a compatibility shim
(see principle #2 in the root guide) — it is to update the tests to express
the new, intended behaviour, and delete the ones that encoded the old shape.

## Conventions

### Helpers (`test/helpers.js`)

Reusable, deterministic utilities:

- `customMap(obstacles)` — fully flat grass map (deterministic, no random
  terrain). **Use this for obstacle-course tests.**
- `wallH` / `wallV` / `wallU` / `wallL` — parametric obstacle builders.
- `zigzag(...)` — multiple walls with alternating gaps.
- `createBot(x, y, angle, map)` — a bot tank + AI controller.
- `simulateNavigation(...)` — run N seconds; returns
  `{ reachedTarget, finalDist, maxStuck, elapsed }`.
- `simulateTeam(...)` — full 5v5 with separation physics.
- `fakeCtx()` — a recording 2D context (every method call is a no-op logged
  to `calls`) for render smoke tests: assert "drew and did not throw", never
  pixel output.
- `fakeDevice({ held, pressed })` — a one-shot InputDevice: `held` actions
  report as isDown/analog, `pressed` actions are consumed by a single
  `wasPressed` call (edge-triggered across frames). Use it to drive human
  tanks and menu navigation.
- `withParams(patches, fn)` — run `fn` with temporary CONFIG/VEHICLES
  overrides (restored after). For scenario tests whose stage needs a
  specific tunable value; invariant tests should derive from live config
  instead (see "Config values are not fixtures" above).
- `randomMap()` — random map with base compounds; returns
  `{ map, layouts }`. Derive passable spawn points near a compound centre
  with `map.getBaseSpawnPoint(layout.center.x, layout.center.y)`.

### Per-suite notes

- **Render tests** (`render.test.js`) drive the `js/render/` package through
  hand-built game fixtures (real `Tank`/`Bullet`/structure entities, fake
  game-shaped objects) so the package is exercised without dragging the whole
  match simulation into the coverage report. The depth-sort contract
  (`collectDepthItems`) is tested directly — never regress the two-pass
  ordering.

- **AI navigation** is slightly nondeterministic (aim wobble). Allow ~5%
  flake on tight courses; prefer progress assertions and generous time limits.
- **AI module tests** (`ai-modules.test.js`) pin the `js/ai/` package seams
  directly (`steerToPoint`, `updatePath`/`pickWaypoint`, `updateStuck` /
  `handleStuck` / `evade` / `tryShootWall`, `steerTurretTo` / `updateWobble`,
  `chooseGoalAndTarget` swarm arbitration) using `createBot` + flat
  `customMap` maps. The controller-level and emergent-behaviour suites
  (`ai.test.js`, `arbitration.test.js`) exercise the same code end-to-end
  through `AIController.think` — the direct tests guard the extracted seams
  so a future AI rework starts from a green baseline.
  Target-priority scoring is tested through `targeting.bestTarget` directly
  (in `ai.test.js`), not through a private controller method.
- **Map tests** should place tiles explicitly (`map.setTile`) rather than rely
  on random generation, which may not contain the tile you're asserting on.
- **Game tests** build matches through the public `Game`/`planFactions` seam,
  not by poking internals. The Game suite in `game.test.js` constructs
  two-human skirmish matches (zero bots → deterministic) and battle matches
  with `teamSize: 1` (zero bots) for the base/tower paths; bots are only used
  when testing bot-specific behaviour (AI per-life reset, the AI think
  loop). Where a deep code path can't be reached deterministically through
  `update()` (artillery splash, crush resolution, watch towers, structure
  destruction), the suite calls the `_`-prefixed method directly after
  arranging state through public entities — assert on events/state, not
  internals. Firing tests drive the vehicle behaviours directly
  (`getVehicleBehaviour(tank.vehicleType).fire(game, tank, device, dt)`)
  against a real `Game`, and geometry queries are asserted on the shared API
  (`game.map.hasLineOfSight`, `game.map.canStand`).
- **Vehicle behaviour tests** (`vehicles.test.js`) exercise each strategy in
  `js/vehicles/` in isolation against a minimal stub game (bullets,
  particles, emit, allTanks, baseStructures, damageables, enemiesOf, map,
  applyDamage, damageTileAt) with real `Tank`/`GameMap` entities — this keeps
  the firing/attack rules unit-testable without a full match. If a behaviour
  needs a new Game seam, add it to the stub and to the real Game, not around
  the stub.
- **Mode tests** (`modes.test.js`) exercise the Skirmish/Battle hooks in
  `js/modes.js` against a stub game (spawn, checkWin, onKill, respawn,
  labels, aiObjective, afterSeparation/afterBullets dispatch). Win-condition
  and scoring rules are tested here in isolation and again through `Game` in
  `game.test.js`.
- **Menu tests** (`menu.test.js`) drive `Menu.update` with one-shot fake
  devices — reuse the same device object across frames so the host keeps its
  identity, and re-`press` the action for each frame it should fire. The
  screens now live in `js/menu/` as strategy objects; the tests keep using the
  public `Menu` seam, and the vehicle-preview smoke test in `render.test.js`
  drives `js/menu/background.js#drawMenuVehicle` directly.
- **Audio tests** (`audio.test.js`) install a fake `window.AudioContext`
  (recording nodes) via `withAudioContext` and assert wiring through
  `hookIntoGame` with spy play methods plus node creation for each sound.

## Checklist for a new test

1. What realistic bug would this catch? (Write it down — if you can't, skip
   the test.)
2. Am I testing behaviour/invariants, or implementation details?
3. Is it deterministic, or genuinely tolerant of randomness?
4. Will it survive the refactor I'm about to do (or the one planned in
   `docs/refactor_opportunities.md`)?
5. Does it add signal, or just lines to hit a coverage number?
