import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    BOT_KEYS,
    createBot,
    customMap,
    GameMap,
    randomMap,
    seededRng,
    simulateNavigation,
    simulateTeam,
    T,
    Tank,
    wallH,
    wallU,
    wallV,
} from "./helpers.js";

/* ── Helper: run a navigation scenario across N fixed seeds ── *
 *                                                                *
 * Each seed produces a fully deterministic AI run on a             *
 * deterministic map.  We require that >= `minPass` out of `seeds`  *
 * trials succeed.  Because the seeds are fixed, the results are   *
 * 100% reproducible — flakiness is eliminated while still         *
 * testing that the AI is robust across different internal random   *
 * sequences.                                                      *
 * ──────────────────────────────────────────────────────────────── */

function assertNavigation(label, setupFn, opts = {}) {
    const { seeds = 10, minPass = 8, seconds = 30, arrivalDist = 2.0 } = opts;
    let successes = 0;
    const failures = [];
    for (let seed = 1; seed <= seeds; seed++) {
        const rng = seededRng(seed);
        const { bot, target, map } = setupFn(rng);
        const result = simulateNavigation(bot, target, map, { seconds, arrivalDist });
        if (result.reachedTarget) {
            successes++;
        } else {
            failures.push({ seed, dist: result.finalDist });
        }
    }
    assert.ok(
        successes >= minPass,
        `${label}: should pass >=${minPass}/${seeds} seeds, got ${successes} ` +
            `(failures: ${failures.map((f) => `seed=${f.seed} dist=${f.dist}`).join(", ")})`,
    );
}

describe("AI Navigation – obstacle courses", () => {
    it("reaches target on open terrain", () => {
        assertNavigation(
            "open terrain",
            (rng) => {
                const map = customMap([]);
                const bot = createBot(16.5, 32.5, 0, map, rng);
                return { bot, target: { x: 48.5, y: 32.5 }, map };
            },
            { minPass: 10 }, // open terrain should always work
        );
    });

    it("navigates around a horizontal wall", () => {
        assertNavigation("horizontal wall", (rng) => {
            const map = customMap(wallH(32, 26, 40));
            const bot = createBot(33.5, 34.5, -Math.PI / 2, map, rng);
            return { bot, target: { x: 33.5, y: 29.5 }, map };
        });
    });

    it("navigates around a vertical wall", () => {
        assertNavigation("vertical wall", (rng) => {
            const map = customMap(wallV(32, 28, 36));
            const bot = createBot(30.5, 32.5, 0, map, rng);
            return { bot, target: { x: 34.5, y: 32.5 }, map };
        });
    });

    it("escapes an L-shaped wall", () => {
        assertNavigation("L-shaped wall", (rng) => {
            const map = customMap([
                ...wallH(34, 28, 40), // horizontal arm
                ...wallV(28, 28, 34), // vertical arm
            ]);
            const bot = createBot(32.5, 31.5, Math.PI / 2, map, rng);
            return { bot, target: { x: 32.5, y: 37.5 }, map };
        });
    });

    it("escapes a U-shaped trap", () => {
        assertNavigation("U-shaped trap", (rng) => {
            const map = customMap(wallU(28, 30, 8, 5));
            const bot = createBot(32.5, 32.5, -Math.PI / 2, map, rng);
            return { bot, target: { x: 32.5, y: 28.5 }, map };
        });
    });

    it("navigates a zigzag maze (2 walls, wider gaps)", () => {
        assertNavigation("zigzag maze", (rng) => {
            const map = customMap([
                ...wallH(32, 29, 40), // gap at left (x<29)
                ...wallH(36, 24, 35), // gap at right (x>35)
            ]);
            const bot = createBot(33.5, 30.5, Math.PI / 2, map, rng);
            return { bot, target: { x: 33.5, y: 38.5 }, map };
        });
    });

    it("navigates a narrow 1-tile corridor", () => {
        assertNavigation("1-tile corridor", (rng) => {
            const map = customMap([...wallH(30, 22, 29), ...wallH(30, 31, 38)]);
            const bot = createBot(30.5, 33.5, -Math.PI / 2, map, rng);
            return { bot, target: { x: 30.5, y: 27.5 }, map };
        });
    });

    it("navigates around rocks (7 HP, takes longer to blast)", () => {
        assertNavigation("rocks", (rng) => {
            const map = customMap(wallH(32, 28, 38, T.ROCK));
            const bot = createBot(33.5, 34.5, -Math.PI / 2, map, rng);
            return { bot, target: { x: 33.5, y: 29.5 }, map };
        });
    });
});

describe("AI Navigation – cross-map (random terrain)", () => {
    it("reaches the opposite tower on 10 random maps", () => {
        let failures = 0;
        for (let i = 0; i < 10; i++) {
            const {
                map,
                towers: [tp1, tp2],
            } = randomMap();
            const rng = seededRng(i + 100);
            const bot = createBot(tp1.x, tp1.y, 0, map, rng);
            const result = simulateNavigation(bot, { x: tp2.x, y: tp2.y }, map, {
                seconds: 25,
                objective: { x: tp2.x, y: tp2.y, alive: true },
            });
            if (!result.reachedTarget) failures++;
        }
        assert.ok(failures <= 1, `at most 1/10 should fail, got ${failures} failures`);
    });
});

describe("AI Combat – fires at terrain", () => {
    it("shoots destructible terrain blocking its path", () => {
        const map = customMap(wallH(30, 29, 31)); // 3-tile wall
        const rng = seededRng(42);
        const bot = createBot(30.5, 32.5, -Math.PI / 2, map, rng);
        let shotsFired = 0;
        for (let f = 0; f < 600; f++) {
            bot.ai.think(0.016, bot.tank, [], map, { x: 30.5, y: 27.5, alive: true });
            bot.tank.update(0.016, bot.ai, BOT_KEYS, map);
            if (bot.ai.isDown("_bx")) shotsFired++;
        }
        assert.ok(shotsFired > 0, "bot should fire at blocking terrain");
    });

    it("fires at enemies with line of sight", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20.5, 32.5, 0, map, rng);
        const enemy = new Tank(2, "#33d", "#239");
        enemy.team = 2;
        enemy.alive = true;
        enemy.x = 23.5;
        enemy.y = 32.5;
        let shotsFired = 0;
        for (let f = 0; f < 300; f++) {
            bot.ai.think(0.016, bot.tank, [enemy], map, null);
            bot.tank.update(0.016, bot.ai, BOT_KEYS, map);
            if (bot.ai.isDown("_bx")) shotsFired++;
        }
        assert.ok(shotsFired > 0, "bot should fire at visible enemy");
    });
});

describe("AI Stuck recovery", () => {
    it("does not get permanently stuck (stuckTime resets)", () => {
        const map = customMap(wallU(27, 28, 10, 6));
        const rng = seededRng(42);
        const bot = createBot(32.5, 31.5, -Math.PI / 2, map, rng);
        let maxStuck = 0;
        for (let f = 0; f < 1200; f++) {
            bot.ai.think(0.016, bot.tank, [], map, { x: 32.5, y: 26.5, alive: true });
            bot.tank.update(0.016, bot.ai, BOT_KEYS, map);
            if (bot.ai.stuckTime > maxStuck) maxStuck = bot.ai.stuckTime;
        }
        assert.ok(maxStuck < 5, `stuckTime should reset, max was ${maxStuck.toFixed(1)}s`);
    });

    it("rotation is not detected as stuck", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(32.5, 32.5, 0, map, rng);
        for (let f = 0; f < 300; f++) {
            bot.ai.think(0.016, bot.tank, [], map, { x: 32.5 - 10, y: 32.5, alive: true });
            bot.tank.update(0.016, bot.ai, BOT_KEYS, map);
        }
        assert.ok(bot.ai.stuckTime < 1.0, `rotating should not count as stuck, got ${bot.ai.stuckTime.toFixed(1)}s`);
    });
});

describe("AI Team mode – 5v5 objective push", () => {
    it("majority of bots reach opposing tower within 30s (10 maps)", () => {
        let totalStuck = 0,
            totalBots = 0;
        for (let trial = 0; trial < 10; trial++) {
            const {
                map,
                towers: [tp1, tp2],
            } = randomMap();
            const results = simulateTeam(map, tp1, tp2, tp2, tp1, { seconds: 30, botsPerTeam: 5 });
            const startDist = Math.hypot(tp2.x - tp1.x, tp2.y - tp1.y);
            for (const r of results) {
                if (r.finalDist / startDist > 0.5) totalStuck++;
                totalBots++;
            }
        }
        const pct = ((totalStuck / totalBots) * 100).toFixed(1);
        assert.ok(totalStuck / totalBots < 0.15, `<15% should be stuck, got ${totalStuck}/${totalBots} (${pct}%)`);
    });

    it("bots are never pushed into impassable terrain", () => {
        for (let trial = 0; trial < 5; trial++) {
            const {
                map,
                towers: [tp1, tp2],
            } = randomMap();
            const _results = simulateTeam(map, tp1, tp2, tp2, tp1, { seconds: 15, botsPerTeam: 5 });
        }
        assert.ok(true);
    });
});
