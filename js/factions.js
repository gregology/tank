/**
 * Faction planning — the pure "who fights whom" resolution of a match.
 *
 * Given a game type, the human players with their chosen teams, and the
 * resolved settings, compute the faction plan: which factions exist, their
 * colours, and how many humans/bots each holds.  Game then materialises
 * that plan into Tank / Camera / AI entities.
 *
 * Kept pure (no entities, no input, no rendering) so the bot-fill rules can
 * be unit-tested in isolation.
 */

import { GAME_TYPES, MAX_PLAYERS, PLAYER_COLORS } from "./config.js";

/**
 * @param {'skirmish'|'battle'} gameType
 * @param {{team:number}[]} humans  human players (team = faction id)
 * @param {object} settings  resolved settings (teamSize, …)
 * @returns {{id:number, color:string, darkColor:string, humanCount:number, botCount:number}[]}
 */
export function planFactions(gameType, humans = [], settings = {}) {
    const def = GAME_TYPES[gameType] ?? GAME_TYPES.skirmish;

    if (def.teamSet === "two") {
        // Battle: fixed RED (1) vs BLUE (2), bots fill each to teamSize.
        const teamSize = settings.teamSize ?? 5;
        return [1, 2].map((team) => {
            const humanCount = humans.filter((h) => h.team === team).length;
            const col = PLAYER_COLORS[team - 1];
            return {
                id: team,
                color: col.color,
                darkColor: col.darkColor,
                humanCount,
                botCount: Math.max(0, teamSize - humanCount),
            };
        });
    }

    // Skirmish: one faction per distinct human team.
    const usedTeams = new Set(humans.map((h) => h.team));
    const factions = [...usedTeams]
        .sort((a, b) => a - b)
        .map((team) => {
            const humanCount = humans.filter((h) => h.team === team).length;
            const col = PLAYER_COLORS[team - 1];
            return { id: team, color: col.color, darkColor: col.darkColor, humanCount, botCount: 0 };
        });

    // A single non-empty team gets exactly one bot as its opposition.
    if (factions.length === 1) {
        const botTeam = firstUnusedTeam(usedTeams);
        const col = PLAYER_COLORS[botTeam - 1];
        factions.push({ id: botTeam, color: col.color, darkColor: col.darkColor, humanCount: 0, botCount: 1 });
    }
    return factions;
}

/** Lowest team id not used by any human (for the Skirmish solo bot). */
export function firstUnusedTeam(usedTeams) {
    for (let t = 1; t <= MAX_PLAYERS; t++) {
        if (!usedTeams.has(t)) return t;
    }
    return 2;
}
