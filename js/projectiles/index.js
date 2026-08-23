/**
 * Projectile behaviour dispatch — the strategy table keyed by `Bullet.kind`.
 *
 * Each projectile kind supplies the lifecycle hooks the simulation calls:
 *   update(b, dt, map)       move the bullet; set `b.alive`, `b.landed`
 *                            (shells), or `b.hitTerrain` (direct bullets).
 *   onTerrain(game, b)       direct: damage the structure/tile struck.
 *   onEntity(game, b, target) direct: apply a hit to an enemy tank.
 *   onLand(game, b)          shell: splash impact at the landing point.
 *
 * Adding a new projectile (guided rocket, grenade, mine, beam) is one
 * module here + a `kind` on the bullet — movement and impact routing come
 * free from the simulation systems (`js/systems/projectiles.js`).
 */

import { direct } from "./direct.js";
import { shell } from "./shell.js";

export const PROJECTILE_BEHAVIOURS = {
    direct,
    shell,
};

/** Look up the behaviour for a bullet kind (defaults to direct). */
export function getProjectileBehaviour(kind) {
    return PROJECTILE_BEHAVIOURS[kind] ?? direct;
}
