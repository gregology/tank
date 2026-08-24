/**
 * Optimisation goals — the single registry of optimisable metrics.
 *
 * Each entry: how to extract the metric from one match's collected
 * metrics (tools/metrics.js), which direction is better, and a label
 * for reports.  Aggregation (mean over runs), baseline-relative scoring,
 * and `--weights` parsing are defined here once and shared by
 * tools/sim.js and tools/optimize.js.
 *
 * Score model: score = Σ wᵢ × ratioᵢ where ratioᵢ is candidate/baseline
 * for lower-is-better metrics and baseline/candidate for higher-is-better
 * (epsilon-guarded).  Lower total = better overall config.
 *
 * Simulation-cost metadata (used by tools/sim-lib.js):
 *   settled(tracker, game)  true once the metric's value can no longer
 *                           change (first-event times) — when *every*
 *                           required metric is settled the match may stop
 *                           early.  Metrics without a predicate need the
 *                           full match.
 *   sampled: true           the metric needs the periodic field scans
 *                           (visited-tile union / clustering samples);
 *                           sampling is skipped when no required metric
 *                           asks for it.
 */

const mean2 = (m, table) => {
    const values = Object.values(table).map(Number);
    return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
};

/** Seconds until both factions have discovered an objective (cap if never). */
function bothDiscovered(m, cap) {
    const times = Object.values(m.discoveryTimes);
    return times.length < 2 ? cap : Math.max(...times);
}

export const OPT_METRICS = {
    engage: {
        better: "lower",
        extract: (m, cap) => m.firstContactTime ?? cap,
        settled: (tracker) => tracker.firstContactTime != null,
        label: "time to first engagement (s)",
    },
    discovery: {
        better: "lower",
        extract: (m, cap) => bothDiscovered(m, cap),
        settled: (tracker, game) => game.factions.every((f) => tracker.discoveryTimes[f.id] != null),
        label: "time until both factions discover (s)",
    },
    explore: {
        better: "higher",
        extract: (m) => mean2(m, m.exploration),
        sampled: true,
        label: "map explored by match end (0-1)",
    },
    exploreRate: {
        better: "higher",
        extract: (m) => mean2(m, m.explorationAt60),
        sampled: true,
        label: "map explored by 60s (0-1)",
    },
    decluster: {
        better: "higher",
        extract: (m) => mean2(m, m.clustering),
        label: "end-state spread (mean pairwise distance)",
    },
    declusterMean: {
        better: "higher",
        extract: (m) => mean2(m, m.clusteringMean),
        sampled: true,
        label: "whole-match spread (mean pairwise distance)",
    },
    cohesion: {
        better: "higher",
        extract: (m) => m.convoyCoherence,
        label: "convoy coherence (0-1)",
    },
    kills: {
        better: "higher",
        extract: (m) => mean2(m, m.kills),
        label: "enemy vehicles destroyed",
    },
    attrition: {
        better: "lower",
        extract: (m) => mean2(m, m.kills),
        label: "own vehicles lost (same data, inverted goal)",
    },
    damage: {
        better: "higher",
        extract: (m) => mean2(m, m.damageDealt),
        label: "HQ damage dealt",
    },
    duration: {
        better: "lower",
        extract: (m) => m.outcome.duration,
        label: "match duration (s)",
    },
};

/** Mean of every registered metric over a set of matches. */
export function aggregate(runs, cap) {
    const out = {};
    for (const [name, metric] of Object.entries(OPT_METRICS)) {
        out[name] = runs.reduce((s, m) => s + metric.extract(m, cap), 0) / runs.length;
    }
    return out;
}

/** Parse "engage=1,discovery=0.5" into { engage: 1, discovery: 0.5 }. */
export function parseWeights(spec) {
    const weights = {};
    for (const pair of spec.split(",")) {
        const [name, raw] = pair.split("=");
        const value = Number(raw);
        if (!OPT_METRICS[name]) throw new Error(`unknown metric "${name}" (known: ${Object.keys(OPT_METRICS).join(", ")})`);
        if (!Number.isFinite(value) || value < 0) throw new Error(`bad weight for "${name}": ${raw}`);
        weights[name] = value;
    }
    if (Object.values(weights).every((w) => w === 0)) throw new Error("at least one weight must be non-zero");
    return weights;
}

const EPS = 1e-6;

/** True when any required metric needs the periodic field scans. */
export function needsSampling(metricNames) {
    return metricNames.some((n) => OPT_METRICS[n]?.sampled);
}

/** True when every required metric's value can no longer change. */
export function allSettled(metricNames, tracker, game) {
    return metricNames.every((n) => OPT_METRICS[n]?.settled?.(tracker, game) ?? false);
}

/** Baseline-relative weighted score for an aggregated config (lower = better). */
export function scoreConfig(agg, baseline, weights) {
    let total = 0;
    for (const [name, w] of Object.entries(weights)) {
        const metric = OPT_METRICS[name];
        const cand = agg[name] + EPS,
            base = baseline[name] + EPS;
        total += w * (metric.better === "lower" ? cand / base : base / cand);
    }
    return total;
}
