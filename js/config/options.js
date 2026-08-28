/**
 * Game types and the pre-game map-size option.
 *
 * GAME_TYPES       — Skirmish / Battle declarations
 * GAME_OPTIONS     — master list of every user-facing option, defined once
 *                    with its choices and default
 * GAME_TYPES[].options — which options each game type shows
 * getDefaultOptionValues() / resolveSettings() — defaults + overrides
 *                    merged into a flat settings object
 *
 * Team size, building density, and base type are deliberately NOT options:
 * they are opinionated defaults derived from the game type and map size in
 * `js/config/match.js` (see `opinionatedSettings`), so the player never sees
 * or changes them — the sandbox tunes them instead.
 */

/**
 * Game type definitions.
 *
 * Each type describes the shared match rules; *who* is human vs bot is
 * decided at match time by the lobby (see the MatchConfig built by
 * Game), so a game type is a small, stable declaration rather than an
 * exhaustive list of compositions:
 *
 *   win:      'score' — first faction to WIN_SCORE kills (Skirmish)
 *             'base'  — destroy the enemy HQ (Battle)
 *   teamSet:  'players' — up to MAX_PLAYERS teams, one per colour (Skirmish)
 *             'two'     — fixed RED vs BLUE (Battle)
 *   bases:    whether tower/HQ compounds are built
 *   vehicles: allowed vehicle type keys from VEHICLES
 *   options:  GAME_OPTIONS keys shown on the pre-game screen
 *   defaults: optional per-type option default indices/values
 */
export const GAME_TYPES = {
    skirmish: {
        label: "SKIRMISH",
        desc: "kill race \u00b7 teams optional \u00b7 tanks only",
        win: "score",
        teamSet: "players",
        bases: false,
        vehicles: ["tank"],
        options: ["mapSize"],
        defaults: { mapSize: 0 },
    },
    battle: {
        label: "BATTLE",
        desc: "tower/base objective \u00b7 2 teams \u00b7 all vehicles",
        win: "base",
        teamSet: "two",
        bases: true,
        vehicles: ["tank", "ifv", "drone", "spg", "squad"],
        options: ["mapSize"],
    },
};

/** The ordered game-type list for the lobby toggle (and any UI that lists modes). */
export const GAME_TYPE_ORDER = ["battle", "skirmish"];

/**
 * Available game options.  Each defines its UI label, allowed choices, and a
 * global default.  Today the only user-facing option is map size — the rest
 * of a match's shape (team size, building density, base type) is opinionated
 * and lives in `js/config/match.js`.
 */
export const GAME_OPTIONS = [
    {
        key: "mapSize",
        label: "MAP SIZE",
        type: "enum",
        choices: [
            { label: "Small  (64\u00d764)", value: { w: 64, h: 64 } },
            { label: "Medium (128\u00d7128)", value: { w: 128, h: 128 } },
            { label: "Large  (192\u00d7192)", value: { w: 192, h: 192 } },
        ],
        defaultIndex: 1,
    },
];

/** Look up an option definition by key. */
function optionDef(key) {
    return GAME_OPTIONS.find((o) => o.key === key);
}

/**
 * Build the initial option indices/values for a game type, merging:
 *   1. global GAME_OPTIONS defaults
 *   2. per-type GAME_TYPES[gameType].defaults overrides
 *
 * Returns a Map<string, number> mapping each option key to its choice index.
 */
export function getDefaultOptionValues(gameType) {
    const def = GAME_TYPES[gameType];
    const keys = def?.options ?? [];
    const typeDefaults = def?.defaults ?? {};
    const values = new Map();

    for (const key of keys) {
        const opt = optionDef(key);
        if (!opt) continue;
        values.set(key, key in typeDefaults ? typeDefaults[key] : opt.defaultIndex);
    }
    return values;
}

/**
 * Resolve a Map<string, choice-index> into a flat settings object with
 * concrete gameplay values.
 *
 * Example output:
 *   { mapSize: { w: 128, h: 128 } }
 */
export function resolveSettings(optionValues) {
    const settings = {};
    for (const [key, val] of optionValues) {
        const opt = optionDef(key);
        if (opt) settings[key] = opt.choices[val].value;
    }
    return settings;
}
