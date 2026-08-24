/**
 * Pheromone signal tests (js/ai/signals.js + js/systems/signals.js).
 *
 * The bugs these tests catch:
 *  - deposits never wired → the arbitration (next step) reads all-zero
 *    fields: no convoys, no rallying, no objective convergence;
 *  - depositMax replaced by plain deposit → a busy long route overwrites
 *    a shorter one and route optimisation runs backwards;
 *  - decay dropped → stale trails/alarms never fade and the swarm
 *    answers yesterday's fight;
 *  - the human emit multiplier dropped → bots stop falling in behind
 *    human-driven convoy leaders;
 *  - alarm broadcast not tied to a living victim → the swarm rallies
 *    to corpses (explicitly ruled out by the design);
 *  - food beacons not gated on the objective being alive → units keep
 *    converging on a destroyed objective;
 *  - fields shared across factions → enemies read each other's trails.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIGNAL_CHANNELS, SignalFields } from "../js/ai/signals.js";
import { ACTIONS, CONFIG } from "../js/config.js";
import { GAME_EVENTS } from "../js/events.js";
import { Game } from "../js/game.js";
import { runSignals } from "../js/systems/signals.js";
import { Tank } from "../js/tank.js";
import { customMap, fakeDevice } from "./helpers.js";

describe("SignalFields", () => {
    it("deposit accumulates but caps at SIGNAL_MAX", () => {
        const f = new SignalFields(8, 8);
        f.deposit("recruit", 2.5, 2.5, CONFIG.SIGNAL_MAX - 1);
        f.deposit("recruit", 2.5, 2.5, 5);
        assert.equal(f.valueAt("recruit", 2.5, 2.5), CONFIG.SIGNAL_MAX);
    });

    it("depositMax keeps the strongest deposit, never a weaker one", () => {
        const f = new SignalFields(8, 8);
        f.depositMax("trail", 2.5, 2.5, 1.0);
        f.depositMax("trail", 2.5, 2.5, 0.4);
        assert.ok(Math.abs(f.valueAt("trail", 2.5, 2.5) - 1.0) < 1e-6);
        f.depositMax("trail", 2.5, 2.5, 1.6);
        assert.ok(Math.abs(f.valueAt("trail", 2.5, 2.5) - 1.6) < 1e-6);
    });

    it("decay halves a channel after its half-life", () => {
        const f = new SignalFields(8, 8);
        for (const channel of SIGNAL_CHANNELS) {
            f.deposit(channel, 2.5, 2.5, 8);
            f.decay(CONFIG.SIGNAL_HALFLIVES[channel]);
            assert.ok(
                Math.abs(f.valueAt(channel, 2.5, 2.5) - 4) < 0.01,
                `${channel} should halve after ${CONFIG.SIGNAL_HALFLIVES[channel]}s`,
            );
        }
    });

    it("off-map deposits and reads are safe no-ops", () => {
        const f = new SignalFields(8, 8);
        f.deposit("recruit", -3, 99, 5);
        f.depositMax("trail", -3, 99, 5);
        assert.equal(f.valueAt("recruit", -3, 99), 0);
    });
});

/* ── runSignals ───────────────────────────────────────────── */

const botTank = (x, y, team = 1, overrides = {}) => ({
    alive: true,
    x,
    y,
    team,
    vehicleType: "tank",
    underAttackTimer: 0,
    distanceTravelled: 0,
    ...overrides,
});

function stubGame({ tanks = [], humans = [], knownObjectives = [], size = 16 } = {}) {
    const faction = {
        id: 1,
        entities: tanks,
        knownObjectives: new Set(knownObjectives),
        signals: new SignalFields(size, size),
    };
    const enemy = { id: 2, entities: [], knownObjectives: new Set(), signals: new SignalFields(size, size) };
    return {
        factions: [faction, enemy],
        allTanks: tanks,
        humanTanks: humans,
    };
}

describe("runSignals deposits", () => {
    it("every alive vehicle leaves recruitment at its own tile only", () => {
        const tank = botTank(5.5, 5.5);
        const game = stubGame({ tanks: [tank] });
        runSignals(game, 0.1);
        const signals = game.factions[0].signals;
        assert.ok(signals.valueAt("recruit", 5.5, 5.5) > 0, "recruitment deposited");
        assert.equal(signals.valueAt("recruit", 8.5, 8.5), 0, "no leakage to other tiles");
    });

    it("human-driven vehicles emit SIGNAL_HUMAN_EMIT× stronger recruitment", () => {
        const bot = botTank(5.5, 5.5);
        const human = botTank(9.5, 9.5);
        const game = stubGame({ tanks: [bot, human], humans: [human] });
        runSignals(game, 0.1);
        const signals = game.factions[0].signals;
        const botV = signals.valueAt("recruit", 5.5, 5.5);
        const humanV = signals.valueAt("recruit", 9.5, 9.5);
        assert.ok(Math.abs(humanV / botV - CONFIG.SIGNAL_HUMAN_EMIT) < 1e-6, "human emits stronger");
    });

    it("deposits stay inside the owner's faction fields", () => {
        const tank = botTank(5.5, 5.5, 1);
        const game = stubGame({ tanks: [tank] });
        runSignals(game, 0.1);
        assert.equal(game.factions[1].signals.valueAt("recruit", 5.5, 5.5), 0, "no cross-faction leak");
    });

    it("alarm is broadcast only by a living victim while its timer runs", () => {
        const victim = botTank(5.5, 5.5, 1, { underAttackTimer: 0.3 });
        const corpse = botTank(9.5, 9.5, 1, { alive: false, underAttackTimer: 4 });
        const game = stubGame({ tanks: [victim, corpse] });
        runSignals(game, 0.1);
        const signals = game.factions[0].signals;
        assert.ok(signals.valueAt("alarm", 5.5, 5.5) > 0, "victim broadcasts");
        assert.equal(signals.valueAt("alarm", 9.5, 9.5), 0, "no rally to a corpse");
        assert.ok(victim.underAttackTimer < 0.3, "broadcast window counts down");
    });

    it("trail is laid only with a known objective, weaker after a longer journey", () => {
        const objective = { alive: true, x: 12.5, y: 12.5 };
        const fresh = botTank(3.5, 3.5, 1, { distanceTravelled: 0 });
        const weary = botTank(7.5, 7.5, 1, { distanceTravelled: 50 });
        const game = stubGame({ tanks: [fresh, weary], knownObjectives: [objective] });
        runSignals(game, 0.1);
        const signals = game.factions[0].signals;
        const freshV = signals.valueAt("trail", 3.5, 3.5);
        const wearyV = signals.valueAt("trail", 7.5, 7.5);
        assert.ok(freshV > 0, "trail deposited");
        assert.ok(freshV > wearyV, "shorter journey lays the stronger trail");
    });

    it("no trail without a known objective", () => {
        const game = stubGame({ tanks: [botTank(5.5, 5.5)] });
        runSignals(game, 0.1);
        assert.equal(game.factions[0].signals.valueAt("trail", 5.5, 5.5), 0);
    });

    it("food beacon sits at known live objectives and never at destroyed ones", () => {
        const live = { alive: true, x: 12.5, y: 12.5 };
        const dead = { alive: false, x: 3.5, y: 3.5 };
        const game = stubGame({ knownObjectives: [live, dead] });
        runSignals(game, 0.1);
        const signals = game.factions[0].signals;
        assert.ok(signals.valueAt("food", 12.5, 12.5) > 0, "beacon at live objective");
        assert.equal(signals.valueAt("food", 3.5, 3.5), 0, "no beacon at destroyed objective");
    });

    it("a destroyed objective's stale beacon decays away", () => {
        const objective = { alive: true, x: 12.5, y: 12.5 };
        const game = stubGame({ knownObjectives: [objective] });
        const signals = game.factions[0].signals;
        runSignals(game, 1.0);
        assert.ok(signals.valueAt("food", 12.5, 12.5) > 1, "beacon established");
        objective.alive = false;
        for (let i = 0; i < 20; i++) runSignals(game, 1.0);
        assert.ok(signals.valueAt("food", 12.5, 12.5) < 0.01, "stale beacon gone");
    });
});

/* ── wiring through a real match ──────────────────────────── */

describe("signal wiring in a real match", () => {
    const human = (team) => ({
        device: fakeDevice(),
        color: "#cc3333",
        darkColor: "#882222",
        label: `P${team}`,
        team,
    });

    function battleGame() {
        return new Game({
            gameType: "battle",
            humans: [human(1), human(2)],
            settings: { mapSize: { w: 64, h: 64 }, buildingDensity: 0, baseType: "compound", teamSize: 1 },
        });
    }

    it("a frame deposits recruitment at vehicles and food at the known base", () => {
        const game = battleGame();
        // Discovery is pinned separately; here we seed knowledge directly
        // so the deposit wiring is what is under test.
        for (const faction of game.factions) {
            faction.knownObjectives.add(game.bases.find((b) => b.team !== faction.id));
        }
        game.update(0.016);
        for (const faction of game.factions) {
            const tank = faction.entities[0];
            assert.ok(faction.signals.valueAt("recruit", tank.x, tank.y) > 0, "recruitment at the tank");
            const enemyBase = game.bases.find((b) => b.team !== faction.id);
            assert.ok(faction.signals.valueAt("food", enemyBase.x, enemyBase.y) > 0, "beacon at the base");
        }
    });

    it("the hit event starts the victim's alarm broadcast", () => {
        const game = battleGame();
        const victim = game.allTanks[0];
        assert.equal(victim.underAttackTimer, 0);
        game.emit(GAME_EVENTS.HIT, { tank: victim, zone: "front" });
        assert.equal(victim.underAttackTimer, CONFIG.SIGNAL_ALARM_TIME);
        game.update(0.016);
        const faction = game.factions.find((f) => f.id === victim.team);
        assert.ok(faction.signals.valueAt("alarm", victim.x, victim.y) > 0, "alarm deposited at the victim");
    });

    it("hits on structures do not broadcast the vehicle alarm", () => {
        const game = battleGame();
        const tower = game.baseStructures[0];
        game.emit(GAME_EVENTS.HIT, { tank: tower, zone: null });
        assert.equal(tower.underAttackTimer, undefined, "structures never carry the broadcast state");
    });

    it("journey distance accumulates with movement and resets on respawn", () => {
        const map = customMap([]);
        const tank = new Tank(1, "#cc3333", "#882222");
        tank.team = 1;
        tank.alive = true;
        tank.x = 10.5;
        tank.y = 10.5;
        const device = fakeDevice({ held: [ACTIONS.forward] });
        for (let i = 0; i < 30; i++) tank.update(0.016, device, map);
        assert.ok(tank.distanceTravelled > 0.5, "journey accumulates");
        tank.respawnAt(20.5, 20.5);
        assert.equal(tank.distanceTravelled, 0, "a fresh life starts a fresh journey");
        assert.equal(tank.underAttackTimer, 0, "respawned vehicles are not broadcasting");
    });
});
