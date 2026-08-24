/**
 * Worker entry for the match pool (tools/pool.js).
 *
 * Receives { id, task } messages, runs one headless match, and posts the
 * metrics back keyed by task id.  Each worker is a separate isolate, so
 * the CONFIG/VEHICLES overrides runMatch applies per task can never leak
 * into another worker's simulation.
 */

import { parentPort } from "node:worker_threads";
import { runMatch } from "./sim-lib.js";

parentPort.on("message", ({ id, task }) => {
    try {
        parentPort.postMessage({ id, metrics: runMatch(task) });
    } catch (err) {
        parentPort.postMessage({ id, error: String(err?.stack ?? err) });
    }
});
