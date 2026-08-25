/**
 * Sweep worker: runs one match task at a time and posts the result back.
 * Matches are pure functions of (params, size, seed), so the parent's
 * result set is identical no matter how tasks interleave.
 */

import { parentPort } from "node:worker_threads";
import { runMatch } from "./sim.js";

parentPort.on("message", (task) => {
    const result = runMatch(task.matchOpts);
    parentPort.postMessage({ key: task.key, result });
});
