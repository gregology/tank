/**
 * Projectile impact behaviours.
 *
 * A bullet carries a `kind` ("direct" or "shell"); when an arcing shell
 * reaches its target distance, `applyProjectileImpact` dispatches to the
 * matching landing behaviour.  This replaces the old `Bullet.sourceType`
 * string that routed landings back through the *shooter's* vehicle
 * behaviour — the landing effect is a property of the projectile, not of
 * who fired it.
 */

import { VEHICLES } from "./config.js";
import { splashStructures } from "./vehicles/aoe.js";

/** Artillery splash: radial damage to tanks and structures, then the impact tile. */
function shellImpact(game, b) {
    const splashR = VEHICLES.spg.splashRadius;

    for (const t of game.allTanks) {
        if (!t.alive || b.team === t.team) continue;
        const r = t.hitRadius;
        const d = t.distanceToPoint(b.x, b.y);
        if (d >= splashR + r) continue;

        const effectiveDist = Math.max(0, d - r);
        const dmg = b.damage * Math.max(0, 1 - effectiveDist / splashR);
        if (dmg <= 0) continue;

        game.applyHitToTank(b, t, dmg);
    }

    splashStructures(game, b.x, b.y, splashR, b.damage, b.team);

    game.damageTileAt(Math.floor(b.x), Math.floor(b.y), b.damage);
    game.particles.emitArtilleryImpact(b.x, b.y);
    game.emit("artillery_impact", { bullet: b });
}

/** Projectile kind → landing behaviour. */
export const PROJECTILE_IMPACTS = {
    shell: shellImpact,
};

/** Run a bullet's landing behaviour, if its kind has one. */
export function applyProjectileImpact(game, bullet) {
    const impact = PROJECTILE_IMPACTS[bullet.kind];
    if (impact) impact(game, bullet);
}
