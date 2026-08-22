/**
 * Watch-tower firing system — auto-targeting enemies in range.
 *
 * This used to live as `Game.updateWatchTowers`; it was extracted so tower
 * combat is a system like the other per-frame passes.  Targeting uses the
 * shared `pickTarget` weighted core (see `js/ai/targeting.js`), so the tower
 * reuses the same scoring the AI does rather than re-deriving it.
 */

import { pickTarget } from "../ai/targeting.js";
import { Bullet } from "../bullet.js";
import { BASE_STRUCTURES } from "../config.js";

/** Update watch-tower firing (auto-targets enemies in range with LOS). */
export function updateWatchTowers(game, dt) {
    for (const base of game.bases) {
        const enemyTeam = game.allTanks.filter((t) => t.team !== base.team);
        for (const tower of base.towers) {
            if (!tower.alive) continue;
            tower.fireCooldown -= dt;
            if (tower.fireCooldown > 0) continue;

            // Find best target in range (shared weighted-targeting core).
            const cfg = BASE_STRUCTURES.baseTower;
            const pick = pickTarget(enemyTeam, cfg.targetPriority, tower, {
                range: cfg.fireRange,
                hasLineOfSight: (x1, y1, x2, y2) => game.map.hasLineOfSight(x1, y1, x2, y2, { skipOrigin: true }),
            });
            if (!pick) continue;
            const best = pick.target;

            // Fire
            const angle = Math.atan2(best.y - tower.y, best.x - tower.x);
            tower.turretAngle = angle;
            tower.fireCooldown = cfg.bulletCooldown;
            const b = new Bullet(tower.x, tower.y, angle, 0, tower.team, cfg.bulletDamage, cfg.bulletSpeed);
            game.bullets.push(b);
            const tipX = tower.x + Math.cos(angle) * 0.3;
            const tipY = tower.y + Math.sin(angle) * 0.3;
            game.particles.emitIFVFlash(tipX, tipY, angle);
            game.emit("fire", { tower, bullet: b });
        }
    }
}
