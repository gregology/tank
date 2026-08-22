/**
 * Projectile lifecycle systems — the per-frame bullet passes.
 *
 * These two passes used to live as `Game._tickBullets` / `_checkBulletHits`;
 * they were extracted so the simulation loop (`Game._update`) is a short,
 * ordered list of system calls.  Movement and impact effects are dispatched
 * through the projectile behaviour (`js/projectiles/`, keyed by `Bullet.kind`),
 * so the systems themselves never branch on bullet type — they just ask the
 * behaviour what to do with a bullet that died.
 */

import { getProjectileBehaviour } from "../projectiles/index.js";

/** Advance bullets; dispatch terrain impacts and shell landings. */
export function tickBullets(game, dt) {
    for (const b of game.bullets) {
        const wasAlive = b.alive;
        b.update(dt, game.map);
        if (wasAlive && !b.alive) {
            const behaviour = getProjectileBehaviour(b.kind);
            if (b.landed) behaviour.onLand?.(game, b);
            else if (b.hitTerrain) behaviour.onTerrain?.(game, b);
        }
    }
}

/** Resolve direct-bullet hits against enemy tanks (squads use member hitboxes). */
export function checkBulletHits(game) {
    for (const b of game.bullets) {
        if (!b.alive) continue;
        const behaviour = getProjectileBehaviour(b.kind);
        if (!behaviour.onEntity) continue; // shells damage via onLand, not per-entity hits
        for (const t of game.allTanks) {
            if (!t.alive || b.team === t.team) continue;
            if (t.hitTest(b.x, b.y)) {
                b.alive = false;
                behaviour.onEntity(game, b, t);
                break;
            }
        }
    }
}
