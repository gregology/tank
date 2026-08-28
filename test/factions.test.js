import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAYER_COLORS } from "../js/config.js";
import { firstUnusedTeam, planFactions } from "../js/factions.js";

describe("planFactions – Skirmish", () => {
    it("one human creates a single bot opponent", () => {
        const factions = planFactions("skirmish", [{ team: 1 }]);
        assert.equal(factions.length, 2);
        assert.equal(factions[0].humanCount, 1);
        assert.equal(factions[1].humanCount, 0);
        assert.equal(factions[1].botCount, 1);
    });

    it("two humans on separate teams create no bots", () => {
        const factions = planFactions("skirmish", [{ team: 1 }, { team: 2 }]);
        assert.equal(factions.length, 2);
        assert.equal(
            factions.reduce((s, f) => s + f.botCount, 0),
            0,
        );
    });

    it("every human on one team creates exactly one bot", () => {
        const factions = planFactions("skirmish", [{ team: 1 }, { team: 1 }, { team: 1 }]);
        assert.equal(factions.length, 2);
        assert.equal(factions[0].humanCount, 3);
        assert.equal(factions[1].botCount, 1);
    });

    it("assigns each faction its own colour", () => {
        const factions = planFactions("skirmish", [{ team: 1 }, { team: 3 }]);
        assert.deepEqual(factions.map((f) => f.color).sort(), [PLAYER_COLORS[0].color, PLAYER_COLORS[2].color].sort());
    });

    it("picks the lowest unused team for the bot", () => {
        // All humans on green (team 3) → bot takes red (team 1).
        const factions = planFactions("skirmish", [{ team: 3 }]);
        assert.equal(factions[1].id, 1);
        assert.equal(factions[1].color, PLAYER_COLORS[0].color);
    });
});

describe("planFactions – Battle", () => {
    it("fills each team to teamSize with bots", () => {
        const factions = planFactions("battle", [{ team: 1 }, { team: 1 }], 5);
        const red = factions.find((f) => f.id === 1);
        const blue = factions.find((f) => f.id === 2);
        assert.equal(red.humanCount, 2);
        assert.equal(red.botCount, 3);
        assert.equal(blue.humanCount, 0);
        assert.equal(blue.botCount, 5);
    });

    it("caps bot count at zero when humans exceed teamSize", () => {
        const factions = planFactions("battle", [{ team: 1 }, { team: 1 }, { team: 1 }], 2);
        assert.equal(factions.find((f) => f.id === 1).botCount, 0);
    });

    it("always produces the fixed RED and BLUE factions", () => {
        const factions = planFactions("battle", [], 3);
        assert.deepEqual(
            factions.map((f) => [f.id, f.color]),
            [
                [1, PLAYER_COLORS[0].color],
                [2, PLAYER_COLORS[1].color],
            ],
        );
    });
});

describe("firstUnusedTeam", () => {
    it("returns the lowest absent team id", () => {
        assert.equal(firstUnusedTeam(new Set([1])), 2);
        assert.equal(firstUnusedTeam(new Set([1, 2, 3])), 4);
        assert.equal(firstUnusedTeam(new Set([2, 3, 4])), 1);
    });
});
