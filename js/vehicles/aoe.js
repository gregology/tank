/**
 * Shared area-of-effect damage.
 *
 * `applyBlast` is the one radial-damage primitive: it damages enemy tanks
 * and enemy structures with the same edge-distance falloff (full damage at
 * the blast centre, falling linearly to 0 at `radius` beyond the target's
 * own radius).  The drone's self-destruct and the SPG's artillery splash
 * both call it; a future explosive weapon (mine, grenade, rocket) reuses
 * it rather than copying the loop.
 */

import { distance } from "../utils.js";

/**
 * Apply radial blast damage to enemy tanks and structures.
 *
 * @param {object} game    Game (allTanks/baseStructures/applyHitToTank/
 *                         onStructureDestroyed/particles/emit)
 * @param {number} x       blast centre world X
 * @param {number} y       blast centre world Y
 * @param {number} radius  blast radius in world units
 * @param {number} damage  full (centre) damage
 * @param {number} team    team that caused the blast (own units safe)
 */
export function applyBlast(game, x, y, radius, damage, team) {
    for (const t of game.allTanks) {
        if (!t.alive || t.team === team) continue;
        const d = t.distanceToPoint(x, y);
        if (d >= radius + t.hitRadius) continue;
        const edge = Math.max(0, d - t.hitRadius);
        const dmg = damage * Math.max(0, 1 - edge / radius);
        if (dmg <= 0) continue;
        game.applyHitToTank({ x, y, team }, t, dmg);
    }

    for (const s of game.baseStructures) {
        if (!s.alive || s.team === team) continue;
        const d = distance(x, y, s.x, s.y);
        if (d >= radius + s.size) continue;
        const edge = Math.max(0, d - s.size);
        const dmg = damage * Math.max(0, 1 - edge / radius);
        if (dmg <= 0) continue;

        if (s.applyDamage(dmg)) {
            game.onStructureDestroyed(s);
        } else {
            game.particles.emitImpact(x, y);
            game.emit("impact", {});
        }
    }
}
