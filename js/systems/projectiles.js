/**
 * Projectile lifecycle systems — the per-frame bullet passes.
 *
 * These two passes used to live as `Game._tickBullets` / `_checkBulletHits`;
 * they were extracted so the simulation loop (`Game._update`) is a short,
 * ordered list of system calls and the bullet logic is independently
 * testable.  Each system receives the `Game` as its first argument (the
 * same strategy-context convention the modes and vehicle behaviours use).
 *
 * Arcing-shell *landing* behaviour stays in `js/projectiles.js` (dispatched
 * by `Bullet.kind`); this module owns movement, terrain/structure collision,
 * and direct-bullet entity hits.
 */

import { applyProjectileImpact } from "../projectiles.js";

/** Advance bullets; resolve terrain/structure collisions and shell landings. */
export function tickBullets(game, dt) {
    for (const b of game.bullets) {
        const wasAlive = b.alive;
        b.update(dt, game.map);
        if (wasAlive && !b.alive) {
            if (b.arcing && b.landed) {
                // Arcing shells apply their impact through the projectile system.
                applyProjectileImpact(game, b);
            } else if (!b.arcing && game.map.blocksProjectile(b.x, b.y)) {
                game.particles.emitImpact(b.x, b.y);
                game.emit("impact", { bullet: b });
                const gx = Math.floor(b.x),
                    gy = Math.floor(b.y);
                // Check for a base structure at this tile.
                const structure = game._getStructureAt(gx, gy);
                if (structure) {
                    if (b.team !== structure.team) {
                        if (structure.applyDamage(b.damage)) {
                            game.onStructureDestroyed(structure);
                        }
                    }
                } else {
                    game.damageTileAt(gx, gy, b.damage);
                }
            }
        }
    }
}

/** Resolve direct-bullet hits against enemy tanks (squads use member hitboxes). */
export function checkBulletHits(game) {
    for (const b of game.bullets) {
        if (!b.alive || b.arcing) continue;
        for (const t of game.allTanks) {
            if (!t.alive || b.team === t.team) continue;
            if (t.hitTest(b.x, b.y)) {
                b.alive = false;
                game.applyHitToTank(b, t, b.damage);
                break;
            }
        }
    }
}
