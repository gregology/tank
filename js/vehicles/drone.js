/**
 * Drone behaviour — an FPV kamikaze that doesn't shoot: it detonates
 * on command with a radial blast that damages tanks and structures
 * (distance falloff), then destroys itself.
 *
 * Drones don't aim or navigate with the normal AI flow — aiThink routes
 * to the AI's drone flight loop, which takes its goal from the swarm
 * (chooseSwarmGoal) and flies straight (drones fly over everything).
 */

import { patrol } from "../ai/navigation.js";
import { chooseSwarmGoal, spacingOffset } from "../ai/swarm/behaviours.js";
import { targetPriorityOf } from "../ai/targeting.js";
import { ACTIONS, BASE_STRUCTURES, CONFIG, VEHICLES } from "../config.js";
import { GAME_EVENTS } from "../events.js";
import { angleDiff } from "../utils.js";
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

    aiThink(ai, dt, me, enemies, map) {
        const { navGoal, fireTarget } = chooseSwarmGoal(ai, dt, me, enemies, map);
        ai.currentGoal = navGoal;

        // If we have a fire target nearby, prioritise diving at it.
        let target = navGoal;
        if (fireTarget && fireTarget.dist < 20) {
            target = fireTarget.target;
        }

        if (!target) {
            patrol(ai);
            return true;
        }

        // Navigate directly (drones fly over everything), bent by spacing.
        const spacing = spacingOffset(ai, me);
        const tx = target.x + spacing.x,
            ty = target.y + spacing.y;
        const desired = Math.atan2(ty - me.y, tx - me.x);
        const diff = angleDiff(me.angle, desired);

        if (diff > CONFIG.AIM_DEADZONE) ai.keys[ACTIONS.right] = true;
        if (diff < -CONFIG.AIM_DEADZONE) ai.keys[ACTIONS.left] = true;

        const dist = Math.hypot(tx - me.x, ty - me.y);
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
        // Check discovered objectives (e.g. the enemy base's HQ).
        for (const obj of ai.swarm.intel.objectives()) {
            const d = Math.hypot(obj.x - me.x, obj.y - me.y);
            const size = obj.entity.hq?.size ?? BASE_STRUCTURES.baseHQ.size;
            if (d < detonateRange + size) {
                ai.keys[ACTIONS.fire] = true;
                return true;
            }
        }
        return true;
    },
};
