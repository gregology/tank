/**
 * Dotted-path access into the CONFIG / VEHICLES tables — the single
 * implementation shared by the headless tooling (tools/sim-lib.js) and
 * the test helpers (test/helpers.js#withParams).  Kept dependency-light
 * (config only) so importing it never drags the game graph in.
 */

import { CONFIG, VEHICLES } from "../js/config.js";

const PARAM_ROOTS = { CONFIG, VEHICLES };

/** Read a dotted parameter path ("CONFIG.X" / "VEHICLES.tank.signals.recruit"). */
export function getParam(path) {
    return path.split(".").reduce((obj, key) => obj?.[key], PARAM_ROOTS);
}

/** Set a dotted parameter path to a value. */
export function setParam(path, value) {
    const keys = path.split(".");
    const parent = keys.slice(0, -1).reduce((obj, key) => obj?.[key], PARAM_ROOTS);
    if (parent == null || typeof parent !== "object") throw new Error(`unknown parameter: ${path}`);
    parent[keys[keys.length - 1]] = value;
}
