/**
 * Sandbox tuning model — the DOM-free half of the sandbox.
 *
 * Sliders are generated from the SWARM_TUNABLES table (one line per key,
 * driven by `doc`), so a new tunable appears in the sandbox with zero UI
 * code.  `applyTuning` writes straight into the match's live tuning
 * object — the swarm reads it every tick, so changes apply mid-match.
 */

import { BATTLE_TEAM_SIZE_KEYS, battleTeamSize, SWARM, SWARM_TUNABLES, tunableBounds } from "../config.js";

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
 * Team-size choices for a map-size select index, from the match tunables —
 * the sandbox never hardcodes its own caps or defaults.
 */
export function teamSizeRange(mapSizeIndex) {
    const { min, max } = tunableBounds(BATTLE_TEAM_SIZE_KEYS);
    return { min, max, defaultValue: battleTeamSize(mapSizeIndex) };
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
