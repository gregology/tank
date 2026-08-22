/**
 * Combat target selection for the AI.
 *
 * Every vehicle type declares a `targetPriority` table in VEHICLES
 * (config.js) mapping target types → desirability weight.  Candidates are
 * scored as  weight / distance; a weight of 0 means "never engage".
 *
 * This is the natural home for future lead computation — a bot aiming at
 * where a target *is heading* would call a `predictPosition(target, t)`
 * helper here and score/pass the predicted point, without touching the
 * rest of the AI.
 */

import { VEHICLES } from "../config.js";

/**
 * Pick the best target from enemies + enemy structures using
 * priority-weighted scoring:  weight / distance.
 *
 * @param {object} ai       the AIController (for `_enemyStructures`)
 * @param {object} me       the bot's own tank
 * @param {object[]} enemies array of enemy Tank objects
 * @returns {{ target: object, dist: number } | null}
 */
export function bestTarget(ai, me, enemies) {
    const priorities = VEHICLES[me.vehicleType]?.targetPriority ?? {};
    const allTargets = [...enemies, ...ai._enemyStructures];
    let best = null;
    let bestScore = -1;
    for (const e of allTargets) {
        if (!e.alive) continue;
        const w = priorities[e.targetType] ?? 1;
        if (w <= 0) continue;
        const d = Math.hypot(e.x - me.x, e.y - me.y);
        const score = w / Math.max(d, 0.5);
        if (score > bestScore) {
            best = e;
            bestScore = score;
        }
    }
    return best ? { target: best, dist: Math.hypot(best.x - me.x, best.y - me.y) } : null;
}
