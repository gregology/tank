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

/**
 * Apply radial blast damage to enemy tanks and structures.
 *
 * @param {object} game    Game (damageables/applyDamage)
 * @param {number} x       blast centre world X
 * @param {number} y       blast centre world Y
 * @param {number} radius  blast radius in world units
 * @param {number} damage  full (centre) damage
 * @param {number} team    team that caused the blast (own units safe)
 */
export function applyBlast(game, x, y, radius, damage, team) {
    // One loop over every damageable entity.  Tanks and structures share the
    // same `distanceToPoint` / `hitRadius` hitbox vocabulary, and both route
    // through the single `game.applyDamage` application seam.
    for (const e of game.damageables) {
        if (!e.alive || e.team === team) continue;
        const d = e.distanceToPoint(x, y);
        if (d >= radius + e.hitRadius) continue;
        const edge = Math.max(0, d - e.hitRadius);
        const dmg = damage * Math.max(0, 1 - edge / radius);
        if (dmg <= 0) continue;

        game.applyDamage(e, { x, y, team }, dmg);
    }
}
