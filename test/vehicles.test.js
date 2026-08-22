/**
 * Vehicle behaviour tests — each behaviour strategy (js/vehicles/) is
 * exercised in isolation through a stub game + real entities, so the
 * firing/attack rules are unit-testable without a full match.
 *
 * The stub game is deliberately small: behaviours may only use the
 * documented seams (bullets, particles, emit, allTanks, baseStructures,
 * map, applyHitToTank, onStructureDestroyed, damageTileAt).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS, TILES as T, VEHICLES } from "../js/config.js";
import { getProjectileBehaviour } from "../js/projectiles/index.js";
import { Tank } from "../js/tank.js";
import { getVehicleBehaviour } from "../js/vehicles/index.js";
import { customMap, fakeDevice } from "./helpers.js";

/** A flat grass map with an optional wall — deterministic. */
function flatMap(wallTile = null) {
    const map = customMap(wallTile ? [wallTile] : []);
    return map;
}

/** A stub Game exposing the seams behaviours may use. */
function stubGame({ tanks = [], structures = [], map = flatMap() } = {}) {
    const game = {
        map,
        bullets: [],
        particles: {
            emit: () => {},
        },
        allTanks: tanks,
        baseStructures: structures,
        hits: [],
        destroyedStructures: [],
        damagedTiles: [],
        events: [],
        emit: (event, d) => game.events.push({ event, d }),
        applyHitToTank: (source, tank, damage) => {
            game.hits.push({ source, tank, damage });
        },
        onStructureDestroyed: (s) => {
            game.destroyedStructures.push(s);
        },
        damageTileAt: (gx, gy, damage) => {
            game.damagedTiles.push({ gx, gy, damage });
        },
    };
    return game;
}

/** A Tank placed on open ground with a given vehicle type. */
function placedTank(type, x = 10.5, y = 10.5, team = 1) {
    const t = new Tank(1, "#cc3333", "#882222");
    t.team = team;
    t.alive = true;
    t.x = x;
    t.y = y;
    t.vehicleType = type;
    return t;
}

describe("tank behaviour (direct fire)", () => {
    it("fires a bullet with the vehicle's stats and emits the fire event", () => {
        const game = stubGame();
        const tank = placedTank("tank");
        getVehicleBehaviour("tank").fire(game, tank, fakeDevice({ held: [ACTIONS.fire] }), 0.016);
        assert.equal(game.bullets.length, 1);
        assert.equal(game.bullets[0].damage, VEHICLES.tank.bulletDamage);
        assert.equal(game.bullets[0].speed, VEHICLES.tank.bulletSpeed);
        assert.ok(tank.fireCooldown > 0, "fire cooldown set");
        assert.equal(game.events[0].event, "fire");
        assert.equal(game.events[0].d.tank, tank);
    });

    it("does not fire while the cooldown is active", () => {
        const game = stubGame();
        const tank = placedTank("tank");
        tank.fireCooldown = 0.5;
        getVehicleBehaviour("tank").fire(game, tank, fakeDevice({ held: [ACTIONS.fire] }), 0.016);
        assert.equal(game.bullets.length, 0);
    });

    it("IFV fires the same direct bullet but uses the IFV muzzle flash", () => {
        const game = stubGame();
        let flashEffect = null;
        game.particles.emit = (effect) => {
            flashEffect = effect;
        };
        const ifv = placedTank("ifv");
        getVehicleBehaviour("ifv").fire(game, ifv, fakeDevice({ held: [ACTIONS.fire] }), 0.016);
        assert.equal(game.bullets.length, 1);
        assert.equal(flashEffect, "ifvFlash");
    });

    it("unknown types fall back to the tank behaviour", () => {
        assert.equal(getVehicleBehaviour("mystery"), getVehicleBehaviour("tank"));
    });
});

describe("SPG behaviour (hold-to-charge artillery)", () => {
    it("holding fire starts charging; releasing fires an arcing shell", () => {
        const game = stubGame();
        const spg = placedTank("spg");
        const held = fakeDevice({ held: [ACTIONS.fire] });
        getVehicleBehaviour("spg").fire(game, spg, held, 0.5);
        assert.ok(spg.isCharging);
        assert.equal(spg.chargeTime, 0.5);

        getVehicleBehaviour("spg").fire(game, spg, fakeDevice(), 0.016);
        assert.ok(!spg.isCharging);
        assert.equal(game.bullets.length, 1);
        assert.ok(game.bullets[0].arcing, "shell arcs over terrain");
        assert.equal(game.bullets[0].kind, "shell");
        assert.equal(game.events[0].event, "fire");
    });

    it("charges cap at the vehicle's max range", () => {
        const game = stubGame();
        const spg = placedTank("spg");
        const held = fakeDevice({ held: [ACTIONS.fire] });
        getVehicleBehaviour("spg").fire(game, spg, held, 1000);
        assert.ok(spg.chargeTime <= (VEHICLES.spg.maxRange - VEHICLES.spg.minRange) / VEHICLES.spg.chargeRate);
    });

    it("shell impact splashes tanks, structures, and the impact tile", () => {
        const game = stubGame({
            tanks: [placedTank("tank", 12.5, 12.5, 2)],
            structures: [{ alive: true, team: 2, x: 14.5, y: 12.5, size: 0.5, applyDamage: () => false }],
        });
        const b = { kind: "shell", x: 12.5, y: 12.5, team: 1, damage: 3.0 };
        getProjectileBehaviour("shell").onLand(game, b);
        assert.equal(game.hits.length, 1, "tank hit by splash");
        assert.equal(game.hits[0].tank.team, 2);
        assert.equal(game.damagedTiles.length, 1, "impact tile damaged");
        assert.equal(game.damagedTiles[0].gx, 12);
        assert.equal(game.damagedTiles[0].gy, 12);
        assert.ok(game.events.some((e) => e.event === "artillery_impact"));
    });

    it("splash skips friendly tanks and structures", () => {
        const game = stubGame({
            tanks: [placedTank("tank", 12.5, 12.5, 1)],
        });
        const b = { kind: "shell", x: 12.5, y: 12.5, team: 1, damage: 3.0 };
        getProjectileBehaviour("shell").onLand(game, b);
        assert.equal(game.hits.length, 0, "own team not damaged");
    });
});

describe("drone behaviour (kamikaze detonation)", () => {
    it("detonates on fire: kills the drone, damages enemies, emits drone_strike", () => {
        const game = stubGame({
            tanks: [placedTank("tank", 11.5, 10.5, 2)],
        });
        const drone = placedTank("drone", 10.5, 10.5, 1);
        getVehicleBehaviour("drone").fire(game, drone, fakeDevice({ held: [ACTIONS.fire] }), 0.016);
        assert.ok(!drone.alive, "drone destroyed itself");
        assert.equal(game.hits.length, 1, "enemy damaged by blast");
        assert.ok(game.events.some((e) => e.event === "drone_strike"));
    });

    it("does not detonate unless fire is held", () => {
        const game = stubGame();
        const drone = placedTank("drone");
        getVehicleBehaviour("drone").fire(game, drone, fakeDevice(), 0.016);
        assert.ok(drone.alive);
        assert.equal(game.hits.length, 0);
    });

    it("does not damage own-team tanks", () => {
        const game = stubGame({
            tanks: [placedTank("tank", 11.5, 10.5, 1)],
        });
        const drone = placedTank("drone", 10.5, 10.5, 1);
        getVehicleBehaviour("drone").fire(game, drone, fakeDevice({ held: [ACTIONS.fire] }), 0.016);
        assert.equal(game.hits.length, 0);
    });
});

describe("squad behaviour (auto-fire + dig-in)", () => {
    it("toggles dig-in on the fire edge and auto-fires at enemies in range", () => {
        const map = flatMap();
        const squad = placedTank("squad", 10.5, 10.5, 1);
        const enemy = placedTank("tank", 14.5, 10.5, 2);
        const game = stubGame({ tanks: [squad, enemy], map });
        const comp = squad.squad;
        for (let gx = 8; gx <= 16; gx++) {
            map.setTile(gx, 9, T.GRASS);
            map.setTile(gx, 10, T.GRASS);
            map.setTile(gx, 11, T.GRASS);
        }

        getVehicleBehaviour("squad").fire(game, squad, fakeDevice({ pressed: [ACTIONS.fire] }), 0.016);
        assert.equal(comp.digIn.state, "diggingIn", "fire edge starts dig-in");
        assert.equal(game.bullets.length, 0, "no firing while digging in");

        comp.update(1.1, map); // complete the dig-in transition
        getVehicleBehaviour("squad").fire(game, squad, fakeDevice(), 0.016);
        assert.equal(comp.digIn.state, "dugIn");
        assert.ok(game.bullets.length > 0, "dug-in squad members auto-fire");
    });

    it("update drives the squad component (dig-in timer + member steering)", () => {
        const map = flatMap();
        const squad = placedTank("squad");
        squad.squad.startDigIn();
        getVehicleBehaviour("squad").update(stubGame({ map }), squad, 1.1);
        assert.equal(squad.squad.digIn.state, "dugIn", "component update completed the dig-in");
    });
});

describe("movement (move hook)", () => {
    it("tank drives forward through the behaviour seam", () => {
        const map = flatMap();
        const tank = placedTank("tank", 10.5, 10.5);
        tank.angle = 0;
        const device = fakeDevice({ held: [ACTIONS.forward] });
        for (let i = 0; i < 10; i++) getVehicleBehaviour("tank").move(tank, device, 0.016, map);
        assert.ok(tank.x > 10.5, "ground vehicle moved east");
    });

    it("drone flies over blocking terrain instead of sliding around it", () => {
        const map = flatMap();
        const drone = placedTank("drone", 10.5, 10.5);
        drone.angle = 0;
        for (let gx = 11; gx <= 14; gx++) map.setTile(gx, 10, T.HILL); // wall east
        const device = fakeDevice({ held: [ACTIONS.forward] });
        for (let i = 0; i < 30; i++) getVehicleBehaviour("drone").move(drone, device, 0.016, map);
        assert.ok(drone.x > 11.5, "drone flew over the hill line");
    });

    it("squad movement cancels an in-progress dig-in", () => {
        const map = flatMap();
        const squad = placedTank("squad", 10.5, 10.5);
        squad.squad.startDigIn();
        assert.equal(squad.squad.digIn.state, "diggingIn");
        getVehicleBehaviour("squad").move(squad, fakeDevice({ held: [ACTIONS.forward] }), 0.016, map);
        assert.equal(squad.squad.digIn.state, "roaming", "movement key cancelled the dig-in");
    });
});

describe("AI aim strategies", () => {
    /** A stub AIController-shaped executor with the seams aim strategies use. */
    function stubAi(_me) {
        const keys = {};
        return {
            keys,
            fireDelay: 0,
            rng: () => 0.5,
            steerTurretTo: (t, desired) => {
                t.turretAngle = desired - t.angle; // snap the turret onto the target
            },
            tryShootWall: () => {},
        };
    }

    it("tank aims the turret and fires when LOS is clear", () => {
        const map = flatMap();
        const me = placedTank("tank", 10.5, 10.5);
        me.angle = 0;
        const ai = stubAi(me);
        const target = { x: 14.5, y: 10.5, dist: 4 };
        getVehicleBehaviour("tank").aim(ai, me, target, map);
        assert.equal(ai.keys[ACTIONS.fire], true, "fired after aiming east at an eastern target");
    });

    it("tank does not fire without line of sight", () => {
        const map = flatMap({ x: 12, y: 10, tile: T.HILL });
        const me = placedTank("tank", 10.5, 10.5);
        me.angle = 0;
        const ai = stubAi(me);
        const target = { x: 14.5, y: 10.5, dist: 4 };
        getVehicleBehaviour("tank").aim(ai, me, target, map);
        assert.equal(ai.keys[ACTIONS.fire], undefined, "no LOS → no fire");
    });

    it("IFV fires opportunistically within a wide forward cone", () => {
        const map = flatMap();
        const me = placedTank("ifv", 10.5, 10.5);
        me.angle = 0;
        const ai = stubAi(me);
        const target = { x: 14.5, y: 12.0, dist: 4.3 }; // slightly off the hull line
        getVehicleBehaviour("ifv").aim(ai, me, target, map);
        assert.equal(ai.keys[ACTIONS.fire], true);
    });

    it("SPG holds fire to charge only until the shell would reach the target", () => {
        const map = flatMap();
        const me = placedTank("spg", 10.5, 10.5);
        me.angle = 0;
        const ai = stubAi(me);
        const dist = 10;
        const target = { x: 10.5 + dist, y: 10.5, dist };
        getVehicleBehaviour("spg").aim(ai, me, target, map);
        assert.equal(ai.keys[ACTIONS.fire], true, "charging while the shell falls short");

        me.chargeTime = 999; // fully charged past the target range
        ai.keys = {};
        getVehicleBehaviour("spg").aim(ai, me, target, map);
        assert.equal(ai.keys[ACTIONS.fire], undefined, "releases fire when the charge is enough");
    });

    it("drones and squads have no turret-aim behaviour", () => {
        const map = flatMap();
        const ai = stubAi(placedTank("tank"));
        const target = { x: 14.5, y: 10.5, dist: 4 };
        assert.doesNotThrow(() => getVehicleBehaviour("drone").aim(ai, placedTank("drone"), target, map));
        assert.doesNotThrow(() => getVehicleBehaviour("squad").aim(ai, placedTank("squad"), target, map));
        assert.equal(ai.keys[ACTIONS.fire], undefined);
    });
});
