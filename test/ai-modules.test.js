import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { steerTurretTo, updateWobble } from "../js/ai/aiming.js";
import { chooseGoalAndTarget } from "../js/ai/arbitration.js";
import { patrol, pickWaypoint, steerToPoint, updatePath } from "../js/ai/navigation.js";
import { evade, handleStuck, tryShootWall, updateStuck } from "../js/ai/recovery.js";
import { SignalFields } from "../js/ai/signals.js";
import { targetPriorityOf } from "../js/ai/targeting.js";
import { ACTIONS, CONFIG } from "../js/config.js";
import { createBot, customMap, seededRng, Tank, wallH, withParams } from "./helpers.js";

/*
 * Direct unit tests for the js/ai/ package (arbitration, targeting,
 * navigation, recovery, aiming).  The controller-level suites
 * (ai.test.js, arbitration.test.js) exercise the same code end-to-end
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

describe("AI modules – swarm arbitration", () => {
    const think = (bot, ctx) => chooseGoalAndTarget(bot.ai, 0.016, bot.tank, ctx);

    it("navigates straight to the objective when no signals exist", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        const { navGoal, fireTarget } = think(bot, {
            enemies: [],
            map: customMap([]),
            objective: { x: 30, y: 30, alive: true },
        });
        assert.deepEqual(navGoal, { x: 30, y: 30 });
        assert.equal(fireTarget, null, "objective beyond fire range");
    });

    it("fires at the objective inside OBJECTIVE_ENGAGE_RANGE", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        const { fireTarget } = think(bot, {
            enemies: [],
            map: customMap([]),
            objective: { x: 20, y: 10, alive: true },
        });
        assert.ok(fireTarget, "objective in range should be engaged");
    });

    it("always explores when there is no objective (never idles)", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        const { navGoal } = think(bot, { enemies: [], map: customMap([]), objective: null });
        assert.ok(navGoal, "a bot without an objective must keep moving");
    });

    it("rallies to the strongest alarm deposit before pursuing the objective", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map, seededRng(1));
        const signals = new SignalFields(map.width, map.height);
        signals.deposit("alarm", 14.5, 10.5, 5);
        const swarm = { signals, friendlies: [bot.tank], humans: [] };
        const { navGoal } = think(bot, { enemies: [], map, objective: { x: 40, y: 40, alive: true }, swarm });
        assert.deepEqual(navGoal, { x: 14.5, y: 10.5 });
    });

    it("a weaker emitter falls in behind a stronger one (convoy)", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.tank.vehicleType = "ifv"; // recruit 0.8 < tank's 1.0
        const leader = new Tank(9, "#c33", "#822");
        leader.team = 1;
        leader.alive = true;
        leader.x = 15;
        leader.y = 10;
        leader.angle = 0; // facing east
        const swarm = { signals: new SignalFields(map.width, map.height), friendlies: [bot.tank, leader], humans: [] };
        const { navGoal } = think(bot, { enemies: [], map, objective: { x: 40, y: 10, alive: true }, swarm });
        assert.ok(navGoal.x < 15, `station should sit behind the leader, got x=${navGoal.x}`);
    });

    it("a flank vehicle holds a perpendicular offset from its leader", () => {
        const map = customMap([]);
        const bot = createBot(12, 10, 0, map, seededRng(1));
        bot.tank.vehicleType = "squad";
        const leader = new Tank(9, "#c33", "#822");
        leader.team = 1;
        leader.alive = true;
        leader.x = 15;
        leader.y = 10;
        leader.angle = 0;
        const swarm = { signals: new SignalFields(map.width, map.height), friendlies: [bot.tank, leader], humans: [] };
        const { navGoal } = think(bot, { enemies: [], map, objective: { x: 40, y: 10, alive: true }, swarm });
        const lateral = Math.abs(navGoal.y - 10);
        assert.ok(
            Math.abs(lateral - CONFIG.CONVOY_FLANK_OFFSET) < 0.01,
            `flank offset should be perpendicular, got ${lateral}`,
        );
    });

    it("equal emitters do not follow each other", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map, seededRng(1));
        const peer = new Tank(9, "#c33", "#822");
        peer.team = 1;
        peer.alive = true;
        peer.x = 14;
        peer.y = 10;
        const swarm = { signals: new SignalFields(map.width, map.height), friendlies: [bot.tank, peer], humans: [] };
        const { navGoal } = think(bot, { enemies: [], map, objective: { x: 40, y: 10, alive: true }, swarm });
        assert.deepEqual(navGoal, { x: 40, y: 10 }, "two tanks both lead — no one follows");
    });

    it("convoys only form behind a purposeful leader (no idle base blobs)", () => {
        const map = customMap([]);
        const mk = (seed) => {
            const bot = createBot(10, 10, 0, map, seededRng(seed));
            bot.tank.vehicleType = "ifv";
            const leader = new Tank(9, "#c33", "#822");
            leader.team = 1;
            leader.alive = true;
            leader.x = 15;
            leader.y = 10;
            leader.angle = 0;
            const swarm = {
                signals: new SignalFields(map.width, map.height),
                friendlies: [bot.tank, leader],
                humans: [],
            };
            return { bot, swarm };
        };
        const withPurpose = mk(1);
        const purposeful = think(withPurpose.bot, {
            enemies: [],
            map,
            objective: { x: 40, y: 10, alive: true },
            swarm: withPurpose.swarm,
        });
        assert.ok(purposeful.navGoal.x < 15, "with a known objective the follower joins the push");

        const idle = mk(1);
        const purposeless = think(idle.bot, { enemies: [], map, objective: null, swarm: idle.swarm });
        assert.ok(
            Math.abs(purposeless.navGoal.x - purposeful.navGoal.x) > 0.5 ||
                Math.abs(purposeless.navGoal.y - purposeful.navGoal.y) > 0.5,
            "without a purpose the bot explores instead of queueing",
        );
    });

    it("convoy-joining is suppressed in a crowded area", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.tank.vehicleType = "ifv";
        const leader = new Tank(9, "#c33", "#822");
        leader.team = 1;
        leader.alive = true;
        leader.x = 15;
        leader.y = 10;
        leader.angle = 0;
        const signals = new SignalFields(map.width, map.height);
        signals.deposit("recruit", 10.5, 10.5, CONFIG.CONVOY_CROWD_LIMIT + 1);
        const swarm = { signals, friendlies: [bot.tank, leader], humans: [] };
        const { navGoal } = think(bot, { enemies: [], map, objective: { x: 40, y: 10, alive: true }, swarm });
        assert.deepEqual(navGoal, { x: 40, y: 10 }, "crowded bot heads for the objective itself");
    });

    it("exploration ventures away from the home anchor", () => {
        // Scenario config: the invariant only holds with a meaningful
        // venture weight, which tuning may take near zero — set it.
        withParams([["CONFIG.EXPLORE_VENTURE_WEIGHT", 0.2]], () => {
            const map = customMap([]);
            const meanDistanceFromHome = (home) => {
                const bot = createBot(30, 30, 0, map, seededRng(11));
                const swarm = {
                    signals: new SignalFields(map.width, map.height),
                    friendlies: [bot.tank],
                    humans: [],
                    home,
                };
                let total = 0;
                for (let i = 0; i < 60; i++) {
                    bot.ai.state.exploreTimer = 0; // force a fresh pick
                    const { navGoal } = think(bot, { enemies: [], map, objective: null, swarm });
                    total += Math.hypot(navGoal.x - 30, navGoal.y - 30);
                }
                return total / 60;
            };
            const anchored = meanDistanceFromHome({ x: 30, y: 30 });
            const free = meanDistanceFromHome(null);
            assert.ok(
                anchored > free + 1,
                `home anchor should push exploration outward (anchored ${anchored.toFixed(1)} vs free ${free.toFixed(1)})`,
            );
        });
    });

    it("prefers a strong trail tile that makes progress toward the objective", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map, seededRng(1));
        const signals = new SignalFields(map.width, map.height);
        signals.depositMax("trail", 14.5, 10.5, 2); // ahead (progress)
        signals.depositMax("trail", 6.5, 10.5, 5); // behind (stronger, but no progress)
        const swarm = { signals, friendlies: [bot.tank], humans: [] };
        const { navGoal } = think(bot, { enemies: [], map, objective: { x: 40, y: 10, alive: true }, swarm });
        assert.deepEqual(navGoal, { x: 14.5, y: 10.5 }, "backward signal must not pull the bot home");
    });

    it("artillery holds position once the objective is inside its range", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.tank.vehicleType = "spg";
        const { navGoal } = think(bot, { enemies: [], map, objective: { x: 20, y: 10, alive: true } });
        assert.deepEqual(navGoal, { x: 10, y: 10 }, "SPG should stop and shell");
    });
});

describe("AI modules – separation steering", () => {
    const think = (bot, ctx) => chooseGoalAndTarget(bot.ai, 0.016, bot.tank, ctx);

    const convoy = (map, bots) => {
        const leader = new Tank(9, "#c33", "#822");
        leader.team = 1;
        leader.alive = true;
        leader.x = 15;
        leader.y = 10;
        leader.angle = 0;
        return {
            leader,
            swarm: {
                signals: new SignalFields(map.width, map.height),
                friendlies: [leader, ...bots.map((b) => b.tank)],
                humans: [],
            },
        };
    };

    it("two same-side flankers get pushed to different stations", () => {
        // Scenario config: the separation radius is optimizer-tunable —
        // declare it rather than inherit it.
        withParams([["VEHICLES.drone.personalSpace", 1.5]], () => {
            const map = customMap([]);
            const droneA = createBot(13.4, 11.6, 0, map, seededRng(1));
            const droneB = createBot(13.6, 11.4, 0, map, seededRng(2));
            for (const d of [droneA, droneB]) {
                d.tank.vehicleType = "drone";
                d.ai.state.convoySide = 1; // force the shared station
            }
            const { swarm } = convoy(map, [droneA, droneB]);
            const ctx = { enemies: [], map, objective: { x: 40, y: 10, alive: true }, swarm };
            const goalA = think(droneA, ctx).navGoal;
            const goalB = think(droneB, ctx).navGoal;
            const apart = Math.hypot(goalA.x - goalB.x, goalA.y - goalB.y);
            assert.ok(apart > 1.5, `stacked flankers should be pushed apart (goals ${apart.toFixed(2)} apart)`);
        });
    });

    it("vehicles with personalSpace 0 are unaffected", () => {
        const map = customMap([]);
        const bot = createBot(10, 10, 0, map, seededRng(1));
        const peer = new Tank(9, "#c33", "#822");
        peer.team = 1;
        peer.alive = true;
        peer.x = 10.3;
        peer.y = 10;
        const swarm = {
            signals: new SignalFields(map.width, map.height),
            friendlies: [bot.tank, peer],
            humans: [],
        };
        const { navGoal } = think(bot, { enemies: [], map, objective: { x: 40, y: 10, alive: true }, swarm });
        assert.deepEqual(navGoal, { x: 40, y: 10 }, "tanks keep their queue/contact spacing only");
    });

    it("a ground vehicle is never repelled onto impassable ground", () => {
        // Value-agnostic: the hill block covers every tile a repulsion
        // offset could reach for any plausible personalSpace (≤ ~3), so
        // the invariant holds no matter how the radius is tuned.
        const map = customMap(wallH(10, 37, 40));
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.tank.vehicleType = "squad";
        const peer = createBot(10.7, 10, 0, map, seededRng(2)); // another squad: equal
        peer.tank.vehicleType = "squad"; // emit, so no convoy leadership —
        // it sits east, pushing the bot's goal west into the hills
        const swarm = {
            signals: new SignalFields(map.width, map.height),
            friendlies: [bot.tank, peer.tank],
            humans: [],
        };
        const objective = { x: 40.5, y: 10.5, alive: true };
        const { navGoal } = think(bot, { enemies: [], map, objective, swarm });
        assert.deepEqual(navGoal, { x: 40.5, y: 10.5 }, "blocked repulsion leaves the goal unchanged");
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
