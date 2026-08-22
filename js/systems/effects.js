/**
 * Damage-smoke system — emit smoke puffs from damaged tanks.
 *
 * This used to live as `Game._emitDamageSmoke`; it is the per-frame cooldown
 * emitter for the smoke trail a damaged vehicle leaves.
 */

/** Emit smoke from damaged tanks on their per-vehicle cooldown. */
export function emitDamageSmoke(game, dt) {
    for (const t of game.allTanks) {
        if (!t.alive || !t.damaged) continue;
        t.smokeTimer -= dt;
        if (t.smokeTimer <= 0) {
            t.smokeTimer = 0.15 + Math.random() * 0.1;
            game.particles.emit("smoke", t.x, t.y);
        }
    }
}
