/**
 * Headless match runner — the measurement harness for AI tuning.
 *
 * Runs a full bot-vs-bot match without a browser (Game is DOM-free) and
 * returns a plain-metrics JSON object.  Everything is seeded, so a match
 * is a pure function of its options:  node tools/sim.js --seed 42
 * always reports the same numbers.
 *
 * Metrics (the quantities swarm tuning tries to move):
 *   firstContactTime — first time opposing units see each other up close
 *   discovery        — per faction, when the enemy HQ was first sighted
 *                      (sight radius + line of sight; battle only)
 *   coverage         — fraction of passable tiles a faction stood on
 *                      (exploration spread; sampled per faction)
 *   clustering       — mean nearest-neighbour distance within a faction
 *                      (lower = more bunched up)
 *   duration/winner  — decisiveness
 *
 * CLI:
 *   node tools/sim.js --seed 7
 *   node tools/sim.js --seeds 1-20 --teamSize 5 --map 128 --cap 300
 *   node tools/sim.js --type skirmish --seeds 1,2,3 --pretty
 */

import { pathToFileURL } from "node:url";
import { mapSizeIndexFor, opinionatedSettings, TILE_PROPS } from "../js/config.js";
import { GAME_EVENTS } from "../js/events.js";
import { Game } from "../js/game.js";

/** Tiles within which a unit is considered to "see" (discovery radius). */
export const SIGHT_RADIUS = 8;
/** Opposing units this close with LOS count as engaged. */
export const CONTACT_RANGE = 10;
/** Seconds of game time between metric samples. */
const SAMPLE_INTERVAL = 0.5;
/** Seconds of game time between coverage-timeline snapshots. */
const TIMELINE_INTERVAL = 15;

export const DEFAULTS = {
    type: "battle",
    seed: 1,
    map: 128,
    cap: 300,
};

/**
 * Run one seeded match to completion (or the time cap) and collect metrics.
 *
 * @param {object} opts  see DEFAULTS (seed, type, map, cap) plus explicit
 *                       overrides (teamSize, density) and `tuning`:
 *                       per-match swarm parameter overrides.  Team size and
 *                       density default to the opinionated match defaults
 *                       (js/config/match.js).
 * @returns {object} plain-JSON metrics for the match
 */
export function runMatch(opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const dt = 1 / 60;
    const opinionated = opinionatedSettings(o.type, mapSizeIndexFor(o.map));

    // Skirmish plans factions from humans only, so bot-vs-bot needs
    // passive stand-ins: humans on distinct teams whose device does
    // nothing (they never move or fire; the swarm reads them as inert
    // leaders — nobody follows a parked leader).
    const passiveDevice = { isDown: () => false, wasPressed: () => false, analog: () => 0, endFrame() {} };
    const humans = Array.from({ length: o.passive ?? 0 }, (_, i) => ({
        device: passiveDevice,
        color: "#888888",
        darkColor: "#555555",
        label: `IDLE${i + 1}`,
        team: i + 1,
    }));

    const game = new Game({
        gameType: o.type,
        humans,
        settings: {
            mapSize: { w: o.map, h: o.map },
            buildingDensity: o.density ?? opinionated.buildingDensity,
            teamSize: o.teamSize ?? opinionated.teamSize,
            seed: o.seed,
            tuning: o.tuning,
        },
    });

    const factions = game.factions.map((f) => f.id);
    const passableTiles = countPassableTiles(game);
    const visited = new Map(factions.map((id) => [id, new Set()]));
    const clusterSamples = new Map(factions.map((id) => [id, []]));
    const deaths = Object.fromEntries(factions.map((id) => [id, 0]));
    const discovery = Object.fromEntries(factions.map((id) => [id, null]));
    const timeline = new Map(factions.map((id) => [id, []]));
    let firstContactTime = null;

    game.on(GAME_EVENTS.DESTROY, ({ entity }) => {
        if (entity.isVehicle && entity.team in deaths) deaths[entity.team]++;
    });

    let sampleTimer = 0;
    let timelineTimer = 0;
    while (!game.gameOver && game.gameTime < o.cap) {
        game.update(dt);

        sampleTimer -= dt;
        if (sampleTimer <= 0) {
            sampleTimer += SAMPLE_INTERVAL;
            if (firstContactTime === null) firstContactTime = contactTime(game);
            sampleFactions(game, visited, clusterSamples, discovery);
        }
        timelineTimer -= dt;
        if (timelineTimer <= 0) {
            timelineTimer += TIMELINE_INTERVAL;
            for (const [id, set] of visited) timeline.get(id).push(round3(set.size / passableTiles));
        }
    }

    return {
        seed: o.seed,
        gameType: o.type,
        winner: game.winner,
        duration: round3(Math.min(game.gameTime, o.cap)),
        timedOut: !game.gameOver,
        firstContactTime,
        discovery,
        coverage: Object.fromEntries([...visited].map(([id, set]) => [id, round3(set.size / passableTiles)])),
        coverageOverTime: Object.fromEntries([...timeline].map(([id, ts]) => [id, ts])),
        clustering: Object.fromEntries([...clusterSamples].map(([id, s]) => [id, s.length ? round3(mean(s)) : null])),
        deaths,
    };
}

/* ── metric internals ─────────────────────────────────────── */

function countPassableTiles(game) {
    let n = 0;
    for (const t of game.map.tiles) if (TILE_PROPS[t]?.passable) n++;
    return n;
}

/** First sample where an opposing pair is close with line of sight. */
function contactTime(game) {
    const alive = game.allTanks.filter((t) => t.alive);
    for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
            const a = alive[i],
                b = alive[j];
            if (a.team === b.team) continue;
            if (Math.hypot(a.x - b.x, a.y - b.y) > CONTACT_RANGE) continue;
            if (!game.map.hasLineOfSight(a.x, a.y, b.x, b.y)) continue;
            return round3(game.gameTime);
        }
    }
    return null;
}

/** Per-sample faction metrics: visited tiles, clustering, HQ discovery. */
function sampleFactions(game, visited, clusterSamples, discovery) {
    const alive = game.allTanks.filter((t) => t.alive);
    for (const t of alive) visited.get(t.team)?.add(Math.floor(t.y) * game.map.width + Math.floor(t.x));

    for (const f of game.factions) {
        const units = alive.filter((t) => t.team === f.id);
        if (units.length >= 2) clusterSamples.get(f.id).push(meanNearestNeighbour(units));
        if (discovery[f.id] === null) discovery[f.id] = discoveryTime(game, f.id, units);
    }
}

/** Mean over each unit's distance to its nearest same-faction neighbour. */
function meanNearestNeighbour(units) {
    let total = 0;
    for (const u of units) {
        let best = Infinity;
        for (const v of units) {
            if (v === u) continue;
            best = Math.min(best, Math.hypot(v.x - u.x, v.y - u.y));
        }
        total += best;
    }
    return total / units.length;
}

/** Game time when a faction first sights the enemy base (its intel
 *  gains the objective — sight range + LOS, checked by the swarm). */
function discoveryTime(game, factionId, _units) {
    const swarm = game.swarms.get(factionId);
    if (!swarm) return null;
    return swarm.intel.objectives().length > 0 ? round3(game.gameTime) : null;
}

/* ── aggregation ──────────────────────────────────────────── */

/** Aggregate per-match metrics into a summary across seeds. */
export function summarize(results) {
    const decisive = results.filter((r) => r.winner !== null);
    const factions = [...new Set(results.flatMap((r) => Object.keys(r.deaths)))];
    const perFaction = (pick) =>
        Object.fromEntries(
            factions.map((id) => {
                const vals = results.map((r) => pick(r, id)).filter((v) => v != null);
                return [id, vals.length ? round3(mean(vals)) : null];
            }),
        );
    return {
        matches: results.length,
        decisive: decisive.length,
        decisiveFraction: round3(decisive.length / results.length),
        meanDuration: round3(mean(results.map((r) => r.duration))),
        meanFirstContact: meanOrNull(results.map((r) => r.firstContactTime)),
        discovery: perFaction((r, id) => r.discovery[id]),
        discoveryRate: Object.fromEntries(
            factions.map((id) => [id, round3(results.filter((r) => r.discovery[id] !== null).length / results.length)]),
        ),
        /** Fraction of matches where BOTH factions discovered the objective. */
        mutualDiscovery: round3(results.filter((r) => factions.every((id) => r.discovery[id] !== null)).length / results.length),
        coverage: perFaction((r, id) => r.coverage[id]),
        clustering: perFaction((r, id) => r.clustering[id]),
    };
}

/* ── small numeric helpers ────────────────────────────────── */

function mean(xs) {
    return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function meanOrNull(xs) {
    const vals = xs.filter((x) => x !== null);
    return vals.length ? round3(mean(vals)) : null;
}
function round3(x) {
    return Math.round(x * 1000) / 1000;
}

/* ── CLI ──────────────────────────────────────────────────── */

function parseArgs(argv) {
    const opts = {};
    let pretty = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--pretty") {
            pretty = true;
            continue;
        }
        if (!arg.startsWith("--")) continue;
        const key = arg.slice(2);
        const val = argv[++i];
        opts[key] = val;
    }
    // Expand --seeds "1-10" | "1,2,3" into a list; --seed n is one seed.
    let seeds = null;
    if (opts.seeds) {
        seeds = opts.seeds.includes("-")
            ? range(...opts.seeds.split("-").map(Number))
            : opts.seeds.split(",").map(Number);
    } else if (opts.seed) {
        seeds = [Number(opts.seed)];
    }
    const matchOpts = {};
    if (opts.type) matchOpts.type = opts.type;
    for (const k of ["map", "teamSize", "density", "cap", "passive"]) if (opts[k]) matchOpts[k] = Number(opts[k]);
    if (opts.tuning) {
        // --tuning KEY=VALUE,KEY=VALUE — per-match swarm overrides
        matchOpts.tuning = {};
        for (const pair of opts.tuning.split(",")) {
            const [k, v] = pair.split("=");
            matchOpts.tuning[k] = Number(v);
        }
    }
    return { seeds: seeds ?? [DEFAULTS.seed], matchOpts, pretty };
}

function range(a, b) {
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    const { seeds, matchOpts, pretty } = parseArgs(process.argv.slice(2));
    const results = seeds.map((seed) => runMatch({ ...matchOpts, seed }));
    for (const r of results) console.log(JSON.stringify(r, null, pretty ? 2 : 0));
    if (results.length > 1) console.log(JSON.stringify({ summary: summarize(results) }, null, pretty ? 2 : 0));
}
