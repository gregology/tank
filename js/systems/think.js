/**
 * AI-think system — the per-frame bot "think" pass.
 *
 * This used to be an inline loop in `Game._update`; it was extracted so the
 * simulation loop is a uniform ordered list of system calls.  The mode
 * strategy resolves each bot's objective (battle: the enemy base; skirmish:
 * the nearest enemy) and the controller runs one think step.
 */

/** Run one AI think step for every alive bot. */
export function runThink(game, bots, dt) {
    for (const { ai, tank, enemies } of bots) {
        if (!tank.alive) continue;
        const objective = game.mode.aiObjective(game, { ai, tank, enemies }) ?? (enemies.find((e) => e.alive) || null);
        ai.think(dt, tank, enemies, game.map, objective, game.mode.enemyStructures(game, tank));
    }
}
