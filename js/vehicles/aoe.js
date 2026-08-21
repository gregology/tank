/**
 * Shared area-of-effect helpers for vehicle behaviours.
 *
 * Vehicle behaviours (js/vehicles/*) that explode — the drone's
 * self-destruct and the SPG's artillery splash — damage structures
 * with the same edge-distance falloff, so the loop lives here once.
 */

import { distance } from "../utils.js";

/**
 * Damage enemy structures within `radius` of (cx, cy) with linear
 * edge-distance falloff.  Destroys destroyed structures through the
 * game's structure-destruction pipeline.
 *
 * @param {object} game    Game (bullets/particles/event bus live here)
 * @param {number} cx      blast centre world X
 * @param {number} cy      blast centre world Y
 * @param {number} radius  blast radius in world units
 * @param {number} damage  full (centre) damage
 * @param {number} team    team that caused the blast (own structures safe)
 */
export function splashStructures(game, cx, cy, radius, damage, team) {
    for (const s of game.baseStructures) {
        if (!s.alive || s.team === team) continue;
        const d = distance(cx, cy, s.x, s.y);
        if (d >= radius + s.size) continue;

        const edgeDist = Math.max(0, d - s.size);
        const dmg = damage * Math.max(0, 1 - edgeDist / radius);
        if (dmg <= 0) continue;

        if (s.applyDamage(dmg)) {
            game.onStructureDestroyed(s);
        } else {
            game.particles.emitImpact(cx, cy);
            game.emit("impact", {});
        }
    }
}
