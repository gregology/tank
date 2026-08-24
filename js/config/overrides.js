/**
 * Dotted-key override application for the config tables.
 *
 * Lives apart from js/config/tuning.js because that file is GENERATED
 * (overwritten by `tools/optimize.js --implement`); this helper is not.
 */

/**
 * Set `target[path] = value` for each dotted key ("SIGNAL_HALFLIVES.trail").
 * Strict: an unknown path throws, so a typo in the generated file (or a
 * renamed config key) fails loudly at load instead of silently tuning
 * nothing.
 */
export function applyOverrides(target, overrides) {
    for (const [path, value] of Object.entries(overrides)) {
        const keys = path.split(".");
        const parent = keys.slice(0, -1).reduce((obj, key) => obj?.[key], target);
        const leaf = keys[keys.length - 1];
        if (parent == null || typeof parent !== "object" || !(leaf in parent)) {
            throw new Error(`unknown tuning override: ${path}`);
        }
        parent[leaf] = value;
    }
}
