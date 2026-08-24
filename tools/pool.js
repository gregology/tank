/**
 * Match pool — fan headless matches out across worker threads.
 *
 * `runMatches(tasks)` is the one execution engine for tools/optimize.js
 * and tools/sim.js: pass every match to run as a `{ opts, seed, params }`
 * task (seeds precomputed by the caller, so threaded and sequential runs
 * consume the identical seed sequence) and get the metrics back in task
 * order.  `--threads 1` runs in-process with zero worker overhead — the
 * debug/reference path the threaded path must produce identical
 * results to.
 */

import os from "node:os";
import { Worker } from "node:worker_threads";
import { runMatch } from "./sim-lib.js";

export function defaultThreads() {
    return os.availableParallelism?.() ?? os.cpus().length;
}

/**
 * @param {Array<{opts:object, seed:number, params:object}>} tasks
 * @param {object} [opts]
 * @param {number} [opts.threads]   worker count (default: available parallelism)
 * @param {(done:number, total:number) => void} [opts.onProgress]
 * @returns {Promise<object[]>} metrics in task order
 */
export async function runMatches(tasks, { threads = defaultThreads(), onProgress = null } = {}) {
    if (tasks.length === 0) return [];
    const workerCount = Math.max(1, Math.min(threads, tasks.length));
    if (workerCount === 1) {
        return tasks.map((task, i) => {
            const metrics = runMatch(task);
            onProgress?.(i + 1, tasks.length);
            return metrics;
        });
    }

    return new Promise((resolve, reject) => {
        const results = new Array(tasks.length);
        const workers = [];
        let nextTask = 0,
            done = 0,
            settled = false;

        const shutdown = () => {
            for (const w of workers) w.terminate();
        };
        const fail = (err) => {
            if (settled) return;
            settled = true;
            shutdown();
            reject(err);
        };
        const assign = (worker) => {
            if (nextTask < tasks.length && !settled) {
                worker.postMessage({ id: nextTask, task: tasks[nextTask++] });
            }
        };

        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker(new URL("./sim-worker.js", import.meta.url));
            workers.push(worker);
            worker.on("online", () => assign(worker));
            worker.on("error", fail);
            worker.on("message", (msg) => {
                if (msg.error) {
                    fail(new Error(msg.error));
                    return;
                }
                results[msg.id] = msg.metrics;
                done++;
                onProgress?.(done, tasks.length);
                if (done === tasks.length) {
                    settled = true;
                    shutdown();
                    resolve(results);
                    return;
                }
                assign(worker);
            });
        }
    });
}
