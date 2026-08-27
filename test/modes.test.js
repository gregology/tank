/**
 * Game-mode strategy tests (js/modes.js) — each hook is exercised with
 * a minimal stub game exposing the public world-model surface the modes
 * use (allTanks / humanTanks / factions / bases / scores + setBases /
 * creditKill / nearestEnemy), so the Skirmish-vs-Battle branching is
 * unit-testable without a full match.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFIG } from "../js/config.js";
import { GameMap } from "../js/map.js";
import { getMode } from "../js/modes.js";
import { Tank } from "../js/tank.js";
import { randomMap } from "./helpers.js";

/** A stub Game with the public fields and methods a mode hook reads/writes. */
function stubGame(overrides = {}) {
    const game = {
        map: new GameMap(undefined, undefined, undefined, undefined, undefined, "compound"),
        settings: {},
        factions: [],
        bases: [],
        baseStructures: [],
        structureMap: new Map(),
        humanTanks: [],
        scores: new Map(),
        allTanks: [],
        pushFromStructures: () => {
            game.pushed = true;
        },
        updateWatchTowers: () => {
            game.towersUpdated = true;
        },
        setBases: (bases) => {
            game.bases = bases;
            game.baseStructures = bases.flatMap((b) => b.allStructures);
            game.structureMap = new Map();
            for (const s of game.baseStructures) {
                for (const pos of s.tilePositions) {
                    game.structureMap.set(`${pos.gx},${pos.gy}`, s);
                }
            }
        },
        creditKill: (factionId) => {
            game.scores.set(factionId, (game.scores.get(factionId) ?? 0) + 1);
        },
        nearestEnemy: () => null,
        rng: Math.random,
        ...overrides,
    };
    return game;
}

describe("mode dispatch", () => {
    it("skirmish has no bases; battle does", () => {
        assert.equal(getMode("skirmish").hasBases, false);
        assert.equal(getMode("battle").hasBases, true);
        assert.equal(getMode("unknown-mode").hasBases, false, "unknown game types default to skirmish");
    });
});

describe("battle mode", () => {
    it("init builds two compounds and registers their structures", () => {
        const game = stubGame({
            factions: [
                { id: 1, color: "#cc3333", darkColor: "#882222" },
                { id: 2, color: "#3366dd", darkColor: "#223399" },
            ],
        });
        getMode("battle").init(game);
        assert.equal(game.bases.length, 2);
        for (const base of game.bases) {
            assert.ok(base.hq, "HQ built");
            assert.ok(base.towers.length > 0, "watch towers built");
        }
        assert.ok(game.baseStructures.length >= 2, "structures registered");
        assert.ok(game.structureMap.size > 0, "tile → structure map populated");
        const pos = game.baseStructures[0].tilePositions[0];
        assert.equal(game.structureMap.get(`${pos.gx},${pos.gy}`), game.baseStructures[0]);
    });

    it("spawn places tanks inside their own compound", () => {
        const game = stubGame({
            factions: [
                { id: 1, color: "#cc3333", darkColor: "#882222", entities: [] },
                { id: 2, color: "#3366dd", darkColor: "#223399", entities: [] },
            ],
        });
        const mode = getMode("battle");
        mode.init(game);
        const tank1 = new Tank(1, "#cc3333", "#882222");
        tank1.team = 1;
        const tank2 = new Tank(1, "#3366dd", "#223399");
        tank2.team = 2;
        game.allTanks = [tank1, tank2];
        game.factions = [
            { id: 1, entities: [tank1] },
            { id: 2, entities: [tank2] },
        ];
        mode.spawn(game);
        const base1 = game.bases.find((b) => b.team === 1);
        assert.ok(
            Math.abs(tank1.x - base1.center.x) < 20 && Math.abs(tank1.y - base1.center.y) < 20,
            "team 1 tank spawned near its compound",
        );
    });

    it("checkWin returns the surviving faction when an HQ is destroyed", () => {
        const mode = getMode("battle");
        const game = stubGame({
            bases: [
                { alive: false, team: 1 },
                { alive: true, team: 2 },
            ],
        });
        assert.equal(mode.checkWin(game), 2);
        const noWinner = stubGame({
            bases: [
                { alive: true, team: 1 },
                { alive: true, team: 2 },
            ],
        });
        assert.equal(mode.checkWin(noWinner), null);
    });

    it("onKill does not score (respawns are timed)", () => {
        const mode = getMode("battle");
        const game = stubGame({ scores: new Map([[1, 3]]) });
        mode.onKill(game, 1, {});
        assert.equal(game.scores.get(1), 3);
    });

    it("respawn returns a compound spawn while the base lives, else a free spawn", () => {
        const mode = getMode("battle");
        const withBase = stubGame({
            bases: [{ team: 1, alive: true, center: { x: 30, y: 30 } }],
        });
        const sp = mode.respawn(withBase, { team: 1 });
        assert.ok(sp && typeof sp.x === "number", "compound spawn point returned");

        const deadBase = stubGame({
            bases: [{ team: 1, alive: false, center: { x: 30, y: 30 } }],
        });
        const free = mode.respawn(deadBase, { team: 1 });
        assert.ok(free && typeof free.x === "number", "fallback free spawn returned");
    });

    it("afterSeparation / afterBullets dispatch to the base-only steps", () => {
        const game = stubGame();
        const mode = getMode("battle");
        mode.afterSeparation(game);
        mode.afterBullets(game, 0.016);
        assert.ok(game.pushed, "structure pushing runs in battle");
        assert.ok(game.towersUpdated, "watch towers update in battle");
    });

    it("labels are RED / BLUE", () => {
        const mode = getMode("battle");
        assert.equal(mode.factionLabel({}, { id: 1 }), "RED");
        assert.equal(mode.factionLabel({}, { id: 2 }), "BLUE");
        assert.equal(mode.winnerLabel({}, { id: 1 }), "RED TEAM");
        assert.equal(mode.winnerLabel({}, { id: 2 }), "BLUE TEAM");
    });
});

describe("skirmish mode", () => {
    it("checkWin returns the first faction at WIN_SCORE", () => {
        const mode = getMode("skirmish");
        const game = stubGame({
            scores: new Map([
                [1, CONFIG.WIN_SCORE],
                [2, 3],
            ]),
        });
        assert.equal(mode.checkWin(game), 1);
        const noWinner = stubGame({ scores: new Map([[1, CONFIG.WIN_SCORE - 1]]) });
        assert.equal(mode.checkWin(noWinner), null);
    });

    it("onKill credits the killer and reserves the dead tank's respawn spot", () => {
        const mode = getMode("skirmish");
        const game = stubGame({ scores: new Map([[1, 0]]) });
        const dead = new Tank(1, "#c33", "#822");
        dead.x = 1;
        dead.y = 1;
        mode.onKill(game, 1, dead);
        assert.equal(game.scores.get(1), 1, "kill credited");
        assert.ok(typeof dead.x === "number" && dead.x !== 1, "respawn position reserved at kill time");
    });

    it("respawn returns null — the position was set at kill time", () => {
        const mode = getMode("skirmish");
        assert.equal(mode.respawn(stubGame(), {}), null);
    });

    it("afterSeparation / afterBullets are no-ops", () => {
        const mode = getMode("skirmish");
        const game = stubGame();
        mode.afterSeparation(game);
        mode.afterBullets(game, 0.016);
        assert.equal(game.pushed, undefined, "no structure pushing in skirmish");
        assert.equal(game.towersUpdated, undefined, "no watch towers in skirmish");
    });

    it("labels follow humans: P1 / BOT / colour label", () => {
        const mode = getMode("skirmish");
        const p1 = new Tank(1, "#cc3333", "#882222");
        p1.team = 1;
        const game = stubGame({ humanTanks: [p1] });
        assert.equal(mode.factionLabel(game, { id: 1, color: "#cc3333" }), "P1");
        assert.equal(mode.factionLabel(game, { id: 2, color: "#3366dd" }), "BOT");
        assert.equal(mode.winnerLabel(game, { id: 1, color: "#cc3333" }), "PLAYER 1");
        assert.equal(mode.winnerLabel(game, { id: 2, color: "#3366dd" }), "BOT");

        // A multi-human team falls back to the colour label.
        const p2 = new Tank(2, "#cc3333", "#882222");
        p2.team = 1;
        const teamGame = stubGame({ humanTanks: [p1, p2] });
        assert.equal(mode.factionLabel(teamGame, { id: 1, color: "#cc3333" }), "RED");
        assert.equal(mode.winnerLabel(teamGame, { id: 1, color: "#cc3333" }), "RED TEAM");
    });
});

describe("real map integration", () => {
    it("battle mode init + spawn works on a real generated map", () => {
        const { map } = randomMap();
        const game = stubGame({
            map,
            factions: [
                { id: 1, color: "#cc3333", darkColor: "#882222", entities: [] },
                { id: 2, color: "#3366dd", darkColor: "#223399", entities: [] },
            ],
        });
        const mode = getMode("battle");
        mode.init(game);
        game.allTanks = game.factions.flatMap((f) => f.entities);
        mode.spawn(game);
        assert.equal(game.allTanks.length, 0, "no entities yet — spawn is a no-op over empty factions");
        assert.equal(game.bases.length, 2);
    });
});
