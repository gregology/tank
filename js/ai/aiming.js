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

/**
 * Steer the turret offset so that `me.turretWorld` approaches
 * `desiredWorld` (a world-space angle).
 */
export function steerTurretTo(ai, me, desiredWorld) {
    let desiredOffset = desiredWorld - me.angle;
    while (desiredOffset > Math.PI) desiredOffset -= Math.PI * 2;
    while (desiredOffset < -Math.PI) desiredOffset += Math.PI * 2;

    let currentOffset = me.turretAngle;
    while (currentOffset > Math.PI) currentOffset -= Math.PI * 2;
    while (currentOffset < -Math.PI) currentOffset += Math.PI * 2;

    let diff = desiredOffset - currentOffset;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

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
