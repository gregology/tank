/**
 * Tuning-tooling tests (tools/sweep.js, tools/render-config.js).
 *
 * Bugs these catch:
 *   - sweep results that depend on thread count (the reproducibility
 *     contract the whole tuning workflow rests on),
 *   - scoring math that doesn't actually prefer better metrics,
 *   - sampling that ignores declared ranges or drops the defaults
 *     baseline,
 *   - config regeneration that doesn't round-trip (an adopted value
 *     that never reaches the game).
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SWARM, SWARM_TUNABLES } from "../js/config.js";
import { renderSwarmConfig } from "../tools/render-config.js";
import { DEFAULT_GOALS, runTasks, sampleCandidates, scoreMetrics } from "../tools/sweep.js";

describe("sweep sampling", () => {
    it("is reproducible from the sweep seed and always keeps defaults as candidate 0", () => {
        const a = sampleCandidates(8, 42);
        const b = sampleCandidates(8, 42);
        assert.deepEqual(a, b, "same sweep seed → same candidates");
        assert.equal(a[0].name, "defaults");
        assert.deepEqual(a[0].params, {}, "candidate 0 is the untouched baseline");

        const c = sampleCandidates(8, 43);
        assert.notDeepEqual(c.slice(1), a.slice(1), "a different seed samples different sets");
    });

    it("samples every value within its declared range", () => {
        for (const cand of sampleCandidates(30, 7)) {
            for (const [key, v] of Object.entries(cand.params)) {
                const t = SWARM_TUNABLES.find((x) => x.key === key);
                assert.ok(t, `${key} is a real tunable`);
                assert.ok(v >= t.min && v <= t.max, `${key}=${v} within [${t.min}, ${t.max}]`);
            }
        }
    });
});

describe("sweep scoring", () => {
    const baseline = { decisive: 0.5, discovery: 0.5, duration: 300, firstContact: 30, coverage: 0.1, clustering: 15 };

    it("better metrics beat the baseline, worse metrics lose", () => {
        const better = { decisive: 1, discovery: 1, duration: 150, firstContact: 15, coverage: 0.2, clustering: 10 };
        const worse = {
            decisive: 0.25,
            discovery: 0.25,
            duration: 500,
            firstContact: 60,
            coverage: 0.05,
            clustering: 25,
        };
        assert.ok(scoreMetrics(better, baseline, DEFAULT_GOALS) > 0);
        assert.ok(scoreMetrics(worse, baseline, DEFAULT_GOALS) < 0);
    });

    it("a heavier goal weight moves the score more", () => {
        const faster = { ...baseline, duration: 100 };
        const light = scoreMetrics(faster, baseline, { duration: -1 });
        const heavy = scoreMetrics(faster, baseline, { duration: -3 });
        assert.ok(heavy > light, "a 3× weight triples the contribution");
    });
});

describe("sweep execution", () => {
    it("results are identical regardless of worker count", async () => {
        const tasks = [];
        for (const [ci, tuning] of [{}, { W_RALLY: 5 }].entries()) {
            for (const seed of [1, 2]) {
                tasks.push({ key: `${ci}|64|${seed}`, matchOpts: { map: 64, teamSize: 2, cap: 30, seed, tuning } });
            }
        }
        const serial = await runTasks(tasks, 1);
        const parallel = await runTasks(tasks, 3);
        assert.deepEqual([...parallel.entries()].sort(), [...serial.entries()].sort());
    });
});

describe("config regeneration", () => {
    it("round-trips: adopted values land in the regenerated module", async () => {
        const values = { SIGHT_RANGE: 12, W_CONVOY: 9 };
        const text = renderSwarmConfig(SWARM_TUNABLES, values);
        const dir = mkdtempSync(join(tmpdir(), "swarm-cfg-"));
        const file = join(dir, "swarm.js");
        writeFileSync(file, text);
        const mod = await import(`${file}?v=${Date.now()}`);
        assert.equal(mod.SWARM.SIGHT_RANGE, 12, "adopted value present");
        assert.equal(mod.SWARM.W_CONVOY, 9, "second adopted value present");
        assert.equal(mod.SWARM.ALARM_MEMORY, SWARM.ALARM_MEMORY, "untouched keys keep defaults");
        assert.equal(mod.SWARM_TUNABLES.length, SWARM_TUNABLES.length, "schema preserved");
    });
});
