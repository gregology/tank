/**
 * Parameter sweep optimizer (npm run optimize).
 *
 *   node tools/optimize.js [--weights engage=1,discovery=1] [--configs 20]
 *       [--repeats 5] [--seed 1] [--map 64] [--team 4] [--cap 240]
 *       [--threads N] [--implement] [--verify 8]
 *
 * Random-searches the swarm tuning space (SPACE below), scoring each
 * config by the weighted, baseline-relative sum of the registered
 * metrics (tools/goals.js).  Lower score = better; the baseline scores
 * exactly Σ weights.
 *
 * Execution: every match (baseline + configs, and later the
 * verification) is precomputed as a seeded task — in the SAME rng
 * consumption order the old sequential loop used — and fanned out over
 * a worker pool (tools/pool.js).  Threaded and `--threads 1` runs are
 * therefore bit-identical.  Matches simulate only what the weighted
 * metrics need: time-of-first-event goals (`engage`, `discovery`) stop
 * the match as soon as they are settled.
 *
 * --implement re-verifies the winning config on --verify fresh seeds
 * (against the baseline on the same seeds) and, only if it still wins,
 * writes it to js/config/tuning.js — the override layer the config
 * package merges over its defaults at load.
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { aggregate, OPT_METRICS, parseWeights, scoreConfig } from "./goals.js";
import { defaultThreads, runMatches } from "./pool.js";
import { getParam, seededRng } from "./sim-lib.js";

/** The tunable space: dotted param path + uniform sampling range. */
const SPACE = [
    { path: "CONFIG.EXPLORE_VENTURE_WEIGHT", min: 0, max: 0.3 },
    { path: "CONFIG.CONVOY_CROWD_LIMIT", min: 2, max: 20 },
    { path: "CONFIG.CONVOY_JOIN_RANGE", min: 6, max: 16 },
    { path: "CONFIG.EXPLORE_RADIUS", min: 8, max: 24 },
    { path: "CONFIG.EXPLORE_SAMPLES", min: 4, max: 12, int: true },
    { path: "CONFIG.EXPLORE_INTERVAL", min: 1, max: 8 },
    { path: "CONFIG.SIGNAL_HALFLIVES.trail", min: 2, max: 20 },
    { path: "CONFIG.SIGNAL_HALFLIVES.recruit", min: 1, max: 6 },
    { path: "CONFIG.SIGNAL_ALARM_STRENGTH", min: 2, max: 12 },
    { path: "CONFIG.SIGNAL_ALARM_RESPONSE_RADIUS", min: 6, max: 20, int: true },
    { path: "CONFIG.SIGNAL_TRAIL_DISTANCE_FACTOR", min: 0, max: 0.15 },
    { path: "VEHICLES.drone.personalSpace", min: 0, max: 3 },
    { path: "VEHICLES.squad.personalSpace", min: 0, max: 2.5 },
];

const TUNING_FILE = "js/config/tuning.js";

function parseArgs(argv) {
    const opts = {
        weights: "engage=1,discovery=1",
        configs: 20,
        repeats: 5,
        seed: 1,
        mapSize: 64,
        teamSize: 4,
        cap: 240,
        threads: defaultThreads(),
        implement: false,
        verify: 8,
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => argv[++i];
        if (arg === "--weights") opts.weights = next();
        else if (arg === "--configs") opts.configs = Number(next());
        else if (arg === "--repeats") opts.repeats = Number(next());
        else if (arg === "--seed") opts.seed = Number(next());
        else if (arg === "--map") opts.mapSize = Number(next());
        else if (arg === "--team") opts.teamSize = Number(next());
        else if (arg === "--cap") opts.cap = Number(next());
        else if (arg === "--threads") opts.threads = Number(next());
        else if (arg === "--implement") opts.implement = true;
        else if (arg === "--verify") opts.verify = Number(next());
        else throw new Error(`unknown argument: ${arg}`);
    }
    opts.parsedWeights = parseWeights(opts.weights);
    return opts;
}

/* ── task construction (rng order matches the old sequential loop) ── */

function drawSeeds(rng, n) {
    return Array.from({ length: n }, () => Math.floor(rng() * 1e9));
}

function drawParams(rng) {
    return Object.fromEntries(
        SPACE.map((p) => {
            const v = p.min + rng() * (p.max - p.min);
            return [p.path, p.int ? Math.round(v) : +v.toFixed(4)];
        }),
    );
}

/**
 * Build evaluation units ({ params, seeds }) and run every match through
 * the pool.  Returns one aggregated metric set per unit, in unit order.
 */
async function evaluateAll(units, opts, weights) {
    const matchOpts = {
        mapSize: opts.mapSize,
        teamSize: opts.teamSize,
        cap: opts.cap,
        metrics: Object.keys(weights),
    };
    const tasks = units.flatMap((u) => u.seeds.map((seed) => ({ ...matchOpts, seed, params: u.params })));
    let lastReport = 0;
    const results = await runMatches(tasks, {
        threads: opts.threads,
        onProgress: (done, total) => {
            if (done - lastReport >= 25 || done === total) {
                console.log(`  ${done}/${total} matches`);
                lastReport = done;
            }
        },
    });
    let offset = 0;
    return units.map((u) => {
        const slice = results.slice(offset, (offset += u.seeds.length));
        return aggregate(slice, opts.cap);
    });
}

function formatMetrics(agg, weights) {
    return Object.keys(weights)
        .map((name) => `${name}=${agg[name].toFixed(2)}`)
        .join(" ");
}

/* ── --implement persistence ── */

function writeTuning(params, header) {
    const split = { CONFIG: {}, VEHICLES: {} };
    for (const [path, value] of Object.entries(params)) {
        const [root, ...rest] = path.split(".");
        split[root][rest.join(".")] = value;
    }
    const render = (table) => {
        const entries = Object.entries(table);
        if (entries.length === 0) return "{}";
        const body = entries
            .map(([key, value]) => `        ${/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key)}: ${value},`)
            .join("\n");
        return `{\n${body}\n    }`;
    };
    writeFileSync(
        TUNING_FILE,
        `${header}\nexport const TUNING_OVERRIDES = {\n    CONFIG: ${render(split.CONFIG)},\n    VEHICLES: ${render(split.VEHICLES)},\n};\n`,
    );
    execSync(`npx biome format --write ${TUNING_FILE}`, { stdio: "inherit" });
}

/* ── main ── */

const opts = parseArgs(process.argv);
const weights = opts.parsedWeights;
const rng = seededRng(opts.seed);

const baselineParams = Object.fromEntries(SPACE.map((p) => [p.path, getParam(p.path)]));
const units = [{ params: baselineParams, seeds: drawSeeds(rng, opts.repeats) }];
for (let c = 0; c < opts.configs; c++) {
    units.push({ params: drawParams(rng), seeds: drawSeeds(rng, opts.repeats) });
}

console.log(
    `sweep: ${opts.configs} configs × ${opts.repeats} repeats (+baseline), ${units.reduce((s, u) => s + u.seeds.length, 0)} matches on ${opts.threads} threads, goals: ${opts.weights}`,
);
const aggs = await evaluateAll(units, opts, weights);
const baseline = aggs[0];
console.log(`baseline: score=${scoreConfig(baseline, baseline, weights).toFixed(3)}  ${formatMetrics(baseline, weights)}`);

const results = aggs.slice(1).map((agg, i) => ({
    params: units[i + 1].params,
    agg,
    score: scoreConfig(agg, baseline, weights),
}));
results.sort((a, b) => a.score - b.score);
console.log("\ntop 5 configs:");
for (const r of results.slice(0, 5)) {
    console.log(`  score=${r.score.toFixed(3)}  ${formatMetrics(r.agg, weights)}`);
    for (const [path, value] of Object.entries(r.params)) {
        if (value !== baselineParams[path]) console.log(`    ${path} = ${value}  (default ${baselineParams[path]})`);
    }
}

if (opts.implement) {
    const winner = results[0];
    console.log(`\nverifying the winner on ${opts.verify} fresh seeds…`);
    const freshRng = seededRng(opts.seed + 1e6);
    const verifyUnits = [
        { params: winner.params, seeds: drawSeeds(freshRng, opts.verify) },
        { params: baselineParams, seeds: drawSeeds(freshRng, opts.verify) },
    ];
    const [verifyWinner, verifyBaseline] = await evaluateAll(verifyUnits, opts, weights);
    const verifiedScore = scoreConfig(verifyWinner, verifyBaseline, weights);
    const baselineScore = scoreConfig(verifyBaseline, verifyBaseline, weights);
    console.log(
        `verification: winner score=${verifiedScore.toFixed(3)} vs baseline ${baselineScore.toFixed(3)}  ${formatMetrics(verifyWinner, weights)}`,
    );
    if (verifiedScore < baselineScore) {
        const header =
            `/**\n * GENERATED by tools/optimize.js --implement — ${new Date().toISOString()}\n` +
            ` * weights: ${opts.weights}\n` +
            ` * sweep: score ${winner.score.toFixed(3)} over ${opts.configs} configs × ${opts.repeats} repeats\n` +
            ` * verification: ${verifiedScore.toFixed(3)} vs baseline ${baselineScore.toFixed(3)} on ${opts.verify} fresh seeds\n` +
            ` * Hand-edits are overwritten by the next --implement run.\n */`;
        writeTuning(winner.params, header);
        console.log(`wrote ${TUNING_FILE}`);
    } else {
        console.log("the winner did NOT beat the baseline on fresh seeds — nothing written (likely overfit)");
    }
}
