/**
 * Swarm arbitration behaviour tests — the pheromone layers exercised
 * end-to-end (arbitration + signal fields + think + movement together)
 * on deterministic flat maps.
 *
 * The bugs these tests catch:
 *  - the alarm layer broken or mis-prioritised → teammates ignore a
 *    nearby fight instead of rallying to it;
 *  - the convoy layer inverted (weaker emits "more") or gated wrong →
 *    bots scatter instead of falling in behind a stronger emitter;
 *  - exploration returning no goal → an objective-less bot idles
 *    forever (once objectives start unknown, it would never discover).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignalFields } from "../js/ai/signals.js";
import { ACTIONS, CONFIG } from "../js/config.js";
import { GAME_EVENTS } from "../js/events.js";
import { Game } from "../js/game.js";
import { runSignals } from "../js/systems/signals.js";
import { Tank } from "../js/tank.js";
import { createBot, customMap, fakeDevice, seededRng, withParams } from "./helpers.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** A minimal world: one faction with signal fields, no enemies. */
function miniWorld(tanks, humans = []) {
    const signals = new SignalFields(128, 128);
    return {
        factions: [{ id: 1, entities: tanks, knownObjectives: new Set(), signals }],
        allTanks: tanks,
        humanTanks: humans,
        swarm: { signals, friendlies: tanks, humans },
    };
}

function step(world, bots, dt) {
    runSignals(world, dt);
    for (const { tank, device } of world.drivers ?? []) tank.update(dt, device, world.map);
    for (const bot of bots) {
        bot.ai.think(dt, bot.tank, [], world.map, null, [], world.swarm);
        bot.tank.update(dt, bot.ai, world.map);
    }
}

describe("swarm arbitration behaviour", () => {
    it("a teammate rallies toward a friendly that is under attack", () => {
        // Scenario config: the response radius is optimizer-tunable and
        // the helper starts ~9 tiles away — declare a radius that reaches.
        withParams([["CONFIG.SIGNAL_ALARM_RESPONSE_RADIUS", 14]], () => {
            const map = customMap([]);
            const victim = createBot(20, 20, 0, map, seededRng(1));
            const helper = createBot(28, 24, 0, map, seededRng(2));
            victim.tank.underAttackTimer = CONFIG.SIGNAL_ALARM_TIME;
            const world = miniWorld([victim.tank, helper.tank]);
            world.map = map;
            const bots = [victim, helper];

            const before = dist(helper.tank, victim.tank);
            for (let f = 0; f < 150; f++) step(world, bots, 0.016);

            assert.ok(
                dist(helper.tank, victim.tank) < before - 3,
                `helper should close on the victim (${before.toFixed(1)} → ${dist(helper.tank, victim.tank).toFixed(1)})`,
            );
        });
    });

    it("no one rallies once the fight is over (the alarm dies with the victim)", () => {
        const map = customMap([]);
        const corpse = createBot(20, 20, 0, map, seededRng(1));
        const bystander = createBot(28, 24, 0, map, seededRng(2));
        corpse.tank.alive = false;
        corpse.tank.underAttackTimer = 4; // was broadcasting when it died
        const world = miniWorld([corpse.tank, bystander.tank]);
        world.map = map;

        const before = dist(bystander.tank, corpse.tank);
        for (let f = 0; f < 90; f++) step(world, [bystander], 0.016);

        const moved = dist(bystander.tank, corpse.tank) - before;
        assert.ok(moved > -1, `bystander must not converge on a corpse (moved ${moved.toFixed(1)})`);
    });

    it("bots fall into a convoy behind a moving human leader", () => {
        const map = customMap([]);
        const leader = new Tank(1, "#cc3333", "#882222");
        leader.team = 1;
        leader.alive = true;
        leader.x = 20;
        leader.y = 32;
        leader.angle = 0; // driving east
        const device = fakeDevice({ held: [ACTIONS.forward] });

        const wingA = createBot(16, 30, 0, map, seededRng(3));
        const wingB = createBot(15, 34, 0, map, seededRng(4));
        wingB.tank.vehicleType = "ifv";
        const tanks = [leader, wingA.tank, wingB.tank];
        const world = miniWorld(tanks, [leader]);
        world.map = map;
        world.drivers = [{ tank: leader, device }];

        const startA = { x: wingA.tank.x, y: wingA.tank.y };
        const startB = { x: wingB.tank.x, y: wingB.tank.y };
        for (let f = 0; f < 300; f++) step(world, [wingA, wingB], 0.016);

        for (const [bot, start] of [
            [wingA, startA],
            [wingB, startB],
        ]) {
            assert.ok(
                dist(bot.tank, leader) < 8,
                `${bot.tank.vehicleType} should stay with the convoy (dist ${dist(bot.tank, leader).toFixed(1)})`,
            );
            assert.ok(
                dist(bot.tank, start) > 10,
                `${bot.tank.vehicleType} should travel with the leader (moved ${dist(bot.tank, start).toFixed(1)})`,
            );
        }
    });

    it("a bot with no objective and no enemies keeps exploring", () => {
        const map = customMap([]);
        const bot = createBot(20, 20, 0, map, seededRng(7));
        const world = miniWorld([bot.tank]);
        world.map = map;
        for (let f = 0; f < 600; f++) step(world, [bot], 0.016);
        assert.ok(
            bot.tank.distanceTravelled > 10,
            `an objective-less bot should keep moving, travelled ${bot.tank.distanceTravelled.toFixed(1)}`,
        );
    });

    it("drones fan out instead of stacking at the flank station", () => {
        // Scenario config: the separation radius is optimizer-tunable —
        // declare it rather than inherit it.
        withParams([["VEHICLES.drone.personalSpace", 1.5]], () => {
            const map = customMap([]);
            const leader = new Tank(1, "#cc3333", "#882222");
            leader.team = 1;
            leader.alive = true;
            leader.x = 20;
            leader.y = 32;
            leader.angle = 0;
            const device = fakeDevice({ held: [ACTIONS.forward] });

            const droneA = createBot(16, 31, 0, map, seededRng(5));
            const droneB = createBot(16, 33, 0, map, seededRng(6));
            droneA.tank.vehicleType = "drone";
            droneB.tank.vehicleType = "drone";
            droneA.ai.state.convoySide = 1; // both drones, same side: the
            droneB.ai.state.convoySide = 1; // stacking case from the bug report
            const tanks = [leader, droneA.tank, droneB.tank];
            const world = miniWorld(tanks, [leader]);
            world.map = map;
            world.drivers = [{ tank: leader, device }];

            for (let f = 0; f < 300; f++) step(world, [droneA, droneB], 0.016);

            const apart = dist(droneA.tank, droneB.tank);
            assert.ok(apart > 0.8, `drones should fan out around the station (final separation ${apart.toFixed(2)})`);
        });
    });

    it("a bot-only battle runs the full loop: explore, discover, converge, win", () => {
        // The bug this catches: any break in the discovery → signal →
        // arbitration chain stalls the match — bots wander forever and
        // nobody ever attacks a base.
        const game = new Game({
            gameType: "battle",
            humans: [],
            settings: { mapSize: { w: 48, h: 48 }, buildingDensity: 0, baseType: "compound", teamSize: 4 },
        });
        const discovered = new Set();
        game.on(GAME_EVENTS.OBJECTIVE_DISCOVERED, (d) => discovered.add(d.faction.id));

        while (!game.gameOver && game.gameTime < 240) game.update(0.016);

        assert.equal(discovered.size, 2, "both factions discovered the enemy base");
        assert.ok(game.gameOver, `a winner should emerge within 240s (t=${game.gameTime.toFixed(0)}s)`);
    });
});
