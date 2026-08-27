/**
 * Match determinism tests (js/rng.js + seed plumbing through Game).
 *
 * The headless simulator and the tuning sweeps stand or fall on one
 * invariant: same seed + same settings ⇒ bit-for-bit identical match.
 * These tests exist to catch the classic regressions:
 *   - an unseeded Math.random() sneaking into the simulation path,
 *   - a consumer drawing from the wrong stream (one bot's rolls shifting
 *     another bot's decisions),
 *   - the map seed being ignored or re-drawn.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Game } from "../js/game.js";
import { GameMap } from "../js/map.js";
import { deriveSeed, mulberry32 } from "../js/rng.js";

/** A pure bot-vs-bot battle: the shape the headless simulator runs. */
function battleMatch(seed, overrides = {}) {
    return new Game({
        gameType: "battle",
        humans: [],
        settings: {
            mapSize: { w: 64, h: 64 },
            buildingDensity: 1.0,
            baseType: "compound",
            teamSize: 3,
            ...overrides,
            seed,
        },
    });
}

/** The full observable match state we require to be reproducible. */
function snapshot(game) {
    return {
        tiles: Array.from(game.map.tiles),
        tanks: game.allTanks.map((t) => ({
            id: t.playerNumber,
            type: t.vehicleType,
            team: t.team,
            x: t.x,
            y: t.y,
            angle: t.angle,
            alive: t.alive,
        })),
        time: game.gameTime,
    };
}

describe("mulberry32 / deriveSeed", () => {
    it("same seed produces the identical stream", () => {
        const a = mulberry32(1234);
        const b = mulberry32(1234);
        for (let i = 0; i < 100; i++) assert.equal(a(), b());
    });

    it("different seeds produce different streams", () => {
        const a = mulberry32(1);
        const b = mulberry32(2);
        const same = Array.from({ length: 20 }, () => a() === b()).filter(Boolean);
        assert.ok(same.length === 0, "streams from different seeds must diverge immediately");
    });

    it("derived streams are independent of each other", () => {
        // Catches salt collisions: bot 1's decisions must not be bot 2's.
        const a = mulberry32(deriveSeed(42, 1));
        const b = mulberry32(deriveSeed(42, 2));
        const seqA = Array.from({ length: 10 }, () => a());
        const seqB = Array.from({ length: 10 }, () => b());
        assert.notDeepEqual(seqA, seqB);
        // …and deriving again reproduces the same stream exactly.
        const a2 = mulberry32(deriveSeed(42, 1));
        assert.deepEqual(
            seqA,
            Array.from({ length: 10 }, () => a2()),
        );
    });
});

describe("Game seed plumbing", () => {
    it("same seed → identical map and initial placement", () => {
        const g1 = battleMatch(777);
        const g2 = battleMatch(777);
        assert.deepEqual(snapshot(g1), snapshot(g2));
    });

    it("different seeds → different maps", () => {
        const g1 = battleMatch(1);
        const g2 = battleMatch(2);
        assert.notDeepEqual(Array.from(g1.map.tiles), Array.from(g2.map.tiles));
    });

    it("an explicit seed survives construction (map is generated from it)", () => {
        const game = battleMatch(555);
        assert.equal(game.map.seed, 555);
        // Pure terrain generation is reproducible from the seed alone
        // (the game's map additionally has compounds stamped onto it).
        const m1 = new GameMap(64, 64, 1.0, undefined, 555);
        const m2 = new GameMap(64, 64, 1.0, undefined, 555);
        assert.deepEqual(Array.from(m1.tiles), Array.from(m2.tiles));
    });

    it("same-seed matches stay bit-identical after 600 simulated frames", () => {
        const g1 = battleMatch(2024);
        const g2 = battleMatch(2024);
        for (let f = 0; f < 600; f++) {
            g1.update(0.016);
            g2.update(0.016);
        }
        assert.deepEqual(snapshot(g1), snapshot(g2));
    });

    it("the restart sequence is reproducible from the initial seed", () => {
        const g1 = battleMatch(99);
        const g2 = battleMatch(99);
        g1.restart();
        g2.restart();
        assert.deepEqual(snapshot(g1), snapshot(g2));
        assert.notEqual(g1.map.seed, 99, "restart must draw a fresh map seed");
    });

    it("two same-seed matches produce identical bot decisions (per-bot streams)", () => {
        // If all bots shared one stream, consumption order would couple
        // them; derived per-bot streams keep each bot's decisions stable.
        const g1 = battleMatch(31337);
        const g2 = battleMatch(31337);
        for (let f = 0; f < 120; f++) {
            g1.update(0.016);
            g2.update(0.016);
        }
        const keys1 = g1.bots.map(({ tank }) => game_botKeys(g1, tank));
        const keys2 = g2.bots.map(({ tank }) => game_botKeys(g2, tank));
        assert.deepEqual(keys1, keys2);
    });
});

/** The bot's current key state — a direct read of its decided actions. */
function game_botKeys(game, tank) {
    const bot = game.getBot(tank);
    return Object.keys(bot.ai.keys)
        .filter((k) => bot.ai.keys[k])
        .sort();
}
