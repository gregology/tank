/**
 * Shared firing primitives — the one place a bullet is constructed and its
 * muzzle flash is emitted.
 *
 * Every shooter (tank, IFV, SPG, squad member, watch tower) used to build
 * a `new Bullet(...)` + `game.bullets.push(...)` + a muzzle-flash particle
 * by hand in four places.  `spawnBullet` collapses construct-push;
 * `flashMuzzle` collapses the flash dispatch (muzzle / ifv / spg).  The
 * `fire` event payload stays with each caller (tank vs tower vs squad
 * member), but the mechanical part is written once.
 */

import { Bullet } from "./bullet.js";

/** Emit the muzzle flash for a shot, dispatched by its data key. */
export function flashMuzzle(game, flash, x, y, angle) {
    if (flash === "ifv") game.particles.emit("ifvFlash", x, y, angle);
    else if (flash === "spg") game.particles.emit("spgFlash", x, y, angle);
    else if (flash === "muzzle") game.particles.emit("muzzleFlash", x, y, angle);
}

/**
 * Construct a bullet, push it onto the game's bullet list, and return it.
 * `flash` + `flashOffset` also emit the muzzle flash at the barrel tip.
 *
 * @param {object} game   Game (or behaviour-test stub) with `bullets`/`particles`
 * @param {object} spec   bullet construction parameters (see Bullet)
 * @returns {Bullet} the spawned bullet
 */
export function spawnBullet(
    game,
    {
        x,
        y,
        angle,
        owner,
        team,
        damage,
        speed,
        arcing = false,
        targetDistance = 0,
        lifetime = null,
        kind = null,
        tracer = false,
        flash = null,
        flashOffset = 0,
    },
) {
    const b = new Bullet(x, y, angle, owner, team, damage, speed, arcing, targetDistance, lifetime, kind, tracer);
    game.bullets.push(b);
    if (flash) {
        const tipX = x + Math.cos(angle) * flashOffset;
        const tipY = y + Math.sin(angle) * flashOffset;
        flashMuzzle(game, flash, tipX, tipY, angle);
    }
    return b;
}
