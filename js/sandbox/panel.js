/**
 * Sandbox tuning model — the DOM-free half of the sandbox.
 *
 * Sliders are generated from the SWARM_TUNABLES table (one line per key,
 * driven by `doc`), so a new tunable appears in the sandbox with zero UI
 * code.  `applyTuning` writes straight into the match's live tuning
 * object — the swarm reads it every tick, so changes apply mid-match.
 */

import { GAME_OPTIONS, SWARM, SWARM_TUNABLES } from "../config.js";

/** Slider descriptors for the control panel. */
export function sliderSpecs() {
    return SWARM_TUNABLES.map((t) => ({
        key: t.key,
        min: t.min,
        max: t.max,
        value: t.value,
        step: stepFor(t.min, t.max),
        doc: t.doc,
    }));
}

/**
 * Team-size choices for a map-size select index, from the canonical
 * GAME_OPTIONS declaration — the sandbox never hardcodes its own caps.
 */
export function teamSizeRange(mapSizeIndex) {
    const opt = GAME_OPTIONS.find((o) => o.key === "teamSize");
    const max = opt.maxByMapSize?.[mapSizeIndex] ?? opt.max;
    return { min: opt.min, max, defaultValue: opt.default };
}

/** ~100 steps across the range, snapped to a friendly precision. */
function stepFor(min, max) {
    const raw = (max - min) / 100;
    const pow = 10 ** Math.floor(Math.log10(raw));
    return Math.max(pow, raw) || 0.01;
}

/** Write one live tuning override into the running match. */
export function applyTuning(game, key, value) {
    if (!(key in SWARM)) throw new Error(`unknown tunable: ${key}`);
    game.tuning[key] = value;
}

/** Restore every tunable to its table default. */
export function resetTuning(game) {
    for (const t of SWARM_TUNABLES) game.tuning[t.key] = t.value;
}
