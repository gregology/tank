/**
 * Direct-fire projectile behaviour (the default `Bullet.kind`).
 *
 * A direct bullet flies in a straight line and is stopped by solid terrain;
 * on terrain it damages the structure/tile it struck, and on an enemy tank
 * it applies a hit.  This owns the movement + collision + effects that used
 * to live in `Bullet.update` and `Game._tickBullets`/`_checkBulletHits`.
 */

import { GAME_EVENTS } from "../events.js";

export const direct = {
    update(b, dt, map) {
        const dx = Math.cos(b.angle) * b.speed * dt;
        const dy = Math.sin(b.angle) * b.speed * dt;
        b.x += dx;
        b.y += dy;
        b.lifetime -= dt;

        // Direct bullets are stopped by solid obstacles.
        if (map.blocksProjectile(b.x, b.y)) {
            b.alive = false;
            b.hitTerrain = true;
            return;
        }
        if (b.x < -1 || b.x > map.width + 1 || b.y < -1 || b.y > map.height + 1) {
            b.alive = false;
            return;
        }
        if (b.lifetime <= 0) b.alive = false;
    },

    /** Apply the terrain/structure impact of a direct bullet that hit solid ground. */
    onTerrain(game, b) {
        game.particles.emit("impact", b.x, b.y);
        game.emit(GAME_EVENTS.IMPACT, { bullet: b });
        const gx = Math.floor(b.x),
            gy = Math.floor(b.y);
        const structure = game.structureAt(gx, gy);
        if (structure) {
            if (b.team !== structure.team) game.applyDamage(structure, b, b.damage);
        } else {
            game.damageTileAt(gx, gy, b.damage);
        }
    },

    /** Apply a direct hit to an enemy tank. */
    onEntity(game, b, target) {
        game.applyDamage(target, b, b.damage);
    },
};
