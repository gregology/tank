/**
 * Batch parameter sweep — empirical tuning for the swarm.
 *
 * Samples candidate tuning sets within each tunable's [min, max] (the
 * current defaults are always candidate 0, so every run compares against
 * the status quo), scores each across seeded matches on the full size
 * matrix, and ranks them by a WEIGHTED-GOAL score chosen on the CLI.
 *
 * Reproducibility contract: a match is a pure function of
 * (params, map size, seed), candidate sets are drawn from --sweep-seed,
 * and results merge keyed by (candidate, size, seed) — the report is
 * bit-identical no matter how many worker threads run.
 *
 * CLI:
 *   node tools/sweep.js --candidates 16 --tune-seeds 1-3 --workers 8
 *   node tools/sweep.js --goals decisive=3,discovery=2,duration=-1 \
 *        --sizes 64 --out /tmp/sweep.json
 */

import { availableParallelism } from "node:os";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { opinionatedSettings, SWARM, SWARM_TUNABLES } from "../js/config.js";
import { mulberry32 } from "../js/rng.js";
import { runMatch, summarize } from "./sim.js";

/** The tuning matrix: every map size at its opinionated team size. */
export const SIZE_MATRIX = [
    { map: 64, teamSize: opinionatedSettings("battle", 0).teamSize, cap: 300 },
    { map: 128, teamSize: opinionatedSettings("battle", 1).teamSize, cap: 420 },
    { map: 192, teamSize: opinionatedSettings("battle", 2).teamSize, cap: 600 },
];

export const DEFAULT_GOALS = {
    decisive: 3,
    discovery: 2,
    duration: -1,
    firstContact: -0.5,
    coverage: 0.5,
    clustering: -0.25,
};

/* ── candidate sampling ───────────────────────────────────── */

/**
 * Draw `count` candidate tuning sets.  Candidate 0 is always the current
 * defaults (the baseline every report compares against); the rest each
 * perturb a random subset of tunables within their declared ranges, so
 * the search stays local enough to learn from few matches.
 */
export function sampleCandidates(count, sweepSeed) {
    const rng = mulberry32(sweepSeed);
    const candidates = [{ name: "defaults", params: {} }];
    for (let i = 1; i <= count; i++) {
        const params = {};
        for (const t of SWARM_TUNABLES) {
            if (rng() > 0.35) continue; // perturb a sparse subset
            const v = t.min + rng() * (t.max - t.min);
            params[t.key] = Math.round(v * 10000) / 10000;
        }
        if (Object.keys(params).length === 0) {
            const t = SWARM_TUNABLES[Math.floor(rng() * SWARM_TUNABLES.length)];
            params[t.key] = Math.round((t.min + rng() * (t.max - t.min)) * 10000) / 10000;
        }
        candidates.push({ name: `c${i}`, params });
    }
    return candidates;
}

/* ── scoring ──────────────────────────────────────────────── */

/** Flat metric view of one match-set summary (means across factions). */
export function metricsOf(summary) {
    const mean = (obj) => {
        const vals = Object.values(obj).filter((v) => v != null);
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    return {
        decisive: summary.decisiveFraction,
        discovery: summary.mutualDiscovery,
        duration: summary.meanDuration,
        firstContact: summary.meanFirstContact,
        coverage: mean(summary.coverage),
        clustering: mean(summary.clustering),
    };
}

/**
 * Aggregate per-size metrics into one number per metric (equal weight
 * per size).  Null metrics (e.g. no contact ever) fall back to the
 * baseline's value — neutral, not punitive.
 */
export function aggregateMetrics(sizeMetrics, baseline) {
    const keys = ["decisive", "discovery", "duration", "firstContact", "coverage", "clustering"];
    const out = {};
    for (const k of keys) {
        const vals = sizeMetrics.map((m) => m[k]).filter((v) => v != null);
        out[k] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : baseline?.[k] ?? null;
    }
    return out;
}

/**
 * The weighted-goal score: each metric as a ratio to the baseline,
 * centred so 0 = "same as the baseline" and signed so higher = better
 * regardless of the goal's direction (negative weight = less is better).
 */
export function scoreMetrics(metrics, baseline, goals = DEFAULT_GOALS) {
    let score = 0;
    for (const [key, w] of Object.entries(goals)) {
        if (metrics[key] == null || baseline[key] == null || baseline[key] === 0) continue;
        score += w * (metrics[key] / baseline[key] - 1);
    }
    return score;
}

/* ── parallel execution (reproducible regardless of threads) ─ */

/**
 * Run every (candidate, size, seed) match across worker threads and
 * return results keyed by task key.  Matches are pure, so any schedule
 * yields the same result set.
 */
export async function runTasks(tasks, workerCount) {
    const results = new Map();
    if (workerCount <= 1 || tasks.length === 0) {
        for (const t of tasks) results.set(t.key, runMatch(t.matchOpts));
        return results;
    }
    const workers = [];
    const pending = new Map(); // worker → task
    let next = 0;
    let resolveAll, rejectAll;
    const done = new Promise((res, rej) => {
        resolveAll = res;
        rejectAll = rej;
    });

    const assign = (worker) => {
        if (next >= tasks.length) {
            if (pending.size === 0) resolveAll();
            return;
        }
        const task = tasks[next++];
        pending.set(worker, task);
        worker.postMessage(task);
    };

    for (let i = 0; i < Math.min(workerCount, tasks.length); i++) {
        const worker = new Worker(new URL("./sweep-worker.js", import.meta.url));
        worker.on("message", ({ key, result }) => {
            results.set(key, result);
            pending.delete(worker);
            assign(worker);
        });
        worker.on("error", rejectAll);
        workers.push(worker);
    }
    for (const worker of workers) assign(worker);
    try {
        await done;
    } finally {
        await Promise.all(workers.map((w) => w.terminate()));
    }
    return results;
}

/* ── the sweep itself ─────────────────────────────────────── */

/**
 * Run a full sweep and return the ranked report.
 *
 * @param {object} opts  { candidates, sweepSeed, tuneSeeds, sizes, goals, workers }
 */
export async function runSweep(opts = {}) {
    const candidates = sampleCandidates(opts.candidates ?? 16, opts.sweepSeed ?? 1);
    const sizes = opts.sizes ?? SIZE_MATRIX;
    const goals = opts.goals ?? DEFAULT_GOALS;
    const tuneSeeds = opts.tuneSeeds ?? [1, 2, 3];

    const tasks = [];
    for (const [ci, cand] of candidates.entries()) {
        for (const size of sizes) {
            for (const seed of tuneSeeds) {
                tasks.push({
                    key: `${ci}|${size.map}|${seed}`,
                    ci,
                    size,
                    seed,
                    matchOpts: { map: size.map, teamSize: size.teamSize, cap: size.cap, seed, tuning: cand.params },
                });
            }
        }
    }

    const results = await runTasks(tasks, opts.workers ?? 1);

    // Per candidate: summarize per size, aggregate, score.
    const rows = candidates.map((cand, ci) => {
        const sizeMetrics = sizes.map((size) => {
            const matches = tuneSeeds.map((seed) => results.get(`${ci}|${size.map}|${seed}`));
            return metricsOf(summarize(matches));
        });
        return { name: cand.name, params: cand.params, sizeMetrics };
    });
    const baseline = aggregateMetrics(rows[0].sizeMetrics, null);
    for (const row of rows) {
        row.metrics = aggregateMetrics(row.sizeMetrics, baseline);
        row.score = scoreMetrics(row.metrics, baseline, goals);
    }
    rows.sort((a, b) => b.score - a.score);
    return { goals, sizes, tuneSeeds, baseline, rows };
}

/* ── CLI ──────────────────────────────────────────────────── */

function parseGoals(str) {
    const goals = {};
    for (const pair of str.split(",")) {
        const [k, v] = pair.split("=");
        goals[k] = Number(v);
    }
    return goals;
}

function parseCli(argv) {
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith("--")) continue;
        opts[argv[i].slice(2)] = argv[++i];
    }
    const tuneSeeds = opts["tune-seeds"]?.includes("-")
        ? range(...opts["tune-seeds"].split("-").map(Number))
        : (opts["tune-seeds"]?.split(",").map(Number) ?? undefined);
    return {
        candidates: opts.candidates ? Number(opts.candidates) : undefined,
        sweepSeed: opts["sweep-seed"] ? Number(opts["sweep-seed"]) : undefined,
        tuneSeeds,
        sizes: opts.sizes ? SIZE_MATRIX.filter((s) => opts.sizes.split(",").map(Number).includes(s.map)) : undefined,
        goals: opts.goals ? parseGoals(opts.goals) : undefined,
        workers: opts.workers ? Number(opts.workers) : availableParallelism(),
        out: opts.out,
    };
}

function range(a, b) {
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    const cli = parseCli(process.argv.slice(2));
    const report = await runSweep(cli);
    const fmt = (row) =>
        `${row.name.padEnd(9)} score ${row.score.toFixed(2).padStart(7)}  ` +
        `decisive ${row.metrics.decisive?.toFixed(2)}  discovery ${row.metrics.discovery?.toFixed(2)}  ` +
        `duration ${row.metrics.duration?.toFixed(0)}s  contact ${row.metrics.firstContact?.toFixed(0)}s  ` +
        `coverage ${row.metrics.coverage?.toFixed(2)}  cluster ${row.metrics.clustering?.toFixed(1)}`;
    console.log(`baseline: ${fmt({ name: "defaults", score: 0, metrics: report.baseline })}`);
    for (const row of report.rows.slice(0, 8)) console.log(fmt(row));
    if (cli.out) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(cli.out, JSON.stringify(report, null, 2));
        console.log(`report written to ${cli.out}`);
    }
}
