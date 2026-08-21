/**
 * Default vehicle behaviour — direct-fire guns (tank, and the base for
 * every other behaviour).  Tanks and IFVs share this `fire`; the IFV
 * overrides only the AI aim strategy (see ifv.js).
 *
 * A behaviour is a plain strategy object with five hooks, dispatched by
 * js/vehicles/index.js from the `vehicleType`:
 *
 *   fire(game, tank, device, dt)      per-frame firing/attack
 *   update(game, tank, dt)            per-frame component update
 *   onShellImpact(game, bullet)       arcing shell landing
 *   aim(ai, me, target, map)          AI turret-aim strategy
 *   aiThink(ai, dt, me, enemies, map, objective)
 *                                     AI think-level dispatch; returns true
 *                                     when it consumed the whole think
 */

import { Bullet } from "../bullet.js";
import { ACTIONS, CONFIG, VEHICLES } from "../config.js";

export const tank = {
    fire(game, tank, device, _dt) {
        if (!device.isDown(ACTIONS.fire) || !tank.canFire()) return;
        tank.fire();
        const fireAngle = tank.turretWorld;
        const vStats = VEHICLES[tank.vehicleType];
        const b = new Bullet(
            tank.x,
            tank.y,
            fireAngle,
            tank.playerNumber,
            tank.team,
            vStats.bulletDamage,
            vStats.bulletSpeed,
        );
        game.bullets.push(b);
        const tipX = tank.x + Math.cos(fireAngle) * CONFIG.TANK_BARREL_LENGTH;
        const tipY = tank.y + Math.sin(fireAngle) * CONFIG.TANK_BARREL_LENGTH;
        if (vStats.muzzleFlash === "ifv") game.particles.emitIFVFlash(tipX, tipY, fireAngle);
        else game.particles.emitMuzzleFlash(tipX, tipY, fireAngle);
        game.emit("fire", { tank, bullet: b });
    },

    update(_game, _tank, _dt) {},

    onShellImpact(_game, _bullet) {},

    /**
     * Standard turret aiming: steer the independent turret (or the hull
     * when the turret is disabled), then fire when aimed and LOS is
     * clear; otherwise shoot destructible terrain in front.
     */
    aim(ai, me, target, map) {
        const desiredWorld = Math.atan2(target.y - me.y, target.x - me.x);

        if (me.turretDisabled) {
            let diff = desiredWorld - me.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            if (diff > 0.08) ai.keys[ACTIONS.right] = true;
            if (diff < -0.08) ai.keys[ACTIONS.left] = true;

            if (Math.abs(diff) > 0.3) return;
        } else {
            ai.steerTurretTo(me, desiredWorld);

            const turretWorld = me.turretWorld;
            let diff = desiredWorld - turretWorld;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            if (Math.abs(diff) > 0.3) return;
        }

        if (ai.fireDelay > 0) return;

        if (map.hasLineOfSight(me.x, me.y, target.x, target.y)) {
            ai.keys[ACTIONS.fire] = true;
            ai.fireDelay = 0.25 + ai.rng() * 0.35;
            return;
        }

        ai.tryShootWall(me, map);
    },

    aiThink(_ai, _dt, _me, _enemies, _map, _objective) {
        return false;
    },
};
