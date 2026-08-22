/**
 * Drone behaviour — an FPV kamikaze that doesn't shoot: it detonates
 * on command with a radial blast that damages tanks and structures
 * (distance falloff), then destroys itself.
 *
 * Drones don't aim or navigate with the normal AI flow — aiThink routes
 * to the AI's drone flight loop.
 */

import { patrol } from "../ai/navigation.js";
import { chooseGoalAndTarget } from "../ai/roles.js";
import { targetPriorityOf } from "../ai/targeting.js";
import { ACTIONS, BASE_STRUCTURES, CONFIG, VEHICLES } from "../config.js";
import { GAME_EVENTS } from "../events.js";
import { applyBlast } from "./aoe.js";
import { animateTread, drive, rotateHull, rotateTurret } from "./tank.js";

export const drone = {
    fire(game, drone, device, _dt) {
        if (!device.isDown(ACTIONS.fire) || !drone.alive) return;

        const vStats = VEHICLES.drone;
        const blastR = vStats.blastRadius;
        const maxDmg = vStats.blastDamage;

        applyBlast(game, drone.x, drone.y, blastR, maxDmg, drone.team);

        game.particles.emit("droneExplosion", drone.x, drone.y);
        game.emit(GAME_EVENTS.DRONE_STRIKE, { drone });
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

    aim(_ai, _me, _target, _map) {},

    aiThink(ai, dt, me, enemies, map, objective) {
        const { navGoal, fireTarget } = chooseGoalAndTarget(ai, dt, me, enemies, map, objective);

        // If we have a fire target nearby, prioritise diving at it.
        let target = navGoal;
        if (fireTarget && fireTarget.dist < 20) {
            target = { x: fireTarget.x, y: fireTarget.y };
        }

        if (!target) {
            patrol(ai);
            return true;
        }

        // Navigate directly (drones fly over everything).
        const desired = Math.atan2(target.y - me.y, target.x - me.x);
        let diff = desired - me.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (diff > CONFIG.AIM_DEADZONE) ai.keys[ACTIONS.right] = true;
        if (diff < -CONFIG.AIM_DEADZONE) ai.keys[ACTIONS.left] = true;

        const dist = Math.hypot(target.x - me.x, target.y - me.y);
        if (Math.abs(diff) < Math.PI * 0.7 && dist > 0.5) {
            ai.keys[ACTIONS.forward] = true;
        }

        // Detonate when nearly on top of a valid target (point-blank = max
        // damage); skip targets with priority 0 so the blast isn't wasted.
        const detonateRange = VEHICLES.drone.blastRadius * 0.3 + VEHICLES.tank.size;
        const priorities = VEHICLES[me.vehicleType]?.targetPriority ?? {};
        for (const e of enemies) {
            if (!e.alive) continue;
            if (targetPriorityOf(priorities, e.targetType) <= 0) continue;
            const d = Math.hypot(e.x - me.x, e.y - me.y);
            if (d < detonateRange) {
                ai.keys[ACTIONS.fire] = true;
                return true;
            }
        }
        // Check the objective (tower).
        if (objective?.alive) {
            const d = Math.hypot(objective.x - me.x, objective.y - me.y);
            if (d < detonateRange + BASE_STRUCTURES.baseHQ.size) {
                ai.keys[ACTIONS.fire] = true;
            }
        }
        return true;
    },
};
