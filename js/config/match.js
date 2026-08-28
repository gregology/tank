/**
 * Opinionated match defaults — the tunables behind the simplified lobby.
 *
 * The lobby no longer asks the player for team size, building density, or
 * base type: it derives them here from the game type and map size.  Keeping
 * them as a tunables table (the same { key, min, max, value, doc } shape as
 * SWARM_TUNABLES) is what makes them the "environment variables" the sandbox
 * and tuning tooling can adjust without touching any UI code.
 *
 *   battle:  16 / 24 / 32 units per team on small / medium / large maps,
 *            dense buildings (1.5), compound bases
 *   skirmish:  high buildings (2.0)
 */

export const MATCH_TUNABLES = Object.freeze([
    {
        key: "battleTeamSizeSmall",
        min: 2,
        max: 32,
        value: 16,
        doc: "battle units per team on small (64\u00d764) maps",
    },
    {
        key: "battleTeamSizeMedium",
        min: 2,
        max: 32,
        value: 24,
        doc: "battle units per team on medium (128\u00d7128) maps",
    },
    {
        key: "battleTeamSizeLarge",
        min: 2,
        max: 32,
        value: 32,
        doc: "battle units per team on large (192\u00d7192) maps",
    },
    {
        key: "battleDensity",
        min: 0.5,
        max: 3,
        value: 1.5,
        doc: "battle building-density multiplier (1.5 = dense)",
    },
    {
        key: "skirmishDensity",
        min: 0.5,
        max: 3,
        value: 2,
        doc: "skirmish building-density multiplier (2.0 = high)",
    },
]);

/** Team-size tunable keys in map-size order (small, medium, large). */
export const BATTLE_TEAM_SIZE_KEYS = ["battleTeamSizeSmall", "battleTeamSizeMedium", "battleTeamSizeLarge"];

/** Building-density tunable keys (battle, skirmish). */
export const DENSITY_KEYS = ["battleDensity", "skirmishDensity"];

const byKey = new Map(MATCH_TUNABLES.map((t) => [t.key, t]));

/** Current default value for a match tunable key (undefined if unknown). */
export function matchTuning(key) {
    return byKey.get(key)?.value;
}

/** Battle team size for a map-size index (0 = small, 1 = medium, 2 = large). */
export function battleTeamSize(mapSizeIndex) {
    const key = BATTLE_TEAM_SIZE_KEYS[mapSizeIndex] ?? BATTLE_TEAM_SIZE_KEYS[1];
    return matchTuning(key);
}

/** The shared min/max span of a set of tunable keys (for sandbox inputs). */
export function tunableBounds(keys) {
    const entries = keys.map((key) => byKey.get(key)).filter(Boolean);
    return {
        min: Math.min(...entries.map((t) => t.min)),
        max: Math.max(...entries.map((t) => t.max)),
    };
}

/**
 * The opinionated per-mode settings for a game type and map-size index.
 * These are what the lobby injects instead of asking the user.
 */
export function opinionatedSettings(gameType, mapSizeIndex = 1) {
    if (gameType === "battle") {
        return {
            teamSize: battleTeamSize(mapSizeIndex),
            buildingDensity: matchTuning("battleDensity"),
            baseType: "compound",
        };
    }
    return { buildingDensity: matchTuning("skirmishDensity") };
}
