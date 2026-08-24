/**
 * Match metrics — shared by the headless simulator/optimizer (Node)
 * and the browser sandbox.
 *
 * `trackMatch` subscribes to the game event bus for time-based events;
 * `collectMetrics` computes state-based metrics from the finished (or
 * running) match.  Everything is plain data so results can be printed
 * as JSON or rendered in the sandbox panel.
 *
 *   firstContactTime   seconds until the first shot from a *vehicle*
 *                      (static tower fire is excluded — vehicles only
 *                      fire with a target, so the first mobile shot
 *                      marks the forces actually engaging)
 *   discoveryTimes     factionId → seconds until that faction first
 *                      discovered an enemy objective
 *   exploration        factionId → fraction of passable tiles that ever
 *                      carried a friendly recruit/trail signal (ground
 *                      covered so far — sampled cumulatively, since the
 *                      fields themselves decay)
 *   clustering         factionId → mean pairwise distance between its
 *                      alive vehicles (low = blobbing)
 *   clusteringMean     factionId → the same, averaged over the whole
 *                      match (sampled alongside exploration)
 *   explorationAt60    factionId → exploration fraction at t=60s
 *                      (how fast the map gets covered)
 *   kills              factionId → enemy vehicles destroyed
 *   damageDealt        factionId → HQ damage dealt to the enemy base
 *   convoyCoherence    fraction of alive bots near a stronger emitter
 *   outcome            winner / duration / HQ damage taken
 */

import { CONFIG, VEHICLES } from "../js/config.js";
import { GAME_EVENTS } from "../js/events.js";

/** When the exploration-rate snapshot is taken (game-seconds). */
export const EXPLORATION_SNAPSHOT_TIME = 60;

export function trackMatch(game) {
    const tracker = {
        firstContactTime: null,
        discoveryTimes: {},
        visited: new Map(),
        kills: {},
        clusteringSamples: new Map(),
        explorationAt60: null,
    };
    for (const faction of game.factions) {
        tracker.visited.set(faction.id, new Set());
        tracker.kills[faction.id] = 0;
        tracker.clusteringSamples.set(faction.id, { sum: 0, count: 0 });
    }
    game.on(GAME_EVENTS.FIRE, ({ source }) => {
        if (tracker.firstContactTime == null && source.isVehicle) tracker.firstContactTime = game.gameTime;
    });
    game.on(GAME_EVENTS.OBJECTIVE_DISCOVERED, ({ faction }) => {
        if (tracker.discoveryTimes[faction.id] == null) tracker.discoveryTimes[faction.id] = game.gameTime;
    });
    game.on(GAME_EVENTS.DESTROY, ({ entity }) => {
        if (!entity.isVehicle) return;
        for (const faction of game.factions) {
            if (faction.id !== entity.team) tracker.kills[faction.id]++;
        }
    });
    return tracker;
}

/** Field value above which a tile counts as visited for exploration. */
const VISITED_THRESHOLD = 0.05;

/**
 * Union the currently marked tiles into the cumulative visited sets and
 * sample the clustering index.  Call this periodically (e.g. twice a
 * second) while simulating.
 */
export function sampleExploration(game, tracker) {
    for (const faction of game.factions) {
        const visited = tracker.visited.get(faction.id);
        if (visited) {
            for (let gy = 0; gy < game.map.height; gy++) {
                for (let gx = 0; gx < game.map.width; gx++) {
                    const x = gx + 0.5,
                        y = gy + 0.5;
                    if (
                        faction.signals.valueAt("recruit", x, y) > VISITED_THRESHOLD ||
                        faction.signals.valueAt("trail", x, y) > VISITED_THRESHOLD
                    ) {
                        visited.add(gy * game.map.width + gx);
                    }
                }
            }
        }
        const samples = tracker.clusteringSamples.get(faction.id);
        if (samples) {
            samples.sum += clusteringIndex(faction);
            samples.count++;
        }
    }
}

/** Record the exploration-rate snapshot (call once at the snapshot time). */
export function snapshotExplorationRate(game, tracker) {
    tracker.explorationAt60 = {};
    for (const faction of game.factions) {
        tracker.explorationAt60[faction.id] = explorationFraction(game, faction, tracker.visited.get(faction.id));
    }
}

export function collectMetrics(game, tracker) {
    const exploration = {};
    const clustering = {};
    const clusteringMean = {};
    const damageDealt = {};
    for (const faction of game.factions) {
        exploration[faction.id] = explorationFraction(game, faction, tracker.visited.get(faction.id));
        clustering[faction.id] = clusteringIndex(faction);
        const samples = tracker.clusteringSamples.get(faction.id);
        clusteringMean[faction.id] = samples.count > 0 ? +(samples.sum / samples.count).toFixed(2) : 0;
        const enemyBase = game.bases.find((b) => b.team !== faction.id);
        damageDealt[faction.id] = enemyBase?.hq ? +(enemyBase.hq.maxHp - enemyBase.hq.hp).toFixed(2) : 0;
    }
    return {
        firstContactTime: tracker.firstContactTime,
        discoveryTimes: tracker.discoveryTimes,
        exploration,
        explorationAt60: tracker.explorationAt60 ?? exploration,
        clustering,
        clusteringMean,
        kills: tracker.kills,
        damageDealt,
        convoyCoherence: convoyCoherence(game),
        outcome: {
            winner: game.winner,
            duration: +game.gameTime.toFixed(1),
            gameOver: game.gameOver,
            hqDamage: game.bases.map((b) => +(b.hq.maxHp - b.hq.hp).toFixed(2)),
        },
    };
}

function explorationFraction(game, faction, visited) {
    let passable = 0;
    for (let gy = 0; gy < game.map.height; gy++) {
        for (let gx = 0; gx < game.map.width; gx++) {
            if (game.map.isPassable(gx + 0.5, gy + 0.5)) passable++;
        }
    }
    return passable > 0 ? +((visited?.size ?? 0) / passable).toFixed(3) : 0;
}

function clusteringIndex(faction) {
    const alive = faction.entities.filter((t) => t.alive);
    let sum = 0,
        pairs = 0;
    for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
            sum += Math.hypot(alive[i].x - alive[j].x, alive[i].y - alive[j].y);
            pairs++;
        }
    }
    return pairs > 0 ? +(sum / pairs).toFixed(2) : 0;
}

function convoyCoherence(game) {
    let bots = 0,
        following = 0;
    for (const faction of game.factions) {
        for (const tank of faction.entities) {
            if (!tank.alive || game.humanTanks.includes(tank)) continue;
            bots++;
            const myEmit = emitOf(tank, game);
            const nearLeader = faction.entities.some(
                (f) =>
                    f !== tank &&
                    f.alive &&
                    emitOf(f, game) > myEmit &&
                    Math.hypot(f.x - tank.x, f.y - tank.y) <= CONFIG.CONVOY_JOIN_RANGE,
            );
            if (nearLeader) following++;
        }
    }
    return bots > 0 ? +(following / bots).toFixed(3) : 0;
}

function emitOf(tank, game) {
    const base = VEHICLES[tank.vehicleType]?.signals?.recruit ?? 0;
    return game.humanTanks.includes(tank) ? base * CONFIG.SIGNAL_HUMAN_EMIT : base;
}
