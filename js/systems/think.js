/**
 * AI-think system — the per-frame bot "think" pass.
 *
 * This used to be an inline loop in `Game._update`; it was extracted so the
 * simulation loop is a uniform ordered list of system calls.  The mode
 * strategy resolves each bot's objective (battle: the known enemy base,
 * or none until it is discovered; skirmish: the nearest enemy) and the
 * controller runs one think step, given the bot's faction swarm context
 * (signal fields + friendlies).
 */

/** Run one AI think step for every alive bot. */
export function runThink(game, bots, dt) {
    for (const { ai, tank, enemies } of bots) {
        if (!tank.alive) continue;
        const faction = game.factions.find((f) => f.id === tank.team);
        const objective = game.mode.aiObjective(game, { ai, tank, enemies });
        const swarm = faction
            ? {
                  signals: faction.signals,
                  friendlies: faction.entities,
                  humans: game.humanTanks,
                  home: game.mode.homeAnchor(game, faction),
              }
            : null;
        ai.think(dt, tank, enemies, game.map, objective, game.mode.enemyStructures(game, tank), swarm);
    }
}
