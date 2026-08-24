/**
 * Headless match engine — shared by tools/sim.js and tools/optimize.js.
 *
 * Runs a full match without any DOM: seed the global PRNG, apply
 * CONFIG/VEHICLES parameter overrides, simulate to game-over (or the
 * time cap), and collect metrics.  Overrides are applied per run and
 * restored afterwards — the config modules are process-wide singletons.
 */

import { Game } from "../js/game.js";
import { allSettled, needsSampling } from "./goals.js";
import { collectMetrics, EXPLORATION_SNAPSHOT_TIME, sampleExploration, snapshotExplorationRate, trackMatch } from "./metrics.js";
import { getParam, setParam } from "./params.js";

export { getParam, setParam };

/** Deterministic PRNG (mulberry32) — same algorithm as test/helpers. */
export function seededRng(seed) {
    let s = seed | 0;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Run one headless match.
 *
 * @param {object} opts
 * @param {number} [opts.seed]        PRNG seed (the match is deterministic per seed)
 * @param {number} [opts.mapSize]     square map side in tiles
 * @param {number} [opts.teamSize]    vehicles per faction
 * @param {number} [opts.cap]         max game-seconds to simulate
 * @param {object} [opts.params]      { "CONFIG.X": value, … } overrides
 * @param {number} [opts.dt]          frame delta (default 1/60)
 * @param {string[]} [opts.metrics]   metric names the caller will consume
 *        (tools/goals.js registry).  When given, the periodic field scans
 *        run only if one of them is `sampled`, and the match stops early
 *        once every one of them is `settled` — a first-event metric like
 *        `engage` must not pay for a full 240s match.  Omit to simulate
 *        the full match with all sampling (sim.js does this).
 * @returns {object} metrics (see tools/metrics.js)
 */
export function runMatch({ seed = 1, mapSize = 64, teamSize = 4, cap = 240, params = {}, dt = 0.016, metrics = null } = {}) {
    const sampling = metrics == null || needsSampling(metrics);
    const originals = Object.entries(params).map(([path, value]) => {
        const original = getParam(path);
        setParam(path, value);
        return [path, original];
    });
    const realRandom = Math.random;
    Math.random = seededRng(seed);
    try {
        const game = new Game({
            gameType: "battle",
            humans: [],
            settings: { mapSize: { w: mapSize, h: mapSize }, buildingDensity: 0, baseType: "compound", teamSize },
        });
        const tracker = trackMatch(game);
        let nextSample = 0;
        let snapshotted = false;
        while (!game.gameOver && game.gameTime < cap) {
            game.update(dt);
            if (game.gameTime >= nextSample) {
                if (sampling) sampleExploration(game, tracker);
                nextSample = game.gameTime + 0.5;
                if (metrics != null && allSettled(metrics, tracker, game)) break;
            }
            if (sampling && !snapshotted && game.gameTime >= EXPLORATION_SNAPSHOT_TIME) {
                snapshotExplorationRate(game, tracker);
                snapshotted = true;
            }
        }
        return collectMetrics(game, tracker);
    } finally {
        Math.random = realRandom;
        for (const [path, original] of originals) setParam(path, original);
    }
}
