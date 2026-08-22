/**
 * Drone behaviour — an FPV kamikaze that doesn't shoot: it detonates
 * on command with a radial blast that damages tanks and structures
 * (distance falloff), then destroys itself.
 *
 * Drones don't aim or navigate with the normal AI flow — aiThink routes
 * to the AI's drone flight loop.
 */

import { ACTIONS, VEHICLES } from "../config.js";
import { splashStructures } from "./aoe.js";
import { animateTread, drive, rotateHull, rotateTurret } from "./tank.js";

export const drone = {
    fire(game, drone, device, _dt) {
        if (!device.isDown(ACTIONS.fire) || !drone.alive) return;

        const vStats = VEHICLES.drone;
        const blastR = vStats.blastRadius;
        const maxDmg = vStats.blastDamage;

        for (const t of game.allTanks) {
            if (!t.alive || t.team === drone.team) continue;
            const d = t.distanceToPoint(drone.x, drone.y);
            if (d >= blastR) continue;

            const dmg = maxDmg * Math.max(0, 1 - d / blastR);
            if (dmg <= 0) continue;

            game.applyHitToTank(drone, t, dmg);
        }

        splashStructures(game, drone.x, drone.y, blastR, maxDmg, drone.team);

        game.particles.emitDroneExplosion(drone.x, drone.y);
        game.emit("drone_strike", { drone });
        drone.kill();
    },

    /** Fly over everything: free rotation, fixed turret, map-bounds only. */
    move(tank, device, dt, map) {
        const oldX = tank.x,
            oldY = tank.y;
        const rotating = rotateHull(tank, device, dt, true);
        rotateTurret(tank, device, dt);
        drive(tank, device, dt, map, true);
        animateTread(tank, dt, oldX, oldY, rotating);
    },

    update(_game, _tank, _dt) {},

    onShellImpact(_game, _bullet) {},

    aim(_ai, _me, _target, _map) {},

    aiThink(ai, dt, me, enemies, map, objective) {
        ai.thinkDrone(dt, me, enemies, map, objective);
        return true;
    },
};
