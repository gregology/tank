/**
 * Watch-tower firing system — auto-targeting enemies in range.
 *
 * This used to live as `Game.updateWatchTowers`; it was extracted so tower
 * combat is a system like the other per-frame passes.  Targeting uses the
 * shared `pickTarget` weighted core (see `js/ai/targeting.js`), so the tower
 * reuses the same scoring the AI does rather than re-deriving it.
 */

import { pickTarget } from "../ai/targeting.js";
import { BASE_STRUCTURES } from "../config.js";
import { GAME_EVENTS } from "../events.js";
import { spawnBullet } from "../shoot.js";

/** Update watch-tower firing (auto-targets enemies in range with LOS). */
export function updateWatchTowers(game, dt) {
    for (const base of game.bases) {
        const enemyTeam = game.allTanks.filter((t) => t.team !== base.team);
        for (const tower of base.towers) {
            if (!tower.alive) continue;
            tower.fireCooldown -= dt;
            if (tower.fireCooldown > 0) continue;

            const cfg = BASE_STRUCTURES[tower.entityType];
            if (!cfg?.bulletSpeed) continue; // non-shooting structure

            // Find best target in range (shared weighted-targeting core).
            const pick = pickTarget(enemyTeam, cfg.targetPriority, tower, {
                range: cfg.fireRange,
                hasLineOfSight: (x1, y1, x2, y2) => game.map.hasLineOfSight(x1, y1, x2, y2, { skipOrigin: true }),
            });
            if (!pick) continue;
            const best = pick.target;

            const angle = Math.atan2(best.y - tower.y, best.x - tower.x);
            tower.turretAngle = angle;
            tower.fireCooldown = cfg.bulletCooldown;
            const b = spawnBullet(game, {
                x: tower.x,
                y: tower.y,
                angle,
                owner: 0,
                team: tower.team,
                damage: cfg.bulletDamage,
                speed: cfg.bulletSpeed,
                tracer: true,
                flash: "ifvFlash",
                flashOffset: 0.3,
            });
            game.emit(GAME_EVENTS.FIRE, { source: tower, bullet: b, sound: cfg.fireSound ?? "tower" });
        }
    }
}
