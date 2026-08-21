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
and camera are measured by `game.test.js` (Game suite), `menu.test.js`,
`audio.test.js`, `particles.test.js`, and `camera.test.js`. The aggregate
gate (~96% line / ~88% branch / ~94% funcs at last check) is a floor, not a
target — keep the untested-modules gap closed: any new module must be
imported by a test or it silently drops out of the report.

### Determinism where it matters; tolerance where it can't be

- **Deterministic where possible.** Use explicit flat maps (`customMap`) for
  obstacle-course and navigation tests so random terrain can't flake the test.
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
- `randomMap(...)` — random map (note: currently returns a legacy `towers`
  field that should be treated as removable debt).

### Per-suite notes

- **Render tests** (`render.test.js`) drive the `js/render/` package through
  hand-built game fixtures (real `Tank`/`Bullet`/structure entities, fake
  game-shaped objects) so the package is exercised without dragging the whole
  match simulation into the coverage report. The depth-sort contract
  (`collectDepthItems`) is tested directly — never regress the two-pass
  ordering.

- **AI navigation** is slightly nondeterministic (aim wobble). Allow ~5%
  flake on tight courses; prefer progress assertions and generous time limits.
- **Map tests** should place tiles explicitly (`map.setTile`) rather than rely
  on random generation, which may not contain the tile you're asserting on.
- **Game tests** build matches through the public `Game`/`planFactions` seam,
  not by poking internals. The Game suite in `game.test.js` constructs
  two-human skirmish matches (zero bots → deterministic) and battle matches
  with `teamSize: 1` (zero bots) for the base/tower paths; bots are only used
  when testing bot-specific behaviour (AI role re-assignment, the AI think
  loop). Where a deep code path can't be reached deterministically through
  `update()` (artillery splash, crush resolution, watch towers, structure
  destruction), the suite calls the `_`-prefixed method directly after
  arranging state through public entities — assert on events/state, not
  internals.
- **Menu tests** (`menu.test.js`) drive `Menu.update` with one-shot fake
  devices — reuse the same device object across frames so the host keeps its
  identity, and re-`press` the action for each frame it should fire.
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
