import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { steerTurretTo, updateWobble } from "../js/ai/aiming.js";
import { patrol, pickWaypoint, steerToPoint, updatePath } from "../js/ai/navigation.js";
import { evade, handleStuck, tryShootWall, updateStuck } from "../js/ai/recovery.js";
import { targetPriorityOf } from "../js/ai/targeting.js";
import { ACTIONS } from "../js/config.js";
import { createBot, customMap, seededRng, wallH } from "./helpers.js";

/*
 * Direct unit tests for the js/ai/ package (targeting, navigation,
 * recovery, aiming).  The controller-level suites (ai.test.js,
 * swarm.test.js) exercise the same code end-to-end through
 * `AIController.think`; these pin the module seams themselves.
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

describe("AI modules – target priority resolution", () => {
    it("returns the explicit override when the shooter lists the target type", () => {
        assert.equal(targetPriorityOf({ spg: 10 }, "spg"), 10);
        assert.equal(targetPriorityOf({ drone: 0 }, "drone"), 0);
    });

    it("falls back to the target's class default for an unlisted type", () => {
        assert.equal(targetPriorityOf({}, "tank"), 5, "vehicle class default");
        assert.equal(targetPriorityOf({}, "drone"), 3, "air class default");
        assert.equal(targetPriorityOf({}, "baseHQ"), 5, "structure class default");
    });

    it("defaults to 1 for an unknown target type", () => {
        assert.equal(targetPriorityOf({}, "mystery_unit"), 1);
    });
});
