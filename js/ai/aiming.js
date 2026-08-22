/**
 * Turret-aiming primitives for the AI.
 *
 * The turret rotates independently of the hull using the turretLeft /
 * turretRight virtual keys; `me.turretAngle` is a hull-relative offset.
 * `steerTurretTo` converts a desired world-space turret angle into the
 * right steering keys — the shared primitive every aiming strategy
 * (vehicle `aim` hooks, stuck recovery) builds on.  Future lead-aiming
 * ("put the round where the target is heading") only needs to change the
 * *desired* angle computed by the caller; this module stays untouched.
 */

import { ACTIONS } from "../config.js";
import { angleDiff } from "../utils.js";

/**
 * Steer the turret offset so that `me.turretWorld` approaches
 * `desiredWorld` (a world-space angle).
 */
export function steerTurretTo(ai, me, desiredWorld) {
    const diff = angleDiff(me.turretWorld, desiredWorld);
    if (diff > 0.05) ai.keys[ACTIONS.turretRight] = true;
    if (diff < -0.05) ai.keys[ACTIONS.turretLeft] = true;
}

/** Point the turret straight ahead (used while recovering from being stuck). */
export function aimTurretForward(ai, me) {
    steerTurretTo(ai, me, me.angle);
}

/**
 * Refresh the aim-wobble perturbation on its timer.  Wobble is the
 * accepted ~5% AI nondeterminism; it makes bots miss occasionally so
 * they read as fallible rather than aimbot-precise.
 */
export function updateWobble(ai, dt) {
    ai.wobbleTimer -= dt;
    if (ai.wobbleTimer <= 0) {
        ai.aimWobble = (ai.rng() - 0.5) * 0.15;
        ai.wobbleTimer = 0.5 + ai.rng() * 1.0;
    }
}
