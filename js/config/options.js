/**
 * Game types and pre-game options.
 *
 * GAME_TYPES       — Skirmish / Battle declarations
 * GAME_OPTIONS     — master list of every option, defined once with
 *                    type, labels, and defaults
 * GAME_TYPES[].options — which options each game type shows
 * getDefaultOptionValues() / resolveSettings() — defaults + overrides
 *                    merged into a flat settings object
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
        win: "score",
        teamSet: "players",
        bases: false,
        vehicles: ["tank"],
        options: ["mapSize", "buildingDensity"],
        defaults: { mapSize: 0 },
    },
    battle: {
        win: "base",
        teamSet: "two",
        bases: true,
        vehicles: ["tank", "ifv", "drone", "spg", "squad"],
        options: ["mapSize", "buildingDensity", "baseType", "teamSize"],
    },
};

/**
 * Available game options.  Each defines its UI type, labels, allowed
 * values, and a global default.
 *
 * 'enum' type:
 *   choices[]       — { label, value } pairs shown in the UI
 *   defaultIndex    — index into choices[] used when no override exists
 *
 * 'range' type:
 *   min, max, step  — numeric range
 *   default         — initial value when no override exists
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
    {
        key: "buildingDensity",
        label: "BUILDING DENSITY",
        type: "enum",
        choices: [
            { label: "Sparse", value: 0.5 },
            { label: "Normal", value: 1.0 },
            { label: "Dense", value: 1.5 },
        ],
        defaultIndex: 1,
    },
    {
        key: "baseType",
        label: "BASE TYPE",
        type: "enum",
        choices: [
            { label: "HQ Only", value: "hq_only" },
            { label: "Compound", value: "compound" },
        ],
        defaultIndex: 1,
    },
    {
        key: "teamSize",
        label: "TEAM SIZE",
        type: "range",
        min: 2,
        max: 32,
        maxByMapSize: [16, 24, 32],
        step: 1,
        default: 5,
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
 * Returns a Map<string, number> where:
 *   enum  options → current choice index
 *   range options → current numeric value
 */
export function getDefaultOptionValues(gameType) {
    const def = GAME_TYPES[gameType];
    const keys = def?.options ?? [];
    const typeDefaults = def?.defaults ?? {};
    const values = new Map();

    for (const key of keys) {
        const opt = optionDef(key);
        if (!opt) continue;
        if (key in typeDefaults) {
            values.set(key, typeDefaults[key]);
        } else if (opt.type === "enum") {
            values.set(key, opt.defaultIndex);
        } else {
            values.set(key, opt.default);
        }
    }
    return values;
}

/**
 * Resolve a Map<string, index/value> into a flat settings object
 * with concrete gameplay values.
 *
 * Example output:
 *   { mapSize: { w: 100, h: 100 }, buildingDensity: 1.0,
 *     baseType: 'compound', teamSize: 5 }
 */
export function resolveSettings(optionValues) {
    const settings = {};
    for (const [key, val] of optionValues) {
        const opt = optionDef(key);
        if (!opt) continue;
        if (opt.type === "enum") {
            settings[key] = opt.choices[val].value;
        } else {
            settings[key] = val;
        }
    }
    // Clamp teamSize to the per-map-size maximum
    const tsOpt = optionDef("teamSize");
    if (tsOpt?.maxByMapSize && settings.teamSize != null) {
        const msIdx = optionValues.get("mapSize") ?? 0;
        const cap = tsOpt.maxByMapSize[msIdx] ?? tsOpt.max;
        if (settings.teamSize > cap) settings.teamSize = cap;
    }
    return settings;
}
