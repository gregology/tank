/**
 * Acceptance suite: bot-vs-bot battles with no human input must reliably
 * produce, across many seeded random maps:
 *   exploration  — both factions cover ground beyond their spawn crust
 *   discovery    — BOTH factions' intel learns the enemy base
 *   convergence  — forces actually engage (deaths on both sides)
 *   a winner     — the match resolves within the cap
 *
 * Bugs this catches: an AI regression that stops exploration (coverage
 * floor), breaks discovery (fog-of-war/intel regressions), stalls the
 * siege (decisiveness), or reintroduces faction asymmetry (both factions
 * must discover, not just one).
 *
 * Matches run headless through the same runner the tuning sweeps use
 * (tools/sim.js), so this suite is the tuneable target: parameter changes
 * that break these invariants SHOULD fail the suite.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runMatch } from "../tools/sim.js";

describe("bot-vs-bot battle acceptance", () => {
    // The criterion is that matches RESOLVE, not that they resolve fast —
    // pacing is the sweep's optimization target. 900s covers the slow
    // wars of attrition that choke-point terrain legitimately produces.
    const MATCHES = { map: 64, teamSize: 3, cap: 900 };

    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        it(`seed ${seed}: exploration, mutual discovery, convergence, winner`, () => {
            const r = runMatch({ ...MATCHES, seed });
            assert.ok(
                r.coverage["1"] > 0.03 && r.coverage["2"] > 0.03,
                `both factions explore: ${JSON.stringify(r.coverage)}`,
            );
            assert.ok(r.discovery["1"] !== null, `faction 1 discovers the enemy base (seed ${seed})`);
            assert.ok(r.discovery["2"] !== null, `faction 2 discovers the enemy base (seed ${seed})`);
            assert.ok(r.deaths["1"] > 0 && r.deaths["2"] > 0, `forces engage: ${JSON.stringify(r.deaths)}`);
            assert.ok(r.winner !== null, `a winner emerges within the cap (seed ${seed}, ${r.duration}s)`);
        });
    }

    it("no hard faction sweep across the set", () => {
        // Guards against systematic faction bias (the persona-era bug was
        // a 30/30 sweep; the fixed-diagonal base placement later gave the
        // NE position ~80% — random repulsion-sampled placement fixed it).
        // Floor: neither faction may be swept out of a 16-seed set.
        const results = Array.from({ length: 16 }, (_, i) => runMatch({ ...MATCHES, seed: i + 1 }));
        const wins = { 1: 0, 2: 0 };
        for (const r of results) if (r.winner !== null) wins[r.winner]++;
        assert.ok(wins[1] >= 2 && wins[2] >= 2, `neither faction may be swept: ${JSON.stringify(wins)}`);
    });
});
