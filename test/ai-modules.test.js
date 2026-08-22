import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { steerTurretTo, updateWobble } from "../js/ai/aiming.js";
import { patrol, pickWaypoint, steerToPoint, updatePath } from "../js/ai/navigation.js";
import { evade, handleStuck, tryShootWall, updateStuck } from "../js/ai/recovery.js";
import { AI_ROLES, chooseGoalAndTarget, computeFlankPoint, findBestPosition } from "../js/ai/roles.js";
import { ACTIONS } from "../js/config.js";
import { createBot, customMap, seededRng, Tank, wallH } from "./helpers.js";

/*
 * Direct unit tests for the js/ai/ package (roles, targeting,
 * navigation, recovery, aiming).  The controller-level suites
 * (ai.test.js, roles.test.js) exercise the same code end-to-end
 * through `AIController.think`; these pin the module seams themselves.
 */

describe("AI modules – navigation", () => {
    it("updatePath computes a route and caches it for the same goal", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map, seededRng(1));
        updatePath(bot.ai, 0.016, bot.tank, { x: 20, y: 10 });
        assert.ok(bot.ai._path.length > 0, "a route should be computed");
        assert.deepEqual(bot.ai._pathGoal, { x: 20, y: 10 });

        // Same goal, timer far from elapsing → cached (same array).
        bot.ai._pathTimer = 5;
        const before = bot.ai._path;
        updatePath(bot.ai, 0.016, bot.tank, { x: 20, y: 10 });
        assert.equal(bot.ai._path, before, "path should not be recomputed for the same goal");
    });

    it("updatePath recomputes when the goal moves more than 3 units", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map, seededRng(1));
        updatePath(bot.ai, 0.016, bot.tank, { x: 20, y: 10 });
        bot.ai._pathTimer = 5;
        updatePath(bot.ai, 0.016, bot.tank, { x: 30, y: 10 });
        assert.deepEqual(bot.ai._pathGoal, { x: 30, y: 10 }, "a moved goal should invalidate the cached route");
    });

    it("pickWaypoint skips ahead to the farthest walkable waypoint", () => {
        const map = customMap([]);
        const bot = createBot(11, 10, 0, map, seededRng(1));
        bot.ai._path = [
            { x: 12, y: 10 },
            { x: 14, y: 10 },
            { x: 16, y: 10 },
            { x: 18, y: 10 },
            { x: 20, y: 10 },
        ];
        const wp = pickWaypoint(bot.ai, bot.tank, map);
        assert.deepEqual(wp, { x: 20, y: 10 }, "flat ground → skip to the last waypoint");
    });

    it("pickWaypoint drops waypoints the bot has already passed", () => {
        const map = customMap([]);
        const bot = createBot(12.6, 10, 0, map, seededRng(1));
        bot.ai._path = [
            { x: 12, y: 10 },
            { x: 14, y: 10 },
            { x: 16, y: 10 },
            { x: 18, y: 10 },
        ];
        const wp = pickWaypoint(bot.ai, bot.tank, map);
        assert.equal(bot.ai._path.length, 3, "passed waypoints are consumed");
        assert.deepEqual(wp, { x: 18, y: 10 });
    });

    it("steerToPoint drives forward toward a point ahead", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map);
        steerToPoint(bot.ai, bot.tank, { x: 15, y: 10 }, { hasPath: true, map });
        assert.equal(bot.ai.keys[ACTIONS.forward], true);
        assert.equal(bot.ai.keys[ACTIONS.right], undefined);
        assert.equal(bot.ai.keys[ACTIONS.left], undefined);
    });

    it("steerToPoint reverses when the point is behind", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map);
        steerToPoint(bot.ai, bot.tank, { x: 5, y: 10 }, { hasPath: true, map });
        assert.equal(bot.ai.keys[ACTIONS.backward], true);
    });

    it("steerToPoint turns toward a point off to the side", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map);
        steerToPoint(bot.ai, bot.tank, { x: 10, y: 15 }, { hasPath: true, map });
        assert.equal(bot.ai.keys[ACTIONS.right], true);
    });

    it("steerToPoint with no path does not drive at a close point", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map);
        steerToPoint(bot.ai, bot.tank, { x: 10.5, y: 10 }, { hasPath: false, map });
        assert.equal(bot.ai.keys[ACTIONS.forward], undefined);
        assert.equal(bot.ai.keys[ACTIONS.backward], undefined);
    });

    it("patrol drives forward", () => {
        const bot = createBot(10, 10, 0, customMap([]));
        patrol(bot.ai);
        assert.equal(bot.ai.keys[ACTIONS.forward], true);
        assert.equal(bot.ai._patrolStep, 1);
    });
});

describe("AI modules – stuck recovery", () => {
    it("updateStuck accumulates stuckTime while stationary", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        for (let i = 0; i < 6; i++) updateStuck(bot.ai, 0.3, bot.tank);
        assert.ok(bot.ai.stuckTime > 0.1, `stuckTime should accumulate, got ${bot.ai.stuckTime}`);
    });

    it("updateStuck decays when the bot moves", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        for (let i = 0; i < 6; i++) updateStuck(bot.ai, 0.3, bot.tank);
        bot.tank.x = 20; // moved 10 units
        updateStuck(bot.ai, 0.3, bot.tank);
        assert.equal(bot.ai.stuckTime, 0, "movement should reset stuckTime");
    });

    it("handleStuck wiggles backward at low stuckTime", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        bot.ai.stuckTime = 0.5;
        handleStuck(bot.ai, bot.tank, customMap([]));
        assert.equal(bot.ai.keys[ACTIONS.backward], true);
        assert.ok(bot.ai.keys[ACTIONS.right] || bot.ai.keys[ACTIONS.left], "should wiggle to a side");
    });

    it("handleStuck escalates to evade past 1.2s", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        bot.ai.stuckTime = 1.5;
        handleStuck(bot.ai, bot.tank, customMap([]));
        assert.equal(bot.ai.evading, true);
    });

    it("handleStuck blasts the nearest wall past 2.5s", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        bot.ai.stuckTime = 3;
        handleStuck(bot.ai, bot.tank, customMap([]));
        assert.equal(bot.ai.keys[ACTIONS.backward], true, "blast recovery backs up");
    });

    it("evade ends and resets state after its timer", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        bot.ai.evading = true;
        bot.ai.evadeDir = 1;
        bot.ai.evadeTimer = 0.1;
        evade(bot.ai, 0.2, bot.tank, customMap([]));
        assert.equal(bot.ai.evading, false);
        assert.equal(bot.ai.stuckTime, 0);
        assert.equal(bot.ai._posHistory.length, 0);
    });

    it("tryShootWall fires at a blocking tile ahead", () => {
        const map = customMap(wallH(31, 30, 31)); // hill directly north of the bot
        const bot = createBot(30.5, 32.5, -Math.PI / 2, map, seededRng(1));
        tryShootWall(bot.ai, bot.tank, map);
        assert.equal(bot.ai.keys[ACTIONS.fire], true);
        assert.ok(bot.ai.fireDelay > 0, "a shot should be on cooldown after firing");
    });

    it("tryShootWall does not fire on open ground", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map, seededRng(1));
        tryShootWall(bot.ai, bot.tank, map);
        assert.equal(bot.ai.keys[ACTIONS.fire], undefined);
    });
});

describe("AI modules – aiming", () => {
    it("steerTurretTo steers right for a desired angle to the right", () => {
        const bot = createBot(10, 10, 0, customMap([]));
        steerTurretTo(bot.ai, bot.tank, Math.PI / 2);
        assert.equal(bot.ai.keys[ACTIONS.turretRight], true);
    });

    it("steerTurretTo steers left for a desired angle to the left", () => {
        const bot = createBot(10, 10, 0, customMap([]));
        steerTurretTo(bot.ai, bot.tank, -Math.PI / 2);
        assert.equal(bot.ai.keys[ACTIONS.turretLeft], true);
    });

    it("steerTurretTo is idle when already aligned", () => {
        const bot = createBot(10, 10, 0, customMap([]));
        steerTurretTo(bot.ai, bot.tank, 0);
        assert.equal(bot.ai.keys[ACTIONS.turretRight], undefined);
        assert.equal(bot.ai.keys[ACTIONS.turretLeft], undefined);
    });

    it("updateWobble refreshes the wobble perturbation on its timer", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        bot.ai.wobbleTimer = 0;
        updateWobble(bot.ai, 0.1);
        assert.equal(typeof bot.ai.aimWobble, "number");
        assert.ok(bot.ai.wobbleTimer > 0.5, "wobble should reschedule its next refresh");
    });
});

describe("AI modules – role dispatch", () => {
    it("no role and no objective → no goal, no target", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        const { navGoal, fireTarget } = chooseGoalAndTarget(bot.ai, 0.016, bot.tank, [], customMap([]), null);
        assert.equal(navGoal, null);
        assert.equal(fireTarget, null);
    });

    it("no role → charge at the objective", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        const { navGoal, fireTarget } = chooseGoalAndTarget(bot.ai, 0.016, bot.tank, [], customMap([]), {
            x: 30,
            y: 30,
            alive: true,
        });
        assert.deepEqual(navGoal, { x: 30, y: 30 });
        assert.equal(fireTarget, null, "objective beyond fire range");
    });

    it("role strategy dispatch uses ai.role", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        bot.ai.role = AI_ROLES.CAVALRY;
        const { navGoal } = chooseGoalAndTarget(bot.ai, 0.016, bot.tank, [], customMap([]), {
            x: 30,
            y: 30,
            alive: true,
        });
        assert.deepEqual(navGoal, { x: 30, y: 30 });
    });

    it("defender patrols a ring around the friendly tower", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        bot.ai.role = AI_ROLES.DEFENDER;
        bot.ai.friendlyBase = { x: 10, y: 10, alive: true };
        const { navGoal } = chooseGoalAndTarget(bot.ai, 0.016, bot.tank, [], customMap([]), {
            x: 30,
            y: 30,
            alive: true,
        });
        assert.ok(navGoal, "defender should always have a patrol goal");
        const dist = Math.hypot(navGoal.x - 10, navGoal.y - 10);
        assert.ok(Math.abs(dist - 10) < 0.01, `patrol goal should sit on the patrol ring, got ${dist}`);
    });

    it("defender intercepts a threat near the friendly tower", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        bot.ai.role = AI_ROLES.DEFENDER;
        bot.ai.friendlyBase = { x: 10, y: 10, alive: true };
        const enemy = new Tank(9, "#33d", "#239");
        enemy.team = 2;
        enemy.alive = true;
        enemy.x = 14;
        enemy.y = 10;
        const { navGoal, fireTarget } = chooseGoalAndTarget(bot.ai, 0.016, bot.tank, [enemy], customMap([]), {
            x: 30,
            y: 30,
            alive: true,
        });
        assert.deepEqual(navGoal, { x: 14, y: 10 }, "defender should intercept the threat");
        assert.ok(fireTarget, "defender should fire at the intercepted threat");
    });

    it("defender falls back to cavalry when its tower is dead", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        bot.ai.role = AI_ROLES.DEFENDER;
        bot.ai.friendlyBase = { x: 10, y: 10, alive: false };
        const { navGoal } = chooseGoalAndTarget(bot.ai, 0.016, bot.tank, [], customMap([]), {
            x: 30,
            y: 30,
            alive: true,
        });
        assert.deepEqual(navGoal, { x: 30, y: 30 }, "dead tower → cavalry rush");
    });
});

describe("AI modules – position scoring", () => {
    it("findBestPosition returns a candidate at the ideal range", () => {
        const map = customMap([]);
        const pos = findBestPosition(
            { x: 10, y: 10 },
            { x: 30, y: 30 },
            map,
            { cover: 0, flank: 5, range: 0, los: 0 },
            10,
        );
        assert.ok(pos, "should find a position");
        const dist = Math.hypot(pos.x - 30, pos.y - 30);
        assert.ok(dist >= 8 && dist <= 12, `candidate should sit near the ideal range, got ${dist.toFixed(1)}`);
    });

    it("computeFlankPoint forms a ring around the midpoint", () => {
        const map = customMap([]);
        const pos = computeFlankPoint({ x: 10, y: 10 }, { x: 30, y: 30 }, map);
        assert.ok(pos, "should find a flank point");
        const midDist = Math.hypot(pos.x - 20, pos.y - 20);
        assert.ok(midDist >= 8 && midDist <= 14, `flank point should ring the midpoint, got ${midDist.toFixed(1)}`);
    });
});
