/**
 * Navigation for the AI: A* path maintenance and waypoint steering.
 *
 * Bots compute a route on the tile grid (pathfinder.js), then follow
 * waypoints, skipping ahead to any further waypoint with a walkable
 * line.  `steerToPoint` is the shared "turn the hull toward a point and
 * drive" primitive.  Reactive obstacle avoidance is a light fallback for
 * dynamic obstacles (`nudge`), not the primary navigation.
 *
 * A future "tanks follow each other in columns" behaviour replaces the
 * *goal* a bot steers toward — the steering itself (`steerToPoint`)
 * stays as is.
 */

import { ACTIONS, CONFIG } from "../config.js";

/**
 * Recompute the A* route when the goal moved, the route is empty, or
 * the refresh timer elapsed.
 */
export function updatePath(ai, dt, me, goal) {
    ai._pathTimer -= dt;
    const stale = ai._pathGoal && Math.hypot(goal.x - ai._pathGoal.x, goal.y - ai._pathGoal.y) > 3;

    if (ai._pathTimer <= 0 || ai._path.length === 0 || stale) {
        ai._pathTimer = 1.2 + ai.rng() * 0.6;
        ai._pathGoal = { x: goal.x, y: goal.y };
        ai._path = ai._pf.findPath(me.x, me.y, goal.x, goal.y) ?? [];
    }
}

/**
 * Pick the best waypoint: drop waypoints we've passed, then skip ahead
 * to the farthest one with a walkable line from here (up to 8 ahead).
 */
export function pickWaypoint(ai, me, map) {
    if (ai._path.length === 0) {
        return ai._pathGoal ?? { x: me.x, y: me.y };
    }

    while (ai._path.length > 1) {
        const d = Math.hypot(ai._path[0].x - me.x, ai._path[0].y - me.y);
        if (d > 0.9) break;
        ai._path.shift();
    }

    let best = 0;
    const limit = Math.min(ai._path.length - 1, 8);
    for (let i = limit; i > 0; i--) {
        if (map.hasWalkableLine(me.x, me.y, ai._path[i].x, ai._path[i].y)) {
            best = i;
            break;
        }
    }
    return ai._path[best];
}

/**
 * Drive the hull toward `point`: rotate toward it, drive forward when
 * roughly aligned (reverse when the waypoint is behind us), and nudge
 * around obstacles directly ahead.
 *
 * @param {object}  ai       the AIController
 * @param {object}  me       the bot's own tank
 * @param {object}  point    { x, y } world position to steer to
 * @param {object}  opts     { hasPath, map } whether a real path exists,
 *                           and the map for obstacle nudging
 */
export function steerToPoint(ai, me, point, { hasPath, map }) {
    const wpDist = Math.hypot(point.x - me.x, point.y - me.y);
    const driveAngle = Math.atan2(point.y - me.y, point.x - me.x);
    let driveDiff = driveAngle - me.angle;
    while (driveDiff > Math.PI) driveDiff -= Math.PI * 2;
    while (driveDiff < -Math.PI) driveDiff += Math.PI * 2;

    const absDiff = Math.abs(driveDiff);

    if (hasPath && wpDist > 0.8) {
        if (absDiff < Math.PI * 0.8) {
            ai.keys[ACTIONS.forward] = true;
        } else {
            ai.keys[ACTIONS.backward] = true;
        }
    } else if (!hasPath && wpDist > 2.0 && absDiff < 0.6) {
        ai.keys[ACTIONS.forward] = true;
    }

    if (driveDiff > CONFIG.AIM_DEADZONE) ai.keys[ACTIONS.right] = true;
    if (driveDiff < -CONFIG.AIM_DEADZONE) ai.keys[ACTIONS.left] = true;

    if (ai.keys[ACTIONS.forward]) {
        nudge(ai, me, map);
    }
}

/** Wander in place: drive forward with a gentle sinusoidal weave. */
export function patrol(ai) {
    ai.keys[ACTIONS.forward] = true;
    ai._patrolStep = (ai._patrolStep || 0) + 1;
    if (Math.sin(ai._patrolStep * 0.023) > 0.3) ai.keys[ACTIONS.right] = true;
}

/**
 * Light reactive obstacle avoidance: if the tile straight ahead is
 * impassable, steer around it (or stop rather than drive into it).
 */
function nudge(ai, me, map) {
    const k = ACTIONS,
        a = me.angle;
    const bk = (ang, d) => !map.isPassable(me.x + Math.cos(ang) * d, me.y + Math.sin(ang) * d);
    if (!bk(a, 0.6)) return;
    if (!bk(a - 0.5, 0.8)) ai.keys[k.left] = true;
    else if (!bk(a + 0.5, 0.8)) ai.keys[k.right] = true;
    else ai.keys[k.forward] = false;
}
