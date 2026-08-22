/**
 * SPG behaviour — hold-to-charge artillery.
 *
 * FIRE is held to charge range, then released to lob an arcing shell
 * that flies over terrain and lands at the charged distance.  The
 * shell's splash damage lives in the projectile system
 * (js/projectiles.js), not here — the landing effect is a property of
 * the projectile, not of the shooter.
 */

import { ACTIONS, CONFIG, VEHICLES } from "../config.js";
import { spawnBullet } from "../shoot.js";
import { groundMove } from "./tank.js";

export const spg = {
    fire(game, tank, device, dt) {
        if (!tank.alive) return;

        const fireHeld = device.isDown(ACTIONS.fire);
        const vStats = VEHICLES.spg;

        if (fireHeld && tank.fireCooldown <= 0) {
            tank.isCharging = true;
            tank.chargeTime += dt;
            const maxCharge = (vStats.maxRange - vStats.minRange) / vStats.chargeRate;
            if (tank.chargeTime > maxCharge) tank.chargeTime = maxCharge;
        } else if (tank.isCharging && !fireHeld) {
            const range = Math.min(vStats.minRange + tank.chargeTime * vStats.chargeRate, vStats.maxRange);
            tank.isCharging = false;
            tank.chargeTime = 0;
            tank.fire();

            const fireAngle = tank.turretWorld;
            const b = spawnBullet(game, {
                x: tank.x,
                y: tank.y,
                angle: fireAngle,
                owner: tank.playerNumber,
                team: tank.team,
                damage: vStats.bulletDamage,
                speed: vStats.bulletSpeed,
                arcing: true,
                targetDistance: range,
                flash: "spg",
                flashOffset: CONFIG.TANK_BARREL_LENGTH,
            });
            game.emit("fire", { tank, bullet: b });
        } else {
            tank.isCharging = false;
            tank.chargeTime = 0;
        }
    },

    /** Ground movement, but deployed (charging) artillery cannot drive. */
    move(tank, device, dt, map) {
        groundMove(tank, device, dt, map, !tank.isCharging && !tank.trackDamaged);
    },

    update(_game, _tank, _dt) {},

    /** Hold fire to charge until the shell would reach the target, then release. */
    aim(ai, me, target, _map) {
        const desiredWorld = Math.atan2(target.y - me.y, target.x - me.x);
        ai.steerTurretTo(me, desiredWorld);

        const turretWorld = me.turretWorld;
        let diffT = desiredWorld - turretWorld;
        while (diffT > Math.PI) diffT -= Math.PI * 2;
        while (diffT < -Math.PI) diffT += Math.PI * 2;
        if (Math.abs(diffT) > 0.3) return;

        const dist = target.dist;
        const vStats = VEHICLES.spg;
        if (dist < vStats.minRange * 0.5 || dist > vStats.maxRange * 1.1) return;
        if (me.fireCooldown > 0) return;

        // Charge only as long as the shell would fall short of the target.
        const clampedDist = Math.max(vStats.minRange, Math.min(dist, vStats.maxRange));
        const neededCharge = (clampedDist - vStats.minRange) / vStats.chargeRate;
        if (me.chargeTime < neededCharge + 0.05) {
            ai.keys[ACTIONS.fire] = true;
        }
    },

    aiThink(_ai, _dt, _me, _enemies, _map, _objective) {
        return false;
    },
};
