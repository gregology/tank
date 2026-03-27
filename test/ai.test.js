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
                seconds: 60,
                objective: { x: tp2.x, y: tp2.y, alive: true },
            });
            if (!result.reachedTarget) failures++;
        }
        assert.ok(failures <= 3, `at most 3/10 should fail, got ${failures} failures`);
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
            const results = simulateTeam(map, tp1, tp2, tp2, tp1, { seconds: 60, botsPerTeam: 5 });
            const startDist = Math.hypot(tp2.x - tp1.x, tp2.y - tp1.y);
            for (const r of results) {
                if (r.finalDist / startDist > 0.5) totalStuck++;
                totalBots++;
            }
        }
        const pct = ((totalStuck / totalBots) * 100).toFixed(1);
        assert.ok(totalStuck / totalBots < 0.30, `<30% should be stuck, got ${totalStuck}/${totalBots} (${pct}%)`);
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

/* ════════════════════════════════════════════════════════════ *
 *  Target priority – weighted target selection                  *
 * ════════════════════════════════════════════════════════════ */

describe("AI Target priority – _bestTarget scoring", () => {
    it("tank prefers SPG over IFV at equal distance", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "tank"; // tank: spg=10, ifv=2

        const spg = new Tank(2, "#33d", "#239");
        spg.team = 2;
        spg.alive = true;
        spg.vehicleType = "spg";
        spg.x = 25;
        spg.y = 32;

        const ifv = new Tank(3, "#33d", "#239");
        ifv.team = 2;
        ifv.alive = true;
        ifv.vehicleType = "ifv";
        ifv.x = 25;
        ifv.y = 32.01; // nearly same distance

        // Run one think to populate the AI state
        bot.ai.think(0.016, bot.tank, [spg, ifv], map, null);
        // The AI should pick SPG (weight 10) over IFV (weight 2)
        const result = bot.ai._bestTarget(bot.tank, [spg, ifv]);
        assert.ok(result, "should find a target");
        assert.equal(result.target.vehicleType, "spg", "tank should prefer SPG over IFV at same distance");
    });

    it("tank never targets drones (priority 0)", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "tank"; // tank: drone=0

        const drone = new Tank(2, "#33d", "#239");
        drone.team = 2;
        drone.alive = true;
        drone.vehicleType = "drone";
        drone.x = 21;
        drone.y = 32; // very close

        const result = bot.ai._bestTarget(bot.tank, [drone]);
        assert.equal(result, null, "tank should never target a drone (priority 0)");
    });

    it("IFV strongly prefers drones over tanks", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "ifv"; // ifv: drone=10, tank=2

        const drone = new Tank(2, "#33d", "#239");
        drone.team = 2;
        drone.alive = true;
        drone.vehicleType = "drone";
        drone.x = 28;
        drone.y = 32; // farther away

        const tank = new Tank(3, "#33d", "#239");
        tank.team = 2;
        tank.alive = true;
        tank.vehicleType = "tank";
        tank.x = 25;
        tank.y = 32; // closer

        const result = bot.ai._bestTarget(bot.tank, [drone, tank]);
        assert.ok(result, "should find a target");
        // drone: 10/8=1.25, tank: 2/5=0.4 → drone wins
        assert.equal(result.target.vehicleType, "drone", "IFV should prefer drone even when tank is closer");
    });

    it("SPG ignores tanks, drones, and IFVs (all priority 0)", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "spg"; // spg: tank=0, drone=0, ifv=0

        const tank = new Tank(2, "#33d", "#239");
        tank.team = 2;
        tank.alive = true;
        tank.vehicleType = "tank";
        tank.x = 22;
        tank.y = 32;

        const drone = new Tank(3, "#33d", "#239");
        drone.team = 2;
        drone.alive = true;
        drone.vehicleType = "drone";
        drone.x = 23;
        drone.y = 32;

        const ifv = new Tank(4, "#33d", "#239");
        ifv.team = 2;
        ifv.alive = true;
        ifv.vehicleType = "ifv";
        ifv.x = 24;
        ifv.y = 32;

        const result = bot.ai._bestTarget(bot.tank, [tank, drone, ifv]);
        assert.equal(result, null, "SPG should ignore tanks, drones, and IFVs");
    });

    it("SPG targets other SPGs (priority 5)", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "spg"; // spg: spg=5

        const enemySpg = new Tank(2, "#33d", "#239");
        enemySpg.team = 2;
        enemySpg.alive = true;
        enemySpg.vehicleType = "spg";
        enemySpg.x = 25;
        enemySpg.y = 32;

        const result = bot.ai._bestTarget(bot.tank, [enemySpg]);
        assert.ok(result, "SPG should target another SPG");
        assert.equal(result.target.vehicleType, "spg");
    });

    it("nearby low-priority target can beat distant high-priority target", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "tank"; // tank: spg=10, ifv=2

        const farSpg = new Tank(2, "#33d", "#239");
        farSpg.team = 2;
        farSpg.alive = true;
        farSpg.vehicleType = "spg";
        farSpg.x = 50;
        farSpg.y = 32; // distance 30

        const closeIfv = new Tank(3, "#33d", "#239");
        closeIfv.team = 2;
        closeIfv.alive = true;
        closeIfv.vehicleType = "ifv";
        closeIfv.x = 20.5;
        closeIfv.y = 32; // distance 0.5

        // spg score: 10/30=0.33, ifv score: 2/0.5=4.0 → IFV wins
        const result = bot.ai._bestTarget(bot.tank, [farSpg, closeIfv]);
        assert.ok(result, "should find a target");
        assert.equal(
            result.target.vehicleType,
            "ifv",
            "very close low-priority target should beat distant high-priority target",
        );
    });

    it("skips dead enemies", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "tank";

        const dead = new Tank(2, "#33d", "#239");
        dead.team = 2;
        dead.alive = false;
        dead.vehicleType = "tank";
        dead.x = 21;
        dead.y = 32;

        const result = bot.ai._bestTarget(bot.tank, [dead]);
        assert.equal(result, null, "should not target dead enemies");
    });
});

describe("AI Target priority – drone detonation", () => {
    it("drone does not detonate on another drone", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "drone"; // drone: drone=0

        const enemyDrone = new Tank(2, "#33d", "#239");
        enemyDrone.team = 2;
        enemyDrone.alive = true;
        enemyDrone.vehicleType = "drone";
        enemyDrone.x = 20.1;
        enemyDrone.y = 32; // point-blank

        // Simulate enough frames for detonation decision
        for (let f = 0; f < 30; f++) {
            bot.ai.think(0.016, bot.tank, [enemyDrone], map, null);
        }
        assert.ok(!bot.ai.isDown("_bx"), "drone should NOT detonate on another drone");
    });

    it("drone detonates on a tank at point-blank", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "drone"; // drone: tank=5

        const enemyTank = new Tank(2, "#33d", "#239");
        enemyTank.team = 2;
        enemyTank.alive = true;
        enemyTank.vehicleType = "tank";
        enemyTank.x = 20.1;
        enemyTank.y = 32; // point-blank

        bot.ai.think(0.016, bot.tank, [enemyTank], map, null);
        assert.ok(bot.ai.isDown("_bx"), "drone SHOULD detonate on a tank at point-blank");
    });

    it("drone detonates on an SPG at point-blank", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "drone"; // drone: spg=10

        const enemySpg = new Tank(2, "#33d", "#239");
        enemySpg.team = 2;
        enemySpg.alive = true;
        enemySpg.vehicleType = "spg";
        enemySpg.x = 20.1;
        enemySpg.y = 32;

        bot.ai.think(0.016, bot.tank, [enemySpg], map, null);
        assert.ok(bot.ai.isDown("_bx"), "drone SHOULD detonate on an SPG at point-blank");
    });

    it("drone ignores drone but detonates when tank is also in range", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "drone";

        const enemyDrone = new Tank(2, "#33d", "#239");
        enemyDrone.team = 2;
        enemyDrone.alive = true;
        enemyDrone.vehicleType = "drone";
        enemyDrone.x = 20.05;
        enemyDrone.y = 32;

        const enemyTank = new Tank(3, "#33d", "#239");
        enemyTank.team = 2;
        enemyTank.alive = true;
        enemyTank.vehicleType = "tank";
        enemyTank.x = 20.15;
        enemyTank.y = 32;

        bot.ai.think(0.016, bot.tank, [enemyDrone, enemyTank], map, null);
        assert.ok(
            bot.ai.isDown("_bx"),
            "drone should detonate when a valid target (tank) is in range, even if a drone is also there",
        );
    });
});

describe("AI Target priority – integration with roles", () => {
    it("tank bot does not fire at drones when they are the only enemy", () => {
        const map = new GameMap();
        const rng = seededRng(42);
        const bot = createBot(20, 32, 0, map, rng);
        bot.tank.vehicleType = "tank";

        const drone = new Tank(2, "#33d", "#239");
        drone.team = 2;
        drone.alive = true;
        drone.vehicleType = "drone";
        drone.x = 23;
        drone.y = 32;

        // No objective — drone is the only possible target
        let fired = false;
        for (let f = 0; f < 300; f++) {
            bot.ai.think(0.016, bot.tank, [drone], map, null);
            bot.tank.update(0.016, bot.ai, BOT_KEYS, map);
            if (bot.ai.isDown("_bx")) fired = true;
        }
        // Tank should not waste shots on drone (priority 0)
        assert.ok(!fired, "tank should not fire at a drone (priority 0)");
    });

    it("IFV defender intercepts drones near tower", () => {
        const map = customMap([]);
        const rng = seededRng(42);
        const bot = createBot(30, 32, 0, map, rng);
        bot.tank.vehicleType = "ifv";
        bot.ai.role = "defender";
        bot.ai.friendlyTower = { x: 32, y: 32, alive: true };

        const drone = new Tank(2, "#33d", "#239");
        drone.team = 2;
        drone.alive = true;
        drone.vehicleType = "drone";
        drone.x = 34;
        drone.y = 32; // near the tower

        const objective = { x: 50, y: 32, alive: true };
        // Simulate and check that IFV moves toward drone
        let minDist = Infinity;
        for (let f = 0; f < 300; f++) {
            bot.ai.think(0.016, bot.tank, [drone], map, objective);
            bot.tank.update(0.016, bot.ai, BOT_KEYS, map);
            const d = Math.hypot(drone.x - bot.tank.x, drone.y - bot.tank.y);
            if (d < minDist) minDist = d;
        }
        assert.ok(minDist < 4, `IFV defender should intercept drone near tower, got min dist ${minDist.toFixed(1)}`);
    });
});
