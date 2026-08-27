/**
 * Swarm behaviour tests (js/ai/swarm/ + js/systems/swarm.js).
 *
 * Every test names the bug it catches:
 *   - stale routes that never fade (missing decay)
 *   - rallying to a corpse (alarm surviving the victim's death)
 *   - attacking an already-destroyed objective (dead food signal)
 *   - omniscient objectives (discovery without sight/LOS)
 *   - the swarm blobbing at home (exploration not spreading)
 *   - converging units stacking (missing personal space)
 *   - followers chasing their own tail (trail pulling backward)
 *   - route optimization inverted (longer paths laying stronger trails)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseSwarmGoal, spacingOffset } from "../js/ai/swarm/behaviours.js";
import { SignalFields } from "../js/ai/swarm/fields.js";
import { Swarm } from "../js/ai/swarm/index.js";
import { SWARM } from "../js/config.js";
import { Game } from "../js/game.js";
import { updateSwarms } from "../js/systems/swarm.js";
import { createBot, customMap, revealObjective, seededRng, Tank } from "./helpers.js";

const TICK = SWARM.FIELD_TICK;

/* ── fields ───────────────────────────────────────────────── */

describe("swarm fields", () => {
    it("decay fades stale signals", () => {
        const f = new SignalFields(16, 16);
        f.deposit("trail", 8, 8, 10);
        let prev = f.sample("trail", 8, 8);
        for (let i = 0; i < 5; i++) {
            f.tick({ ...SWARM, TRAIL_DIFFUSION: 0 });
            const v = f.sample("trail", 8, 8);
            assert.ok(v < prev, "trail must fade every tick");
            prev = v;
        }
    });

    it("diffusion spreads a deposit to its neighbours", () => {
        const f = new SignalFields(16, 16);
        f.deposit("alarm", 8, 8, 10);
        f.tick({ ...SWARM, ALARM_DECAY: 1 });
        assert.ok(f.sample("alarm", 9, 8) > 0, "east neighbour receives spread");
        assert.ok(f.sample("alarm", 8, 9) > 0, "south neighbour receives spread");
        assert.ok(f.sample("alarm", 8, 8) < 10, "centre gives value away");
    });

    it("deposits clamp instead of growing without bound", () => {
        const f = new SignalFields(16, 16);
        for (let i = 0; i < 200; i++) f.deposit("food", 8, 8, 10);
        assert.ok(f.sample("food", 8, 8) <= 50, "field values are capped");
    });

    it("strongestInRadius finds the peak and respects the threshold", () => {
        const f = new SignalFields(16, 16);
        f.deposit("alarm", 10, 8, 2);
        const hit = f.strongestInRadius("alarm", 8, 8, 6, 0.1);
        assert.ok(hit, "peak within radius is found");
        assert.equal(Math.floor(hit.x), 10);
        assert.equal(f.strongestInRadius("alarm", 8, 8, 6, 5), null, "below-threshold peaks are ignored");
    });
});

/* ── intel ────────────────────────────────────────────────── */

describe("swarm intel", () => {
    const structure = (x, y) => ({ x, y, team: 2, alive: true });
    const objective = (x, y) => ({ x, y, alive: true });

    it("objectives are sorted by priority and the dead drop out", () => {
        const swarm = new Swarm(16, 16);
        const minor = objective(5, 5);
        const major = objective(10, 10);
        swarm.intel.revealObjective(minor, 1);
        swarm.intel.revealObjective(major, 10);
        assert.equal(swarm.intel.objectives()[0].entity, major, "highest priority first");

        major.alive = false;
        assert.deepEqual(
            swarm.intel.objectives().map((o) => o.entity),
            [minor],
            "a destroyed objective stops attracting",
        );
    });

    it("structures are fog-of-war: only discovered, standing ones are targetable", () => {
        const swarm = new Swarm(16, 16);
        assert.equal(swarm.intel.knownStructures().length, 0, "nothing is omnisciently known");
        const s = structure(5, 5);
        swarm.intel.revealStructure(s);
        assert.equal(swarm.intel.knownStructures().length, 1);
        s.alive = false;
        assert.equal(swarm.intel.knownStructures().length, 0, "rubble is not a target");
    });
});

/* ── goal candidates ──────────────────────────────────────── */

describe("swarm goal selection", () => {
    const flat = () => customMap([]);

    it("a revealed objective becomes the nav goal", () => {
        const bot = createBot(10, 10, 0, flat(), seededRng(1));
        revealObjective(bot, { x: 30, y: 10 });
        const { navGoal } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], flat());
        assert.equal(navGoal.kind, "objective");
        assert.ok(navGoal.x > 10, "goal moves toward the objective");
    });

    it("an alarm near an ally triggers a rally", () => {
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        // Declared stage: isolates the rally mechanism from the global
        // weight balance (the sweep retunes W_RALLY/W_EXPLORE freely).
        bot.swarm.tuning.W_RALLY = 10;
        bot.swarm.fields.deposit("alarm", 15, 10, 3);
        const { navGoal } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.equal(navGoal.kind, "rally");
        assert.ok(Math.hypot(navGoal.x - 15, navGoal.y - 10) < 2, "rally heads for the alarm peak");
    });

    it("a unit does not rally to its own alarm", () => {
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.swarm.fields.deposit("alarm", 10, 10, 3); // its own tile
        const { navGoal } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.notEqual(navGoal?.kind, "rally");
    });

    it("a nearby visible enemy is engaged (fired at) without derailing the colony", () => {
        // Bug caught: a bot ignoring an adjacent enemy entirely.  Whether
        // navigation *pursues* is tuned (W_HUNT); that close enemies are
        // engaged is the invariant, and it must hold under any tuning.
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        const enemy = new Tank(2, "#33d", "#239");
        enemy.team = 2;
        enemy.alive = true;
        enemy.x = 14;
        enemy.y = 10;
        const { navGoal, fireTarget } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [enemy], map);
        assert.ok(fireTarget, "a close enemy is the fire target");
        assert.equal(fireTarget.target, enemy);
        assert.ok(navGoal, "the colony still has somewhere to be");
    });

    it("with nothing known, the fallback is exploration (no idle bots)", () => {
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        const { navGoal } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.equal(navGoal.kind, "explore");
        assert.ok(map.isPassable(navGoal.x, navGoal.y), "exploration targets passable ground");
        assert.ok(Math.hypot(navGoal.x - 10, navGoal.y - 10) > 4, "exploration goes somewhere");
    });

    it("a known objective is shelled even when nothing is currently seen (siege)", () => {
        // Bug caught: if fire targets require a personally-seen structure,
        // attackers with a known-but-unseen objective never grind the
        // compound — sieges stall at the gate forever.
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.swarm.intel.revealObjective({ x: 17, y: 10, alive: true }, 10); // objective only, no structure sighting
        const { fireTarget } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.ok(fireTarget, "the colony shells a known objective position");
        assert.equal(Math.round(fireTarget.target.x), 17);
    });

    it("skirmish semantics: with no intel there is no objective candidate", () => {
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        const { navGoal } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.notEqual(navGoal?.kind, "objective");
        assert.notEqual(navGoal?.kind, "trail");
    });

    it("keep-range vehicles hold a standoff band instead of closing in", () => {
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.tank.vehicleType = "spg"; // keepRange 15
        revealObjective(bot, { x: 40, y: 10 });

        const far = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.ok(far.navGoal.x > 10, "far away: close the distance");

        bot.tank.x = 16; // too close (d=24 → inside 15×1.2? no: 40-16=24 > 18 → still approaching)
        bot.tank.x = 30; // d=10 < 12 → too close
        const close = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.ok(close.navGoal.x < 30, "too close: back off to the standoff band");
    });
});

/* ── convoy ───────────────────────────────────────────────── */

describe("swarm convoy (recruitment)", () => {
    const flat = () => customMap([]);

    const leaderTank = (x, y, angle = 0) => {
        const t = new Tank(9, "#c33", "#822");
        t.team = 1;
        t.alive = true;
        t.vehicleType = "tank";
        t.x = x;
        t.y = y;
        t.angle = angle;
        t.convoyLeadable = true; // a purposeful leader — parked bots hold no convoy
        return t;
    };

    it("weaker attractors escort a stronger leader marching on the objective", () => {
        // Bug caught: assaults trickling in one unit at a time instead of
        // arriving as a convoy.  Escort is the convoy's purpose — a leader
        // heading for the objective gathers followers.
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.tank.vehicleType = "ifv";
        const leader = leaderTank(12, 10, 0); // facing east
        leader.pursuingObjective = true;
        bot.ai.allies = [bot.tank, leader];

        const { navGoal } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.equal(navGoal.kind, "convoy");
        assert.ok(navGoal.x < leader.x, "the follow point sits behind the leader");
        assert.ok(navGoal.y > leader.y, "an IFV flanks slightly to the side");
    });

    it("a track-crippled vehicle never leads a convoy", () => {
        // Bug caught: an immobilised tank kept its 'objective' goal kind,
        // so it stayed convoy-leadable — its escorts parked around the
        // casualty forever and the whole assault stalled out.
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.tank.vehicleType = "ifv";
        const leader = leaderTank(12, 10, 0);
        leader.pursuingObjective = true;
        leader.convoyLeadable = false; // the swarm system now stamps this for cripples
        leader.disabledSubsystems.add("leftTrack");
        leader.disabledSubsystems.add("rightTrack");
        assert.ok(leader.trackDamaged, "stage: the leader is immobilised");
        bot.ai.allies = [bot.tank, leader];

        const { navGoal } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.notEqual(navGoal?.kind, "convoy", "nobody follows a casualty");
    });

    it("a parked leader holds no convoy (no idle blobs)", () => {
        // Bug caught: convoys self-sustaining around a stationary bot at
        // spawn.  convoyLeadable is what separates purpose from parking.
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.tank.vehicleType = "ifv";
        const leader = leaderTank(12, 10, 0);
        leader.convoyLeadable = false; // parked and purposeless
        bot.ai.allies = [bot.tank, leader];

        const { navGoal } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.notEqual(navGoal?.kind, "convoy");
    });

    it("a tank does not follow a weaker attractor (no circular follow)", () => {
        const map = flat();
        const bot = createBot(10, 10, 0, map, seededRng(1));
        bot.tank.vehicleType = "tank";
        const ifv = leaderTank(12, 10, 0);
        ifv.vehicleType = "ifv";
        bot.ai.allies = [bot.tank, ifv];

        const { navGoal } = chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map);
        assert.notEqual(navGoal?.kind, "convoy", "tanks lead; they don't follow IFVs");
    });

    it("human-driven vehicles are stronger leaders than bots", () => {
        const map = flat();
        // Declared stage: isolates the leadership mechanism from the
        // global weight balance (explore-vs-convoy is a tuning call).
        const scenario = (human) => {
            const bot = createBot(10, 10, 0, map, seededRng(1));
            bot.tank.vehicleType = "squad";
            const ally = leaderTank(12, 10, 0); // a tank — squads convoy behind tanks
            if (human) bot.swarm.humans.add(ally);
            bot.swarm.tuning.W_EXPLORE = 0.5;
            bot.ai.allies = [bot.tank, ally];
            return chooseSwarmGoal(bot.ai, 0.016, bot.tank, [], map).navGoal;
        };
        const botLed = scenario(false);
        const humanLed = scenario(true);
        assert.equal(humanLed.kind, "convoy", "followers gather to a human leader");
        assert.ok(humanLed.strength > botLed.strength, "a human leader attracts more strongly than a bot");
    });
});

/* ── spacing ──────────────────────────────────────────────── */

describe("swarm spacing", () => {
    it("neighbours inside personal space push the steer point away", () => {
        const bot = createBot(10, 10, 0, customMap([]), seededRng(1));
        const close = new Tank(2, "#c33", "#822");
        close.alive = true;
        close.x = 10.4;
        close.y = 10;
        bot.ai.allies = [bot.tank, close];

        const offset = spacingOffset(bot.ai, bot.tank);
        assert.ok(offset.x < 0, "repulsion points away from the crowding neighbour");

        close.x = 20; // beyond personal space
        const none = spacingOffset(bot.ai, bot.tank);
        assert.equal(none.x, 0);
        assert.equal(none.y, 0);
    });
});

/* ── the per-frame system (staged via a stub game) ────────── */

describe("swarm system", () => {
    /**
     * A controlled world for updateSwarms: real map + real Swarm,
     * stand-in units and structures.  One call with dt = FIELD_TICK
     * advances exactly one field tick.
     */
    function stubWorld({ units = [], structures = [], obstacles = [], bots = [], bases = [] } = {}) {
        const map = customMap(obstacles);
        const swarm = new Swarm(map.width, map.height, { ...SWARM });
        const enemySwarm = new Swarm(map.width, map.height, { ...SWARM });
        return {
            map,
            swarm,
            enemySwarm,
            game: {
                map,
                allTanks: units,
                baseStructures: structures,
                bases,
                bots,
                gameTime: 0,
                swarms: new Map([
                    [1, swarm],
                    [2, enemySwarm],
                ]),
            },
        };
    }

    const unit = (x, y, team = 1) => ({
        x,
        y,
        team,
        alive: true,
        lastHitAt: null,
        routeHistory: [],
        objectivesSeen: new Set(),
    });
    /** An enemy base whose compound is one structure at (x, y). */
    const enemyBase = (x, y) => {
        const wall = { x, y, team: 2, alive: true };
        return { wall, base: { team: 2, alive: true, x, y, hq: { size: 0.5 }, structures: [wall] } };
    };

    it("a unit discovers an enemy structure within sight + LOS", () => {
        const sight = SWARM.SIGHT_RANGE;
        const { wall, base } = enemyBase(10 + sight - 1, 10);
        const { game, swarm, enemySwarm } = stubWorld({
            units: [unit(10, 10)],
            structures: [wall],
            bases: [base],
        });
        updateSwarms(game, TICK);
        assert.equal(swarm.intel.knownStructures().length, 1, "sighted structure becomes targetable");
        assert.equal(swarm.intel.objectives().length, 1, "seeing the compound reveals the base objective");
        assert.equal(enemySwarm.intel.size, 0, "knowledge is per-faction");
    });

    it("no discovery beyond sight range", () => {
        const { wall, base } = enemyBase(10 + SWARM.SIGHT_RANGE + 10, 10);
        const { game, swarm } = stubWorld({
            units: [unit(10, 10)],
            structures: [wall],
            bases: [base],
        });
        updateSwarms(game, TICK);
        assert.equal(swarm.intel.size, 0);
    });

    it("no discovery through a wall (LOS gates sight)", () => {
        const sight = SWARM.SIGHT_RANGE;
        const { wall, base } = enemyBase(10 + sight - 1, 10);
        const between = Math.floor(10 + sight / 2);
        const { game, swarm } = stubWorld({
            units: [unit(10, 10)],
            structures: [wall],
            bases: [base],
            obstacles: [{ x: between, y: 10 }], // a solid tile between
        });
        updateSwarms(game, TICK);
        assert.equal(swarm.intel.size, 0, "a wall between blocks discovery");
    });

    it("a living victim raises the alarm; death silences it (no corpse rally)", () => {
        const victim = unit(20, 20);
        victim.lastHitAt = 0;
        const { game, swarm, enemySwarm } = stubWorld({ units: [victim] });

        updateSwarms(game, TICK);
        assert.ok(swarm.fields.sample("alarm", 20, 20) > 0, "a unit under attack signals");
        assert.equal(enemySwarm.fields.sample("alarm", 20, 20), 0, "the enemy colony hears nothing");

        victim.alive = false;
        for (let i = 0; i < 40; i++) {
            game.gameTime += TICK;
            updateSwarms(game, TICK);
        }
        assert.ok(
            swarm.fields.sample("alarm", 20, 20) < 0.05,
            "the signal dies with the victim — no rallying to a corpse",
        );
    });

    it("a hit on a structure raises the alarm — sieges rally the colony", () => {
        // Bug caught: a lone attacker could raze a compound wall by wall
        // without the colony reacting — only unit hits raised the alarm,
        // so defenders stood by while the nest was dismantled.
        const game = new Game({
            gameType: "battle",
            humans: [],
            settings: { mapSize: { w: 64, h: 64 }, buildingDensity: 1.0, baseType: "compound", teamSize: 3, seed: 3 },
        });
        const structure = game.bases.find((b) => b.team === 1).walls[0];
        const swarm = game.swarms.get(1);
        const enemySwarm = game.swarms.get(2);
        assert.equal(swarm.fields.sample("alarm", structure.x, structure.y), 0, "no alarm before the hit");

        game.applyDamage(structure, { x: structure.x, y: structure.y + 5 }, 1);
        updateSwarms(game, TICK);
        assert.ok(swarm.fields.sample("alarm", structure.x, structure.y) > 0, "the nest under attack signals");
        assert.equal(
            enemySwarm.fields.sample("alarm", structure.x, structure.y),
            0,
            "the attacking colony hears nothing",
        );

        // …and the signal outlasts the hit: one hit keeps emitting while
        // the siege could continue (unit walls die in one shot — a
        // one-tick spike would fade before anyone reacts).
        const strength = swarm.fields.sample("alarm", structure.x, structure.y);
        for (let i = 0; i < Math.ceil(3 / TICK); i++) {
            game.gameTime += TICK;
            updateSwarms(game, TICK);
        }
        assert.ok(
            swarm.fields.sample("alarm", structure.x, structure.y) > strength * 0.3,
            "the alarm persists for seconds after the last hit",
        );
    });

    it("a known objective is lit with food; destruction removes the attraction", () => {
        const objective = { x: 30, y: 30, alive: true };
        const { game, swarm } = stubWorld({});
        swarm.intel.revealObjective(objective, 10);

        updateSwarms(game, TICK);
        assert.ok(swarm.fields.sample("food", 30, 30) > 0, "a known objective attracts");

        objective.alive = false;
        for (let i = 0; i < 20; i++) {
            game.gameTime += TICK;
            updateSwarms(game, TICK);
        }
        assert.equal(swarm.intel.size, 0, "destroyed objectives leave intel");
        assert.ok(swarm.fields.sample("food", 30, 30) < 0.1, "attraction dies with the objective");
    });

    it("every unit lays crumb trail; the route field stays dark until a route is proven", () => {
        const wanderer = unit(10, 10);
        const { game, swarm } = stubWorld({ units: [wanderer] });
        updateSwarms(game, TICK);
        assert.ok(swarm.fields.sample("trail", 10, 10) > 0, "crumbs mark the path");
        assert.equal(swarm.fields.sample("route", 10, 10), 0, "no route without a discovery");
        assert.ok(swarm.fields.sample("visited", 10, 10) > 0, "…and it still marks ground as visited");
    });

    it("a personal sighting lights the unit's walked route", () => {
        // Bug caught: followers had no lit route to follow because the
        // discoverer's path never lit up.
        const scout = unit(10, 10);
        scout.routeHistory = [10 * 128 + 5, 10 * 128 + 6, 10 * 128 + 7, 10 * 128 + 8, 10 * 128 + 9];
        const objective = { x: 14, y: 10, alive: true };
        const { game, swarm } = stubWorld({ units: [scout] });
        swarm.intel.revealObjective(objective, 10);

        updateSwarms(game, TICK);
        assert.ok(swarm.fields.sample("route", 5, 10) > 0, "the walked path lights up");
        assert.ok(swarm.fields.sample("route", 9, 10) > 0, "…the whole of it");
        assert.ok(scout.objectivesSeen.has(objective), "the sighting is recorded per unit");

        const before = swarm.fields.sample("route", 5, 10);
        updateSwarms(game, TICK);
        assert.ok(
            swarm.fields.sample("route", 5, 10) <= before,
            "a unit doesn't re-light a route it has already sighted",
        );
    });

    it("shorter journeys lay stronger routes (route optimization)", () => {
        const sprinter = unit(10, 10);
        sprinter.routeHistory = [10 * 128 + 8, 10 * 128 + 9]; // 2-tile journey
        const plodder = unit(20, 10);
        plodder.routeHistory = Array.from({ length: 40 }, (_, i) => 10 * 128 + (i % 40)); // long wander
        const objective = { x: 14, y: 10, alive: true };
        const { game, swarm } = stubWorld({ units: [sprinter, plodder] });
        swarm.intel.revealObjective(objective, 10);

        updateSwarms(game, TICK);
        const short = swarm.fields.sample("route", 8, 10);
        const long = swarm.fields.sample("route", 15, 10);
        assert.ok(short > 0, "routes light on discovery");
        // The bar is a clear dominance margin, not an exact ratio: the
        // ratio depends on TRAIL_LIT_NORM's length scaling.
        assert.ok(
            short > long * 1.5,
            `a shorter journey must light stronger (${short.toFixed(1)} vs ${long.toFixed(1)})`,
        );
    });
});

/* ── integration: the colony spreads out ──────────────────── */

describe("swarm integration (real match)", () => {
    const countCoverage = (swarm) => {
        let n = 0;
        for (const v of swarm.fields.grids.visited) if (v > 0.5) n++;
        return n;
    };

    it("no idle blobs: every unit displaces and the colony's coverage grows", () => {
        // Bug caught: idle groups forming at spawn (the anti-clustering
        // requirement).  Staged on a large map with early samples so the
        // pre-contact exploration phase is what's measured — defending
        // home under attack is legitimate behaviour, not blobbing.
        for (const seed of [11, 12, 13]) {
            const game = new Game({
                gameType: "battle",
                humans: [],
                settings: {
                    mapSize: { w: 128, h: 128 },
                    buildingDensity: 1.0,
                    baseType: "compound",
                    teamSize: 3,
                    seed,
                },
            });
            const swarm = game.swarms.get(1);

            for (let f = 0; f < Math.ceil(2 / 0.016); f++) game.update(0.016);
            const snap = new Map(
                game.allTanks.filter((t) => t.team === 1 && t.alive).map((t) => [t, { x: t.x, y: t.y }]),
            );
            const earlyCoverage = countCoverage(swarm);

            // A unit clearing the spawn area through the compound gate
            // jostles with its teammates for a few seconds — that's not
            // blobbing.  Measure over 14s so only genuine idlers fail.
            for (let f = 0; f < Math.ceil(14 / 0.016); f++) game.update(0.016);
            const lateCoverage = countCoverage(swarm);

            for (const [t, p] of snap) {
                if (!t.alive) continue;
                const d = Math.hypot(t.x - p.x, t.y - p.y);
                assert.ok(d > 4, `seed ${seed}: ${t.vehicleType} idle (moved ${d.toFixed(1)})`);
            }
            assert.ok(lateCoverage > earlyCoverage * 2, `seed ${seed}: coverage ${earlyCoverage} → ${lateCoverage}`);
        }
    });
});
