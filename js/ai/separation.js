/**
 * Separation steering — boids-style local repulsion between friendly
 * vehicles.
 *
 * Many swarm goals are a single shared point (a convoy flank station,
 * an alarm tile, an objective beacon), so converging vehicles would
 * stack on top of each other — most visibly drones, which fly over
 * the collision separation.  This layer offsets the navigation goal
 * away from nearby friendlies: the goal stays the attractor, the
 * repulsion spreads the arrivals.  A vehicle's `personalSpace` radius
 * in VEHICLES (0 = unaffected) sets how much room it keeps; ground
 * vehicles stay at 0 because the convoy queue and contact separation
 * already space them.
 */

import { VEHICLES } from "../config.js";

/**
 * Offset `goal` away from friendlies within `me`'s personal space.
 * Repulsion falls off with distance and the total offset is clamped to
 * the vehicle's personal-space radius.  A ground vehicle is never
 * repelled onto an impassable tile.
 */
export function applySpacing(me, friendlies, goal, map) {
    const space = VEHICLES[me.vehicleType]?.personalSpace ?? 0;
    if (space <= 0) return goal;

    let rx = 0,
        ry = 0;
    for (const f of friendlies) {
        if (f === me || !f.alive) continue;
        const dx = me.x - f.x,
            dy = me.y - f.y;
        const d = Math.hypot(dx, dy);
        if (d >= space || d < 1e-6) continue;
        const push = (space - d) / (space * d);
        rx += (dx / d) * push;
        ry += (dy / d) * push;
    }
    const mag = Math.hypot(rx, ry);
    if (mag < 1e-6) return goal;

    const offset = Math.min(mag, 1) * space;
    const gx = goal.x + (rx / mag) * offset,
        gy = goal.y + (ry / mag) * offset;
    if (!me.flies && !map.isPassable(gx, gy)) return goal;
    return { x: gx, y: gy };
}
