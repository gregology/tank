/**
 * AI-think system — the per-frame bot "think" pass.
 *
 * This used to be an inline loop in `Game._update`; it was extracted so the
 * simulation loop is a uniform ordered list of system calls.  Each bot
 * thinks against its faction's swarm (shared pheromone fields + intel,
 * injected into the controller at creation) — goals emerge from the
 * colony's signals, not from an assigned role.
 */

/** Run one AI think step for every alive bot. */
export function runThink(game, bots, dt) {
    for (const { ai, tank, enemies } of bots) {
        if (!tank.alive) continue;
        ai.think(dt, tank, enemies, game.map);
    }
}
