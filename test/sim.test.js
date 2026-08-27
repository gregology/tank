/**
 * Headless sim-runner tests (tools/sim.js).
 *
 * Bugs these catch:
 *   - nondeterminism leaking into the measurement harness (tuning on
 *     irreproducible numbers would be noise-chasing),
 *   - metric math regressions (NaN clustering when a faction is down to
 *     one unit, coverage outside (0,1], duration past the cap),
 *   - discovery metrics appearing in skirmish, where there are no
 *     objectives to discover (the metric mirrors the swarm rule:
 *     discovery applies to objectives/structures only).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runMatch, summarize } from "../tools/sim.js";

const FAST = { map: 64, teamSize: 2, density: 0.5, cap: 60 };

describe("runMatch", () => {
    it("is deterministic: same seed → identical metrics", () => {
        const a = runMatch({ ...FAST, seed: 11 });
        const b = runMatch({ ...FAST, seed: 11 });
        assert.deepEqual(a, b);
    });

    it("metrics stay within their domains", () => {
        const r = runMatch({ ...FAST, seed: 3 });
        assert.ok(r.duration > 0 && r.duration <= FAST.cap, "duration within the cap");
        assert.equal(typeof r.timedOut, "boolean");
        for (const id of Object.keys(r.coverage)) {
            assert.ok(r.coverage[id] > 0 && r.coverage[id] <= 1, `coverage[${id}] in (0,1]`);
            const c = r.clustering[id];
            assert.ok(c === null || (Number.isFinite(c) && c > 0), `clustering[${id}] finite or null`);
            const d = r.discovery[id];
            assert.ok(d === null || (d > 0 && d <= r.duration + 0.5), `discovery[${id}] within the match`);
        }
    });

    it("skirmish has no discovery metrics (no objectives)", () => {
        const r = runMatch({ ...FAST, type: "skirmish", seed: 5 });
        for (const id of Object.keys(r.discovery)) {
            assert.equal(r.discovery[id], null);
        }
    });
});

describe("summarize", () => {
    it("aggregates stay within [0,1] and counts add up", () => {
        const results = [3, 4, 5].map((seed) => runMatch({ ...FAST, seed }));
        const s = summarize(results);
        assert.equal(s.matches, 3);
        assert.ok(s.decisiveFraction >= 0 && s.decisiveFraction <= 1);
        for (const id of Object.keys(s.discoveryRate)) {
            assert.ok(s.discoveryRate[id] >= 0 && s.discoveryRate[id] <= 1);
        }
    });
});
