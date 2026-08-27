/**
 * Combat target selection for the AI and turrets.
 *
 * `pickTarget` is the shared weighted-targeting core: it scores alive
 * candidates as `priority weight / distance` and picks the highest, with
 * optional range and line-of-sight filters.  The AI (`bestTarget`) and the
 * watch towers (game.js) both use it.  The one deliberate variant is squad
 * members, who pick the *closest* primary-over-fallback target (see
 * `squad.js#pickSquadTarget`) — their scoring is distance, not weight.
 *
 * This is the natural home for future lead computation — a bot aiming at
 * where a target *is heading* would call a `predictPosition(target, t)`
 * helper here and score/pass the predicted point, without touching the
 * rest of the AI.
 */

import { TARGET_CLASS_DEFAULTS, TARGET_TYPES, VEHICLES } from "../config.js";

/**
 * Resolve a shooter's priority weight for a target type: an explicit
 * override in the shooter's table, then the target's class default, then 1.
 * This is what flattens the old O(N²) targetPriority matrix — a new target
 * type is one `TARGET_TYPES` entry (inheriting its class default) instead
 * of an edit to every shooter's table.
 */
export function targetPriorityOf(priorities, targetType) {
    if (priorities[targetType] != null) return priorities[targetType];
    const cls = TARGET_TYPES[targetType]?.class;
    return (cls && TARGET_CLASS_DEFAULTS[cls]) ?? 1;
}

/**
 * Pick the best candidate from `candidates` using priority-weighted
 * scoring:  weight / distance.
 *
 * @param {object[]} candidates  targets with x/y + targetType (+ alive)
 * @param {object}   priorities  targetType → desirability weight (0 = never)
 * @param {{x:number,y:number}} origin  position the target is scored from
 * @param {object}   [opts]
 * @param {number}   [opts.range=Infinity]       maximum distance to consider
 * @param {(x1:number,y1:number,x2:number,y2:number)=>boolean} [opts.hasLineOfSight]
 * @returns {{ target: object, dist: number } | null}
 */
export function pickTarget(candidates, priorities, origin, { range = Infinity, hasLineOfSight = null } = {}) {
    let best = null;
    let bestScore = -1;
    for (const e of candidates) {
        if (!e.alive) continue;
        const w = targetPriorityOf(priorities, e.targetType);
        if (w <= 0) continue;
        const d = Math.hypot(e.x - origin.x, e.y - origin.y);
        if (d > range) continue;
        if (hasLineOfSight && !hasLineOfSight(origin.x, origin.y, e.x, e.y)) continue;
        const score = w / Math.max(d, 0.5);
        if (score > bestScore) {
            best = e;
            bestScore = score;
        }
    }
    return best ? { target: best, dist: Math.hypot(best.x - origin.x, best.y - origin.y) } : null;
}

/**
 * Pick the best target from enemies + discovered enemy structures using
 * priority-weighted scoring:  weight / distance.
 *
 * Structures are fog-of-war: only ones the faction has discovered
 * (sight + LOS, tracked by the swarm's intel) are considered.
 *
 * @param {object} ai       the AIController (for the swarm intel)
 * @param {object} me       the bot's own tank
 * @param {object[]} enemies array of enemy Tank objects
 * @param {object} [opts]
 * @param {number} [opts.range=Infinity]  maximum distance to consider
 * @returns {{ target: object, dist: number } | null}
 */
export function bestTarget(ai, me, enemies, { range = Infinity } = {}) {
    const priorities = VEHICLES[me.vehicleType]?.targetPriority ?? {};
    return pickTarget([...enemies, ...ai.swarm.intel.knownStructures()], priorities, me, { range });
}
