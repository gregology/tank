/**
 * Discovery system tests (js/systems/discovery.js) — faction knowledge of
 * enemy objectives.
 *
 * The bugs these tests catch:
 *  - discovery never fires → once objectives start unknown, bots would
 *    wander forever and never learn where the enemy base is;
 *  - the LOS / range checks are dropped → factions become omniscient
 *    again and "discovery" is meaningless;
 *  - the discovered event fires repeatedly → the pheromone "food" beacon
 *    (which will subscribe to it) would be re-deposited every frame;
 *  - battle stops pre-populating faction knowledge → today's behaviour
 *    (bots know the base) silently regresses before discovery goes live.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFIG, TILES as T } from "../js/config.js";
import { GAME_EVENTS } from "../js/events.js";
import { Game } from "../js/game.js";
import { getMode } from "../js/modes.js";
import { runDiscovery } from "../js/systems/discovery.js";
import { customMap, fakeDevice, wallV } from "./helpers.js";

/** A minimal game stub exposing what runDiscovery reads. */
function stubGame({ unit, objective, obstacles = [] }) {
    const events = [];
    const faction = { id: 1, entities: [unit], knownObjectives: new Set() };
    return {
        map: customMap(obstacles),
        factions: [faction],
        mode: getMode("battle"),
        bases: [{ team: 1, alive: true }, objective],
        emit: (event, data) => events.push({ event, data }),
        events,
    };
}

const unit = (x, y) => ({ alive: true, x, y, team: 1 });
const objective = (x, y) => ({ team: 2, alive: true, x, y });

describe("runDiscovery", () => {
    it("discovers an objective a friendly unit can see, firing the event once", () => {
        const obj = objective(40.5, 40.5);
        const game = stubGame({ unit: unit(35.5, 40.5), objective: obj });

        runDiscovery(game);
        runDiscovery(game); // a second pass must not re-fire

        assert.ok(game.factions[0].knownObjectives.has(obj), "objective added to faction knowledge");
        const discovered = game.events.filter((e) => e.event === GAME_EVENTS.OBJECTIVE_DISCOVERED);
        assert.equal(discovered.length, 1);
        assert.equal(discovered[0].data.faction, game.factions[0]);
        assert.equal(discovered[0].data.objective, obj);
    });

    it("does not discover beyond sight range", () => {
        const obj = objective(40.5, 40.5);
        const far = 40.5 - CONFIG.OBJECTIVE_DISCOVERY_RANGE - 1;
        const game = stubGame({ unit: unit(far, 40.5), objective: obj });

        runDiscovery(game);

        assert.equal(game.factions[0].knownObjectives.size, 0);
        assert.equal(game.events.length, 0);
    });

    it("does not discover through blocking terrain", () => {
        const obj = objective(40.5, 40.5);
        const game = stubGame({
            unit: unit(35.5, 40.5),
            objective: obj,
            obstacles: wallV(38, 35, 45, T.HILL),
        });

        runDiscovery(game);

        assert.equal(game.factions[0].knownObjectives.size, 0);
    });

    it("a compound objective is spotted via any of its structures, not just its centre", () => {
        // The HQ (objective.x/y) hides behind the compound walls — seeing
        // the wall ring must count as discovering the base.
        const compound = {
            team: 2,
            alive: true,
            x: 45.5,
            y: 45.5,
            allStructures: [{ alive: true, x: 38.5, y: 40.5 }],
        };
        const game = stubGame({ unit: unit(35.5, 40.5), objective: compound });

        runDiscovery(game);

        assert.ok(game.factions[0].knownObjectives.has(compound), "spotted via the outer wall");
    });

    it("ignores dead objectives and dead spotters", () => {
        const dead = { team: 2, alive: false, x: 40.5, y: 40.5 };
        const game = stubGame({ unit: { alive: false, x: 35.5, y: 40.5, team: 1 }, objective: dead });

        runDiscovery(game);

        assert.equal(game.factions[0].knownObjectives.size, 0);
    });
});

describe("discovery in a real match", () => {
    const human = (team) => ({
        device: fakeDevice(),
        color: "#cc3333",
        darkColor: "#882222",
        label: `P${team}`,
        team,
    });

    it("objectives start unknown and are discovered when a unit sees the enemy base", () => {
        const game = new Game({
            gameType: "battle",
            humans: [human(1), human(2)],
            settings: {
                mapSize: { w: 64, h: 64 },
                buildingDensity: 0,
                baseType: "compound",
                teamSize: 1,
            },
        });

        const red = game.factions.find((f) => f.id === 1);
        const blueBase = game.bases.find((b) => b.team === 2);
        assert.equal(red.knownObjectives.size, 0, "the enemy base starts unknown");
        assert.equal(game.mode.aiObjective(game, { tank: { team: 1 } }), null, "no objective before discovery");

        // Find a legal position with line of sight to a compound
        // structure (the compound's orientation is map-dependent).
        let spot = null;
        for (let gy = 0; gy < game.map.height && !spot; gy++) {
            for (let gx = 0; gx < game.map.width && !spot; gx++) {
                const x = gx + 0.5,
                    y = gy + 0.5;
                if (!game.map.isPassable(x, y)) continue;
                const visible = blueBase.allStructures.some(
                    (s) =>
                        s.alive &&
                        Math.hypot(s.x - x, s.y - y) <= CONFIG.OBJECTIVE_DISCOVERY_RANGE &&
                        game.map.hasLineOfSight(x, y, s.x, s.y, { skipTarget: true }),
                );
                if (visible) spot = { x, y };
            }
        }
        assert.ok(spot, "a spotting position exists on the map");

        const spotter = red.entities[0];
        spotter.x = spot.x;
        spotter.y = spot.y;
        const events = [];
        game.on(GAME_EVENTS.OBJECTIVE_DISCOVERED, (d) => events.push(d));
        game.update(0.016);

        assert.ok(red.knownObjectives.has(blueBase), "discovery added the base to faction knowledge");
        assert.equal(events.length, 1, "the discovery event fired once");
        assert.equal(events[0].objective, blueBase);
        assert.equal(
            game.mode.aiObjective(game, { tank: { team: 1 } }),
            blueBase,
            "bots navigate to the base once it is known",
        );
    });
});
