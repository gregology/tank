/**
 * Adopt a swept tuning — the guarded last step of the tuning loop.
 *
 * Takes a candidate from a sweep report, re-validates it against the
 * current defaults on DISJOINT seeds (the anti-lucky-seed guard), and
 * only then regenerates js/config/swarm.js — so the adopted values apply
 * everywhere at once: the real game, the sandbox, the sims, and the
 * test suite.
 *
 * CLI:
 *   node tools/adopt.js --from sweep-results.json
 *   node tools/adopt.js --from sweep-results.json --candidate c7 \
 *        --validate-seeds 101-112 --margin 0
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { SWARM_TUNABLES } from "../js/config.js";
import { renderSwarmConfig } from "./render-config.js";
import { aggregateMetrics, DEFAULT_GOALS, metricsOf, runTasks, scoreMetrics, SIZE_MATRIX } from "./sweep.js";
import { summarize } from "./sim.js";

const CONFIG_PATH = new URL("../js/config/swarm.js", import.meta.url);
const HISTORY_PATH = new URL("./adoption-history.jsonl", import.meta.url);

export async function adopt({ report, candidateName, validateSeeds, sizes = SIZE_MATRIX, goals = DEFAULT_GOALS, margin = 0 }) {
    const candidate = candidateName
        ? report.rows.find((r) => r.name === candidateName)
        : report.rows.find((r) => r.name !== "defaults");
    if (!candidate) throw new Error(`candidate not found: ${candidateName ?? "(best non-default)"}`);

    // ── Validation on disjoint seeds ──
    const tasks = [];
    for (const size of sizes) {
        for (const seed of validateSeeds) {
            for (const [which, params] of [
                ["defaults", {}],
                ["candidate", candidate.params],
            ]) {
                tasks.push({
                    key: `${which}|${size.map}|${seed}`,
                    matchOpts: { map: size.map, teamSize: size.teamSize, cap: size.cap, seed, tuning: params },
                });
            }
        }
    }
    const results = await runTasks(tasks, Math.min(8, tasks.length));
    const metricsFor = (which) => {
        const sizeMetrics = sizes.map((size) =>
            metricsOf(summarize(validateSeeds.map((seed) => results.get(`${which}|${size.map}|${seed}`)))),
        );
        return aggregateMetrics(sizeMetrics, null);
    };
    const baseline = metricsFor("defaults");
    const validated = metricsFor("candidate");
    const baseScore = scoreMetrics(baseline, baseline, goals);
    const candScore = scoreMetrics(validated, baseline, goals);

    const accepted = candScore > baseScore + margin;
    return { candidate, baseline, validated, baseScore, candScore, accepted };
}

/** Append the adoption to the history log — the previous values are
 *  always recoverable (the lesson of a rejected post-adoption revert). */
function recordAdoption(params) {
    const previous = Object.fromEntries(SWARM_TUNABLES.map((t) => [t.key, t.value]));
    const line = JSON.stringify({ at: new Date().toISOString(), adopted: params, previous });
    let existing = "";
    try {
        existing = readFileSync(HISTORY_PATH, "utf8");
    } catch { /* first adoption */ }
    writeFileSync(HISTORY_PATH, `${existing}${line}\n`);
}

/** Regenerate js/config/swarm.js with the adopted values and verify. */
export function writeAdoptedConfig(params) {
    for (const key of Object.keys(params)) {
        const entry = SWARM_TUNABLES.find((t) => t.key === key);
        if (!entry) throw new Error(`candidate sets unknown tunable: ${key}`);
        if (params[key] < entry.min || params[key] > entry.max) {
            throw new Error(`${key}=${params[key]} outside [${entry.min}, ${entry.max}]`);
        }
    }
    recordAdoption(params);
    writeFileSync(CONFIG_PATH, renderSwarmConfig(SWARM_TUNABLES, params));
    execFileSync("npx", ["biome", "format", "--write", "js/config/swarm.js"], { stdio: "pipe" });
}

/* ── CLI ──────────────────────────────────────────────────── */

function parseCli(argv) {
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith("--")) continue;
        opts[argv[i].slice(2)] = argv[++i];
    }
    return opts;
}

function range(a, b) {
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    const cli = parseCli(process.argv.slice(2));
    const report = JSON.parse(readFileSync(cli.from, "utf8"));
    const seeds = cli["validate-seeds"]?.includes("-")
        ? range(...cli["validate-seeds"].split("-").map(Number))
        : [101, 102, 103, 104, 105, 106, 107, 108];
    const outcome = await adopt({
        report,
        candidateName: cli.candidate,
        validateSeeds: seeds,
        goals: report.goals ?? DEFAULT_GOALS,
        margin: cli.margin ? Number(cli.margin) : 0,
    });

    console.log(`candidate: ${outcome.candidate.name}  params: ${JSON.stringify(outcome.candidate.params)}`);
    console.log(`validation: defaults ${outcome.baseScore.toFixed(2)} vs candidate ${outcome.candScore.toFixed(2)}`);
    if (!outcome.accepted) {
        console.error("REJECTED on validation seeds — likely a lucky-seed artefact. Not adopted.");
        process.exit(1);
    }
    writeAdoptedConfig(outcome.candidate.params);
    console.log("adopted: js/config/swarm.js regenerated. Run `npm test` — tuned values that break behaviour SHOULD fail tests.");
}
