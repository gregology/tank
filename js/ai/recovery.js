/**
 * Stuck detection and recovery for the AI.
 *
 * The AI detects that it is stuck by sampling its own position history
 * (no drift + not rotating for a while).  Recovery escalates: wiggle
 * backwards and shoot the blocking terrain, then a timed evade, and
 * finally blast the nearest destructible wall.  This module only touches
 * the bot's own state (`ai.keys`, `ai.stuckTime`, `ai.evading`, …).
 */

import { ACTIONS } from "../config.js";
import { aimTurretForward, steerTurretTo } from "./aiming.js";

/**
 * Sample position/angle history and update `ai.stuckTime`: it rises
 * while the bot drifts less than 0.4 world-units (and isn't rotating),
 * and decays otherwise.
 */
export function updateStuck(ai, dt, me) {
    ai._sampleTimer -= dt;
    if (ai._sampleTimer <= 0) {
        ai._sampleTimer = 0.2;
        ai._posHistory.push({ x: me.x, y: me.y, a: me.angle });
        if (ai._posHistory.length > 12) ai._posHistory.shift();
    }
    if (ai._posHistory.length >= 5) {
        const old = ai._posHistory[0];
        const drift = Math.hypot(me.x - old.x, me.y - old.y);
        let aDiff = Math.abs(me.angle - old.a);
        if (aDiff > Math.PI) aDiff = Math.PI * 2 - aDiff;
        const rotating = aDiff > 0.3;

        ai.stuckTime = drift < 0.4 && !rotating ? ai.stuckTime + dt : Math.max(0, ai.stuckTime - dt * 4);
    }
}

/**
 * Escalate stuck recovery by how long the bot has been stuck:
 * wiggle + shoot the wall ahead, then switch to evade, then blast
 * the nearest wall outright.
 */
export function handleStuck(ai, me, map) {
    const k = ACTIONS;
    if (ai.stuckTime < 1.2) {
        ai.keys[k.backward] = true;
        ai.keys[ai.rng() > 0.5 ? k.right : k.left] = true;
        if (!me.fixedGun) aimTurretForward(ai, me);
        tryShootWall(ai, me, map);
    } else if (ai.stuckTime < 2.5) {
        ai.evading = true;
        ai.evadeTimer = 0.6 + ai.rng() * 0.8;
        ai.evadeDir = ai.rng() > 0.5 ? 1 : -1;
    } else {
        blastNearestWall(ai, me, map);
    }
}

/**
 * Timed last-resort evade: steer hard to one side and drive forward,
 * shooting anything blocking the way, until the timer runs out.
 */
export function evade(ai, dt, me, map) {
    ai.evadeTimer -= dt;
    const k = ACTIONS;
    ai.keys[ai.evadeDir > 0 ? k.right : k.left] = true;
    ai.keys[k.forward] = true;
    if (!me.fixedGun) aimTurretForward(ai, me);
    tryShootWall(ai, me, map);
    if (ai.evadeTimer <= 0) {
        ai.evading = false;
        ai.stuckTime = 0;
        ai._posHistory = [];
        ai._pathTimer = 0;
    }
}

/**
 * Fire at a destructible tile directly ahead of the turret (sampled at
 * 0.6 / 1.0 / 1.5 units) so the bot blasts its way out.
 */
export function tryShootWall(ai, me, map) {
    if (ai.fireDelay > 0) return;
    const tw = me.turretWorld;
    for (const d of [0.6, 1.0, 1.5]) {
        const ax = me.x + Math.cos(tw) * d;
        const ay = me.y + Math.sin(tw) * d;
        if (map.blocksProjectile(ax, ay)) {
            ai.keys[ACTIONS.fire] = true;
            ai.fireDelay = 0.3;
            return;
        }
    }
}

/**
 * Find the nearest destructible tile within a 3-tile box, aim at it
 * (turret, or hull for fixed-gun vehicles), fire when aligned, and back
 * up.  Resets the stuck timer so the bot tries again fresh.
 */
export function blastNearestWall(ai, me, map) {
    const k = ACTIONS;
    let bestD = Infinity,
        bestA = me.turretWorld;
    for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
            const gx = Math.floor(me.x) + dx;
            const gy = Math.floor(me.y) + dy;
            if (!map.blocksProjectile(gx + 0.5, gy + 0.5)) continue;
            const d = Math.hypot(gx + 0.5 - me.x, gy + 0.5 - me.y);
            if (d < bestD) {
                bestD = d;
                bestA = Math.atan2(gy + 0.5 - me.y, gx + 0.5 - me.x);
            }
        }
    }

    if (!me.fixedGun) {
        steerTurretTo(ai, me, bestA);
    } else {
        let diff = bestA - me.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (diff > 0.08) ai.keys[k.right] = true;
        if (diff < -0.08) ai.keys[k.left] = true;
    }

    const tw = me.turretWorld;
    let diff = bestA - tw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) < 0.2 && ai.fireDelay <= 0) {
        ai.keys[k.fire] = true;
        ai.fireDelay = 0.3;
    }
    ai.keys[k.backward] = true;
    if (ai.stuckTime > 4) {
        ai.stuckTime = 0;
        ai._posHistory = [];
        ai._path = [];
    }
}
