/**
 * Sandbox tests (js/sandbox/).
 *
 * Bugs these catch:
 *   - sliders drifting out of sync with the tunables table (a new
 *     tunable that never appears in the sandbox),
 *   - live tuning writes not reaching the running match (a slider that
 *     does nothing), incl. typos in tunable names,
 *   - the debug renderer crashing on a real match state (each field
 *     overlay + units + intel markers).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SWARM, SWARM_TUNABLES } from "../js/config.js";
import { Game } from "../js/game.js";
import { applyTuning, resetTuning, sliderSpecs } from "../js/sandbox/panel.js";
import { drawSandbox } from "../js/sandbox/view.js";
import { fakeCtx } from "./helpers.js";

import "../js/sandbox/main.js"; // coverage-of-record for the DOM shell

function seededMatch() {
    return new Game({
        gameType: "battle",
        humans: [],
        settings: { mapSize: { w: 64, h: 64 }, buildingDensity: 0.5, baseType: "compound", teamSize: 3, seed: 3 },
    });
}

describe("sandbox panel", () => {
    it("generates one slider per tunable with a sane range", () => {
        const specs = sliderSpecs();
        assert.equal(specs.length, SWARM_TUNABLES.length, "every tunable gets a slider");
        for (const s of specs) {
            assert.ok(s.min < s.max, `${s.key}: min < max`);
            assert.ok(s.value >= s.min && s.value <= s.max, `${s.key}: default within range`);
            assert.ok(s.step > 0, `${s.key}: positive step`);
        }
    });

    it("applyTuning writes live into the match; unknown keys are rejected", () => {
        const game = seededMatch();
        applyTuning(game, "SIGHT_RANGE", 12);
        assert.equal(game.tuning.SIGHT_RANGE, 12);
        assert.equal(game.swarms.get(1).tuning.SIGHT_RANGE, 12, "the swarm reads the same live object");
        assert.throws(() => applyTuning(game, "SIGHT_RAANGE", 5), /unknown tunable/);
    });

    it("resetTuning restores table defaults", () => {
        const game = seededMatch();
        applyTuning(game, "SIGHT_RANGE", 12);
        resetTuning(game);
        assert.equal(game.tuning.SIGHT_RANGE, SWARM.SIGHT_RANGE);
    });
});

describe("sandbox view", () => {
    it("draws a running match with every field overlay without throwing", () => {
        const game = seededMatch();
        for (let f = 0; f < 120; f++) game.update(1 / 60); // let signals accumulate
        for (const field of [null, "visited", "trail", "alarm", "food"]) {
            const { ctx, calls } = fakeCtx();
            assert.doesNotThrow(() => drawSandbox(ctx, game, { field, factionId: 1, width: 400, height: 400 }));
            assert.ok(calls.includes("fillRect"), "tiles/units drawn");
        }
    });
});
