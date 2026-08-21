/**
 * SPG behaviour — hold-to-charge artillery.
 *
 * FIRE is held to charge range, then released to lob an arcing shell
 * that flies over terrain and lands at the charged distance.  On
 * landing, onShellImpact applies the splash damage model (tank disks
 * use their hitbox radius, structures use edge-distance falloff, and
 * the impact tile takes full damage).
 */

import { Bullet } from "../bullet.js";
import { ACTIONS, CONFIG, VEHICLES } from "../config.js";
import { splashStructures } from "./aoe.js";

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
            const b = new Bullet(
                tank.x,
                tank.y,
                fireAngle,
                tank.playerNumber,
                tank.team,
                vStats.bulletDamage,
                vStats.bulletSpeed,
                true,
                range,
            );
            b.sourceType = "spg";
            game.bullets.push(b);

            const tipX = tank.x + Math.cos(fireAngle) * CONFIG.TANK_BARREL_LENGTH;
            const tipY = tank.y + Math.sin(fireAngle) * CONFIG.TANK_BARREL_LENGTH;
            game.particles.emitSPGFlash(tipX, tipY, fireAngle);
            game.emit("fire", { tank, bullet: b });
        } else {
            tank.isCharging = false;
            tank.chargeTime = 0;
        }
    },

    update(_game, _tank, _dt) {},

    /** Artillery splash: radial damage to tanks and structures, then the impact tile. */
    onShellImpact(game, b) {
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
    },

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
