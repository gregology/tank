/**
 * Headless match runner (npm run sim).
 *
 *   node tools/sim.js [--seed 1] [--map 64] [--team 4] [--cap 240]
 *                     [--runs 1] [--threads N] [--set CONFIG.X=1.5]...
 *
 * Prints the collected metrics as JSON (per run; with --runs > 1 the
 * mean of every registered optimisable metric, see tools/goals.js).
 * Full matches with all sampling — for goal-weighted, early-exit sweeps
 * use tools/optimize.js.  Parameter overrides use dotted paths into
 * CONFIG or VEHICLES, e.g.:
 *
 *   node tools/sim.js --set CONFIG.EXPLORE_VENTURE_WEIGHT=0.2 \
 *        --set VEHICLES.tank.signals.recruit=1.4 --runs 5
 */

import { aggregate } from "./goals.js";
import { defaultThreads, runMatches } from "./pool.js";

function parseArgs(argv) {
    const opts = { seed: 1, mapSize: 64, teamSize: 4, cap: 240, runs: 1, threads: defaultThreads(), params: {} };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => argv[++i];
        if (arg === "--seed") opts.seed = Number(next());
        else if (arg === "--map") opts.mapSize = Number(next());
        else if (arg === "--team") opts.teamSize = Number(next());
        else if (arg === "--cap") opts.cap = Number(next());
        else if (arg === "--runs") opts.runs = Number(next());
        else if (arg === "--threads") opts.threads = Number(next());
        else if (arg === "--set") {
            const [path, raw] = next().split("=");
            opts.params[path] = Number(JSON.parse(raw));
        } else throw new Error(`unknown argument: ${arg}`);
    }
    return opts;
}

const opts = parseArgs(process.argv);
const tasks = Array.from({ length: opts.runs }, (_, r) => ({
    seed: opts.seed + r,
    mapSize: opts.mapSize,
    teamSize: opts.teamSize,
    cap: opts.cap,
    params: opts.params,
}));
const runs = await runMatches(tasks, { threads: opts.threads });

if (opts.runs === 1) {
    console.log(JSON.stringify(runs[0], null, 2));
} else {
    const mean = aggregate(runs, opts.cap);
    mean.gameOverRate = +(runs.filter((r) => r.outcome.gameOver).length / runs.length).toFixed(2);
    console.log(JSON.stringify({ runs: runs.length, mean }, null, 2));
}
