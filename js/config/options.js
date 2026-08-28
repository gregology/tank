/**
 * Game types, their order in the lobby toggle, and the map-size choices.
 *
 * GAME_TYPES       — Skirmish / Battle declarations
 * GAME_TYPE_ORDER  — the ordered game-type list for the lobby toggle
 * MAP_SIZES        — the one user-facing setup choice (label + dimensions)
 *
 * Team size and building density are deliberately NOT options: they are
 * opinionated defaults derived from the game type and map size in
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
 *   teamSet:  'players' — up to MAX_PLAYERS teams, one per colour (Skirmish)
 *             'two'     — fixed RED vs BLUE (Battle)
 *   vehicles: allowed vehicle type keys from VEHICLES
 *
 * Win condition and whether bases exist live in the mode strategy
 * (`js/modes.js`), not here.
 */
export const GAME_TYPES = {
    skirmish: {
        label: "SKIRMISH",
        desc: "kill race \u00b7 teams optional \u00b7 tanks only",
        teamSet: "players",
        vehicles: ["tank"],
    },
    battle: {
        label: "BATTLE",
        desc: "tower/base objective \u00b7 2 teams \u00b7 all vehicles",
        teamSet: "two",
        vehicles: ["tank", "ifv", "drone", "spg", "squad"],
    },
};

/** The ordered game-type list for the lobby toggle (and any UI that lists modes). */
export const GAME_TYPE_ORDER = ["battle", "skirmish"];

/**
 * The map-size choices — the only thing the player still picks at setup.
 * The index into this list is the `mapSizeIndex` the opinionated defaults
 * (`js/config/match.js`) key team size off of.
 */
export const MAP_SIZES = [
    { label: "Small  (64\u00d764)", w: 64, h: 64 },
    { label: "Medium (128\u00d7128)", w: 128, h: 128 },
    { label: "Large  (192\u00d7192)", w: 192, h: 192 },
];

/** Index into MAP_SIZES for a map width (defaults to medium when unknown). */
export function mapSizeIndexFor(width) {
    const index = MAP_SIZES.findIndex((size) => size.w === width);
    return index < 0 ? 1 : index;
}
