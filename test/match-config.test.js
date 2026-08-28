/**
 * Match-default tunables tests (js/config/match.js).
 *
 * Bugs these catch:
 *   - the opinionated team-size / density / base-type defaults drifting
 *     from the spec (16/24/32, dense, high, compound),
 *   - the map-size index mapping to the wrong team-size tunable,
 *   - a resolver returning the wrong shape, so the lobby builds a broken
 *     MatchConfig (missing teamSize, or skirmish gaining a base type).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    BATTLE_TEAM_SIZE_KEYS,
    battleTeamSize,
    DENSITY_KEYS,
    MATCH_TUNABLES,
    matchTuning,
    opinionatedSettings,
    tunableBounds,
} from "../js/config.js";

describe("match tunables", () => {
    it("pins the opinionated defaults (16/24/32, dense, high)", () => {
        assert.equal(matchTuning("battleTeamSizeSmall"), 16);
        assert.equal(matchTuning("battleTeamSizeMedium"), 24);
        assert.equal(matchTuning("battleTeamSizeLarge"), 32);
        assert.equal(matchTuning("battleDensity"), 1.5, "dense");
        assert.equal(matchTuning("skirmishDensity"), 2, "high");
    });

    it("declares every tunable with a sane range containing its value", () => {
        for (const t of MATCH_TUNABLES) {
            assert.ok(t.min < t.max, `${t.key}: min < max`);
            assert.ok(t.value >= t.min && t.value <= t.max, `${t.key}: value in range`);
        }
    });

    it("maps map-size index to the battle team-size tunable", () => {
        assert.equal(battleTeamSize(0), matchTuning("battleTeamSizeSmall"));
        assert.equal(battleTeamSize(1), matchTuning("battleTeamSizeMedium"));
        assert.equal(battleTeamSize(2), matchTuning("battleTeamSizeLarge"));
    });
});

describe("opinionatedSettings", () => {
    it("resolves battle settings: team size by map, dense density, compound base", () => {
        for (let i = 0; i < 3; i++) {
            const settings = opinionatedSettings("battle", i);
            assert.equal(settings.teamSize, battleTeamSize(i));
            assert.equal(settings.buildingDensity, matchTuning("battleDensity"));
            assert.equal(settings.baseType, "compound");
        }
    });

    it("resolves skirmish settings: density only, no team size or base", () => {
        assert.deepEqual(opinionatedSettings("skirmish", 1), {
            buildingDensity: matchTuning("skirmishDensity"),
        });
    });
});

describe("tunableBounds", () => {
    it("spans the declared ranges of the given keys", () => {
        assert.deepEqual(tunableBounds(BATTLE_TEAM_SIZE_KEYS), { min: 2, max: 32 });
        assert.deepEqual(tunableBounds(DENSITY_KEYS), { min: 0.5, max: 3 });
    });
});
